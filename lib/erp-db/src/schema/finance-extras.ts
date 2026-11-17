import { sql } from "drizzle-orm";
import { pgTable, text, serial, timestamp, integer, numeric, boolean, jsonb, uniqueIndex, index } from "drizzle-orm/pg-core";

/** 催款紀錄：哪一張發票、第幾次催、用什麼方式、對方怎麼回 */
export const dunningLogsTable = pgTable("dunning_logs", {
  tenantId: integer("tenant_id").notNull().default(sql`(current_setting('app.tenant_id'::text))::integer`),
  id: serial("id").primaryKey(),
  invoiceId: integer("invoice_id").notNull(),
  customerId: integer("customer_id"),
  level: integer("level").notNull().default(1),
  dunnedDate: text("dunned_date").notNull(),
  // phone 電話、email 電子郵件、line 通訊軟體、letter 書面
  channel: text("channel").notNull().default("phone"),
  overdueAmount: numeric("overdue_amount", { precision: 14, scale: 2 }).notNull().default("0"),
  note: text("note"),
  createdBy: text("created_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("dunning_logs_invoice_idx").on(t.tenantId, t.invoiceId),
]);

export interface RecurringItem { itemId: number; itemName: string; quantity: number; rate: number }

/** 定期發票範本：每月（季、年）固定開給同一個對象的發票 */
export const recurringInvoicesTable = pgTable("recurring_invoices", {
  tenantId: integer("tenant_id").notNull().default(sql`(current_setting('app.tenant_id'::text))::integer`),
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  // Sales 銷項（開給客戶）、Purchase 進項（房租、月費這類固定支出）
  invoiceType: text("invoice_type").notNull().default("Sales"),
  customerId: integer("customer_id"),
  supplierId: integer("supplier_id"),
  projectId: integer("project_id").notNull(),
  items: jsonb("items").$type<RecurringItem[]>().notNull().default([]),
  taxType: text("tax_type").notNull().default("taxable"),
  // monthly 每月、quarterly 每季、yearly 每年
  frequency: text("frequency").notNull().default("monthly"),
  nextRunDate: text("next_run_date").notNull(),
  endDate: text("end_date"),
  isActive: boolean("is_active").notNull().default(true),
  lastRunDate: text("last_run_date"),
  lastInvoiceId: integer("last_invoice_id"),
  runCount: integer("run_count").notNull().default(0),
  note: text("note"),
  createdBy: text("created_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export interface MaterialRequestItem { itemId: number; itemName: string; quantity: number; note?: string }

/** 請購單：現場提出要買什麼，主管核准後再轉成採購單 */
export const materialRequestsTable = pgTable("material_requests", {
  tenantId: integer("tenant_id").notNull().default(sql`(current_setting('app.tenant_id'::text))::integer`),
  id: serial("id").primaryKey(),
  requestNumber: text("request_number").notNull(),
  requestDate: text("request_date").notNull(),
  neededBy: text("needed_by"),
  requesterName: text("requester_name").notNull(),
  projectId: integer("project_id").notNull(),
  departmentId: integer("department_id"),
  // Submitted 待核准、Approved 已核准、Rejected 已退回、Ordered 已轉採購、Cancelled 已取消
  status: text("status").notNull().default("Submitted"),
  items: jsonb("items").$type<MaterialRequestItem[]>().notNull().default([]),
  reason: text("reason"),
  reviewedBy: text("reviewed_by"),
  reviewNote: text("review_note"),
  purchaseOrderId: integer("purchase_order_id"),
  createdBy: text("created_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("material_requests_number_unique").on(t.tenantId, t.requestNumber),
]);

/** 預算：每個會計科目每個月的預算金額 */
export const budgetsTable = pgTable("budgets", {
  tenantId: integer("tenant_id").notNull().default(sql`(current_setting('app.tenant_id'::text))::integer`),
  id: serial("id").primaryKey(),
  fiscalYear: integer("fiscal_year").notNull(),
  accountId: integer("account_id").notNull(),
  month: integer("month").notNull(),
  amount: numeric("amount", { precision: 14, scale: 2 }).notNull().default("0"),
  updatedBy: text("updated_by"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("budgets_year_account_month_unique").on(t.tenantId, t.fiscalYear, t.accountId, t.month),
]);
