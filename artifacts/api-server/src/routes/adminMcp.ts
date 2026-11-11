/**
 * Bot 連線管理（後台）：
 * - 金鑰：建立、停用、刪除（僅系統管理員）。明碼只在建立當下回傳一次。
 * - 待確認操作：Bot 送出的操作在這裡由後台人員確認或拒絕（系統管理員與營運）。
 */
import { randomBytes } from "node:crypto";
import { Router, type IRouter } from "express";
import { and, desc, eq, isNotNull } from "drizzle-orm";
import {
  db,
  aiActionLogsTable,
  mcpApiKeysTable,
  membersTable,
} from "@workspace/db";
import { requireAdmin, requireOps } from "../middlewares/requireMember";
import {
  MCP_CONFIRM_TTL_MS,
  confirmAndExecuteMcpAction,
  rejectMcpAction,
} from "../lib/assistantTools";
import { hashApiKey } from "../lib/newsletter";

const router: IRouter = Router();

function serializeKey(
  k: typeof mcpApiKeysTable.$inferSelect,
  memberName: string | null,
) {
  return {
    id: k.id,
    name: k.name,
    keyLastFour: k.keyLastFour,
    memberId: k.memberId,
    memberName: memberName ?? "",
    isActive: k.isActive,
    lastUsedAt: k.lastUsedAt ? k.lastUsedAt.toISOString() : null,
    createdAt: k.createdAt.toISOString(),
  };
}

router.get("/admin/mcp/keys", requireAdmin, async (_req, res) => {
  const rows = await db
    .select({ key: mcpApiKeysTable, memberName: membersTable.name })
    .from(mcpApiKeysTable)
    .leftJoin(membersTable, eq(mcpApiKeysTable.memberId, membersTable.id))
    .orderBy(desc(mcpApiKeysTable.createdAt));
  res.json(rows.map((r) => serializeKey(r.key, r.memberName)));
});

router.post("/admin/mcp/keys", requireAdmin, async (req, res) => {
  const name =
    typeof req.body?.name === "string" ? req.body.name.trim().slice(0, 80) : "";
  if (!name) {
    res.status(400).json({ error: "請填寫金鑰名稱" });
    return;
  }
  // 金鑰代表建立它的管理員；Bot 送出的操作都記在這位管理員名下
  const rawKey = `qqbot_${randomBytes(32).toString("hex")}`;
  const [row] = await db
    .insert(mcpApiKeysTable)
    .values({
      name,
      keyHash: hashApiKey(rawKey),
      keyLastFour: rawKey.slice(-4),
      memberId: req.member!.id,
    })
    .returning();
  res.status(201).json({ ...serializeKey(row, req.member!.name), key: rawKey });
});

router.patch("/admin/mcp/keys/:id", requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || typeof req.body?.isActive !== "boolean") {
    res.status(400).json({ error: "參數錯誤" });
    return;
  }
  const [row] = await db
    .update(mcpApiKeysTable)
    .set({ isActive: req.body.isActive })
    .where(eq(mcpApiKeysTable.id, id))
    .returning();
  if (!row) {
    res.status(404).json({ error: "找不到金鑰" });
    return;
  }
  const [member] = await db
    .select({ name: membersTable.name })
    .from(membersTable)
    .where(eq(membersTable.id, row.memberId))
    .limit(1);
  res.json(serializeKey(row, member?.name ?? null));
});

router.delete("/admin/mcp/keys/:id", requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "參數錯誤" });
    return;
  }
  await db.delete(mcpApiKeysTable).where(eq(mcpApiKeysTable.id, id));
  res.json({ success: true });
});

/** Bot 送出的操作（最新 50 筆）；status=pending 只看待確認 */
router.get("/admin/mcp/actions", requireOps, async (req, res) => {
  const status = typeof req.query.status === "string" ? req.query.status : "";
  const conditions = [isNotNull(aiActionLogsTable.mcpKeyId)];
  if (status) conditions.push(eq(aiActionLogsTable.status, status));
  const rows = await db
    .select({
      log: aiActionLogsTable,
      keyName: mcpApiKeysTable.name,
    })
    .from(aiActionLogsTable)
    .leftJoin(mcpApiKeysTable, eq(aiActionLogsTable.mcpKeyId, mcpApiKeysTable.id))
    .where(and(...conditions))
    .orderBy(desc(aiActionLogsTable.createdAt))
    .limit(50);
  const cutoff = Date.now() - MCP_CONFIRM_TTL_MS;
  res.json(
    rows.map(({ log, keyName }) => ({
      id: log.id,
      action: log.action,
      payload: log.payload,
      status:
        log.status === "pending" && log.createdAt.getTime() < cutoff
          ? "expired"
          : log.status,
      result: log.result,
      keyName: keyName ?? "（金鑰已刪除）",
      confirmedBy: log.confirmedBy ?? null,
      createdAt: log.createdAt.toISOString(),
    })),
  );
});

router.post("/admin/mcp/actions/:id/confirm", requireOps, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "參數錯誤" });
    return;
  }
  const execution = await confirmAndExecuteMcpAction(id, {
    memberId: req.member!.id,
    memberRole: req.member!.role,
  });
  if (!execution.ok) {
    res.status(execution.status).json({ error: execution.error });
    return;
  }
  res.json({ ok: true, action: execution.action, result: execution.result });
});

router.post("/admin/mcp/actions/:id/reject", requireOps, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "參數錯誤" });
    return;
  }
  const rejected = await rejectMcpAction(id, req.member!.id);
  if (!rejected) {
    res.status(409).json({ error: "待確認操作不存在或已處理" });
    return;
  }
  res.json({ success: true });
});

export default router;
