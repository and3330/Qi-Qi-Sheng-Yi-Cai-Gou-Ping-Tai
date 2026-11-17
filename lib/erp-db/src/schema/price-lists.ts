import { sql } from "drizzle-orm";
import {pgTable, text, serial, timestamp, integer, numeric, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { itemsTable } from "./items";

export const priceListsTable = pgTable("price_lists", {
  tenantId: integer("tenant_id").notNull().default(sql`(current_setting('app.tenant_id'::text))::integer`),
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  currency: text("currency").notNull().default("TWD"),
  customerGroup: text("customer_group"),
  isActive: text("is_active").notNull().default("Y"),
  remarks: text("remarks"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (t) => [
  uniqueIndex("price_lists_name_unique").on(t.tenantId, t.name),
]);

export const priceListItemsTable = pgTable("price_list_items", {
  tenantId: integer("tenant_id").notNull().default(sql`(current_setting('app.tenant_id'::text))::integer`),
  id: serial("id").primaryKey(),
  priceListId: integer("price_list_id").notNull().references(() => priceListsTable.id),
  itemId: integer("item_id").notNull().references(() => itemsTable.id),
  price: numeric("price", { precision: 14, scale: 2 }).notNull().default("0"),
  minQuantity: numeric("min_quantity", { precision: 12, scale: 2 }).notNull().default("1"),
  validFrom: text("valid_from"),
  validTo: text("valid_to"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertPriceListSchema = createInsertSchema(priceListsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertPriceList = z.infer<typeof insertPriceListSchema>;
export type PriceList = typeof priceListsTable.$inferSelect;

export const insertPriceListItemSchema = createInsertSchema(priceListItemsTable).omit({ id: true, createdAt: true });
export type InsertPriceListItem = z.infer<typeof insertPriceListItemSchema>;
export type PriceListItem = typeof priceListItemsTable.$inferSelect;
