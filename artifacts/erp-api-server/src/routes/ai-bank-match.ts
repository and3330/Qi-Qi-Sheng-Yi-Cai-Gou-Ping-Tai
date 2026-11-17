import { Router, type IRouter } from "express";
import { eq, and, sql, gte, lte } from "drizzle-orm";
import { db, bankReconciliationEntriesTable, vouchersTable } from "@workspace/erp-db";
import { requireRole } from "../middleware/require-auth";
import { resolveAiProvider, temperatureParam } from "../lib/ai-provider";
import { aiFetch } from "../lib/ai-client";

const router: IRouter = Router();
router.use("/ai/bank-match", requireRole("owner", "admin", "accountant", "manager"));

// 供應商與模型由環境設定決定（見 lib/ai-provider.ts）
const { baseUrl: OPENAI_BASE, apiKey: OPENAI_KEY, model: AI_MODEL } = resolveAiProvider("small");

async function chatJson(messages: { role: string; content: string }[]): Promise<string> {
  if (!OPENAI_BASE || !OPENAI_KEY) throw new Error("OpenAI integration not configured");
  const res = await aiFetch(`${OPENAI_BASE}/chat/completions`, {
    method: "POST",
    headers: { "Authorization": `Bearer ${OPENAI_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: AI_MODEL,
      messages,
      response_format: { type: "json_object" },
      ...temperatureParam(AI_MODEL, 0),
    }),
  });
  if (!res.ok) throw new Error(`OpenAI ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data: any = await res.json();
  return data.choices?.[0]?.message?.content || "";
}

/**
 * AI 對帳建議：針對未配對的銀行明細，找出候選傳票（金額相近、日期相近），
 * 由 AI 依摘要/日期/金額綜合判斷，回傳建議配對與信心度（不自動套用）。
 */
router.post("/ai/bank-match/:statementId", async (req, res): Promise<void> => {
  const statementId = Number(req.params.statementId);
  if (isNaN(statementId)) { res.status(400).json({ error: "Invalid ID" }); return; }

  const entries = await db.select().from(bankReconciliationEntriesTable)
    .where(and(
      eq(bankReconciliationEntriesTable.statementId, statementId),
      eq(bankReconciliationEntriesTable.matchStatus, "Unmatched"),
    ));
  if (entries.length === 0) { res.json({ suggestions: [] }); return; }

  // 每筆明細找候選傳票：金額 ±1%、日期 ±14 天，最多 8 個候選
  const suggestions: any[] = [];
  const aiBatch: any[] = [];

  for (const entry of entries.slice(0, 30)) {
    const amount = Number(entry.debit) > 0 ? Number(entry.debit) : Number(entry.credit);
    if (!amount) continue;
    const lo = String(Math.floor(amount * 0.99 * 100) / 100);
    const hi = String(Math.ceil(amount * 1.01 * 100) / 100);
    const dateLo = new Date(new Date(entry.transactionDate).getTime() - 14 * 86400000).toISOString().slice(0, 10);
    const dateHi = new Date(new Date(entry.transactionDate).getTime() + 14 * 86400000).toISOString().slice(0, 10);

    const candidates = await db.select({
      id: vouchersTable.id,
      voucherNumber: vouchersTable.voucherNumber,
      voucherDate: vouchersTable.voucherDate,
      totalAmount: vouchersTable.totalAmount,
      description: vouchersTable.description,
    }).from(vouchersTable)
      .where(and(
        gte(vouchersTable.totalAmount, lo),
        lte(vouchersTable.totalAmount, hi),
        gte(vouchersTable.voucherDate, dateLo),
        lte(vouchersTable.voucherDate, dateHi),
        sql`${vouchersTable.status} != 'Cancelled'`,
      )).limit(8);

    if (candidates.length === 0) continue;
    if (candidates.length === 1 && Number(candidates[0].totalAmount) === amount) {
      // 唯一且金額完全相同 → 高信心，不需 AI
      suggestions.push({
        entryId: entry.id, entryDescription: entry.description, entryDate: entry.transactionDate, amount,
        voucherId: candidates[0].id, voucherNumber: candidates[0].voucherNumber,
        confidence: "high", reason: "唯一候選且金額完全相符",
      });
      continue;
    }
    aiBatch.push({ entry, amount, candidates });
  }

  // 需要 AI 判斷的批次
  if (aiBatch.length > 0) {
    try {
      const out = await chatJson([
        { role: "system", content: `你是資深會計。針對每筆銀行交易，從候選傳票中選出最可能的配對（或回 null）。回 JSON：{"matches":[{"entryId":數字,"voucherId":數字或null,"confidence":"high|medium|low","reason":"繁中一句"}]}` },
        { role: "user", content: JSON.stringify(aiBatch.map(b => ({
            entryId: b.entry.id,
            date: b.entry.transactionDate,
            description: b.entry.description,
            reference: b.entry.reference,
            amount: b.amount,
            candidates: b.candidates.map((c: any) => ({ voucherId: c.id, voucherNumber: c.voucherNumber, date: c.voucherDate, amount: Number(c.totalAmount), description: c.description })),
          }))) },
      ]);
      const parsed = JSON.parse(out);
      for (const m of parsed.matches || []) {
        if (!m.voucherId) continue;
        const b = aiBatch.find(x => x.entry.id === m.entryId);
        const cand = b?.candidates.find((c: any) => c.id === m.voucherId);
        if (!b || !cand) continue;
        suggestions.push({
          entryId: b.entry.id, entryDescription: b.entry.description, entryDate: b.entry.transactionDate, amount: b.amount,
          voucherId: cand.id, voucherNumber: cand.voucherNumber,
          confidence: m.confidence || "medium", reason: m.reason || "",
        });
      }
    } catch (err: any) {
      // AI 失敗不阻斷：仍回傳規則式建議
      (req as any).log?.warn({ err: err.message }, "ai bank match failed");
    }
  }

  res.json({ suggestions, unmatchedCount: entries.length });
});

export default router;
