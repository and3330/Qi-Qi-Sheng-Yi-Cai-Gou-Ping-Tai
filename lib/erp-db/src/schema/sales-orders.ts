import { sql } from "drizzle-orm";
import {pgTable, text, serial, timestamp, integer, numeric, jsonb, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { customersTable } from "./customers";
import { employeesTable } from "./employees";
import { departmentsTable } from "./departments";
import { projectsTable } from "./projects";
import { orderTemplatesTable } from "./order-templates";
import { quotationsTable } from "./quotations";

export const salesOrdersTable = pgTable("sales_orders", {
  tenantId: integer("tenant_id").notNull().default(sql`(current_setting('app.tenant_id'::text))::integer`),
  id: serial("id").primaryKey(),
  orderNumber: text("order_number").notNull(),
  customerId: integer("customer_id").notNull().references(() => customersTable.id),
  salespersonId: integer("salesperson_id").references(() => employeesTable.id),
  orderDate: text("order_date").notNull(),
  deliveryDate: text("delivery_date"),
  status: text("status").notNull().default("Draft"),
  totalAmount: numeric("total_amount", { precision: 14, scale: 2 }).notNull().default("0"),
  items: jsonb("items").notNull().default([]),
  departmentId: integer("department_id").references(() => departmentsTable.id),
  projectId: integer("project_id").references(() => projectsTable.id),

  orderSource: text("order_source"),
  quotationId: integer("quotation_id").references(() => quotationsTable.id),
  templateId: integer("template_id").references(() => orderTemplatesTable.id),
  extraFields: jsonb("extra_fields").default({}),
  label: text("label"),
  handlerId: integer("handler_id").references(() => employeesTable.id),
  classWeeks: integer("class_weeks"),
  courseStartDate: text("course_start_date"),
  courseEndDate: text("course_end_date"),
  caseTime: text("case_time"),
  teacherCode: text("teacher_code"),
  teacherFeePerSession: numeric("teacher_fee_per_session", { precision: 10, scale: 2 }),
  teacherMaterialFeeMethod: text("teacher_material_fee_method"),
  coursePeriod: text("course_period"),
  warehouseCode: text("warehouse_code"),
  transactionType: text("transaction_type"),
  dateDetails: text("date_details"),
  remarks: text("remarks"),

  invoiceTaxId: text("invoice_tax_id"),
  invoiceTitle: text("invoice_title"),

  // 未開發票的成立訂單（Confirmed/Completed）自動認列營收的分錄；補開發票後作廢改以發票為準
  journalEntryId: integer("journal_entry_id"),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (t) => [
  uniqueIndex("sales_orders_order_number_unique").on(t.tenantId, t.orderNumber),
]);

export const insertSalesOrderSchema = createInsertSchema(salesOrdersTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertSalesOrder = z.infer<typeof insertSalesOrderSchema>;
export type SalesOrder = typeof salesOrdersTable.$inferSelect;
