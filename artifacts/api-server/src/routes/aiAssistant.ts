import { Router, type IRouter } from "express";
import { and, asc, desc, eq, gt } from "drizzle-orm";
import { openai } from "@workspace/integrations-openai-ai-server";
import type OpenAI from "openai";
import { db, conversations, messages, aiActionLogsTable } from "@workspace/db";
import { requireOps, requireAdmin } from "../middlewares/requireMember";
import { toolDefinitions, executeTool, ACTION_TOOLS } from "../lib/assistantTools";
import { backfillAll, embeddingEnabled } from "../lib/aiIndex";

const router: IRouter = Router();

/**
 * AI 行政助理（後台大腦）
 * - POST /admin/assistant/conversations           建立對話
 * - GET  /admin/assistant/conversations           對話列表
 * - GET  /admin/assistant/conversations/:id/messages 歷史訊息
 * - POST /admin/assistant/conversations/:id/messages 送出訊息（工具呼叫迴圈，非串流）
 * - POST /admin/ai-index/rebuild                  全量重建知識庫索引（僅系統管理員）
 */

const SYSTEM_PROMPT = `你是「七期生醫」後台的 AI 行政助理，是營運後台的操作中樞。使用繁體中文回答。

你可以使用工具查詢內建 ERP 的所有資料（商品、庫存、訂單、會員、機構、錢包、佣金、財務、文章），並在管理者確認後執行操作（建立訂單、調整庫存、變更訂單狀態、機構錢包儲值、文章上下架）。

規則：
1. 查詢類問題直接使用工具取得即時數據回答，數字要精確，不可臆測。
2. 操作類工具採「兩段式確認」：第一次呼叫（不帶 confirmationId）不會執行，只會回傳 confirmationId 與待確認內容。收到後，向管理者完整複述操作內容（對象、品項、數量、金額）並請其確認。
3. 只有在管理者於「下一則訊息」明確同意（例如「確認」「可以」「執行吧」）後，才以相同參數加上該 confirmationId 再次呼叫工具完成執行。confirmationId 為單次有效、10 分鐘內有效。若管理者拒絕或修改內容，放棄舊確認碼並重新提出。
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
    ? `目前有待確認操作：工具 ${pendingAction.action}，confirmationId=${pendingAction.id}，參數 ${JSON.stringify(pendingAction.payload)}。若管理者這一則訊息是明確同意，請以相同參數加上 confirmationId=${pendingAction.id} 呼叫該工具執行；若拒絕或要求修改，忽略此確認碼。`
    : null;
  const chatMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: "system", content: SYSTEM_PROMPT },
    ...(pendingNote ? [{ role: "system" as const, content: pendingNote }] : []),
    ...kept
      .reverse()
      .map((m) => ({ role: m.role as "user" | "assistant", content: m.content.slice(0, 4000) })),
  ];

  const executed: Array<{ tool: string; isAction: boolean; isError: boolean }> = [];
  const requestNonce = `${id}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  try {
    let finalText = "";
    for (let round = 0; round < 6; round++) {
      const completion = await openai.chat.completions.create({
        model: "gpt-5.6-terra",
        max_completion_tokens: 8192,
        messages: chatMessages,
        tools: toolDefinitions,
      });
      const msg = completion.choices[0]?.message;
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
          executed.push({ tool: call.function.name, isAction: ACTION_TOOLS.has(call.function.name), isError });
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
