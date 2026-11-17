import { DEAD_INVOICE_SQL, SALES_TYPES_SQL, isSalesType } from "./enums";
import { tenantPool } from "../tenant-db";
import { computeRfm, unitCost, type CustomerInvoiceAgg } from "./compute";
import { loadCashSettlements } from "./executive";
import { metric, monthsBetween, num, period, ratio } from "./range";
import type { SalesResponse } from "./types";

type Range = { startDate: string; endDate: string; days: number };
const LIVE_INVOICE = `invoice_type IN ${SALES_TYPES_SQL} AND status NOT IN ${DEAD_INVOICE_SQL}`;
const LIVE_INVOICE_I = `i.invoice_type IN ${SALES_TYPES_SQL} AND i.status NOT IN ${DEAD_INVOICE_SQL}`;

async function loadSalesFacts(r: Range) {
  const p = [r.startDate, r.endDate];
  const [inv, ret, cust, items, quotes, rfm] = await Promise.all([
    tenantPool.query(`SELECT substr(invoice_date,1,7) AS month, COUNT(*)::int AS n, SUM(COALESCE(net_amount, total_amount))::float AS amount
                        FROM invoices WHERE ${LIVE_INVOICE} AND invoice_date >= $1 AND invoice_date <= $2 GROUP BY 1`, p),
    tenantPool.query(`SELECT substr(return_date,1,7) AS month, COUNT(*)::int AS n, SUM(total_amount)::float AS amount
                        FROM sales_returns WHERE status NOT IN ('Cancelled','Draft') AND return_date >= $1 AND return_date <= $2 GROUP BY 1`, p),
    tenantPool.query(`SELECT customer_id AS id, SUM(COALESCE(net_amount, total_amount))::float AS amount
                        FROM invoices WHERE ${LIVE_INVOICE} AND invoice_date >= $1 AND invoice_date <= $2 AND customer_id IS NOT NULL
                        GROUP BY 1 ORDER BY 2 DESC`, p),
    tenantPool.query(`SELECT (CASE WHEN COALESCE(li->>'itemId', li->>'item_id') ~ '^[0-9]{1,9}$' THEN COALESCE(li->>'itemId', li->>'item_id')::int END) AS "itemId",
                             COALESCE(li->>'itemName', li->>'item_name', '(未命名品項)') AS name,
                             SUM(CASE WHEN COALESCE(li->>'quantity', li->>'qty') ~ '^-?[0-9]+([.][0-9]+)?$' THEN COALESCE(li->>'quantity', li->>'qty')::numeric ELSE 0 END)::float AS qty,
                             SUM(CASE WHEN li->>'amount' ~ '^-?[0-9]+([.][0-9]+)?$' THEN (li->>'amount')::numeric ELSE 0 END)::float AS revenue
                        FROM invoices i, jsonb_array_elements(CASE WHEN jsonb_typeof(i.items)='array' THEN i.items ELSE '[]'::jsonb END) li
                       WHERE ${LIVE_INVOICE_I} AND i.invoice_date >= $1 AND i.invoice_date <= $2
                       GROUP BY 1, 2 ORDER BY revenue DESC LIMIT 15`, p),
    tenantPool.query(`WITH q AS (
                         SELECT id, COALESCE(grand_total, total_amount)::float AS amount FROM quotations
                          WHERE status <> 'Cancelled' AND quotation_date >= $1 AND quotation_date <= $2),
                       o AS (
                         SELECT so.id, so.total_amount::float AS amount FROM sales_orders so JOIN q ON q.id = so.quotation_id
                          WHERE so.status NOT IN ('Cancelled','Draft')),
                       iv AS (
                         SELECT i.id, COALESCE(i.net_amount, i.total_amount)::float AS amount, i.paid_amount::float AS paid
                           FROM invoices i JOIN o ON o.id = i.sales_order_id WHERE ${LIVE_INVOICE_I})
                     SELECT (SELECT COUNT(*) FROM q)::int AS qn, (SELECT COALESCE(SUM(amount),0) FROM q)::float AS qa,
                            (SELECT COUNT(*) FROM o)::int AS orn, (SELECT COALESCE(SUM(amount),0) FROM o)::float AS ora,
                            (SELECT COUNT(*) FROM iv)::int AS ivn, (SELECT COALESCE(SUM(amount),0) FROM iv)::float AS iva,
                            (SELECT COUNT(*) FROM iv WHERE paid > 0)::int AS pn, (SELECT COALESCE(SUM(paid),0) FROM iv)::float AS pa`, p),
    tenantPool.query(`SELECT i.customer_id AS "customerId", COALESCE(c.name, '(客戶已刪除)') AS name, MAX(i.invoice_date) AS "lastInvoiceDate",
                             COUNT(*)::int AS frequency, SUM(COALESCE(i.net_amount, i.total_amount))::float AS monetary
                        FROM invoices i LEFT JOIN customers c ON c.id = i.customer_id
                       WHERE ${LIVE_INVOICE_I}
                         AND i.invoice_date >= $1 AND i.invoice_date <= $2 AND i.customer_id IS NOT NULL
                       GROUP BY 1, 2`, p),
  ]);
  return { inv: inv.rows, ret: ret.rows, cust: cust.rows, items: items.rows, quotes: quotes.rows[0], rfm: rfm.rows as CustomerInvoiceAgg[] };
}

