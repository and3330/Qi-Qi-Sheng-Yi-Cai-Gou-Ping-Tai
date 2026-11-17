import { and, eq, gte, ilike, inArray, lte, or, sql } from "drizzle-orm";
import {
  db, currentTenantId, customersTable, invoicesTable, vouchersTable, quotationsTable,
  salesOrdersTable, itemsTable, accountsTable, journalEntriesTable,
} from "@workspace/erp-db";

export type DocumentType = "invoices" | "vouchers" | "quotations" | "sales_orders";
const documents = {
  invoices: {
    table: invoicesTable, number: invoicesTable.invoiceNumber, date: invoicesTable.invoiceDate,
    fields: { id: invoicesTable.id, number: invoicesTable.invoiceNumber, date: invoicesTable.invoiceDate, status: invoicesTable.status, customerId: invoicesTable.customerId, type: invoicesTable.invoiceType, totalAmount: invoicesTable.totalAmount, outstandingAmount: invoicesTable.outstandingAmount },
    detail: { dueDate: invoicesTable.dueDate, paidAmount: invoicesTable.paidAmount, netAmount: invoicesTable.netAmount, taxAmount: invoicesTable.taxAmount, taxType: invoicesTable.taxType, taxRate: invoicesTable.taxRate, currency: invoicesTable.currency, exchangeRate: invoicesTable.exchangeRate, govInvoiceNumber: invoicesTable.govInvoiceNumber },
  },
  vouchers: {
    table: vouchersTable, number: vouchersTable.voucherNumber, date: vouchersTable.voucherDate,
    fields: { id: vouchersTable.id, number: vouchersTable.voucherNumber, date: vouchersTable.voucherDate, status: vouchersTable.status, customerId: vouchersTable.customerId, type: vouchersTable.voucherType, totalAmount: vouchersTable.totalAmount },
    detail: { description: vouchersTable.description, notes: vouchersTable.description, journalEntryId: vouchersTable.journalEntryId },
  },
  quotations: {
    table: quotationsTable, number: quotationsTable.quotationNumber, date: quotationsTable.quotationDate,
    fields: { id: quotationsTable.id, number: quotationsTable.quotationNumber, date: quotationsTable.quotationDate, status: quotationsTable.status, customerId: quotationsTable.customerId, totalAmount: quotationsTable.grandTotal },
    detail: { validUntil: quotationsTable.validUntil, notes: quotationsTable.notes, terms: quotationsTable.terms, title: quotationsTable.title, subtotal: quotationsTable.totalAmount, taxAmount: quotationsTable.taxAmount, taxIncluded: quotationsTable.taxIncluded, grandTotal: quotationsTable.grandTotal, currency: quotationsTable.currency, exchangeRate: quotationsTable.exchangeRate },
  },
  sales_orders: {
    table: salesOrdersTable, number: salesOrdersTable.orderNumber, date: salesOrdersTable.orderDate,
    fields: { id: salesOrdersTable.id, number: salesOrdersTable.orderNumber, date: salesOrdersTable.orderDate, status: salesOrdersTable.status, customerId: salesOrdersTable.customerId, totalAmount: salesOrdersTable.totalAmount },
    detail: { deliveryDate: salesOrdersTable.deliveryDate, notes: salesOrdersTable.remarks, remarks: salesOrdersTable.remarks, invoiceTitle: salesOrdersTable.invoiceTitle, invoiceTaxId: salesOrdersTable.invoiceTaxId },
  },
};

function tenant() {
  const id = currentTenantId();
  if (!id) throw new Error("Tenant context required");
  return id;
}
function customerFields(type: DocumentType) {
  return {
    // Preserve the quote's historical/free-text customer even without a master record.
    customerName: type === "quotations"
      ? sql<string | null>`coalesce(nullif(${quotationsTable.customerName}, ''), ${customersTable.name})`
      : customersTable.name,
    customerCode: customersTable.customerCode,
  };
}
const pattern = (value: string) => `%${value.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_")}%`;

export async function searchDocuments(p: {
  type: DocumentType; keyword?: string; status?: string;
  date_from?: string; date_to?: string; limit?: number;
}) {
  const tenantId = tenant();
  const d = documents[p.type];
  return db.select({ ...d.fields, ...customerFields(p.type) }).from(d.table)
    .leftJoin(customersTable, and(eq(customersTable.id, d.table.customerId), eq(customersTable.tenantId, tenantId)))
    .where(and(eq(d.table.tenantId, tenantId),
      p.keyword ? ilike(d.number, pattern(p.keyword)) : undefined,
      p.status ? eq(d.table.status, p.status) : undefined,
      p.date_from ? gte(d.date, p.date_from) : undefined,
      p.date_to ? lte(d.date, p.date_to) : undefined,
    )).orderBy(d.table.id).limit(p.limit ?? 20);
}

