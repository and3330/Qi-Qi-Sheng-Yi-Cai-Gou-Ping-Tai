import { sql } from "drizzle-orm";
import {pgTable, text, serial, timestamp, integer, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const itemTypesTable = pgTable("item_types", {
  tenantId: integer("tenant_id").notNull().default(sql`(current_setting('app.tenant_id'::text))::integer`),
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  label: text("label"),
  colorClass: text("color_class"),
  description: text("description"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (t) => [
  uniqueIndex("item_types_name_unique").on(t.tenantId, t.name),
]);

export const insertItemTypeSchema = createInsertSchema(itemTypesTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertItemType = z.infer<typeof insertItemTypeSchema>;
export type ItemType = typeof itemTypesTable.$inferSelect;
