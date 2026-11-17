import { sql } from "drizzle-orm";
import {pgTable, text, serial, timestamp, integer, numeric, jsonb, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { invoicesTable } from "./invoices";
import { suppliersTable } from "./suppliers";
import { customersTable } from "./customers";
import { departmentsTable } from "./departments";
import { projectsTable } from "./projects";

export const paymentRequestsTable = pgTable("payment_requests", {
  tenantId: integer("tenant_id").notNull().default(sql`(current_setting('app.tenant_id'::text))::integer`),
  id: serial("id").primaryKey(),
  requestNumber: text("request_number").notNull(),
  invoiceId: integer("invoice_id").references(() => invoicesTable.id),
  partyType: text("party_type").notNull(),
  customerId: integer("customer_id").references(() => customersTable.id),
  supplierId: integer("supplier_id").references(() => suppliersTable.id),
  requestDate: text("request_date").notNull(),
  dueDate: text("due_date"),
  amount: numeric("amount", { precision: 14, scale: 2 }).notNull().default("0"),
  status: text("status").notNull().default("Draft"),
  paymentMethod: text("payment_method"),
  bankAccount: text("bank_account"),
  remarks: text("remarks"),
  // 申請人（登入帳號）：誰送出這張申請。員工在「我的申請」看到的就是這一欄等於自己的單
  requestedBy: text("requested_by"),
  // AI 報銷延後過帳用：簽核通過時才建立分錄與發票的原始資料
  metadata: jsonb("metadata"),
  departmentId: integer("department_id").references(() => departmentsTable.id),
  projectId: integer("project_id").references(() => projectsTable.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (t) => [
  uniqueIndex("payment_requests_request_number_unique").on(t.tenantId, t.requestNumber),
]);

export const insertPaymentRequestSchema = createInsertSchema(paymentRequestsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertPaymentRequest = z.infer<typeof insertPaymentRequestSchema>;
export type PaymentRequest = typeof paymentRequestsTable.$inferSelect;
