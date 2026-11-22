import { sql } from "drizzle-orm";
import {pgTable, text, serial, timestamp, numeric, integer, jsonb, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const vouchersTable = pgTable("vouchers", {
  tenantId: integer("tenant_id").notNull().default(sql`(current_setting('app.tenant_id'::text))::integer`),
  id: serial("id").primaryKey(),
  voucherNumber: text("voucher_number").notNull(),
  voucherType: text("voucher_type").notNull(),
  voucherDate: text("voucher_date").notNull(),
  description: text("description"),
  totalAmount: numeric("total_amount", { precision: 14, scale: 2 }).notNull().default("0"),
  status: text("status").notNull().default("草稿"),
  projectId: integer("project_id"),
  departmentId: integer("department_id"),
  customerId: integer("customer_id"),
  supplierId: integer("supplier_id"),
  employeeId: integer("employee_id"),
  journalEntryId: integer("journal_entry_id"),
  items: jsonb("items").notNull().default([]),
  // 用了哪個收付款單模板，和模板自訂欄位填的值
  templateId: integer("template_id"),
  extraFields: jsonb("extra_fields").$type<Record<string, unknown>>(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (t) => [
  uniqueIndex("vouchers_voucher_number_unique").on(t.tenantId, t.voucherNumber),
]);

export const insertVoucherSchema = createInsertSchema(vouchersTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertVoucher = z.infer<typeof insertVoucherSchema>;
export type Voucher = typeof vouchersTable.$inferSelect;
