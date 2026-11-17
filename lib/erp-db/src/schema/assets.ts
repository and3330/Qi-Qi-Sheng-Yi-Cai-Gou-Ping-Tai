import { sql } from "drizzle-orm";
import {pgTable, text, serial, timestamp, integer, numeric, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { assetCategoriesTable } from "./asset-categories";
import { departmentsTable } from "./departments";
import { employeesTable } from "./employees";

export const assetsTable = pgTable("assets", {
  tenantId: integer("tenant_id").notNull().default(sql`(current_setting('app.tenant_id'::text))::integer`),
  id: serial("id").primaryKey(),
  assetNumber: text("asset_number").notNull(),
  name: text("name").notNull(),
  categoryId: integer("category_id").notNull().references(() => assetCategoriesTable.id),
  status: text("status").notNull().default("Draft"),
  purchaseDate: text("purchase_date").notNull(),
  purchaseCost: numeric("purchase_cost", { precision: 14, scale: 2 }).notNull(),
  depreciationMethod: text("depreciation_method").notNull().default("straight-line"),
  usefulLifeYears: integer("useful_life_years").notNull(),
  salvageValue: numeric("salvage_value", { precision: 14, scale: 2 }).notNull().default("0"),
  currentValue: numeric("current_value", { precision: 14, scale: 2 }).notNull(),
  accumulatedDepreciation: numeric("accumulated_depreciation", { precision: 14, scale: 2 }).notNull().default("0"),
  departmentId: integer("department_id").references(() => departmentsTable.id),
  assignedTo: integer("assigned_to").references(() => employeesTable.id),
  location: text("location"),
  serialNumber: text("serial_number"),
  warrantyExpiry: text("warranty_expiry"),
  disposalDate: text("disposal_date"),
  disposalAmount: numeric("disposal_amount", { precision: 14, scale: 2 }),
  remarks: text("remarks"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (t) => [
  uniqueIndex("assets_asset_number_unique").on(t.tenantId, t.assetNumber),
]);

export const insertAssetSchema = createInsertSchema(assetsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertAsset = z.infer<typeof insertAssetSchema>;
export type Asset = typeof assetsTable.$inferSelect;
