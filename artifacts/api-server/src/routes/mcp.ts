/**
 * Bot 連線入口（MCP，Streamable HTTP，無狀態）。
 *
 * 外部 Bot 以金鑰（Authorization: Bearer <key>）連到 POST /api/mcp，
 * 能用的工具與後台 AI 助理完全相同（同一份 toolDefinitions、同一組執行函式）。
 *
 * 安全規則與後台 AI 助理一致：
 * - 查詢類工具直接回傳。
 * - 操作類工具只建立「待確認操作」，不會執行；必須由後台人員登入後按確認才執行。
 *   Bot（模型）沒有任何方法可以自己確認。
 */
import { randomUUID } from "node:crypto";
import { Router, type IRouter, type Request } from "express";
import rateLimit from "express-rate-limit";
import { and, eq } from "drizzle-orm";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import {
  db,
  aiActionLogsTable,
  mcpApiKeysTable,
  membersTable,
} from "@workspace/db";
import {
  ACTION_TOOLS,
  MCP_CONFIRM_TTL_MS,
  READ_TOOLS,
  createPendingMcpAction,
  executeTool,
  toolDefinitions,
} from "../lib/assistantTools";
import { hashApiKey } from "../lib/newsletter";
import { chargeAiCredits, INSUFFICIENT_CREDITS_MESSAGE } from "../lib/aiCredits";

const router: IRouter = Router();

const STATUS_TOOL = "get_action_status";

/** 每個來源每分鐘最多 60 次請求 */
const mcpLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "請求過於頻繁，請稍後再試" },
});

/** 提供給 Bot 的工具清單：與後台 AI 助理同一份定義，只拿掉模型不可使用的 confirmationId */
function buildToolList() {
  const tools = toolDefinitions.map((def) => {
    const fn = def.function;
    const params = fn.parameters as {
      type: string;
      properties?: Record<string, unknown>;
      required?: string[];
    };
    const { confirmationId: _omit, ...properties } = params.properties ?? {};
    const isAction = ACTION_TOOLS.has(fn.name);
    return {
      name: fn.name,
      description: isAction
        ? `${fn.description}（此工具不會直接執行：只會建立待確認操作並回傳確認連結，須由後台人員登入後按確認才生效。）`
        : fn.description,
      inputSchema: {
        type: "object" as const,
        properties,
        ...(params.required ? { required: params.required } : {}),
      },
    };
  });
  tools.push({
    name: STATUS_TOOL,
    description:
      "查詢先前建立的待確認操作目前的狀態：pending（等待後台人員確認）、ok（已確認並執行完成）、rejected（已被拒絕）、error（執行失敗）。",
    inputSchema: {
      type: "object" as const,
      properties: {
        confirmationId: {
          type: "integer",
          description: "建立待確認操作時回傳的確認碼",
        },
      },
      required: ["confirmationId"],
    },
  });
  return tools;
}

function publicBaseUrl(req: Request): string {
  const configured = process.env.PUBLIC_BASE_URL?.trim().replace(/\/+$/, "");
  if (configured) return configured;
  const host = String(req.headers["x-forwarded-host"] ?? req.headers.host ?? "")
    .split(",")[0]
    .trim();
  return `${req.protocol}://${host}`;
}

const asText = (value: unknown, isError = false) => ({
  content: [{ type: "text" as const, text: JSON.stringify(value) }],
  ...(isError ? { isError: true } : {}),
});

