import { z } from "zod/v4";
import { and, desc, eq, sql } from "drizzle-orm";
import {
  db, activitiesTable, bankReconciliationEntriesTable, bankStatementsTable, customersTable,
  invoicesTable, quotationsTable, vouchersTable,
} from "@workspace/erp-db";
import { id } from "./drafts";
import { validateDraft } from "./drafts";
import { toCustomerDraftPayload, validateCustomerDraft } from "./customer-drafts";
import { getEmailSettings, logEmail } from "../lib/email";
import { tenantPool } from "../lib/tenant-db";
import { normalizeCustomerInput } from "../lib/customer-master";
import { buildEmailDraft } from "../lib/email-templates";

/**
 * 直接生效的 MCP 工具。只涵蓋可在 ERP 裡修改或取消、不牽涉稅務與金錢流出的動作：
 * 建客戶、開報價單（草稿狀態）、銀行明細配對傳票。
 * 每個工具都沿用人工操作的同一套檢查，並在呼叫端的交易與稽核紀錄內執行。
 */
export const directToolSchemas = {
  list_unmatched_bank_entries: z.object({ statement_id: id.optional(), limit: z.number().int().min(1).max(50).default(50) }).strict(),
  match_bank_entry: z.object({ entry_id: id, voucher_id: id }).strict(),
  preview_invoice_email: z.object({ invoice_id: id }).strict(),
  request_quotation_email: z.object({ quotation_id: id, to: z.string().max(200).optional() }).strict(),
  request_invoice_email: z.object({ invoice_id: id, to: z.string().max(200).optional() }).strict(),
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const rowsOf = (r: any): any[] => r?.rows ?? r ?? [];
const amountOf = (entry: { debit: string | null; credit: string | null }) => Number(entry.debit) > 0 ? Number(entry.debit) : Number(entry.credit);

/** 直接建立正式客戶：與 POST /customers 相同的整理、統編驗證與同公司重複檢查 */
export async function createCustomerDirect(args: unknown) {
  const payload = await validateCustomerDraft(toCustomerDraftPayload(args as any));
  // 與 POST /customers 相同的欄位整理（去空白、空字串轉 null、統編檢查碼），只寫入允許的文字欄位
  const input = normalizeCustomerInput(payload);
  const [created] = await db.insert(customersTable).values(input).returning({ id: customersTable.id, name: customersTable.name });
  await db.insert(activitiesTable).values({ type: "create", title: "New Customer", description: `${created.name} added as customer (AI agent)`, module: "Sales" });
  return { id: created.id, name: created.name, status: "created" };
}

/** 直接建立報價單（狀態為草稿，仍需在 ERP 改為已接受才能轉銷貨單） */
export async function createQuotationDirect(payload: unknown) {
  const body: any = await validateDraft("quotation", payload);
  const [customer] = await db.select({ name: customersTable.name }).from(customersTable).where(eq(customersTable.id, body.customerId));
  const [last] = await db.select({ quotationNumber: quotationsTable.quotationNumber }).from(quotationsTable).orderBy(desc(quotationsTable.id)).limit(1);
  const lastNumber = last?.quotationNumber?.match(/QT(\d+)/);
  const quotationNumber = `QT${String(lastNumber ? parseInt(lastNumber[1]) + 1 : 1).padStart(5, "0")}`;
  const [row] = await db.insert(quotationsTable).values({
    quotationNumber,
    customerId: body.customerId,
    customerName: customer?.name ?? null,
    quotationDate: body.quotationDate,
    validUntil: body.validUntil ?? null,
    status: "Draft",
    totalAmount: body.totalAmount,
    taxAmount: body.taxAmount,
    grandTotal: body.grandTotal,
    notes: body.notes ?? null,
    items: body.items,
  } as any).returning({ id: quotationsTable.id, quotationNumber: quotationsTable.quotationNumber, grandTotal: quotationsTable.grandTotal });
  await db.insert(activitiesTable).values({ type: "create", title: "報價單已建立", description: `${row.quotationNumber} - ${customer?.name ?? "客戶"} (AI agent)`, module: "Sales" });
  return { id: row.id, quotationNumber: row.quotationNumber, grandTotal: Number(row.grandTotal), status: "Draft" };
}

/** 尚未配對的銀行明細，並附上金額相同、還沒被其他明細配對的傳票作為候選 */
export async function listUnmatchedBankEntries(args: unknown) {
  const p = directToolSchemas.list_unmatched_bank_entries.parse(args);
  const entries = await db.select({
    id: bankReconciliationEntriesTable.id,
    statementId: bankReconciliationEntriesTable.statementId,
    transactionDate: bankReconciliationEntriesTable.transactionDate,
    description: bankReconciliationEntriesTable.description,
    debit: bankReconciliationEntriesTable.debit,
    credit: bankReconciliationEntriesTable.credit,
    bankName: bankStatementsTable.bankName,
  }).from(bankReconciliationEntriesTable)
    .innerJoin(bankStatementsTable, eq(bankReconciliationEntriesTable.statementId, bankStatementsTable.id))
    .where(and(
      eq(bankReconciliationEntriesTable.matchStatus, "Unmatched"),
      p.statement_id ? eq(bankReconciliationEntriesTable.statementId, p.statement_id) : undefined,
    ))
    .orderBy(bankReconciliationEntriesTable.transactionDate, bankReconciliationEntriesTable.id)
    .limit(p.limit);

  const result = [];
  for (const entry of entries) {
    const amount = amountOf(entry);
    const candidates = amount > 0 ? rowsOf(await db.execute(sql`
      SELECT v.id, v.voucher_number AS "voucherNumber", v.voucher_type AS "voucherType", v.voucher_date AS "voucherDate"
      FROM vouchers v
      WHERE v.total_amount = ${String(amount)}::numeric
        AND NOT EXISTS (SELECT 1 FROM bank_reconciliation_entries b WHERE b.matched_voucher_id = v.id)
      ORDER BY v.voucher_date DESC LIMIT 5
    `)) : [];
    result.push({
      entryId: entry.id, statementId: entry.statementId, bankName: entry.bankName,
      transactionDate: entry.transactionDate, description: entry.description,
      direction: Number(entry.credit) > 0 ? "deposit" : "withdrawal", amount,
      candidateVouchers: candidates,
    });
  }
  return { entries: result, limit: p.limit };
}

/** 把銀行明細配對到傳票：明細必須未配對、金額必須相同、傳票不能已被其他明細配對 */
export async function matchBankEntry(args: unknown) {
  const p = directToolSchemas.match_bank_entry.parse(args);
  const [entry] = await db.select().from(bankReconciliationEntriesTable).where(eq(bankReconciliationEntriesTable.id, p.entry_id)).for("update");
  if (!entry) throw new Error("Bank entry not found");
  if (entry.matchStatus !== "Unmatched") throw new Error("Bank entry already matched or posted");
  const [voucher] = await db.select({ id: vouchersTable.id, voucherNumber: vouchersTable.voucherNumber, totalAmount: vouchersTable.totalAmount })
    .from(vouchersTable).where(eq(vouchersTable.id, p.voucher_id));
  if (!voucher) throw new Error("Voucher not found");
  if (Math.round(Number(voucher.totalAmount) * 100) !== Math.round(amountOf(entry) * 100)) throw new Error("Amount mismatch");
  const [taken] = await db.select({ id: bankReconciliationEntriesTable.id }).from(bankReconciliationEntriesTable)
    .where(eq(bankReconciliationEntriesTable.matchedVoucherId, p.voucher_id)).limit(1);
  if (taken) throw new Error("Voucher already matched to another bank entry");
  await db.update(bankReconciliationEntriesTable).set({ matchedVoucherId: voucher.id, matchStatus: "Matched" })
    .where(eq(bankReconciliationEntriesTable.id, p.entry_id));
  return { entryId: p.entry_id, voucherId: voucher.id, voucherNumber: voucher.voucherNumber, status: "Matched" };
}

/**
 * 提出「請寄這張單據給客戶」：只建立一筆待確認的信，由人在 ERP 確認後才寄出。
 * 信件內容一律由伺服器依單據重建，機器人只能指定單據與（選填的）收件人。
 */
async function requestDocumentEmail(docType: "quotation" | "invoice", docId: number, to: string | undefined) {
  const draft = await buildEmailDraft(docType, docId, await getEmailSettings());
  const recipient = (to || draft.to || "").replace(/[\r\n\t]+/g, " ").trim();
  if (!EMAIL_RE.test(recipient)) throw new Error("沒有可用的收件人 Email：請先在客戶主檔補上，或在 to 指定");
  const existing = await tenantPool.query(
    `SELECT id FROM email_logs WHERE status = 'pending' AND doc_type = $1 AND doc_id = $2 AND recipient = $3 LIMIT 1`,
    [docType, docId, recipient]);
  if (existing.rows[0]) {
    return { pendingEmailId: existing.rows[0].id, recipient, subject: draft.subject, status: "pending", note: "這張單據已經有一封寄給同一個收件人的信在等待確認" };
  }
  await logEmail({ docType, docId, recipient, subject: draft.subject, status: "pending", trigger: "ai" });
  return { recipient, subject: draft.subject, status: "pending", nextStep: "已建立待確認的信。要由人在 ERP 的「AI 草稿待確認」按下確認才會寄出。" };
}

export async function requestQuotationEmail(args: unknown) {
  const p = directToolSchemas.request_quotation_email.parse(args);
  const [quotation] = await db.select({ id: quotationsTable.id, status: quotationsTable.status }).from(quotationsTable).where(eq(quotationsTable.id, p.quotation_id));
  if (!quotation) throw new Error("Quotation not found");
  return requestDocumentEmail("quotation", p.quotation_id, p.to);
}

export async function requestInvoiceEmail(args: unknown) {
  const p = directToolSchemas.request_invoice_email.parse(args);
  const [invoice] = await db.select({ id: invoicesTable.id, status: invoicesTable.status, invoiceType: invoicesTable.invoiceType })
    .from(invoicesTable).where(eq(invoicesTable.id, p.invoice_id));
  if (!invoice) throw new Error("Invoice not found");
  if (!["Sales", "Sales Invoice"].includes(invoice.invoiceType)) throw new Error("Only sales invoices can be emailed");
  if (invoice.status === "Cancelled" || invoice.status === "Draft") throw new Error("發票是草稿或已作廢，不能寄送");
  return requestDocumentEmail("invoice", p.invoice_id, p.to);
}

/**
 * 寄發票前的檢查：回傳收件人與主旨是否就緒。只讀取，不寄信。
 * 真正寄出仍由人在 ERP 的發票頁按下寄出。
 */
export async function previewInvoiceEmail(args: unknown) {
  const p = directToolSchemas.preview_invoice_email.parse(args);
  const [invoice] = await db.select({ id: invoicesTable.id, invoiceNumber: invoicesTable.invoiceNumber, status: invoicesTable.status, invoiceType: invoicesTable.invoiceType })
    .from(invoicesTable).where(eq(invoicesTable.id, p.invoice_id));
  if (!invoice) throw new Error("Invoice not found");
  if (!["Sales", "Sales Invoice"].includes(invoice.invoiceType)) throw new Error("Only sales invoices can be emailed");
  const draft = await buildEmailDraft("invoice", p.invoice_id, await getEmailSettings());
  const recipientReady = EMAIL_RE.test(draft.to || "");
  return {
    invoiceId: invoice.id, invoiceNumber: invoice.invoiceNumber, invoiceStatus: invoice.status,
    recipient: draft.to || null, subject: draft.subject,
    readyToSend: recipientReady && invoice.status !== "Cancelled" && invoice.status !== "Draft",
    blockers: [
      ...(recipientReady ? [] : ["客戶沒有可用的 Email，請先在客戶主檔補上"]),
      ...(invoice.status === "Cancelled" ? ["發票已作廢"] : []),
      ...(invoice.status === "Draft" ? ["發票還是草稿"] : []),
    ],
    nextStep: "寄出需要由人在 ERP 的發票頁按下「寄送」；機器人不會直接寄信給客戶。",
  };
}
