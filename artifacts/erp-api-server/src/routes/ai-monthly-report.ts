import { Router, type IRouter } from "express";
import { tenantPool as pool } from "../lib/tenant-db";
import { requireRole } from "../middleware/require-auth";
import { resolveAiProvider, temperatureParam } from "../lib/ai-provider";
import { aiFetch } from "../lib/ai-client";

const router: IRouter = Router();
router.use("/ai", requireRole("owner", "admin", "accountant"));

// 供應商與模型由環境設定決定（見 lib/ai-provider.ts）
const { baseUrl: OPENAI_BASE, apiKey: OPENAI_KEY, model: AI_MODEL } = resolveAiProvider("strong");

async function chatJson(messages: { role: string; content: string }[]): Promise<string> {
  if (!OPENAI_BASE || !OPENAI_KEY) throw new Error("OpenAI integration not configured");
  const res = await aiFetch(`${OPENAI_BASE}/chat/completions`, {
    method: "POST",
    headers: { "Authorization": `Bearer ${OPENAI_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: AI_MODEL,
      messages,
      response_format: { type: "json_object" },
      ...temperatureParam(AI_MODEL, 0.3),
    }),
  });
  if (!res.ok) throw new Error(`OpenAI ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data: any = await res.json();
  return data.choices?.[0]?.message?.content || "";
}

function monthRange(year: number, month: number): { start: string; end: string } {
  const start = `${year}-${String(month).padStart(2, "0")}-01`;
  const next = month === 12 ? { y: year + 1, m: 1 } : { y: year, m: month + 1 };
  const end = `${next.y}-${String(next.m).padStart(2, "0")}-01`;
  return { start, end };
}

function pct(curr: number, prev: number): number | null {
  if (!prev) return null;
  return ((curr - prev) / prev) * 100;
}

interface MonthlyKpi {
  period: { year: number; month: number; start: string; end: string };
  prevPeriod: { year: number; month: number };
  kpis: {
    sales: { total: number; count: number; prev: number; pctChange: number | null };
    purchase: { total: number; count: number; prev: number; pctChange: number | null };
    arOutstanding: number;
    apOutstanding: number;
    newCustomers: number;
    journalEntryCount: number;
    journalUnbalanced: number;
  };
  topCustomers: Array<{ name: string; total: number }>;
  topItems: Array<{ name: string; qty: number; revenue: number }>;
  byDepartment: Array<{ department: string; total: number }>;
}

router.get("/ai/monthly-report", async (req, res): Promise<void> => {
  const now = new Date();
  const year = Number(req.query.year) || now.getFullYear();
  const month = Number(req.query.month) || (now.getMonth() + 1);
  if (year < 2000 || year > 2100 || month < 1 || month > 12) {
    res.status(400).json({ error: "年份或月份無效" }); return;
  }
  const { start, end } = monthRange(year, month);
  const prevYear = month === 1 ? year - 1 : year;
  const prevMonth = month === 1 ? 12 : month - 1;
  const prev = monthRange(prevYear, prevMonth);

  const client = await pool.connect();
  let kpi: MonthlyKpi;
  try {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    await client.query("SET LOCAL statement_timeout = '15000ms'");

    const [salesCur, salesPrev, purCur, purPrev, ar, ap, newCust, jeStats, topCust, topItem, byDept] = await Promise.all([
      client.query(`SELECT COALESCE(SUM(total_amount::numeric),0) AS total, COUNT(*)::int AS cnt FROM sales_orders WHERE order_date >= $1 AND order_date < $2 AND status NOT IN ('Cancelled','Draft')`, [start, end]),
      client.query(`SELECT COALESCE(SUM(total_amount::numeric),0) AS total FROM sales_orders WHERE order_date >= $1 AND order_date < $2 AND status NOT IN ('Cancelled','Draft')`, [prev.start, prev.end]),
      client.query(`SELECT COALESCE(SUM(total_amount::numeric),0) AS total, COUNT(*)::int AS cnt FROM purchase_orders WHERE order_date >= $1 AND order_date < $2 AND status NOT IN ('Cancelled','Draft')`, [start, end]),
      client.query(`SELECT COALESCE(SUM(total_amount::numeric),0) AS total FROM purchase_orders WHERE order_date >= $1 AND order_date < $2 AND status NOT IN ('Cancelled','Draft')`, [prev.start, prev.end]),
      client.query(`SELECT COALESCE(SUM(outstanding_amount::numeric),0) AS total FROM invoices WHERE invoice_type IN ('Sales','Sales Invoice') AND status NOT IN ('Cancelled','Paid','Draft')`),
      client.query(`SELECT COALESCE(SUM(outstanding_amount::numeric),0) AS total FROM invoices WHERE invoice_type IN ('Purchase','Purchase Invoice') AND status NOT IN ('Cancelled','Paid','Draft')`),
      client.query(`SELECT COUNT(*)::int AS cnt FROM customers WHERE created_at >= $1 AND created_at < $2`, [start, end]),
      client.query(`SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE ABS(total_debit::numeric - total_credit::numeric) > 0.01)::int AS unbalanced FROM journal_entries WHERE entry_date >= $1 AND entry_date < $2 AND status IN ('Posted','Submitted')`, [start, end]),
      client.query(`SELECT COALESCE(c.name, '(未命名)') AS name, COALESCE(SUM(so.total_amount::numeric),0) AS total
                    FROM sales_orders so LEFT JOIN customers c ON c.id = so.customer_id
                    WHERE so.order_date >= $1 AND so.order_date < $2 AND so.status NOT IN ('Cancelled','Draft')
                    GROUP BY c.id, c.name ORDER BY total DESC LIMIT 5`, [start, end]),
      client.query(`SELECT COALESCE(item->>'item_name', item->>'itemName', '(未命名商品)') AS name,
                           COALESCE(SUM((item->>'qty')::numeric), SUM((item->>'quantity')::numeric), 0) AS qty,
                           COALESCE(SUM((item->>'amount')::numeric), 0) AS revenue
                    FROM sales_orders so, jsonb_array_elements(so.items) AS item
                    WHERE so.order_date >= $1 AND so.order_date < $2 AND so.status NOT IN ('Cancelled','Draft')
                    GROUP BY name ORDER BY revenue DESC NULLS LAST LIMIT 5`, [start, end]),
      client.query(`SELECT COALESCE(d.name, '(無部門)') AS department, COALESCE(SUM(so.total_amount::numeric),0) AS total
                    FROM sales_orders so LEFT JOIN departments d ON d.id = so.department_id
                    WHERE so.order_date >= $1 AND so.order_date < $2 AND so.status NOT IN ('Cancelled','Draft')
                    GROUP BY d.id, d.name ORDER BY total DESC LIMIT 8`, [start, end]),
    ]);

    await client.query("COMMIT");

    const salesT = Number(salesCur.rows[0].total);
    const salesP = Number(salesPrev.rows[0].total);
    const purT = Number(purCur.rows[0].total);
    const purP = Number(purPrev.rows[0].total);

    kpi = {
      period: { year, month, start, end },
      prevPeriod: { year: prevYear, month: prevMonth },
      kpis: {
        sales: { total: salesT, count: salesCur.rows[0].cnt, prev: salesP, pctChange: pct(salesT, salesP) },
        purchase: { total: purT, count: purCur.rows[0].cnt, prev: purP, pctChange: pct(purT, purP) },
        arOutstanding: Number(ar.rows[0].total),
        apOutstanding: Number(ap.rows[0].total),
        newCustomers: newCust.rows[0].cnt,
        journalEntryCount: jeStats.rows[0].total,
        journalUnbalanced: jeStats.rows[0].unbalanced,
      },
      topCustomers: topCust.rows.map((r: any) => ({ name: r.name, total: Number(r.total) })),
      topItems: topItem.rows.map((r: any) => ({ name: r.name, qty: Number(r.qty), revenue: Number(r.revenue) })),
      byDepartment: byDept.rows.map((r: any) => ({ department: r.department, total: Number(r.total) })),
    };
  } catch (e: any) {
    try { await client.query("ROLLBACK"); } catch {}
    (req as any).log?.error({ err: e.message }, "monthly KPI failed");
    res.status(500).json({ error: "KPI 查詢失敗：" + e.message });
    return;
  } finally {
    client.release();
  }

  // AI 撰寫月報
  let report: any = null;
  try {
    const text = await chatJson([
      {
        role: "system",
        content: `你是一個資深財務分析師，幫公司寫月度經營報告。請只回 JSON：
{
  "title": "YYYY 年 M 月經營報告",
  "executive_summary": "1 段（4-6 句繁體中文）的高層摘要，提到關鍵數字與趨勢",
  "sections": [
    { "title": "區段標題", "body": "段落內容（繁體中文，可有換行）", "highlights": ["重點1","重點2"] }
  ],
  "recommendations": ["建議1","建議2","建議3"]
}

要求：
- 至少 4 個 sections：銷售、採購、應收應付、客戶/部門結構
- 金額用千分位 + NT$ 前綴
- 與上月比較時用百分比並判斷趨勢
- 如果有 unbalanced journal entries 要在報告中提醒
- 整體文字專業但平易，避免堆砌專業術語`,
      },
      {
        role: "user",
        content: `期間：${year} 年 ${month} 月（${start} ~ ${end}，與 ${prevYear} 年 ${prevMonth} 月比較）

KPI 資料（JSON）：
${JSON.stringify(kpi, null, 2)}`,
      },
    ]);
    report = JSON.parse(text);
  } catch (e: any) {
    (req as any).log?.error({ err: e.message }, "AI report write failed");
    res.status(502).json({ error: "AI 撰寫失敗：" + e.message, kpi });
    return;
  }

  res.json({ kpi, report });
});

export default router;
