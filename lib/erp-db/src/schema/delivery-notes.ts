import { sql } from "drizzle-orm";
import {pgTable, text, serial, timestamp, integer, numeric, jsonb, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { salesOrdersTable } from "./sales-orders";
import { customersTable } from "./customers";
import { warehousesTable } from "./warehouses";
import { departmentsTable } from "./departments";
import { projectsTable } from "./projects";

export const deliveryNotesTable = pgTable("delivery_notes", {
  tenantId: integer("tenant_id").notNull().default(sql`(current_setting('app.tenant_id'::text))::integer`),
  id: serial("id").primaryKey(),
  noteNumber: text("note_number").notNull(),
  salesOrderId: integer("sales_order_id").references(() => salesOrdersTable.id),
  customerId: integer("customer_id").notNull().references(() => customersTable.id),
  warehouseId: integer("warehouse_id").references(() => warehousesTable.id),
  deliveryDate: text("delivery_date").notNull(),
  status: text("status").notNull().default("Draft"),
  totalAmount: numeric("total_amount", { precision: 14, scale: 2 }).notNull().default("0"),
  items: jsonb("items").notNull().default([]),
  remarks: text("remarks"),
  departmentId: integer("department_id").references(() => departmentsTable.id),
  projectId: integer("project_id").references(() => projectsTable.id),
  // 提交出貨時自動產生的銷貨成本分錄（銷貨成本/存貨），作廢時據此沖回
  cogsJournalEntryId: integer("cogs_journal_entry_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (t) => [
  uniqueIndex("delivery_notes_note_number_unique").on(t.tenantId, t.noteNumber),
]);

export const insertDeliveryNoteSchema = createInsertSchema(deliveryNotesTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertDeliveryNote = z.infer<typeof insertDeliveryNoteSchema>;
export type DeliveryNote = typeof deliveryNotesTable.$inferSelect;
