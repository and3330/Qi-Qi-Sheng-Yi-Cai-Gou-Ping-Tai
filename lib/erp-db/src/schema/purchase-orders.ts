import { sql } from "drizzle-orm";
import {pgTable, text, serial, timestamp, integer, numeric, jsonb, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { suppliersTable } from "./suppliers";
import { departmentsTable } from "./departments";
import { projectsTable } from "./projects";
import { orderTemplatesTable } from "./order-templates";

export const purchaseOrdersTable = pgTable("purchase_orders", {
  tenantId: integer("tenant_id").notNull().default(sql`(current_setting('app.tenant_id'::text))::integer`),
  id: serial("id").primaryKey(),
  orderNumber: text("order_number").notNull(),
  supplierId: integer("supplier_id").notNull().references(() => suppliersTable.id),
  orderDate: text("order_date").notNull(),
  expectedDate: text("expected_date"),
  status: text("status").notNull().default("Draft"),
  totalAmount: numeric("total_amount", { precision: 14, scale: 2 }).notNull().default("0"),
  currency: text("currency").notNull().default("TWD"),
  exchangeRate: numeric("exchange_rate", { precision: 12, scale: 6 }).notNull().default("1"),
  items: jsonb("items").notNull().default([]),
  templateId: integer("template_id").references(() => orderTemplatesTable.id, { onDelete: "set null" }),
  extraFields: jsonb("extra_fields").default({}),
  departmentId: integer("department_id").references(() => departmentsTable.id),
  projectId: integer("project_id").references(() => projectsTable.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (t) => [
  uniqueIndex("purchase_orders_order_number_unique").on(t.tenantId, t.orderNumber),
]);

export const insertPurchaseOrderSchema = createInsertSchema(purchaseOrdersTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertPurchaseOrder = z.infer<typeof insertPurchaseOrderSchema>;
export type PurchaseOrder = typeof purchaseOrdersTable.$inferSelect;
