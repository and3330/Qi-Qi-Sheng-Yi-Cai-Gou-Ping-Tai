import { sql } from "drizzle-orm";
import {pgTable, text, serial, timestamp, integer, numeric, jsonb, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { purchaseReceiptsTable } from "./purchase-receipts";
import { suppliersTable } from "./suppliers";
import { warehousesTable } from "./warehouses";
import { departmentsTable } from "./departments";
import { projectsTable } from "./projects";

export const purchaseReturnsTable = pgTable("purchase_returns", {
  tenantId: integer("tenant_id").notNull().default(sql`(current_setting('app.tenant_id'::text))::integer`),
  id: serial("id").primaryKey(),
  returnNumber: text("return_number").notNull(),
  purchaseReceiptId: integer("purchase_receipt_id").references(() => purchaseReceiptsTable.id),
  supplierId: integer("supplier_id").notNull().references(() => suppliersTable.id),
  warehouseId: integer("warehouse_id").references(() => warehousesTable.id),
  returnDate: text("return_date").notNull(),
  reason: text("reason"),
  status: text("status").notNull().default("Draft"),
  totalAmount: numeric("total_amount", { precision: 14, scale: 2 }).notNull().default("0"),
  items: jsonb("items").notNull().default([]),
  remarks: text("remarks"),
  departmentId: integer("department_id").references(() => departmentsTable.id),
  projectId: integer("project_id").references(() => projectsTable.id),
  /** 確認退貨時自動建立的扣項單（invoices.id），取消退貨時據此同步作廢 */
  debitNoteInvoiceId: integer("debit_note_invoice_id"),
  /** 確認退貨時自動建立的反轉進貨單（purchase_receipts.id） */
  reverseReceiptId: integer("reverse_receipt_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (t) => [
  uniqueIndex("purchase_returns_return_number_unique").on(t.tenantId, t.returnNumber),
]);

export const insertPurchaseReturnSchema = createInsertSchema(purchaseReturnsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertPurchaseReturn = z.infer<typeof insertPurchaseReturnSchema>;
export type PurchaseReturn = typeof purchaseReturnsTable.$inferSelect;
