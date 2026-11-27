import { Router, type IRouter } from "express";
import { and, asc, desc, eq, gt } from "drizzle-orm";
import { chatCompletion } from "@workspace/integrations-openai-ai-server";
import type OpenAI from "openai";
import { db, conversations, messages, aiActionLogsTable } from "@workspace/db";
import { requireOps, requireAdmin } from "../middlewares/requireMember";
import {
  toolDefinitions,
  executeTool,
  confirmAndExecuteAction,
  ACTION_TOOLS,
} from "../lib/assistantTools";
import { backfillAll, embeddingEnabled } from "../lib/aiIndex";
import { chargeAiCredits, INSUFFICIENT_CREDITS_MESSAGE } from "../lib/aiCredits";

const router: IRouter = Router();

/**
 * AI 行政助理（後台大腦）
 * - POST /admin/assistant/conversations           建立對話
 * - GET  /admin/assistant/conversations           對話列表
 * - GET  /admin/assistant/conversations/:id/messages 歷史訊息
 * - POST /admin/assistant/conversations/:id/messages 送出訊息（工具呼叫迴圈，非串流）
 * - POST /admin/assistant/conversations/:id/actions/:actionId/confirm 管理者明確確認操作
 * - POST /admin/ai-index/rebuild                  全量重建知識庫索引（僅系統管理員）
 */

const SYSTEM_PROMPT = `你是「七期生醫」後台的 AI 行政助理，是營運後台的操作中樞。使用繁體中文回答。

你可以使用工具查詢內建 ERP 的所有資料（商品、庫存、訂單、會員、機構、錢包、佣金、財務、文章），並在管理者確認後執行操作（建立訂單、調整庫存、變更訂單狀態、機構錢包儲值、文章上下架）。

規則：
1. 查詢類問題直接使用工具取得即時數據回答，數字要精確，不可臆測。
2. 操作類工具採「兩段式確認」：第一次呼叫（不帶 confirmationId）不會執行，只會建立待確認操作。收到後，向管理者完整複述操作內容（對象、品項、數量、金額），並請其使用介面上的「確認執行」按鈕。
3. 一般對話中的「確認」「可以」「執行吧」都不構成授權，也不可用 confirmationId 呼叫工具。管理者按下確認按鈕後，伺服器會直接執行已保存的參數，不需要也不允許你再次執行。確認碼為單次有效、10 分鐘內有效。
4. 金額單位為新台幣元。日期使用 YYYY-MM-DD。
5. 回覆精簡、條列清楚；統計結果用表格或列點呈現。
6. 你只能透過提供的工具存取資料，不要編造工具沒有回傳的內容。
7. 所有操作都會留下稽核紀錄。機構錢包儲值僅限系統管理員。`;

router.post("/admin/assistant/conversations", requireOps, async (req, res) => {
  const title =
    typeof req.body?.title === "string" && req.body.title.trim()
      ? req.body.title.trim().slice(0, 80)
      : "新對話";
  const [row] = await db
    .insert(conversations)
    .values({ kind: "admin", memberId: req.member!.id, title })
    .returning();
  res.status(201).json({ id: row.id, title: row.title, createdAt: row.createdAt.toISOString() });
});

router.get("/admin/assistant/conversations", requireOps, async (req, res) => {
  const rows = await db
    .select()
    .from(conversations)
    .where(and(eq(conversations.kind, "admin"), eq(conversations.memberId, req.member!.id)))
    .orderBy(desc(conversations.createdAt))
    .limit(50);
  res.json(rows.map((r) => ({ id: r.id, title: r.title, createdAt: r.createdAt.toISOString() })));
});

async function loadConversation(id: number, memberId: number, kind: string) {
  const [conv] = await db
    .select()
    .from(conversations)
    .where(and(eq(conversations.id, id), eq(conversations.kind, kind), eq(conversations.memberId, memberId)))
    .limit(1);
  return conv ?? null;
}

