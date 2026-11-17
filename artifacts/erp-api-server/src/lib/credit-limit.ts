import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { customersTable, invoicesTable, salesOrdersTable } from "@workspace/erp-db";
import { REVENUE_ORDER_STATUSES } from "./auto-journal";
import { orderOutstanding, orderPaymentSummaries, round2 } from "./order-payments";
import { creditCheck } from "./credit-check";

export { creditCheck };

/**
 * 客戶信用額度：客戶還欠我們的錢（已成立訂單還沒收的 + 沒有掛訂單的發票還沒收的）
 * 加上這張新訂單，超過額度就不能成立訂單。額度沒設（空白或 0）就是不限。
 */

export interface CustomerExposure { orders: number; invoices: number; total: number }

/** 每個客戶目前還欠多少。customerIds 沒給就算全部客戶；excludeOrderId 是正要成立的那張，不重複算 */
export async function customerExposures(tx: any, customerIds?: number[], excludeOrderId?: number): Promise<Map<number, CustomerExposure>> {
  const result = new Map<number, CustomerExposure>();
  if (customerIds && customerIds.length === 0) return result;
  const bucket = (id: number) => {
    let entry = result.get(id);
    if (!entry) { entry = { orders: 0, invoices: 0, total: 0 }; result.set(id, entry); }
    return entry;
  };

  const orders: Array<{ id: number; customerId: number; totalAmount: string }> = await tx
    .select({ id: salesOrdersTable.id, customerId: salesOrdersTable.customerId, totalAmount: salesOrdersTable.totalAmount })
    .from(salesOrdersTable)
    .where(and(
      inArray(salesOrdersTable.status, REVENUE_ORDER_STATUSES),
      customerIds ? inArray(salesOrdersTable.customerId, customerIds) : undefined,
    ));
  const counted = orders.filter(o => o.id !== excludeOrderId);
  const payments = counted.length > 0 ? await orderPaymentSummaries(tx, "sales", counted.map(o => o.id)) : new Map();
  for (const order of counted) bucket(order.customerId).orders += orderOutstanding(Number(order.totalAmount), payments.get(order.id));

  // 沒有掛在訂單底下的銷貨發票（直接開的發票）：訂單底下的發票已經算在訂單裡，不重複算
  const invoices: Array<{ customerId: number | null; outstanding: string }> = await tx
    .select({ customerId: invoicesTable.customerId, outstanding: sql<string>`COALESCE(SUM(${invoicesTable.outstandingAmount}), 0)` })
    .from(invoicesTable)
    .where(and(
      eq(invoicesTable.invoiceType, "Sales"), isNull(invoicesTable.salesOrderId),
      sql`${invoicesTable.status} NOT IN ('Paid', 'Cancelled', 'WrittenOff')`,
      customerIds ? inArray(invoicesTable.customerId, customerIds) : undefined,
    ))
    .groupBy(invoicesTable.customerId);
  for (const row of invoices) if (row.customerId) bucket(row.customerId).invoices += Number(row.outstanding) || 0;

  for (const entry of result.values()) {
    entry.orders = round2(entry.orders); entry.invoices = round2(entry.invoices);
    entry.total = round2(entry.orders + entry.invoices);
  }
  return result;
}

/** 訂單要成立時檢查額度；超過就中止。override 是老闆或財務明確放行 */
export async function assertCreditLimit(tx: any, order: { id: number; customerId: number; totalAmount: string | number }, override: boolean): Promise<void> {
  const [customer] = await tx.select({ name: customersTable.name, creditLimit: customersTable.creditLimit })
    .from(customersTable).where(eq(customersTable.id, order.customerId));
  if (!customer) return;
  const owed = (await customerExposures(tx, [order.customerId], order.id)).get(order.customerId)?.total ?? 0;
  const check = creditCheck(customer.creditLimit == null ? null : Number(customer.creditLimit), owed, Number(order.totalAmount) || 0);
  if (check.ok || override) return;
  const money = (n: number) => `NT$ ${n.toLocaleString("zh-TW")}`;
  throw Object.assign(new Error(
    `「${customer.name}」的信用額度是 ${money(Number(customer.creditLimit))}，目前還欠 ${money(owed)}，加上這張訂單會變成 ${money(check.after)}，超過額度 ${money(check.over)}。請先收款，或由老闆、財務放行。`,
  ), { code: "CREDIT_LIMIT", over: check.over });
}
