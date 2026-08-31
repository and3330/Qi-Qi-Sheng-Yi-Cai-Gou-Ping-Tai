import { Router, type IRouter } from "express";
import { and, asc, desc, eq } from "drizzle-orm";
import { openai } from "@workspace/integrations-openai-ai-server";
import type OpenAI from "openai";
import { db, conversations, messages, membersTable } from "@workspace/db";
import { requireMember, requireStaff } from "../middlewares/requireMember";
import { searchDocuments } from "../lib/aiIndex";

const router: IRouter = Router();

/**
 * AI 衛教客服（會員端）
 * - POST /support/conversations                    建立對話
 * - GET  /support/conversations                    我的對話列表
 * - GET  /support/conversations/:id/messages       歷史訊息
 * - POST /support/conversations/:id/messages       送出訊息（RAG 回覆附來源；必要時轉真人）
 * 真人客服（客服角色）
 * - GET  /admin/support/conversations              全部對話（可篩 needsHuman）
 * - GET  /admin/support/conversations/:id/messages 檢視
 * - POST /admin/support/conversations/:id/reply    真人回覆
 * - POST /admin/support/conversations/:id/close    結案
 */

const SUPPORT_PROMPT = `你是「七期生醫」的 AI 衛教客服，使用繁體中文，語氣親切專業。

規則（務必遵守）：
1. 只根據提供的「知識庫內容」回答衛教與商品相關問題；每次回答結尾列出引用的來源標題（格式：「參考：〈標題〉」）。
2. 絕對不可診斷疾病、判讀症狀、建議用藥或劑量。遇到這類問題，回覆「這個問題涉及診斷或用藥，建議您諮詢醫師或合作醫院」，並在回覆的最後一行單獨輸出「[轉真人]」。
3. 若知識庫內容不足以回答、或你對答案沒有把握，誠實告知並在最後一行單獨輸出「[轉真人]」，請真人客服協助。
4. 避免任何療效宣稱（不可使用「治療」「治癒」「療效」等字眼描述商品），遵守食品藥物廣告規範。
5. 訂單、付款、帳號等個人資料問題，引導會員至「會員中心」查詢；無法處理時輸出「[轉真人]」。
6. 回覆簡潔，200 字以內為原則。`;

router.post("/support/conversations", requireMember, async (req, res) => {
  const [row] = await db
    .insert(conversations)
    .values({ kind: "support", memberId: req.member!.id, title: "客服對話" })
    .returning();
  res.status(201).json({ id: row.id, title: row.title, status: row.status, needsHuman: row.needsHuman, createdAt: row.createdAt.toISOString() });
});

router.get("/support/conversations", requireMember, async (req, res) => {
  const rows = await db
    .select()
    .from(conversations)
    .where(and(eq(conversations.kind, "support"), eq(conversations.memberId, req.member!.id)))
    .orderBy(desc(conversations.createdAt))
    .limit(20);
  res.json(
    rows.map((r) => ({ id: r.id, title: r.title, status: r.status, needsHuman: r.needsHuman, createdAt: r.createdAt.toISOString() })),
  );
});

function serializeSupportMessage(m: typeof messages.$inferSelect) {
  return {
    id: m.id,
    role: m.role,
    content: m.content,
    metadata: m.metadata,
    createdAt: m.createdAt.toISOString(),
  };
}

router.get("/support/conversations/:id/messages", requireMember, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const [conv] = await db
    .select()
    .from(conversations)
    .where(and(eq(conversations.id, id), eq(conversations.kind, "support"), eq(conversations.memberId, req.member!.id)))
    .limit(1);
  if (!conv) {
    res.status(404).json({ error: "找不到此對話" });
    return;
  }
  const rows = await db.select().from(messages).where(eq(messages.conversationId, id)).orderBy(asc(messages.id));
  res.json({
    conversation: { id: conv.id, status: conv.status, needsHuman: conv.needsHuman },
    messages: rows.map(serializeSupportMessage),
  });
});

