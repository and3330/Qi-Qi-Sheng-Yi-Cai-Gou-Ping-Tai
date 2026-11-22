import { sql } from "drizzle-orm";

/**
 * 收付款對訂單的核對。
 *
 * 收款單／付款單的明細除了沖銷發票，也可以直接指定銷貨單或採購單（還沒開發票就先收訂金、先付訂金）。
 * 直接對訂單的金額記在傳票明細的 salesOrderId／purchaseOrderId，不另外建表：
 * - 訂單已收（已付）＝直接對訂單的金額＋它底下各張發票被沖銷的金額
 * - 之後開發票時，先前對訂單收的錢依發票先後順序自動算進發票的已收金額
 */
export type OrderKind = "sales" | "purchase";

const LINE_KEY: Record<OrderKind, string> = { sales: "salesOrderId", purchase: "purchaseOrderId" };
const ORDER_COLUMN: Record<OrderKind, string> = { sales: "sales_order_id", purchase: "purchase_order_id" };
const INVOICE_TYPES: Record<OrderKind, string[]> = { sales: ["Sales", "Sales Invoice"], purchase: ["Purchase", "Purchase Invoice"] };

export const round2 = (n: number): number => Math.round((Number(n) || 0) * 100) / 100;
const rowsOf = (r: any): any[] => r?.rows ?? r ?? [];
const idList = (ids: number[]) => sql.join(ids.map(id => sql`${id}`), sql`, `);

/** 各訂單「直接對訂單」收（付）的金額合計 */
export async function orderAdvanceTotals(tx: any, kind: OrderKind, orderIds: number[]): Promise<Map<number, number>> {
  const result = new Map<number, number>();
  const ids = Array.from(new Set(orderIds.filter(id => Number.isInteger(id) && id > 0)));
  if (ids.length === 0) return result;
  // 欄位名稱是程式內固定的常數，直接寫進 SQL；明細不是陣列、或值不是數字的舊資料一律略過，
  // 不能讓單一筆髒資料造成整個查詢轉型失敗
  const field = sql.raw(`l->>'${LINE_KEY[kind]}'`);
  const rows = rowsOf(await tx.execute(sql`
    SELECT t.order_id, COALESCE(SUM(t.amount), 0) AS total
    FROM (
      SELECT
        CASE WHEN ${field} ~ '^[0-9]+$' THEN (${field})::int END AS order_id,
        CASE WHEN (l->>'amount') ~ '^-?[0-9]+(\\.[0-9]+)?$' THEN (l->>'amount')::numeric ELSE 0 END AS amount
      FROM vouchers v,
        jsonb_array_elements(CASE WHEN jsonb_typeof(v.items) = 'array' THEN v.items ELSE '[]'::jsonb END) AS l
      WHERE v.status <> '已作廢'
    ) t
    WHERE t.order_id IN (${idList(ids)})
    GROUP BY t.order_id
  `));
  for (const row of rows) result.set(Number(row.order_id), round2(Number(row.total)));
  return result;
}

export interface OrderInvoice { id: number; orderId: number; total: number; settled: number }

/** 各訂單底下未取消、未轉呆帳的發票（含各自已被沖銷的金額），依發票先後排序 */
export async function orderInvoices(tx: any, kind: OrderKind, orderIds: number[]): Promise<OrderInvoice[]> {
  const ids = Array.from(new Set(orderIds.filter(id => Number.isInteger(id) && id > 0)));
  if (ids.length === 0) return [];
  const column = sql.raw(`i.${ORDER_COLUMN[kind]}`);
  const types = sql.join(INVOICE_TYPES[kind].map(t => sql`${t}`), sql`, `);
  const rows = rowsOf(await tx.execute(sql`
    SELECT i.id, ${column} AS order_id, i.total_amount AS total,
      COALESCE((SELECT SUM(s.amount) FROM invoice_settlements s WHERE s.invoice_id = i.id), 0) AS settled
    FROM invoices i
    WHERE ${column} IN (${idList(ids)})
      AND i.invoice_type IN (${types})
      AND i.status NOT IN ('Cancelled', 'WrittenOff')
    ORDER BY i.id
  `));
  return rows.map((r: any) => ({ id: Number(r.id), orderId: Number(r.order_id), total: round2(Number(r.total)), settled: round2(Number(r.settled)) }));
}

/**
 * 把直接對訂單收（付）的金額，依發票先後分配給各張發票尚未沖銷的餘額。
 * 回傳每張發票分到的金額；分不完的部分留在訂單上（對應還沒開發票的金額）。
 */
