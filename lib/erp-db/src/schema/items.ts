import { sql } from "drizzle-orm";
import {pgTable, text, serial, timestamp, numeric, boolean, integer, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const itemsTable = pgTable("items", {
  tenantId: integer("tenant_id").notNull().default(sql`(current_setting('app.tenant_id'::text))::integer`),
  id: serial("id").primaryKey(),
  itemCode: text("item_code").notNull(),
  itemName: text("item_name").notNull(),
  itemGroup: text("item_group"),
  itemType: text("item_type"),
  description: text("description"),
  specification: text("specification"),
  unit: text("unit").notNull().default("Nos"),
  sellingPrice: numeric("selling_price", { precision: 12, scale: 2 }).notNull().default("0"),
  buyingPrice: numeric("buying_price", { precision: 12, scale: 2 }).notNull().default("0"),
  totalCost: numeric("total_cost", { precision: 12, scale: 2 }).default("0"),
  materialCost: numeric("material_cost", { precision: 12, scale: 2 }).default("0"),
  expenseCost: numeric("expense_cost", { precision: 12, scale: 2 }).default("0"),
  outsourcingCost: numeric("outsourcing_cost", { precision: 12, scale: 2 }).default("0"),
  laborCost: numeric("labor_cost", { precision: 12, scale: 2 }).default("0"),
  internalPrice: numeric("internal_price", { precision: 12, scale: 2 }).default("0"),
  wholesalePrice: numeric("wholesale_price", { precision: 12, scale: 2 }).default("0"),
  retailPrice: numeric("retail_price", { precision: 12, scale: 2 }).default("0"),
  svipPrice: numeric("svip_price", { precision: 12, scale: 2 }).default("0"),
  peerPrice: numeric("peer_price", { precision: 12, scale: 2 }).default("0"),
  dealerPrice: numeric("dealer_price", { precision: 12, scale: 2 }).default("0"),
  supplierName: text("supplier_name"),
  summary: text("summary"),
  // 移動平均成本: 進貨收貨提交時自動更新 (加權平均), 為毛利計算的成本基準
  movingAvgCost: numeric("moving_avg_cost", { precision: 14, scale: 4 }).notNull().default("0"),
  currentStock: numeric("current_stock", { precision: 12, scale: 2 }).notNull().default("0"),
  reorderLevel: numeric("reorder_level", { precision: 12, scale: 2 }).notNull().default("0"),
  // 虛擬服務：不需出貨、不追蹤庫存（如課程、顧問服務）
  isVirtual: boolean("is_virtual").notNull().default(false),
  status: text("status").notNull().default("Active"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (t) => [
  uniqueIndex("items_item_code_unique").on(t.tenantId, t.itemCode),
]);

export const insertItemSchema = createInsertSchema(itemsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertItem = z.infer<typeof insertItemSchema>;
export type Item = typeof itemsTable.$inferSelect;