router.post("/support/conversations/:id/messages", requireMember, async (req, res) => {
  const id = Number(req.params.id);
  const content = typeof req.body?.content === "string" ? req.body.content.trim() : "";
  if (!Number.isInteger(id) || !content) {
    res.status(400).json({ error: "訊息不可為空" });
    return;
  }
  if (content.length > 1000) {
    res.status(400).json({ error: "訊息過長" });
    return;
  }
  const [conv] = await db
    .select()
    .from(conversations)
    .where(and(eq(conversations.id, id), eq(conversations.kind, "support"), eq(conversations.memberId, req.member!.id)))
    .limit(1);
  if (!conv) {
    res.status(404).json({ error: "找不到此對話" });
    return;
  }
  if (conv.status === "closed") {
    res.status(400).json({ error: "此對話已結案，請建立新對話" });
    return;
  }

  await db.insert(messages).values({ conversationId: id, role: "user", content });

  // 已轉真人的對話不再由 AI 回覆，等待客服
  if (conv.needsHuman) {
    res.json({ reply: null, needsHuman: true });
    return;
  }

  try {
    // RAG：只檢索已發佈內容
    const docs = await searchDocuments(content, { scope: "public", limit: 5 });
    const knowledge = docs.length
      ? docs.map((d, i) => `【${i + 1}】〈${d.title.replace(/^(衛教文章|FAQ|公告)：/, "")}〉\n${d.content.slice(0, 1200)}`).join("\n\n")
      : "（沒有找到相關內容）";

    const history = await db
      .select()
      .from(messages)
      .where(eq(messages.conversationId, id))
      .orderBy(desc(messages.id))
      .limit(10);
    const chatMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [
      { role: "system", content: SUPPORT_PROMPT },
      { role: "system", content: `知識庫內容：\n${knowledge}` },
      ...history
        .reverse()
        .filter((m) => m.role === "user" || m.role === "assistant" || m.role === "agent")
        .map((m) => ({
          role: (m.role === "user" ? "user" : "assistant") as "user" | "assistant",
          content: m.content,
        })),
    ];

    const completion = await openai.chat.completions.create({
      model: "gpt-5.6-terra",
      max_completion_tokens: 8192,
      messages: chatMessages,
    });
    let reply = completion.choices[0]?.message?.content ?? "";
    const needsHuman = reply.includes("[轉真人]");
    reply = reply.replace(/\[轉真人\]/g, "").trim();
    if (!reply) reply = "很抱歉，這個問題需要真人客服協助，我們會盡快回覆您。";

    const sources = docs.map((d) => d.title.replace(/^(衛教文章|FAQ|公告)：/, ""));
    const [saved] = await db
      .insert(messages)
      .values({
        conversationId: id,
        role: "assistant",
        content: reply,
        metadata: { sources, needsHuman },
      })
      .returning();
    if (needsHuman) {
      await db.update(conversations).set({ needsHuman: true }).where(eq(conversations.id, id));
    }
    res.json({ reply: serializeSupportMessage(saved), needsHuman });
  } catch (err) {
    console.error("[support] chat failed:", err);
    res.status(502).json({ error: "客服系統忙碌中，請稍後再試" });
  }
});

// ---------- 真人客服（後台） ----------

router.get("/admin/support/conversations", requireStaff, async (req, res) => {
  const onlyNeedsHuman = req.query.needsHuman === "true";
  const conds = [eq(conversations.kind, "support")];
  if (onlyNeedsHuman) conds.push(eq(conversations.needsHuman, true));
  const rows = await db
    .select({
      conv: conversations,
      memberName: membersTable.name,
      memberUsername: membersTable.username,
    })
    .from(conversations)
    .innerJoin(membersTable, eq(conversations.memberId, membersTable.id))
    .where(and(...conds))
    .orderBy(desc(conversations.createdAt))
    .limit(100);
  res.json(
    rows.map((r) => ({
      id: r.conv.id,
      memberName: r.memberName,
      memberUsername: r.memberUsername,
      status: r.conv.status,
      needsHuman: r.conv.needsHuman,
      createdAt: r.conv.createdAt.toISOString(),
    })),
  );
});

router.get("/admin/support/conversations/:id/messages", requireStaff, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const [conv] = await db
    .select()
    .from(conversations)
    .where(and(eq(conversations.id, id), eq(conversations.kind, "support")))
    .limit(1);
  if (!conv) {
    res.status(404).json({ error: "找不到此對話" });
    return;
  }
  const rows = await db.select().from(messages).where(eq(messages.conversationId, id)).orderBy(asc(messages.id));
  res.json({
    conversation: { id: conv.id, status: conv.status, needsHuman: conv.needsHuman },
    messages: rows.map(serializeSupportMessage),
  });
});

router.post("/admin/support/conversations/:id/reply", requireStaff, async (req, res) => {
  const id = Number(req.params.id);
  const content = typeof req.body?.content === "string" ? req.body.content.trim() : "";
  if (!Number.isInteger(id) || !content) {
    res.status(400).json({ error: "訊息不可為空" });
    return;
  }
  const [conv] = await db
    .select()
    .from(conversations)
    .where(and(eq(conversations.id, id), eq(conversations.kind, "support")))
    .limit(1);
  if (!conv) {
    res.status(404).json({ error: "找不到此對話" });
    return;
  }
  const [saved] = await db
    .insert(messages)
    .values({
      conversationId: id,
      role: "agent",
      content,
      metadata: { agentId: req.member!.id, agentName: req.member!.name },
    })
    .returning();
  res.status(201).json(serializeSupportMessage(saved));
});

router.post("/admin/support/conversations/:id/close", requireStaff, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const [row] = await db
    .update(conversations)
    .set({ status: "closed", needsHuman: false })
    .where(and(eq(conversations.id, id), eq(conversations.kind, "support")))
    .returning();
  if (!row) {
    res.status(404).json({ error: "找不到此對話" });
    return;
  }
  res.json({ ok: true });
});

export default router;