router.get("/admin/assistant/conversations/:id/messages", requireOps, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const conv = await loadConversation(id, req.member!.id, "admin");
  if (!conv) {
    res.status(404).json({ error: "找不到此對話" });
    return;
  }
  const rows = await db
    .select()
    .from(messages)
    .where(eq(messages.conversationId, id))
    .orderBy(asc(messages.id));
  res.json(
    rows
      .filter((m) => m.role === "user" || m.role === "assistant")
      .map((m) => ({
        id: m.id,
        role: m.role,
        content: m.content,
        metadata: m.metadata,
        createdAt: m.createdAt.toISOString(),
      })),
  );
});

router.post(
  "/admin/assistant/conversations/:id/actions/:actionId/confirm",
  requireOps,
  async (req, res) => {
    const conversationId = Number(req.params.id);
    const actionId = Number(req.params.actionId);
    if (!Number.isInteger(conversationId) || !Number.isInteger(actionId)) {
      res.status(400).json({ error: "Invalid id" });
      return;
    }
    const conv = await loadConversation(conversationId, req.member!.id, "admin");
    if (!conv) {
      res.status(404).json({ error: "找不到此對話" });
      return;
    }
    const execution = await confirmAndExecuteAction(actionId, {
      memberId: req.member!.id,
      memberRole: req.member!.role,
      conversationId,
    });
    if (!execution.ok) {
      res.status(execution.status).json({ error: execution.error });
      return;
    }
    const [saved] = await db
      .insert(messages)
      .values({
        conversationId,
        role: "assistant",
        content: "操作已由管理者確認並執行完成。",
        metadata: {
          tools: [
            {
              tool: execution.action,
              isAction: true,
              isError: false,
              status: "executed",
            },
          ],
        },
      })
      .returning();
    res.json({
      ok: true,
      confirmationId: actionId,
      action: execution.action,
      result: execution.result,
      message: {
        id: saved.id,
        role: saved.role,
        content: saved.content,
        metadata: saved.metadata,
        createdAt: saved.createdAt.toISOString(),
      },
    });
  },
);