router.all("/mcp", mcpLimiter, async (req, res): Promise<void> => {
  if (req.method !== "POST") {
    res.status(405).set("Allow", "POST").json({ error: "僅支援 POST" });
    return;
  }

  // ---- 金鑰驗證 ----
  const header = req.headers.authorization;
  const rawKey = header?.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!rawKey) {
    res.status(401).json({ error: "缺少金鑰（Authorization: Bearer <key>）" });
    return;
  }
  let key: typeof mcpApiKeysTable.$inferSelect | undefined;
  let actor: typeof membersTable.$inferSelect | undefined;
  try {
    [key] = await db
      .select()
      .from(mcpApiKeysTable)
      .where(eq(mcpApiKeysTable.keyHash, hashApiKey(rawKey)))
      .limit(1);
    if (key?.isActive) {
      [actor] = await db
        .select()
        .from(membersTable)
        .where(eq(membersTable.id, key.memberId))
        .limit(1);
    }
  } catch (err) {
    req.log.error({ err }, "mcp key lookup failed");
    res.status(500).json({ error: "Internal error" });
    return;
  }
  // 金鑰代表的後台人員必須仍在職且仍是管理員或營運，否則金鑰失效
  if (
    !key ||
    !key.isActive ||
    !actor ||
    !actor.isActive ||
    !["admin", "ops"].includes(actor.role)
  ) {
    res.status(401).json({ error: "金鑰無效或已停用" });
    return;
  }
  void db
    .update(mcpApiKeysTable)
    .set({ lastUsedAt: new Date() })
    .where(eq(mcpApiKeysTable.id, key.id))
    .then(() => {})
    .catch(() => {});

  if (Array.isArray(req.body)) {
    res.status(400).json({ error: "不支援批次請求" });
    return;
  }

  const keyId = key.id;
  const actorId = actor.id;
  const baseUrl = publicBaseUrl(req);

  const server = new Server(
    { name: "qiqi-admin-assistant", version: "1.0.0" },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: buildToolList(),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const name = request.params.name;
    const args = (request.params.arguments ?? {}) as Record<string, unknown>;

    if (name === STATUS_TOOL) {
      const id = Number(args.confirmationId);
      if (!Number.isInteger(id)) return asText({ error: "confirmationId 無效" }, true);
      const [row] = await db
        .select({
          id: aiActionLogsTable.id,
          action: aiActionLogsTable.action,
          status: aiActionLogsTable.status,
          result: aiActionLogsTable.result,
          createdAt: aiActionLogsTable.createdAt,
        })
        .from(aiActionLogsTable)
        .where(
          and(
            eq(aiActionLogsTable.id, id),
            eq(aiActionLogsTable.mcpKeyId, keyId),
          ),
        )
        .limit(1);
      if (!row) return asText({ error: "找不到這筆操作" }, true);
      const expired =
        row.status === "pending" &&
        row.createdAt.getTime() < Date.now() - MCP_CONFIRM_TTL_MS;
      return asText({
        confirmationId: row.id,
        action: row.action,
        status: expired ? "expired" : row.status,
        result: row.result,
      });
    }

    // Bot 每呼叫一次功能扣 1 點（查詢操作狀態不扣）；點數不足時不執行
    if (READ_TOOLS.has(name) || ACTION_TOOLS.has(name)) {
      if (!(await chargeAiCredits(1, `Bot 連線：${name}`, actorId)))
        return asText({ error: INSUFFICIENT_CREDITS_MESSAGE }, true);
    }

    if (READ_TOOLS.has(name)) {
      // 查詢類：與後台 AI 助理走同一個執行函式
      const { result, isError } = await executeTool(name, args, {
        memberId: actorId,
        memberRole: "ops",
        conversationId: 0,
        requestNonce: `mcp:${keyId}`,
      });
      return asText(result, isError);
    }

    if (ACTION_TOOLS.has(name)) {
      if ("confirmationId" in args) {
        return asText(
          { error: "Bot 不可確認或執行待確認操作；請由後台人員開啟確認連結。" },
          true,
        );
      }
      const confirmationId = await createPendingMcpAction(name, args, {
        memberId: actorId,
        mcpKeyId: keyId,
        requestNonce: `mcp:${keyId}:${randomUUID()}`,
      });
      return asText({
        requiresConfirmation: true,
        confirmationId,
        confirmUrl: `${baseUrl}/admin/bot?action=${confirmationId}`,
        expiresInMinutes: Math.round(MCP_CONFIRM_TTL_MS / 60000),
        notice:
          "此操作尚未執行。請把操作內容與確認連結提供給後台人員；對方登入後台按下確認後才會執行。之後可用 get_action_status 查詢結果。",
      });
    }

    return asText({ error: `未知工具 ${name}` }, true);
  });

  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  res.on("close", () => {
    void transport.close();
    void server.close();
  });
  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (err) {
    req.log.error({ err }, "mcp request failed");
    if (!res.headersSent) res.status(500).json({ error: "Internal error" });
  }
});

export default router;
