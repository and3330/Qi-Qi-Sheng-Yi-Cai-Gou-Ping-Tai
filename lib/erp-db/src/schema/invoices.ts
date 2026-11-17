import { sql } from "drizzle-orm";
import {pgTable, text, serial, timestamp, integer, numeric, jsonb, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { customersTable } from "./customers";
import { suppliersTable } from "./suppliers";
import { salesOrdersTable } from "./sales-orders";
import { deliveryNotesTable } from "./delivery-notes";
import { purchaseOrdersTable } from "./purchase-orders";
import { purchaseReceiptsTable } from "./purchase-receipts";

export const invoicesTable = pgTable("invoices", {
  tenantId: integer("tenant_id").notNull().default(sql`(current_setting('app.tenant_id'::text))::integer`),
  id: serial("id").primaryKey(),
  invoiceNumber: text("invoice_number").notNull(),
  invoiceType: text("invoice_type").notNull(),
  customerId: integer("customer_id").references(() => customersTable.id),
  supplierId: integer("supplier_id").references(() => suppliersTable.id),
  salesOrderId: integer("sales_order_id").references(() => salesOrdersTable.id),
  deliveryNoteId: integer("delivery_note_id").references(() => deliveryNotesTable.id),
  purchaseOrderId: integer("purchase_order_id").references(() => purchaseOrdersTable.id),
  // 歸屬專案：由訂單轉出的發票沿用訂單的專案，手開發票由使用者選
  projectId: integer("project_id"),
  purchaseReceiptId: integer("purchase_receipt_id").references(() => purchaseReceiptsTable.id),
  // 外包加工費發票：由哪一張外包單的交貨產生
  subcontractOrderId: integer("subcontract_order_id"),
  invoiceDate: text("invoice_date").notNull(),
  dueDate: text("due_date"),
  // 付款條件與分期排程；有排程時 dueDate 是最後一期的到期日
  paymentTermId: integer("payment_term_id"),
  paymentSchedule: jsonb("payment_schedule").$type<Array<{ label: string; percent: number; dueDate: string; amount: number }> | null>(),
  status: text("status").notNull().default("Draft"),
  totalAmount: numeric("total_amount", { precision: 14, scale: 2 }).notNull().default("0"),
  paidAmount: numeric("paid_amount", { precision: 14, scale: 2 }).notNull().default("0"),
  outstandingAmount: numeric("outstanding_amount", { precision: 14, scale: 2 }).notNull().default("0"),
  currency: text("currency").notNull().default("TWD"),
  exchangeRate: numeric("exchange_rate", { precision: 12, scale: 6 }).notNull().default("1"),
  // 營業稅: taxType = taxable(應稅) | zero_rated(零稅率) | exempt(免稅) | unclassified(未分類, 舊資料)
  taxType: text("tax_type").notNull().default("unclassified"),
  taxRate: numeric("tax_rate", { precision: 5, scale: 2 }).notNull().default("5"),
  // 未稅金額與稅額 (TWD 本位; totalAmount 為含稅總額)
  netAmount: numeric("net_amount", { precision: 14, scale: 2 }).notNull().default("0"),
  taxAmount: numeric("tax_amount", { precision: 14, scale: 2 }).notNull().default("0"),
  // 政府發票號碼 (進項憑證用, ecpay 欄位為銷項電子發票)
  govInvoiceNumber: text("gov_invoice_number"),
  // 自動產生的日記帳分錄（銷貨: 應收/銷貨收入, 採購: 進貨/應付），取消或刪除發票時同步刪除
  journalEntryId: integer("journal_entry_id"),
  // 呆帳沖銷（僅銷貨發票）：轉呆帳時自動建立分錄（借 呆帳損失 / 貸 應收帳款），取消呆帳時刪除
  writeOffJournalEntryId: integer("write_off_journal_entry_id"),
  writeOffAmount: numeric("write_off_amount", { precision: 14, scale: 2 }).notNull().default("0"),
  writeOffDate: text("write_off_date"),
  writeOffReason: text("write_off_reason"),
  items: jsonb("items").notNull().default([]),
  ecpayInvoiceNumber: text("ecpay_invoice_number"),
  ecpayIssueKey: text("ecpay_issue_key"),
  ecpayRandomNumber: text("ecpay_random_number"),
  ecpayInvoiceDate: text("ecpay_invoice_date"),
  ecpayInvoiceType: text("ecpay_invoice_type"),
  ecpayCarrierType: text("ecpay_carrier_type"),
  ecpayCarrierNum: text("ecpay_carrier_num"),
  ecpayLoveCode: text("ecpay_love_code"),
  ecpayTaxId: text("ecpay_tax_id"),
  ecpayCompanyTitle: text("ecpay_company_title"),
  ecpayBuyerName: text("ecpay_buyer_name"),
  ecpayBuyerEmail: text("ecpay_buyer_email"),
  ecpayBuyerPhone: text("ecpay_buyer_phone"),
  ecpayBuyerAddr: text("ecpay_buyer_addr"),
  ecpayVoidedAt: timestamp("ecpay_voided_at", { withTimezone: true }),
  ecpayVoidRequestedAt: timestamp("ecpay_void_requested_at", { withTimezone: true }),
  ecpayVoidReason: text("ecpay_void_reason"),
  ecpayResponse: jsonb("ecpay_response"),
  ecpayStatus: text("ecpay_status"),
  ecpayLastSyncedAt: timestamp("ecpay_last_synced_at", { withTimezone: true }),
  ecpayLastSyncResponse: jsonb("ecpay_last_sync_response"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (t) => [
  uniqueIndex("invoices_invoice_number_unique").on(t.tenantId, t.invoiceNumber),
  uniqueIndex("invoices_ecpay_issue_key_unique").on(t.tenantId, t.ecpayIssueKey),
]);

export const insertInvoiceSchema = createInsertSchema(invoicesTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertInvoice = z.infer<typeof insertInvoiceSchema>;
export type Invoice = typeof invoicesTable.$inferSelect;
