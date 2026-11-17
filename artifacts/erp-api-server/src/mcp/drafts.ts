import { z } from "zod/v4";
import { db, currentTenantId, customersTable, suppliersTable, accountsTable, invoicesTable, invoiceSettlementsTable, itemsTable } from "@workspace/erp-db";
import { eq, sql } from "drizzle-orm";
import { resolveJournalLines } from "../lib/auto-journal";

export const id = z.number().int().positive();
export const date = z.iso.date();
export const money = z.number().positive().max(999999999).refine(v => Math.abs(v * 100 - Math.round(v * 100)) < 0.00001, "At most two decimal places");
const text = z.string().max(500);
const line = z.object({ invoiceId: id, amount: money }).strict();
const voucher = z.object({
  voucherType: z.enum(["收款單", "付款單"]), voucherDate: date,
  customerId: id.optional(), supplierId: id.optional(), accountId: id,
  description: text.default(""), items: z.array(line).min(1).max(100),
}).strict();
const item = z.object({ itemId: id, itemName: z.string().min(1).max(200).optional(), quantity: z.number().positive().max(100000), rate: z.number().nonnegative().max(9999999) }).strict();
const quotation = z.object({ customerId: id, quotationDate: date, validUntil: date.optional(), notes: text.optional(), items: z.array(item).min(1).max(100) }).strict();
const invoice = z.object({ customerId: id, invoiceDate: date, dueDate: date.optional(), taxType: z.enum(["taxable", "zero_rated", "exempt"]).default("taxable"), taxRate: z.number().min(0).max(100).default(5), taxIncluded: z.boolean().default(false), items: z.array(item).min(1).max(100) }).strict();
const request = z.object({ partyType: z.enum(["Customer", "Supplier"]), customerId: id.optional(), supplierId: id.optional(), requestDate: date, dueDate: date.optional(), amount: money, remarks: text.optional() }).strict();
export const docTypeSchema = z.enum(["receipt", "payment", "quotation", "payment_request", "sales_invoice"]);
export type DraftType = z.infer<typeof docTypeSchema>;
export const draftPayloadSchemas = { receipt: voucher, payment: voucher, quotation, sales_invoice: invoice, payment_request: request };
export function draftTarget(type: DraftType) {
  return { receipt: "/vouchers", payment: "/vouchers", quotation: "/quotations", payment_request: "/payment-requests", sales_invoice: "/invoices" }[type];
}
async function exists(table: typeof customersTable | typeof suppliersTable, value: number | undefined) {
  if (!value || !(await db.select({ id: table.id }).from(table).where(eq(table.id, value)).limit(1))[0]) throw new Error("Party not found in tenant");
}
/** Approval calls this again under its human tenant context. Stored payload is canonical input,
 * not the result of this function; result is the existing POST body. Never writes business data. */
export async function validateDraft(type: DraftType, input: unknown): Promise<Record<string, unknown>> {
  if (!currentTenantId()) throw new Error("Tenant context required");
  const parsed = draftPayloadSchemas[type].parse(input);
  if (type === "receipt" || type === "payment") {
    const p = voucher.parse(parsed);
    if (p.voucherType !== (type === "receipt" ? "收款單" : "付款單")) throw new Error("Voucher type mismatch");
    if (type === "receipt" ? p.supplierId !== undefined : p.customerId !== undefined) throw new Error("Unexpected party");
    await exists(type === "receipt" ? customersTable : suppliersTable, type === "receipt" ? p.customerId : p.supplierId);
    const [account] = await db.select().from(accountsTable).where(eq(accountsTable.id, p.accountId));
    // Accounts currently have no active flag. Only an existing non-group asset account is usable.
    if (!account || account.isGroup || account.accountType !== "Asset") throw new Error("Usable asset account required");
    const [cash] = await resolveJournalLines(db,[{ accountName: "現金/銀行", debit: 0, credit: 0 }]);
    if (cash.accountId !== p.accountId) throw new Error("Account must match the existing voucher cash resolver");
    const totals = new Map<number, number>();
    for (const row of p.items) totals.set(row.invoiceId, (totals.get(row.invoiceId) ?? 0) + Math.round(row.amount * 100));
    for (const [invoiceId, cents] of totals) {
      const [inv] = await db.select().from(invoicesTable).where(eq(invoicesTable.id, invoiceId));
      if (!inv || inv.ecpayVoidedAt || ["Draft", "Cancelled", "Voided", "VoidPending", "VoidReconcileRequired", "WrittenOff", "Paid"].includes(inv.status)) throw new Error("Invoice not collectible");
      if (type === "receipt" ? (!["Sales", "Sales Invoice"].includes(inv.invoiceType) || inv.customerId !== p.customerId) : (!["Purchase", "Purchase Invoice"].includes(inv.invoiceType) || inv.supplierId !== p.supplierId)) throw new Error("Invoice party or type mismatch");
      const [settled] = await db.select({ amount: sql<string>`coalesce(sum(${invoiceSettlementsTable.amount}),0)` }).from(invoiceSettlementsTable).where(eq(invoiceSettlementsTable.invoiceId, invoiceId));
      const available = Math.min(Number(inv.outstandingAmount), Number(inv.totalAmount) - Number(settled.amount) - Number(inv.writeOffAmount));
      if (cents > Math.round(available * 100)) throw new Error("Amount exceeds outstanding balance");
    }
    return { voucherType: p.voucherType, voucherDate: p.voucherDate, customerId: p.customerId, supplierId: p.supplierId, description: p.description, items: p.items.map(row => ({ ...row, description: p.description, accountId: p.accountId })), totalAmount: (Array.from(totals.values()).reduce((a,b) => a+b,0)/100).toFixed(2) };
  }
  if (type === "payment_request") {
    const p = request.parse(parsed);
    if (p.partyType === "Customer" ? p.supplierId !== undefined : p.customerId !== undefined) throw new Error("Unexpected party");
    await exists(p.partyType === "Customer" ? customersTable : suppliersTable, p.partyType === "Customer" ? p.customerId : p.supplierId);
    return { ...p, amount: String(p.amount), status: "Draft" };
  }
  const p = type === "quotation" ? quotation.parse(parsed) : invoice.parse(parsed);
  await exists(customersTable, p.customerId);
  const catalog = new Map<number, { itemName: string; itemCode: string }>();
  for (const item of p.items) {
    const [found] = await db.select({ id: itemsTable.id, itemName: itemsTable.itemName, itemCode: itemsTable.itemCode }).from(itemsTable).where(eq(itemsTable.id,item.itemId)).limit(1);
    if (!found) throw new Error("Item not found in tenant");
    catalog.set(item.itemId,found);
  }
  const items = p.items.map(row => ({ ...row, amount: Math.round(row.quantity * row.rate * 100)/100 }));
  const total = items.reduce((n,row) => n+row.amount,0);
  if (!Number.isFinite(total) || total > 999999999999.99) throw new Error("Document total exceeds supported range");
  return type === "quotation" ? { ...p, items: items.map(row => ({ name: catalog.get(row.itemId)!.itemName, code: catalog.get(row.itemId)!.itemCode, qty: row.quantity, unitPrice: row.rate, amount: row.amount })), totalAmount: String(total), grandTotal: String(total), taxAmount: "0", status: "Draft" } : { ...p, items, invoiceType: "Sales" };
}
