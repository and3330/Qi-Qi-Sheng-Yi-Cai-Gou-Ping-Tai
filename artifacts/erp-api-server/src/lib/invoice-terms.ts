import { eq } from "drizzle-orm";
import { invoicesTable, customersTable, suppliersTable, paymentTermsTable } from "@workspace/erp-db";
import { buildSchedule, type Installment, type ScheduleRow } from "./payment-terms";

type InvoiceRow = typeof invoicesTable.$inferSelect;

/**
 * 發票建立後套用付款條件：依條件排出各期到期日與金額，並把到期日設成最後一期。
 * - explicitTermId 是數字：用指定的條件
 * - explicitTermId 是 null：明確不要分期
 * - 沒給（undefined）：用客戶或供應商的預設條件；沒有預設就維持原樣
 */
export async function applyPaymentTerm(tx: any, invoice: InvoiceRow, explicitTermId?: number | null): Promise<InvoiceRow> {
  let termId: number | null = null;
  if (explicitTermId === null) return invoice;
  if (typeof explicitTermId === "number" && Number.isInteger(explicitTermId) && explicitTermId > 0) {
    termId = explicitTermId;
  } else if (invoice.customerId) {
    const [customer] = await tx.select({ termId: customersTable.paymentTermId }).from(customersTable).where(eq(customersTable.id, invoice.customerId));
    termId = customer?.termId ?? null;
  } else if (invoice.supplierId) {
    const [supplier] = await tx.select({ termId: suppliersTable.paymentTermId }).from(suppliersTable).where(eq(suppliersTable.id, invoice.supplierId));
    termId = supplier?.termId ?? null;
  }
  if (!termId) return invoice;
  const [term] = await tx.select().from(paymentTermsTable).where(eq(paymentTermsTable.id, termId));
  // 指定的條件不存在要報錯；預設條件已被刪除或停用則略過，不擋開發票
  if (!term || !term.isActive) {
    if (typeof explicitTermId === "number") throw new Error("找不到這個付款條件，或已經停用");
    return invoice;
  }
  const schedule: ScheduleRow[] = buildSchedule(Number(invoice.totalAmount), invoice.invoiceDate, term.installments as Installment[]);
  if (schedule.length === 0) return invoice;
  const [updated] = await tx.update(invoicesTable).set({
    paymentTermId: term.id,
    paymentSchedule: schedule,
    dueDate: schedule[schedule.length - 1].dueDate,
  }).where(eq(invoicesTable.id, invoice.id)).returning();
  return updated ?? invoice;
}
