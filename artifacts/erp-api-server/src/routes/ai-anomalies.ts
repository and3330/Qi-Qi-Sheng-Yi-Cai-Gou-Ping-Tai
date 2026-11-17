import { Router, type IRouter } from "express";
import { tenantPool as pool } from "../lib/tenant-db";
import { requireRole } from "../middleware/require-auth";
import { resolveAiProvider, temperatureParam } from "../lib/ai-provider";
import { aiFetch } from "../lib/ai-client";

const router: IRouter = Router();
router.use("/ai", requireRole("owner", "admin", "accountant"));

// 供應商與模型由環境設定決定（見 lib/ai-provider.ts）
const { baseUrl: OPENAI_BASE, apiKey: OPENAI_KEY, model: AI_MODEL } = resolveAiProvider("strong");

interface ChatMsg { role: "system" | "user" | "assistant"; content: string }

async function chatJson(messages: ChatMsg[]): Promise<string> {
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
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`OpenAI ${res.status}: ${t.slice(0, 300)}`);
  }
  const json: any = await res.json();
  return json.choices?.[0]?.message?.content || "";
}

interface Candidate {
  category: string;
  rule: string;
  ref: string;          // 單號
  date: string;
  amount: number;
  detail: string;       // 額外資訊（差額、重複次數等）
  meta?: Record<string, any>;
}

