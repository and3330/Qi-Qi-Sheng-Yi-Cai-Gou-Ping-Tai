import {
  pgTable,
  serial,
  text,
  integer,
  boolean,
  timestamp,
  jsonb,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { erpCustomersTable, salesOrdersTable } from "./erpInventory";
import { suppliersTable } from "./suppliers";
import { purchaseOrdersTable } from "./purchasing";

/**
 * 會計科目表（樹狀）：isGroup=true 為彙總科目、不可過帳。
 * accountType: Asset | Liability | Equity | Income | Expense
 * cashFlowCategory 覆寫現金流量表分類：operating | investing | financing | cash
 * balance 為期初/靜態餘額（NT$ 整數），交易面由日記帳彙總。
 */
export const erpAccountsTable = pgTable(
  "erp_accounts",
  {
    id: serial("id").primaryKey(),
    accountNumber: text("account_number").notNull().unique(),
    accountName: text("account_name").notNull(),
    accountType: text("account_type").notNull(),
    parentAccountId: integer("parent_account_id"),
    isGroup: boolean("is_group").notNull().default(false),
    cashFlowCategory: text("cash_flow_category"),
    balance: integer("balance").notNull().default(0),
    description: text("description"),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [index("idx_erp_accounts_parent").on(t.parentAccountId)],
);

/** 傳票/日記帳分錄行（jsonb）：{ accountId?, accountName, debit, credit, description? } */
export interface ErpJournalLine {
  accountId?: number | null;
  accountName?: string | null;
  debit: number;
  credit: number;
  description?: string | null;
}

/**
 * 日記帳/傳票（總帳過帳單位）。lines 為 jsonb 分錄行。
 * status: Draft | Posted；報表僅計 status <> 'Draft'。
 * sourceType/sourceId 標記自動立帳來源（voucher/shop_order/sales_order/purchase_order/profit_share/salary 等）。
 */
export const erpJournalEntriesTable = pgTable(
  "erp_journal_entries",
  {
    id: serial("id").primaryKey(),
    entryNumber: text("entry_number").notNull().unique(),
    entryDate: text("entry_date").notNull(),
    reference: text("reference"),
    description: text("description"),
    totalDebit: integer("total_debit").notNull().default(0),
    totalCredit: integer("total_credit").notNull().default(0),
    lines: jsonb("lines").notNull().default(sql`'[]'::jsonb`),
    status: text("status").notNull().default("Posted"),
    isAuto: boolean("is_auto").notNull().default(false),
    sourceType: text("source_type"),
    sourceId: text("source_id"),
    createdBy: integer("created_by"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("idx_erp_je_date").on(t.entryDate),
    uniqueIndex("uq_erp_je_source")
      .on(t.sourceType, t.sourceId)
      .where(sql`source_type IS NOT NULL AND source_id IS NOT NULL`),
  ],
);

/**
 * 收付款/請款單。voucherType: Receipt(收款單) | Payment(付款單) | Journal(請款單)
 * items jsonb: [{ invoiceId?, description?, amount }]
 * journalEntryId：自動傳票連結（刪單需一併刪除）。
 */
export const erpVouchersTable = pgTable(
  "erp_vouchers",
  {
    id: serial("id").primaryKey(),
    voucherNumber: text("voucher_number").notNull().unique(),
    voucherType: text("voucher_type").notNull(),
    voucherDate: text("voucher_date").notNull(),
    partyType: text("party_type"),
    customerId: integer("customer_id").references(() => erpCustomersTable.id),
    supplierId: integer("supplier_id").references(() => suppliersTable.id),
    totalAmount: integer("total_amount").notNull().default(0),
    paymentMethod: text("payment_method"),
    bankAccount: text("bank_account"),
    items: jsonb("items").notNull().default(sql`'[]'::jsonb`),
    remarks: text("remarks"),
    journalEntryId: integer("journal_entry_id").references(
      () => erpJournalEntriesTable.id,
    ),
    createdBy: integer("created_by"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [index("idx_erp_vouchers_type_date").on(t.voucherType, t.voucherDate)],
);

/**
 * 發票（AR/AP）。invoiceType: Sales | Purchase
 * 金額不變式：paidAmount / outstandingAmount 僅能由 invoice_settlements 重算產生。
 * taxType: taxable | zero_rated | exempt | unclassified；金額為 NT$ 整數。
 * govInvoiceNumber 為政府統一發票號碼；電子發票加值中心（ECPay 等）串接留擴充點。
 */
export const erpInvoicesTable = pgTable(
  "erp_invoices",
  {
    id: serial("id").primaryKey(),
    invoiceNumber: text("invoice_number").notNull().unique(),
    invoiceType: text("invoice_type").notNull(),
    customerId: integer("customer_id").references(() => erpCustomersTable.id),
    supplierId: integer("supplier_id").references(() => suppliersTable.id),
    salesOrderId: integer("sales_order_id").references(
      () => salesOrdersTable.id,
    ),
    purchaseOrderId: integer("purchase_order_id").references(
      () => purchaseOrdersTable.id,
    ),
    invoiceDate: text("invoice_date").notNull(),
    dueDate: text("due_date"),
    totalAmount: integer("total_amount").notNull().default(0),
    paidAmount: integer("paid_amount").notNull().default(0),
    outstandingAmount: integer("outstanding_amount").notNull().default(0),
    taxType: text("tax_type").notNull().default("taxable"),
    taxRate: integer("tax_rate").notNull().default(5),
    netAmount: integer("net_amount").notNull().default(0),
    taxAmount: integer("tax_amount").notNull().default(0),
    govInvoiceNumber: text("gov_invoice_number"),
    status: text("status").notNull().default("Unpaid"),
    items: jsonb("items").notNull().default(sql`'[]'::jsonb`),
    remarks: text("remarks"),
    journalEntryId: integer("journal_entry_id").references(
      () => erpJournalEntriesTable.id,
    ),
    createdBy: integer("created_by"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("idx_erp_invoices_type_status").on(t.invoiceType, t.status),
    index("idx_erp_invoices_customer").on(t.customerId),
    index("idx_erp_invoices_supplier").on(t.supplierId),
    uniqueIndex("uq_erp_invoices_sales_order")
      .on(t.salesOrderId)
      .where(sql`sales_order_id IS NOT NULL`),
    uniqueIndex("uq_erp_invoices_purchase_order")
      .on(t.purchaseOrderId)
      .where(sql`purchase_order_id IS NOT NULL`),
  ],
);

/** 核銷紀錄：發票已收付金額的唯一來源。 */
export const erpInvoiceSettlementsTable = pgTable(
  "erp_invoice_settlements",
  {
    id: serial("id").primaryKey(),
    invoiceId: integer("invoice_id")
      .notNull()
      .references(() => erpInvoicesTable.id, { onDelete: "cascade" }),
    voucherId: integer("voucher_id").references(() => erpVouchersTable.id, {
      onDelete: "cascade",
    }),
    paymentRequestId: integer("payment_request_id"),
    amount: integer("amount").notNull(),
    remarks: text("remarks"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [index("idx_erp_settlements_invoice").on(t.invoiceId)],
);

/**
 * 付款/請款申請。status: Draft → Pending → Approved → Paid；Rejected → Draft；可 Cancelled。
 * 標記 Paid 且關聯發票時經核銷路徑結算。
 */
export const erpPaymentRequestsTable = pgTable(
  "erp_payment_requests",
  {
    id: serial("id").primaryKey(),
    requestNumber: text("request_number").notNull().unique(),
    invoiceId: integer("invoice_id").references(() => erpInvoicesTable.id),
    partyType: text("party_type").notNull(),
    customerId: integer("customer_id").references(() => erpCustomersTable.id),
    supplierId: integer("supplier_id").references(() => suppliersTable.id),
    requestDate: text("request_date").notNull(),
    dueDate: text("due_date"),
    amount: integer("amount").notNull(),
    status: text("status").notNull().default("Draft"),
    paymentMethod: text("payment_method"),
    bankAccount: text("bank_account"),
    remarks: text("remarks"),
    createdBy: integer("created_by"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [index("idx_erp_payreq_status").on(t.status)],
);

/** 銀行對帳單（匯入批次） */
export const erpBankStatementsTable = pgTable("erp_bank_statements", {
  id: serial("id").primaryKey(),
  bankName: text("bank_name"),
  accountNumber: text("account_number"),
  bankAccountId: integer("bank_account_id"),
  statementDate: text("statement_date").notNull(),
  openingBalance: integer("opening_balance").notNull().default(0),
  closingBalance: integer("closing_balance").notNull().default(0),
  /** draft | reconciling | completed */
  status: text("status").notNull().default("draft"),
  remarks: text("remarks"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

/** 銀行對帳明細：matchStatus: unmatched | matched | ignored */
export const erpBankReconciliationEntriesTable = pgTable(
  "erp_bank_reconciliation_entries",
  {
    id: serial("id").primaryKey(),
    statementId: integer("statement_id")
      .notNull()
      .references(() => erpBankStatementsTable.id, { onDelete: "cascade" }),
    transactionDate: text("transaction_date").notNull(),
    description: text("description"),
    debit: integer("debit").notNull().default(0),
    credit: integer("credit").notNull().default(0),
    reference: text("reference"),
    matchedVoucherId: integer("matched_voucher_id").references(
      () => erpVouchersTable.id,
    ),
    matchedJournalEntryId: integer("matched_journal_entry_id").references(
      () => erpJournalEntriesTable.id,
    ),
    matchStatus: text("match_status").notNull().default("unmatched"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [index("idx_erp_bankrec_statement").on(t.statementId)],
);

/** 會計設定（單列）：lockDate 之前（含當日）禁止會計寫入。 */
export const erpAccountingSettingsTable = pgTable("erp_accounting_settings", {
  id: serial("id").primaryKey(),
  lockDate: text("lock_date"),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type ErpAccount = typeof erpAccountsTable.$inferSelect;
export type ErpJournalEntry = typeof erpJournalEntriesTable.$inferSelect;
export type ErpVoucher = typeof erpVouchersTable.$inferSelect;
export type ErpInvoice = typeof erpInvoicesTable.$inferSelect;
export type ErpInvoiceSettlement =
  typeof erpInvoiceSettlementsTable.$inferSelect;
export type ErpPaymentRequest = typeof erpPaymentRequestsTable.$inferSelect;
export type ErpBankStatement = typeof erpBankStatementsTable.$inferSelect;
export type ErpBankReconciliationEntry =
  typeof erpBankReconciliationEntriesTable.$inferSelect;
export type ErpAccountingSettings =
  typeof erpAccountingSettingsTable.$inferSelect;
