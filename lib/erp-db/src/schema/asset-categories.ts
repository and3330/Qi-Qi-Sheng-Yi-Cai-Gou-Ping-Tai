import { sql } from "drizzle-orm";
import {pgTable, text, serial, timestamp, integer, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const assetCategoriesTable = pgTable("asset_categories", {
  tenantId: integer("tenant_id").notNull().default(sql`(current_setting('app.tenant_id'::text))::integer`),
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  depreciationMethod: text("depreciation_method").notNull().default("straight-line"),
  defaultUsefulLifeYears: integer("default_useful_life_years").notNull().default(5),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (t) => [
  uniqueIndex("asset_categories_name_unique").on(t.tenantId, t.name),
]);

export const insertAssetCategorySchema = createInsertSchema(assetCategoriesTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertAssetCategory = z.infer<typeof insertAssetCategorySchema>;
export type AssetCategory = typeof assetCategoriesTable.$inferSelect;