async function loadItemCosts(ids: number[]) {
  if (ids.length === 0) return new Map<number, number>();
  const res = await tenantPool.query(`SELECT id, moving_avg_cost AS mac, buying_price AS bp FROM items WHERE id = ANY($1::int[])`, [ids]);
  const out = new Map<number, number>();
  for (const x of res.rows) {
    const c = unitCost(x.mac, x.bp);
    if (c != null) out.set(x.id as number, c);
  }
  return out;
}

export async function buildSales(r: Range): Promise<SalesResponse> {
  const [f, cash] = await Promise.all([loadSalesFacts(r), loadCashSettlements(r)]);
  const costs = await loadItemCosts(f.items.map((i: any) => i.itemId).filter((x: unknown): x is number => typeof x === "number"));

  const invoiced = f.inv.reduce((s: number, x: any) => s + num(x.amount), 0);
  const invoiceCount = f.inv.reduce((s: number, x: any) => s + x.n, 0);
  const returns = f.ret.reduce((s: number, x: any) => s + num(x.amount), 0);
  const collectedRows = cash.filter((c) => isSalesType(c.invoiceType));
  const collected = collectedRows.reduce((s, c) => s + c.amount, 0);
  const custTotal = f.cust.reduce((s: number, x: any) => s + num(x.amount), 0);
  const top5 = f.cust.slice(0, 5).reduce((s: number, x: any) => s + num(x.amount), 0);
  const q = f.quotes;
  const noInv = "期間內沒有已開立的銷項發票";

  const byMonth = (rows: any[], m: string) => num(rows.find((x) => x.month === m)?.amount);
  const monthly = monthsBetween(r.startDate, r.endDate).map((m) => ({
    month: m,
    invoiced: byMonth(f.inv, m),
    returns: byMonth(f.ret, m),
    collected: collectedRows.filter((c) => c.month === m).reduce((s, c) => s + c.amount, 0),
  }));

  return {
    period: period(r),
    summary: {
      invoicedRevenue: metric(invoiceCount > 0 ? invoiced : null, noInv),
      invoiceCount: { value: invoiceCount },
      returnsAmount: { value: returns },
      returnRate: metric(invoiceCount > 0 ? ratio(returns, invoiced) : null, invoiceCount > 0 ? "發票未稅金額合計為 0" : noInv),
      collected: metric(collectedRows.length > 0 ? collected : null, "期間內沒有收款傳票沖銷銷項發票"),
      quotationConversion: metric(q.qn > 0 ? q.orn / q.qn : null, "期間內沒有報價單"),
      top5Concentration: metric(f.cust.length > 0 ? ratio(top5, custTotal) : null, "期間內沒有含客戶的銷項發票"),
    },
    monthly,
    funnel: q.qn > 0 ? [
      { step: "報價單", amount: num(q.qa), count: q.qn },
      { step: "轉成訂單", amount: num(q.ora), count: q.orn },
      { step: "已開發票", amount: num(q.iva), count: q.ivn },
      { step: "已收款", amount: num(q.pa), count: q.pn },
    ] : [],
    topItems: f.items.map((i: any) => {
      const unit = typeof i.itemId === "number" ? costs.get(i.itemId) : undefined;
      const estCost = unit != null ? unit * num(i.qty) : null;
      return { name: i.name, qty: num(i.qty), revenue: num(i.revenue), estCost, margin: estCost != null ? ratio(num(i.revenue) - estCost, num(i.revenue)) : null };
    }),
    rfm: computeRfm(f.rfm.map((x) => ({ ...x, monetary: num(x.monetary) })), r.endDate),
    notes: [
      { text: "營收取銷項發票未稅金額（排除草稿與作廢），依發票日歸期；銷退取非草稿、非作廢的銷貨退回單。" },
      { text: "漏斗追蹤本期報價單 → 由該報價轉成的訂單 → 該訂單開立的發票 → 發票已收金額。" },
      { text: "品項毛利以目前移動平均成本估算（非出貨當時成本）；無成本的品項顯示無法計算。" },
      { text: "RFM 的 Recency 為結束日與最後發票日的實際天數；分群門檻取本期客戶自身的中位數。" },
    ],
  };
}