export function allocateAdvance(advance: number, invoices: Array<{ id: number; total: number; settled: number }>): Map<number, number> {
  const allocation = new Map<number, number>();
  let remaining = round2(advance);
  for (const inv of [...invoices].sort((a, b) => a.id - b.id)) {
    if (remaining <= 0) break;
    const open = round2(inv.total - inv.settled);
    if (open <= 0) continue;
    const applied = Math.min(open, remaining);
    allocation.set(inv.id, round2(applied));
    remaining = round2(remaining - applied);
  }
  return allocation;
}

export interface OrderPaymentSummary { advance: number; settled: number; paid: number; legacyPaid?: number }

/** 舊系統搬來的歷史單，在搬進來之前就已經收（付）的金額（記在 extraFields.legacyPaid） */
async function legacyPaidTotals(tx: any, kind: OrderKind, orderIds: number[]): Promise<Map<number, number>> {
  const result = new Map<number, number>();
  const ids = Array.from(new Set(orderIds.filter(id => Number.isInteger(id) && id > 0)));
  if (ids.length === 0) return result;
  const source = kind === "sales" ? sql`sales_orders WHERE order_source = 'ecount'` : sql`purchase_orders WHERE extra_fields->>'legacy' = 'true'`;
  const rows = await tx.execute(sql`
    SELECT id, (extra_fields->>'legacyPaid')::numeric AS paid FROM ${source}
    AND extra_fields->>'legacyPaid' ~ '^[0-9]+(\\.[0-9]+)?$' AND id IN (${sql.join(ids.map(id => sql`${id}`), sql`, `)})`);
  for (const row of (rows?.rows ?? rows ?? []) as Array<{ id: number; paid: string }>) result.set(Number(row.id), Number(row.paid) || 0);
  return result;
}

/** 各訂單已收（已付）金額：直接對訂單的金額＋底下發票被沖銷的金額 */
export async function orderPaymentSummaries(tx: any, kind: OrderKind, orderIds: number[]): Promise<Map<number, OrderPaymentSummary>> {
  const advances = await orderAdvanceTotals(tx, kind, orderIds);
  const invoices = await orderInvoices(tx, kind, orderIds);
  const legacy = await legacyPaidTotals(tx, kind, orderIds);
  const result = new Map<number, OrderPaymentSummary>();
  for (const id of new Set(orderIds)) {
    const advance = advances.get(id) || 0;
    const settled = round2(invoices.filter(i => i.orderId === id).reduce((sum, i) => sum + i.settled, 0));
    const legacyPaid = legacy.get(id) || 0;
    result.set(id, { advance, settled, paid: round2(advance + settled + legacyPaid), ...(legacyPaid > 0 ? { legacyPaid } : {}) });
  }
  return result;
}

/** 訂單還能再收（付）多少。total 必須是本位幣金額 */
export function orderOutstanding(total: number, summary: OrderPaymentSummary | undefined): number {
  return Math.max(0, round2(total - (summary?.paid || 0)));
}

/** 給發票重算用：指定發票各自分到多少「直接對訂單」的金額，並回傳同一張訂單下需要一起重算的發票 id */
export async function advanceAllocationForInvoices(tx: any, invoices: Array<{ id: number; invoiceType: string; salesOrderId?: number | null; purchaseOrderId?: number | null }>): Promise<{ allocation: Map<number, number>; siblingIds: number[] }> {
  const allocation = new Map<number, number>();
  const siblingIds = new Set<number>();
  for (const kind of ["sales", "purchase"] as const) {
    const orderIds = Array.from(new Set(invoices
      .filter(inv => INVOICE_TYPES[kind].includes(inv.invoiceType))
      .map(inv => Number(kind === "sales" ? inv.salesOrderId : inv.purchaseOrderId))
      .filter(id => Number.isInteger(id) && id > 0)));
    if (orderIds.length === 0) continue;
    const advances = await orderAdvanceTotals(tx, kind, orderIds);
    // 歷史單搬進來之前就收到的錢，也要算進補開的發票，發票才不會顯示成整張沒收
    for (const [id, paid] of await legacyPaidTotals(tx, kind, orderIds)) advances.set(id, round2((advances.get(id) || 0) + paid));
    if (advances.size === 0) continue;
    const all = await orderInvoices(tx, kind, Array.from(advances.keys()));
    for (const [orderId, advance] of advances) {
      const own = all.filter(i => i.orderId === orderId);
      for (const [invoiceId, amount] of allocateAdvance(advance, own)) allocation.set(invoiceId, amount);
      for (const inv of own) siblingIds.add(inv.id);
    }
  }
  return { allocation, siblingIds: Array.from(siblingIds) };
}
