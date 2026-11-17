import { sql } from "drizzle-orm";
import { pgTable, text, serial, timestamp, integer, numeric } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { itemsTable } from "./items";
import { warehousesTable } from "./warehouses";

export const stockEntriesTable = pgTable("stock_entries", {
  tenantId: integer("tenant_id").notNull().default(sql`(current_setting('app.tenant_id'::text))::integer`),
  id: serial("id").primaryKey(),
  entryType: text("entry_type").notNull(),
  itemId: integer("item_id").notNull().references(() => itemsTable.id),
  warehouseId: integer("warehouse_id").notNull().references(() => warehousesTable.id),
  quantity: numeric("quantity", { precision: 12, scale: 2 }).notNull(),
  rate: numeric("rate", { precision: 12, scale: 2 }).notNull(),
  amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
  remarks: text("remarks"),
  // 這筆異動是怎麼來的：manual 手動、transfer 調撥、count 盤點、receipt 進貨、delivery 出貨、return 退貨、work-order 工單
  source: text("source"),
  // 手動調整庫存產生的盤盈、盤損歸屬的專案
  projectId: integer("project_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertStockEntrySchema = createInsertSchema(stockEntriesTable).omit({ id: true, createdAt: true });
export type InsertStockEntry = z.infer<typeof insertStockEntrySchema>;
export type StockEntry = typeof stockEntriesTable.$inferSelect;
