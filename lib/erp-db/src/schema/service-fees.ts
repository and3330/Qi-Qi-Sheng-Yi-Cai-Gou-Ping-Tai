import { sql } from "drizzle-orm";
import { pgTable, text, serial, timestamp, integer, numeric, index, uniqueIndex } from "drizzle-orm/pg-core";

/**
 * 講師與服務費（勞務報酬）。
 * 服務型單據（課程、活動）的成本主要是人：外聘講師的鐘點費，或自家員工額外的授課費。
 * 每一筆都要歸到專案（可再指定銷貨單），才算得出那張單、那個專案真正的毛利；
 * 同時記下所得類別、代扣稅款與二代健保補充保費，年底可以直接彙總出各人的所得資料。
 */
export const serviceFeesTable = pgTable("service_fees", {
  tenantId: integer("tenant_id").notNull().default(sql`(current_setting('app.tenant_id'::text))::integer`),
  id: serial("id").primaryKey(),
  feeNumber: text("fee_number").notNull(),
  // teacher：外聘講師（老師管理）；employee：自家員工
  payeeType: text("payee_type").notNull(),
  teacherId: integer("teacher_id"),
  employeeId: integer("employee_id"),
  payeeName: text("payee_name").notNull(),
  salesOrderId: integer("sales_order_id"),
  projectId: integer("project_id").notNull(),
  departmentId: integer("department_id"),
  serviceDate: text("service_date").notNull(),
  description: text("description"),
  hours: numeric("hours", { precision: 8, scale: 2 }),
  rate: numeric("rate", { precision: 12, scale: 2 }),
  amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
  // 所得類別：50 薪資、9A 執行業務、9B 稿費及講演鐘點費
  incomeType: text("income_type").notNull().default("50"),
  withholdingTax: numeric("withholding_tax", { precision: 12, scale: 2 }).notNull().default("0"),
  nhiSupplement: numeric("nhi_supplement", { precision: 12, scale: 2 }).notNull().default("0"),
  netAmount: numeric("net_amount", { precision: 12, scale: 2 }).notNull(),
  // Confirmed 已登錄（已認列成本、尚未付款）、Paid 已付款、Voided 已作廢
  status: text("status").notNull().default("Confirmed"),
  paidDate: text("paid_date"),
  journalEntryId: integer("journal_entry_id"),
  paymentJournalEntryId: integer("payment_journal_entry_id"),
  createdBy: text("created_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("service_fees_number_unique").on(t.tenantId, t.feeNumber),
  index("service_fees_order_idx").on(t.tenantId, t.salesOrderId),
  index("service_fees_date_idx").on(t.tenantId, t.serviceDate),
]);

export type ServiceFee = typeof serviceFeesTable.$inferSelect;