router.get("/ai/anomalies", async (req, res): Promise<void> => {
  const days = Math.max(1, Math.min(365, Number(req.query.days) || 30));
  const sinceDate = new Date(Date.now() - days * 86400_000).toISOString().slice(0, 10);

  const candidates: Candidate[] = [];
  const client = await pool.connect();

  try {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    await client.query("SET LOCAL statement_timeout = '15000ms'");

    // 1) 不平衡傳票（總借 ≠ 總貸 且已過帳）
    {
      const r = await client.query(`
        SELECT entry_number, entry_date, total_debit::numeric AS d, total_credit::numeric AS c, status, description
        FROM journal_entries
        WHERE entry_date >= $1 AND status IN ('Posted','Submitted')
          AND ABS(total_debit::numeric - total_credit::numeric) > 0.01
        ORDER BY ABS(total_debit::numeric - total_credit::numeric) DESC
        LIMIT 30
      `, [sinceDate]);
      for (const row of r.rows) {
        const diff = Math.abs(Number(row.d) - Number(row.c));
        candidates.push({
          category: "不平衡傳票",
          rule: "借貸不平",
          ref: row.entry_number,
          date: row.entry_date,
          amount: Math.max(Number(row.d), Number(row.c)),
          detail: `借 ${Number(row.d).toLocaleString()} / 貸 ${Number(row.c).toLocaleString()} / 差 ${diff.toLocaleString()}`,
          meta: { debit: row.d, credit: row.c, diff },
        });
      }
    }

    // 2) 疑似重複付款 / 重複發票（同供應商 + 同金額 7 天內出現 ≥2 次）
    {
      const r = await client.query(`
        WITH dups AS (
          SELECT supplier_id, total_amount::numeric AS amt, COUNT(*) AS cnt,
                 MIN(invoice_date) AS first_d, MAX(invoice_date) AS last_d,
                 array_agg(invoice_number ORDER BY invoice_date) AS refs
          FROM invoices
          WHERE invoice_date >= $1
            AND invoice_type IN ('Purchase','Purchase Invoice')
            AND status NOT IN ('Cancelled','Draft')
            AND supplier_id IS NOT NULL
            AND total_amount::numeric > 0
          GROUP BY supplier_id, total_amount::numeric
          HAVING COUNT(*) >= 2
            AND MAX(invoice_date)::date - MIN(invoice_date)::date <= 7
        )
        SELECT d.*, s.name AS supplier_name
        FROM dups d
        LEFT JOIN suppliers s ON s.id = d.supplier_id
        ORDER BY d.amt DESC
        LIMIT 20
      `, [sinceDate]);
      for (const row of r.rows) {
        candidates.push({
          category: "疑似重複付款",
          rule: "同供應商同金額 7 天內重複",
          ref: (row.refs || []).slice(0, 3).join(", "),
          date: row.last_d,
          amount: Number(row.amt),
          detail: `${row.supplier_name || "(未命名供應商)"} · 重複 ${row.cnt} 次 · ${row.first_d} ~ ${row.last_d}`,
          meta: row,
        });
      }
    }

    // 3) 採購單重複（同供應商同金額 7 天內 ≥2）
    {
      const r = await client.query(`
        WITH dups AS (
          SELECT supplier_id, total_amount::numeric AS amt, COUNT(*) AS cnt,
                 MIN(order_date) AS first_d, MAX(order_date) AS last_d,
                 array_agg(order_number ORDER BY order_date) AS refs
          FROM purchase_orders
          WHERE order_date >= $1
            AND status NOT IN ('Cancelled','Draft')
            AND total_amount::numeric > 0
          GROUP BY supplier_id, total_amount::numeric
          HAVING COUNT(*) >= 2
            AND MAX(order_date)::date - MIN(order_date)::date <= 7
        )
        SELECT d.*, s.name AS supplier_name
        FROM dups d
        LEFT JOIN suppliers s ON s.id = d.supplier_id
        ORDER BY d.amt DESC
        LIMIT 20
      `, [sinceDate]);
      for (const row of r.rows) {
        candidates.push({
          category: "疑似重複採購",
          rule: "同供應商同金額 7 天內重複",
          ref: (row.refs || []).slice(0, 3).join(", "),
          date: row.last_d,
          amount: Number(row.amt),
          detail: `${row.supplier_name || "(未命名供應商)"} · 重複 ${row.cnt} 次 · ${row.first_d} ~ ${row.last_d}`,
          meta: row,
        });
      }
    }

    // 4) 異常金額（journal_entries 期間內超過 99 百分位的離群值）
    {
      const r = await client.query(`
        WITH stats AS (
          SELECT percentile_cont(0.99) WITHIN GROUP (ORDER BY total_debit::numeric) AS p99,
                 percentile_cont(0.50) WITHIN GROUP (ORDER BY total_debit::numeric) AS median
          FROM journal_entries WHERE entry_date >= $1 AND total_debit::numeric > 0
        )
        SELECT je.entry_number, je.entry_date, je.total_debit::numeric AS amt, je.description, s.p99, s.median
        FROM journal_entries je, stats s
        WHERE je.entry_date >= $1
          AND je.total_debit::numeric > s.p99
          AND je.status IN ('Posted','Submitted')
        ORDER BY je.total_debit::numeric DESC
        LIMIT 15
      `, [sinceDate]);
      for (const row of r.rows) {
        candidates.push({
          category: "異常大額傳票",
          rule: `金額超過期間 99 百分位 (NT$${Number(row.p99).toLocaleString(undefined,{maximumFractionDigits:0})})`,
          ref: row.entry_number,
          date: row.entry_date,
          amount: Number(row.amt),
          detail: row.description || "(無說明)",
          meta: { p99: row.p99, median: row.median },
        });
      }
    }

    // 5) 週末建立的傳票（容易是補做或異常）
    {
      const r = await client.query(`
        SELECT entry_number, entry_date, total_debit::numeric AS amt, description, created_at
        FROM journal_entries
        WHERE entry_date >= $1
          AND EXTRACT(DOW FROM created_at) IN (0, 6)
          AND total_debit::numeric > 10000
        ORDER BY total_debit::numeric DESC
        LIMIT 15
      `, [sinceDate]);
      for (const row of r.rows) {
        candidates.push({
          category: "週末建立傳票",
          rule: "週六/週日建立、金額 > NT$10,000",
          ref: row.entry_number,
          date: row.entry_date,
          amount: Number(row.amt),
          detail: row.description || "(無說明)",
          meta: { createdAt: row.created_at },
        });
      }
    }

    await client.query("COMMIT");
  } catch (e: any) {
    try { await client.query("ROLLBACK"); } catch {}
    (req as any).log?.error({ err: e.message }, "anomaly query failed");
    res.status(500).json({ error: "查詢失敗：" + e.message });
    return;
  } finally {
    client.release();
  }

  // AI prioritization & explanation
  let summary = `期間 ${sinceDate} ~ 今天，共偵測到 ${candidates.length} 筆候選異常。`;
  let aiAnalysis: { topRisks?: string[]; recommendation?: string } = {};

  if (candidates.length > 0) {
    try {
      const compact = candidates.slice(0, 80).map((c) => ({
        category: c.category,
        ref: c.ref,
        date: c.date,
        amount: c.amount,
        detail: c.detail,
      }));
      const text = await chatJson([
        {
          role: "system",
          content: `你是一個資深會計與內部稽核員。請審視候選異常清單，回覆 JSON：
- summary: 一段繁體中文（2-3 句）總結整體狀況、最值得關注的類別
- topRisks: 陣列（最多 5 項），每項是繁體中文短句說明該筆為何高風險（要包含單號）
- recommendation: 一段繁體中文（1-2 句）建議下一步動作

只回 JSON。`,
        },
        {
          role: "user",
          content: `期間：最近 ${days} 天\n候選清單（共 ${candidates.length}，前 80 筆）：\n${JSON.stringify(compact, null, 2)}`,
        },
      ]);
      const parsed = JSON.parse(text);
      summary = parsed.summary || summary;
      aiAnalysis = { topRisks: parsed.topRisks, recommendation: parsed.recommendation };
    } catch (e: any) {
      (req as any).log?.warn({ err: e.message }, "AI anomaly analysis failed");
    }
  }

  // Group by category
  const byCategory: Record<string, Candidate[]> = {};
  for (const c of candidates) {
    if (!byCategory[c.category]) byCategory[c.category] = [];
    byCategory[c.category].push(c);
  }

  res.json({
    period: { days, since: sinceDate },
    totalCount: candidates.length,
    summary,
    topRisks: aiAnalysis.topRisks || [],
    recommendation: aiAnalysis.recommendation || "",
    byCategory,
  });
});

export default router;
