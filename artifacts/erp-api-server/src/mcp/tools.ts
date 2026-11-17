import { z } from "zod/v4";
import { and, eq, ne } from "drizzle-orm";
import { db, currentTenantId, aiDraftDocumentsTable, aiCustomerDraftsTable, customersTable, invoicesTable } from "@workspace/erp-db";
import reports from "../routes/reports";
import { date, id, money, docTypeSchema, draftPayloadSchemas, validateDraft } from "./drafts";
import { getDocument, searchDocuments, searchCustomers } from "./document-reads";
import { createCustomerDraftArgs, toCustomerDraftPayload, validateCustomerDraft } from "./customer-drafts";
import { adminToolSchemas, erpRequest, getQuotationPdf, listEndpoints, sendQuotationPdf } from "./admin-tools";
import { createCustomerDirect, createQuotationDirect, directToolSchemas, listUnmatchedBankEntries, matchBankEntry, previewInvoiceEmail, requestQuotationEmail, requestInvoiceEmail } from "./direct-tools";

const documentType = z.enum(["invoices", "vouchers", "quotations", "sales_orders"]);
const shortText = z.string().max(200);
export const toolSchemas = {
  get_finance_summary: z.object({ period: z.string().regex(/^(20\d{2}|2100)-(0[1-9]|1[0-2])$/).optional() }).strict(),
  list_receivables: z.object({ min_overdue_days: z.number().int().min(0).max(36500).optional(), customer_id: id.optional() }).strict(),
  list_overdue_customers: z.object({ days: z.number().int().min(1).max(36500).default(1) }).strict(),
  search_documents: z.object({ type: documentType, keyword: shortText.optional(), status: shortText.optional(), date_from: date.optional(), date_to: date.optional(), limit: z.number().int().min(1).max(50).default(20) }).strict(),
  get_document: z.object({ type: documentType, id }).strict(),
  search_customers: z.object({ keyword: z.string().trim().max(100).optional(), limit: z.number().int().min(1).max(50).default(50) }).strict(),
  create_receipt_draft: z.object({ customer_id: id, date, account_id: id, lines: z.array(z.object({ invoice_id: id, amount: money }).strict()).min(1).max(100), description: z.string().max(500) }).strict(),
  create_document_draft: z.discriminatedUnion("doc_type", [
    z.object({ doc_type: z.literal("quotation"), payload: draftPayloadSchemas.quotation }).strict(),
    z.object({ doc_type: z.literal("payment"), payload: draftPayloadSchemas.payment }).strict(),
    z.object({ doc_type: z.literal("payment_request"), payload: draftPayloadSchemas.payment_request }).strict(),
    z.object({ doc_type: z.literal("sales_invoice"), payload: draftPayloadSchemas.sales_invoice }).strict(),
  ]),
  list_my_drafts: z.object({ status: z.enum(["pending", "confirmed", "rejected"]).optional() }).strict(),
  create_customer_draft: createCustomerDraftArgs,
  // 直接生效（依身分開放）：建客戶、開報價單、銀行對帳配對
  create_customer: createCustomerDraftArgs,
  create_quotation: draftPayloadSchemas.quotation,
  ...directToolSchemas,
  // 全權身分：操作所有模組、報價單 PDF
  ...adminToolSchemas,
};
export type ToolName = keyof typeof toolSchemas;

/** Only these pre-existing terminal READ handlers are reachable.
 * Fixed allowlist, no user-supplied route/handler, no human identity impersonation. */
