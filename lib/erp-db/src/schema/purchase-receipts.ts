import { sql } from "drizzle-orm";
import {pgTable, text, serial, timestamp, integer, numeric, jsonb, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { purchaseOrdersTable } from "./purchase-orders";
import { suppliersTable } from "./suppliers";
import { warehousesTable } from "./warehouses";
import { departmentsTable } from "./departments";
import { projectsTable } from "./projects";

export const purchaseReceiptsTable = pgTable("purchase_receipts", {
  tenantId: integer("tenant_id").notNull().default(sql`(current_setting('app.tenant_id'::text))::integer`),
  id: serial("id").primaryKey(),
  receiptNumber: text("receipt_number").notNull(),
  purchaseOrderId: integer("purchase_order_id").references(() => purchaseOrdersTable.id),
  supplierId: integer("supplier_id").notNull().references(() => suppliersTable.id),
  warehouseId: integer("warehouse_id").references(() => warehousesTable.id),
  receiptDate: text("receipt_date").notNull(),
  status: text("status").notNull().default("Draft"),
  totalAmount: numeric("total_amount", { precision: 14, scale: 2 }).notNull().default("0"),
  items: jsonb("items").notNull().default([]),
  remarks: text("remarks"),
  // 目前只用來標記舊系統搬來的歷史進貨單（legacy = true），以及搬進來時還沒付的金額
  extraFields: jsonb("extra_fields").default({}),
  departmentId: integer("department_id").references(() => departmentsTable.id),
  projectId: integer("project_id").references(() => projectsTable.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (t) => [
  uniqueIndex("purchase_receipts_receipt_number_unique").on(t.tenantId, t.receiptNumber),
]);

export const insertPurchaseReceiptSchema = createInsertSchema(purchaseReceiptsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertPurchaseReceipt = z.infer<typeof insertPurchaseReceiptSchema>;
export type PurchaseReceipt = typeof purchaseReceiptsTable.$inferSelect;
