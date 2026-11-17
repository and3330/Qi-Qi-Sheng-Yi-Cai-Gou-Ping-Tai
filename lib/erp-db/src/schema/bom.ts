import { sql } from "drizzle-orm";
import {pgTable, text, serial, timestamp, integer, numeric, jsonb, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { itemsTable } from "./items";

export const bomsTable = pgTable("boms", {
  tenantId: integer("tenant_id").notNull().default(sql`(current_setting('app.tenant_id'::text))::integer`),
  id: serial("id").primaryKey(),
  bomNumber: text("bom_number").notNull(),
  itemId: integer("item_id").notNull().references(() => itemsTable.id),
  version: integer("version").notNull().default(1),
  quantity: numeric("quantity", { precision: 12, scale: 2 }).notNull().default("1"),
  unit: text("unit").notNull().default("Nos"),
  status: text("status").notNull().default("Draft"),
  remarks: text("remarks"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (t) => [
  uniqueIndex("boms_bom_number_unique").on(t.tenantId, t.bomNumber),
]);

export const bomItemsTable = pgTable("bom_items", {
  tenantId: integer("tenant_id").notNull().default(sql`(current_setting('app.tenant_id'::text))::integer`),
  id: serial("id").primaryKey(),
  bomId: integer("bom_id").notNull().references(() => bomsTable.id),
  itemId: integer("item_id").notNull().references(() => itemsTable.id),
  quantity: numeric("quantity", { precision: 12, scale: 4 }).notNull(),
  unit: text("unit").notNull().default("Nos"),
  rate: numeric("rate", { precision: 12, scale: 2 }).notNull().default("0"),
  amount: numeric("amount", { precision: 14, scale: 2 }).notNull().default("0"),
  parentBomItemId: integer("parent_bom_item_id"),
  level: integer("level").notNull().default(0),
  remarks: text("remarks"),
});

export const insertBomSchema = createInsertSchema(bomsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertBom = z.infer<typeof insertBomSchema>;
export type Bom = typeof bomsTable.$inferSelect;

export const insertBomItemSchema = createInsertSchema(bomItemsTable).omit({ id: true });
export type InsertBomItem = z.infer<typeof insertBomItemSchema>;
export type BomItem = typeof bomItemsTable.$inferSelect;