router.post("/admin/assistant/conversations/:id/messages", requireOps, async (req, res) => {
  const id = Number(req.params.id);
  const content = typeof req.body?.content === "string" ? req.body.content.trim() : "";
  if (!Number.isInteger(id) || !content) {
    res.status(400).json({ error: "訊息不可為空" });
    return;
  }
  if (content.length > 4000) {
    res.status(400).json({ error: "訊息過長（上限 4000 字）" });
    return;
  }
  const conv = await loadConversation(id, req.member!.id, "admin");
  if (!conv) {
    res.status(404).json({ error: "找不到此對話" });
    return;
  }

  await db.insert(messages).values({ conversationId: id, role: "user", content });
  if (conv.title === "新對話") {
    await db
      .update(conversations)
      .set({ title: content.slice(0, 40) })
      .where(eq(conversations.id, id));
  }

  // 帶入最近 30 則歷史
  const history = await db
    .select()
    .from(messages)
    .where(eq(messages.conversationId, id))
    .orderBy(desc(messages.id))
    .limit(30);
  // 聚合上限：歷史合計 24000 字內（由最新往回取）
  const ordered = history.filter((m) => m.role === "user" || m.role === "assistant");
  const kept: typeof ordered = [];
  let budget = 24000;
  for (const m of ordered) {
    const cost = Math.min(m.content.length, 4000);
    if (budget - cost < 0) break;
    budget -= cost;
    kept.push(m);
  }
  // 若有尚未執行的待確認操作，注入系統提示（工具回傳不會保存在歷史中）
  const [pendingAction] = await db
    .select()
    .from(aiActionLogsTable)
    .where(
      and(
        eq(aiActionLogsTable.conversationId, id),
        eq(aiActionLogsTable.status, "pending"),
        gt(aiActionLogsTable.createdAt, new Date(Date.now() - 10 * 60 * 1000)),
      ),
    )
    .orderBy(desc(aiActionLogsTable.id))
    .limit(1);
  const pendingNote = pendingAction
    ? `目前有待確認操作：工具 ${pendingAction.action}，confirmationId=${pendingAction.id}，參數 ${JSON.stringify(pendingAction.payload)}。不論本次對話文字為何，都不可加上 confirmationId 呼叫工具；只有管理者按下介面上的確認按鈕時，伺服器才會直接執行。`
    : null;
  const chatMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: "system", content: SYSTEM_PROMPT },
    ...(pendingNote ? [{ role: "system" as const, content: pendingNote }] : []),
    ...kept
      .reverse()
      .map((m) => ({ role: m.role as "user" | "assistant", content: m.content.slice(0, 4000) })),
  ];

  const executed: Array<{
    tool: string;
    isAction: boolean;
    isError: boolean;
    status?: "pending" | "executed";
    confirmationId?: number;
  }> = [];
  // 每則送給 AI 的訊息扣 1 點；點數不足時不呼叫模型
  if (!(await chargeAiCredits(1, "AI 助理對話", req.member!.id))) {
    res.status(402).json({ error: INSUFFICIENT_CREDITS_MESSAGE });
    return;
  }
  const requestNonce = `${id}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  try {
    let finalText = "";
    for (let round = 0; round < 6; round++) {
      const msg = await chatCompletion({
        maxTokens: 8192,
        messages: chatMessages,
        tools: toolDefinitions,
      });
      if (!msg) break;
      if (msg.tool_calls?.length) {
        chatMessages.push(msg);
        for (const call of msg.tool_calls) {
          if (call.type !== "function") continue;
          let args: unknown = {};
          try {
            args = JSON.parse(call.function.arguments || "{}");
          } catch {
            /* 保持空物件 */
          }
          const { result, isError } = await executeTool(call.function.name, args, {
            memberId: req.member!.id,
            memberRole: req.member!.role,
            conversationId: id,
            requestNonce,
          });
          const isAction = ACTION_TOOLS.has(call.function.name);
          const confirmationId =
            isAction &&
            result &&
            typeof result === "object" &&
            "requiresConfirmation" in result &&
            result.requiresConfirmation === true &&
            "confirmationId" in result &&
            typeof result.confirmationId === "number"
              ? result.confirmationId
              : undefined;
          executed.push({
            tool: call.function.name,
            isAction,
            isError,
            status: isAction ? (confirmationId ? "pending" : "executed") : undefined,
            confirmationId,
          });
          chatMessages.push({
            role: "tool",
            tool_call_id: call.id,
            content: JSON.stringify(result).slice(0, 8000),
          });
        }
        continue;
      }
      finalText = msg.content ?? "";
      break;
    }
    if (!finalText) finalText = "抱歉，這次處理逾時，請再試一次或縮小問題範圍。";

    const [saved] = await db
      .insert(messages)
      .values({
        conversationId: id,
        role: "assistant",
        content: finalText,
        metadata: executed.length ? { tools: executed } : {},
      })
      .returning();
    res.json({
      id: saved.id,
      role: "assistant",
      content: finalText,
      metadata: saved.metadata,
      createdAt: saved.createdAt.toISOString(),
    });
  } catch (err) {
    console.error("[assistant] chat failed:", err);
    res.status(502).json({ error: "AI 服務暫時無法回應，請稍後再試" });
  }
});

router.post("/admin/ai-index/rebuild", requireAdmin, async (_req, res) => {
  try {
    const counts = await backfillAll();
    res.json({ ok: true, embedding: embeddingEnabled() ? "vector" : "keyword", counts });
  } catch (err) {
    console.error("[aiIndex] rebuild failed:", err);
    res.status(500).json({ error: "索引重建失敗" });
  }
});

export default router;
