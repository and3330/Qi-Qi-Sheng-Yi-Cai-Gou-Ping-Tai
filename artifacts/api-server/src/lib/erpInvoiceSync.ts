import { sql, eq, inArray } from "drizzle-orm";
import { erpInvoicesTable, erpInvoiceSettlementsTable } from "@workspace/db";

/**
 * 依 erp_invoice_settlements 重算發票的已收付/未收付金額與狀態。
 * 發票 paidAmount / outstandingAmount 的唯一來源：任何路徑都不得直接改寫。
 * 必須在交易 (tx) 內呼叫，且呼叫前應已鎖定相關發票列（FOR UPDATE）。
 */
export async function recomputeInvoices(tx: any, invoiceIds: number[]) {
  if (invoiceIds.length === 0) return;
  const ids = Array.from(new Set(invoiceIds));
  const invoices = await tx
    .select()
    .from(erpInvoicesTable)
    .where(inArray(erpInvoicesTable.id, ids));
  const sums = await tx
    .select({
      invoiceId: erpInvoiceSettlementsTable.invoiceId,
      total: sql<string>`COALESCE(SUM(${erpInvoiceSettlementsTable.amount}), 0)`,
    })
    .from(erpInvoiceSettlementsTable)
    .where(inArray(erpInvoiceSettlementsTable.invoiceId, ids))
    .groupBy(erpInvoiceSettlementsTable.invoiceId);
  const sumMap = new Map<number, number>(
    sums.map((s: any) => [s.invoiceId, Number(s.total)]),
  );
  for (const inv of invoices) {
    if (inv.status === "Cancelled") continue;
    const total = Number(inv.totalAmount);
    const paid = sumMap.get(inv.id) || 0;
    const outstanding = Math.max(0, total - paid);
    let status = inv.status;
    if (outstanding <= 0 && total > 0) status = "Paid";
    else if (paid > 0) status = "PartiallyPaid";
    else if (status === "Paid" || status === "PartiallyPaid") status = "Unpaid";
    await tx
      .update(erpInvoicesTable)
      .set({ paidAmount: paid, outstandingAmount: outstanding, status })
      .where(eq(erpInvoicesTable.id, inv.id));
  }
}