type Row = Record<string, unknown>;
function rows(value: unknown): Row[] {
  if (!Array.isArray(value) || value.some(v => !v || typeof v !== "object" || Array.isArray(v))) {
    throw new Error("Invalid document detail");
  }
  return value;
}
/** Scalars only: never expose arbitrary nested JSON, provider responses or private keys. */
function value(row: Row, ...keys: string[]): string | number | null {
  for (const key of keys) {
    const v = row[key];
    if (typeof v === "string" || (typeof v === "number" && Number.isFinite(v))) return v;
  }
  return null;
}
function reference(row: Row, key: string): number | null {
  const raw = row[key];
  if (typeof raw !== "number" && typeof raw !== "string") return null;
  const id = Number(raw);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

async function productLines(raw: unknown) {
  const input = rows(raw);
  const ids = [...new Set(input.map(r => reference(r, "itemId")).filter((id): id is number => id !== null))];
  const master = ids.length ? await db.select({
    id: itemsTable.id, name: itemsTable.itemName, code: itemsTable.itemCode, unit: itemsTable.unit,
  }).from(itemsTable).where(and(eq(itemsTable.tenantId, tenant()), inArray(itemsTable.id, ids))) : [];
  const byId = new Map(master.map(item => [item.id, item]));
  return input.map((line, index) => {
    const itemId = reference(line, "itemId");
    const item = itemId ? byId.get(itemId) : undefined;
    return {
      lineNumber: index + 1, itemId,
      name: value(line, "itemName", "name", "description") ?? item?.name ?? null,
      code: value(line, "itemCode", "code", "sku") ?? item?.code ?? null,
      quantity: value(line, "quantity", "qty"), unit: value(line, "unit") ?? item?.unit ?? null,
      unitPrice: value(line, "unitPrice", "rate", "price"),
      discount: value(line, "discount"), discountRate: value(line, "discountRate"),
      discountAmount: value(line, "discountAmount"), taxRate: value(line, "taxRate"),
      taxAmount: value(line, "taxAmount", "tax"),
      subtotal: value(line, "subtotal", "subTotal", "netAmount", "amount"),
      amount: value(line, "amount", "subtotal", "subTotal"),
      description: value(line, "description"), notes: value(line, "notes"),
    };
  });
}

async function journalLines(raw: unknown) {
  const input = rows(raw);
  const ids = [...new Set(input.map(r => reference(r, "accountId")).filter((id): id is number => id !== null))];
  const master = ids.length ? await db.select({
    id: accountsTable.id, name: accountsTable.accountName, code: accountsTable.accountNumber,
  }).from(accountsTable).where(and(eq(accountsTable.tenantId, tenant()), inArray(accountsTable.id, ids))) : [];
  const byId = new Map(master.map(account => [account.id, account]));
  return input.map((line, index) => {
    const accountId = reference(line, "accountId");
    const account = accountId ? byId.get(accountId) : undefined;
    return {
      lineNumber: index + 1, accountId,
      accountName: value(line, "accountName") ?? account?.name ?? null,
      accountCode: value(line, "accountCode", "accountNumber") ?? account?.code ?? null,
      debit: value(line, "debit"), credit: value(line, "credit"),
      amount: value(line, "amount"), description: value(line, "description", "summary"),
      invoiceId: reference(line, "invoiceId"),
    };
  });
}

export async function getDocument(type: DocumentType, id: number) {
  const tenantId = tenant();
  const d = documents[type];
  const [document] = await db.select({
    ...d.fields, ...d.detail, ...customerFields(type), items: d.table.items,
  }).from(d.table)
    .leftJoin(customersTable, and(eq(customersTable.id, d.table.customerId), eq(customersTable.tenantId, tenantId)))
    .where(and(eq(d.table.tenantId, tenantId), eq(d.table.id, id))).limit(1);
  if (!document) throw new Error("Document not found");
  const { items, ...header } = document;
  if (type !== "vouchers") return { ...header, items: await productLines(items) };
  const journalEntryId = reference(header, "journalEntryId");
  const [journal] = journalEntryId ? await db.select({
    id: journalEntriesTable.id, number: journalEntriesTable.entryNumber, date: journalEntriesTable.entryDate,
    status: journalEntriesTable.status, description: journalEntriesTable.description,
    totalDebit: journalEntriesTable.totalDebit, totalCredit: journalEntriesTable.totalCredit,
    lines: journalEntriesTable.lines,
  }).from(journalEntriesTable).where(and(
    eq(journalEntriesTable.tenantId, tenantId), eq(journalEntriesTable.id, journalEntryId),
  )).limit(1) : [];
  if (journalEntryId && !journal) throw new Error("Linked journal not available");
  const voucherItems = await journalLines(items);
  const { lines: rawLines, ...journalHeader } = journal ?? { lines: [] };
  return {
    ...header, items: voucherItems, journalEntry: journal ? journalHeader : null,
    lineSource: journal ? "journal_entry" : "voucher_items",
    lines: journal ? await journalLines(rawLines) : voucherItems,
  };
}

export async function searchCustomers(p: { keyword?: string; limit?: number }) {
  const keyword = p.keyword?.trim();
  const search = keyword ? pattern(keyword) : undefined;
  return db.select({
    id: customersTable.id, code: customersTable.customerCode, customerCode: customersTable.customerCode,
    name: customersTable.name, taxId: customersTable.taxId, contactPerson: customersTable.contactPerson,
  }).from(customersTable).where(and(eq(customersTable.tenantId, tenant()),
    search ? or(ilike(customersTable.name, search), ilike(customersTable.customerCode, search),
      ilike(customersTable.taxId, search), ilike(customersTable.contactPerson, search)) : undefined,
  )).orderBy(customersTable.id).limit(p.limit ?? 50);
}
