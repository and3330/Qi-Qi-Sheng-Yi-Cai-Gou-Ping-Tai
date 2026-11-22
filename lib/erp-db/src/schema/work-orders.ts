import { sql } from "drizzle-orm";
import {pgTable, text, serial, timestamp, integer, numeric, jsonb, boolean, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { itemsTable } from "./items";
import { bomsTable } from "./bom";
import { salesOrdersTable } from "./sales-orders";
import { customersTable } from "./customers";
import { employeesTable } from "./employees";

export const workOrdersTable = pgTable("work_orders", {
  tenantId: integer("tenant_id").notNull().default(sql`(current_setting('app.tenant_id'::text))::integer`),
  id: serial("id").primaryKey(),
  workOrderNumber: text("work_order_number").notNull(),
  bomId: integer("bom_id").notNull().references(() => bomsTable.id),
  itemId: integer("item_id").notNull().references(() => itemsTable.id),
  salesOrderId: integer("sales_order_id").references(() => salesOrdersTable.id),
  // 這張工單是幫哪個客戶做的、誰承辦（都選填；從銷貨單帶入時客戶會跟著帶）
  customerId: integer("customer_id").references(() => customersTable.id),
  handlerId: integer("handler_id").references(() => employeesTable.id),
  plannedQuantity: numeric("planned_quantity", { precision: 12, scale: 2 }).notNull(),
  completedQuantity: numeric("completed_quantity", { precision: 12, scale: 2 }).notNull().default("0"),
  // 已計入成品成本的人工與製造費用累計（工時表 + 工作站時數）
  conversionCost: numeric("conversion_cost", { precision: 14, scale: 2 }).notNull().default("0"),
  status: text("status").notNull().default("Draft"),
  priority: text("priority").notNull().default("Medium"),
  plannedStartDate: text("planned_start_date"),
  plannedEndDate: text("planned_end_date"),
  actualStartDate: text("actual_start_date"),
  actualEndDate: text("actual_end_date"),
  remarks: text("remarks"),
  /** 建單當下成品的虛擬服務快照；舊單據為 null 時回查品項主檔 */
  itemIsVirtual: boolean("item_is_virtual"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (t) => [
  uniqueIndex("work_orders_work_order_number_unique").on(t.tenantId, t.workOrderNumber),
]);

export const workOrderItemsTable = pgTable("work_order_items", {
  tenantId: integer("tenant_id").notNull().default(sql`(current_setting('app.tenant_id'::text))::integer`),
  id: serial("id").primaryKey(),
  workOrderId: integer("work_order_id").notNull().references(() => workOrdersTable.id),
  itemId: integer("item_id").notNull().references(() => itemsTable.id),
  requiredQuantity: numeric("required_quantity", { precision: 12, scale: 4 }).notNull(),
  issuedQuantity: numeric("issued_quantity", { precision: 12, scale: 4 }).notNull().default("0"),
  unit: text("unit").notNull().default("Nos"),
  /** 建單當下材料的虛擬服務快照；舊單據為 null 時回查品項主檔 */
  isVirtual: boolean("is_virtual"),
});

export const insertWorkOrderSchema = createInsertSchema(workOrdersTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertWorkOrder = z.infer<typeof insertWorkOrderSchema>;
export type WorkOrder = typeof workOrdersTable.$inferSelect;

export const insertWorkOrderItemSchema = createInsertSchema(workOrderItemsTable).omit({ id: true });
export type InsertWorkOrderItem = z.infer<typeof insertWorkOrderItemSchema>;
export type WorkOrderItem = typeof workOrderItemsTable.$inferSelect;
