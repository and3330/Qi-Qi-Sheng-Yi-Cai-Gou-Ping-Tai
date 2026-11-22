import { and, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { invoicesTable, salesOrdersTable } from "@workspace/erp-db";
import { REVENUE_ORDER_STATUSES } from "./auto-journal";
import { orderOutstanding, orderPaymentSummaries, round2 } from "./order-payments";

/**
 * 還沒開發票、但客戶已經欠我們的錢：已成立的銷貨單還沒收的金額，扣掉它底下發票還沒收的部分
 * （那部分算在發票上，不重複算）。
 *
 * 規則跟「應收帳款總覽」和信用額度（lib/credit-limit.ts 的 customerExposures）同一套，
 * 所以帳齡表、儀表板、應收總覽三個地方的數字對得起來。
 * 舊系統搬來的銷貨單沒有發票，全部靠這裡才會出現在帳齡表。
 */
export interface UnbilledOrder {
  id: number; orderNumber: string; orderDate: string; customerId: number; status: string;
  /** 還沒收、而且沒有掛在發票上的金額 */
  outstanding: number;
  legacy: boolean;
  label: string | null; projectId: number | null;
}

export async function unbilledOrderReceivables(tx: any, customerId?: number): Promise<UnbilledOrder[]> {
  const orders: Array<{ id: number; orderNumber: string; orderDate: string; customerId: number; status: string; totalAmount: string; orderSource: string | null; label: string | null; projectId: number | null }> = await tx
    .select({ id: salesOrdersTable.id, orderNumber: salesOrdersTable.orderNumber, orderDate: salesOrdersTable.orderDate, customerId: salesOrdersTable.customerId, status: salesOrdersTable.status, totalAmount: salesOrdersTable.totalAmount, orderSource: salesOrdersTable.orderSource, label: salesOrdersTable.label, projectId: salesOrdersTable.projectId })
    .from(salesOrdersTable)
    .where(and(inArray(salesOrdersTable.status, REVENUE_ORDER_STATUSES), customerId === undefined ? undefined : eq(salesOrdersTable.customerId, customerId)));
  if (orders.length === 0) return [];
  const payments = await orderPaymentSummaries(tx, "sales", orders.map(o => o.id));
  // 訂單底下還沒收清的發票：這些金額帳齡表已經用發票算了
  const billed: Array<{ orderId: number | null; open: string }> = await tx
    .select({ orderId: invoicesTable.salesOrderId, open: sql<string>`COALESCE(SUM(${invoicesTable.outstandingAmount}), 0)` })
    .from(invoicesTable)
    .where(and(eq(invoicesTable.invoiceType, "Sales"), isNotNull(invoicesTable.salesOrderId), sql`${invoicesTable.status} NOT IN ('Paid', 'Cancelled', 'WrittenOff')`))
    .groupBy(invoicesTable.salesOrderId);
  const billedOpen = new Map(billed.map(row => [Number(row.orderId), Number(row.open) || 0]));

  const result: UnbilledOrder[] = [];
  for (const order of orders) {
    const open = orderOutstanding(Number(order.totalAmount), payments.get(order.id));
    const outstanding = round2(Math.max(0, open - (billedOpen.get(order.id) || 0)));
    if (!(outstanding > 0)) continue;
    result.push({ id: order.id, orderNumber: order.orderNumber, orderDate: order.orderDate, customerId: order.customerId, status: order.status, outstanding, legacy: order.orderSource === "ecount", label: order.label ?? null, projectId: order.projectId ?? null });
  }
  return result.sort((a, b) => a.orderDate.localeCompare(b.orderDate) || a.id - b.id);
}

/** 銷貨單沒有到期日：從單據日期起算過了幾天 */
export function daysSince(date: string, today: string): number {
  const days = Math.floor((new Date(today).getTime() - new Date(date).getTime()) / 86400000);
  return Number.isFinite(days) ? Math.max(0, days) : 0;
}