async function readReport(path: "/reports/income-statement" | "/reports/cash-flow" | "/reports/ar-aging", query: Record<string,string> = {}): Promise<any> {
  const layer = (reports as any).stack.find((l: any) => l.route?.path === path && l.route.methods.get);
  if (!layer) throw new Error("Finance report unavailable");
  let result: unknown;
  let status = 200;
  await layer.route.stack.at(-1).handle({ query }, {
    status(code: number) { status = code; return this; },
    json(value: unknown) { result = value; },
  });
  if (status !== 200 || result === undefined) throw new Error("Finance report unavailable");
  return result;
}
async function finance(period?: string) {
  const selectedPeriod = period ?? new Date().toISOString().slice(0,7);
  const [year, month] = selectedPeriod.split("-").map(Number);
  const startDate = `${year}-${String(month).padStart(2,"0")}-01`;
  const endDate = new Date(Date.UTC(year,month,0)).toISOString().slice(0,10);
  return {
    period: selectedPeriod, basis: ["reports/income-statement","reports/cash-flow"],
    incomeStatement: await readReport("/reports/income-statement",{startDate,endDate}),
    cashFlow: await readReport("/reports/cash-flow",{startDate,endDate}),
  };
}
async function receivables(days?: number, customer?: number) {
  const report = await readReport("/reports/ar-aging");
  // The existing report returns customer buckets, but omits customer IDs and
  // invoice details. Supplement with a safe projection using its EXACT scope
  // (Sales only, excluding Paid/Cancelled/WrittenOff), not the BI definition.
  // Reconcile all buckets before filtering; drift fails closed.
  const invoices = await db.select({
    id: invoicesTable.id, invoiceNumber: invoicesTable.invoiceNumber,
    customerId: invoicesTable.customerId, dueDate: invoicesTable.dueDate,
    invoiceDate: invoicesTable.invoiceDate, outstandingAmount: invoicesTable.outstandingAmount,
  }).from(invoicesTable).where(and(eq(invoicesTable.invoiceType,"Sales"),ne(invoicesTable.status,"Paid"),ne(invoicesTable.status,"Cancelled"),ne(invoicesTable.status,"WrittenOff"))).orderBy(invoicesTable.id);
  const customers = await db.select({id:customersTable.id,name:customersTable.name}).from(customersTable);
  const names = new Map(customers.map(c => [c.id,c.name]));
  const totals = {current:0,d30:0,d60:0,d90:0,d120:0,total:0};
  const details = invoices.filter(row => Number(row.outstandingAmount)>0).map(row => {
    const overdueDays = Math.max(0,Math.floor((new Date(report.asOfDate).getTime()-new Date(row.dueDate || row.invoiceDate).getTime())/86400000));
    const amount = Number(row.outstandingAmount);
    const bucket = overdueDays<=0 ? "current" : overdueDays<=30 ? "d30" : overdueDays<=60 ? "d60" : overdueDays<=90 ? "d90" : "d120";
    totals[bucket] += amount; totals.total += amount;
    return {...row,customerName:names.get(row.customerId ?? 0) ?? "未指定",overdueDays};
  });
  for (const key of Object.keys(totals) as (keyof typeof totals)[]) {
    if (Math.abs(totals[key]-Number(report.summary[key]))>0.001) throw new Error("AR report detail reconciliation failed");
  }
  const filtered = details.filter(row => (customer === undefined || row.customerId === customer) && (days === undefined || row.overdueDays>=days));
  return {asOfDate:report.asOfDate,basis:"reports/ar-aging",sourceSummary:report.summary,rows:filtered.slice(0,500),totalMatching:filtered.length,limit:500,truncated:filtered.length>500};
}
export async function executeTool(name: ToolName, raw: unknown): Promise<unknown> {
  const tenantId = currentTenantId();
  if (!tenantId) throw new Error("Tenant context required");
  const p: any = toolSchemas[name].parse(raw);
  switch (name) {
    case "get_finance_summary": return finance(p.period);
    case "list_receivables": return receivables(p.min_overdue_days, p.customer_id);
    case "list_overdue_customers": {
      const report = await receivables(p.days);
      const groups = new Map<unknown, any>();
      for (const row of report.rows) {
        const group = groups.get(row.customerId) ?? { customerId: row.customerId, customerName: row.customerName, outstandingAmount: 0, invoices: 0, maxOverdueDays: 0 };
        group.outstandingAmount += Number(row.outstandingAmount);
        group.invoices++;
        group.maxOverdueDays = Math.max(group.maxOverdueDays, Number(row.overdueDays));
        groups.set(row.customerId, group);
      }
      return { asOfDate:report.asOfDate,basis:report.basis,customers: [...groups.values()], sourceLimit:report.limit,totalMatchingInvoices:report.totalMatching,truncated:report.truncated };
    }
    case "search_documents": return searchDocuments(p);
    case "get_document": return getDocument(p.type, p.id);
    case "search_customers": return searchCustomers(p);
    case "create_receipt_draft":
    case "create_document_draft": {
      const type = name === "create_receipt_draft" ? "receipt" : docTypeSchema.parse(p.doc_type);
      const payload = name === "create_receipt_draft" ? {
        voucherType: "收款單", voucherDate: p.date, customerId: p.customer_id, accountId: p.account_id,
        description: p.description, items: p.lines.map((row: any) => ({ invoiceId: row.invoice_id, amount: row.amount })),
      } : p.payload;
      await validateDraft(type,payload);
      const [draft] = await db.insert(aiDraftDocumentsTable).values({ tenantId, docType: type, payload, summary: `${type} draft awaiting human approval` }).returning({ id: aiDraftDocumentsTable.id, status: aiDraftDocumentsTable.status, summary: aiDraftDocumentsTable.summary });
      return draft;
    }
    case "create_customer_draft": {
      // Only ai_customer_drafts is written; formal customers are created by human confirmation.
      const payload = await validateCustomerDraft(toCustomerDraftPayload(p));
      const [draft] = await db.insert(aiCustomerDraftsTable).values({ tenantId, payload, summary: `客戶主檔草稿：${payload.name}` })
        .returning({ id: aiCustomerDraftsTable.id, status: aiCustomerDraftsTable.status, summary: aiCustomerDraftsTable.summary });
      return draft;
    }
    case "create_customer": return createCustomerDirect(p);
    case "create_quotation": return createQuotationDirect(p);
    case "list_unmatched_bank_entries": return listUnmatchedBankEntries(p);
    case "match_bank_entry": return matchBankEntry(p);
    case "preview_invoice_email": return previewInvoiceEmail(p);
    case "request_quotation_email": return requestQuotationEmail(p);
    case "request_invoice_email": return requestInvoiceEmail(p);
    case "erp_list_endpoints": return listEndpoints(p);
    case "erp_request": return erpRequest(p);
    case "get_quotation_pdf": return getQuotationPdf(p);
    case "send_quotation_pdf": return sendQuotationPdf(p);
    case "list_my_drafts": return db.select({
      id: aiDraftDocumentsTable.id, docType: aiDraftDocumentsTable.docType, status: aiDraftDocumentsTable.status,
      summary: aiDraftDocumentsTable.summary, createdAt: aiDraftDocumentsTable.createdAt,
    }).from(aiDraftDocumentsTable).where(and(eq(aiDraftDocumentsTable.createdBy,"ai"), p.status ? eq(aiDraftDocumentsTable.status,p.status) : undefined)).orderBy(aiDraftDocumentsTable.id).limit(50);
  }
}
