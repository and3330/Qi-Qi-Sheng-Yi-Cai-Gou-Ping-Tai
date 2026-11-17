import { sql } from "drizzle-orm";
import {pgTable, text, serial, timestamp, numeric, integer, jsonb, boolean, uniqueIndex } from "drizzle-orm/pg-core";
import { customersTable } from "./customers";
import { departmentsTable } from "./departments";
import { projectsTable } from "./projects";
import { brandsTable } from "./brands";
import { orderTemplatesTable } from "./order-templates";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const quotationsTable = pgTable("quotations", {
  tenantId: integer("tenant_id").notNull().default(sql`(current_setting('app.tenant_id'::text))::integer`),
  id: serial("id").primaryKey(),
  quotationNumber: text("quotation_number").notNull(),
  customerId: integer("customer_id").references(() => customersTable.id),
  customerName: text("customer_name"),
  quotationDate: text("quotation_date").notNull(),
  validUntil: text("valid_until"),
  status: text("status").notNull().default("Draft"),
  totalAmount: numeric("total_amount", { precision: 15, scale: 2 }).notNull().default("0"),
  taxAmount: numeric("tax_amount", { precision: 15, scale: 2 }).notNull().default("0"),
  taxIncluded: boolean("tax_included").notNull().default(false),
  grandTotal: numeric("grand_total", { precision: 15, scale: 2 }).notNull().default("0"),
  currency: text("currency").notNull().default("TWD"),
  exchangeRate: numeric("exchange_rate", { precision: 12, scale: 6 }).notNull().default("1"),
  template: text("template").default("校園"),
  templateId: integer("template_id").references(() => orderTemplatesTable.id, { onDelete: "set null" }),
  extraFields: jsonb("extra_fields").default({}),
  notes: text("notes"),
  terms: text("terms"),
  items: jsonb("items").notNull().default([]),
  brandId: integer("brand_id").references(() => brandsTable.id),
  title: text("title"),
  quoterName: text("quoter_name"),
  quoterPhone: text("quoter_phone"),
  departmentId: integer("department_id").references(() => departmentsTable.id),
  projectId: integer("project_id").references(() => projectsTable.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (t) => [
  uniqueIndex("quotations_quotation_number_unique").on(t.tenantId, t.quotationNumber),
]);

export const insertQuotationSchema = createInsertSchema(quotationsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertQuotation = z.infer<typeof insertQuotationSchema>;
export type Quotation = typeof quotationsTable.$inferSelect;
