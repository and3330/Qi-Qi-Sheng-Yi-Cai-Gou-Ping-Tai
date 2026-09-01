import { index, integer, pgTable, serial, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

export const erpAssetsTable = pgTable("erp_assets", {
  id: serial("id").primaryKey(), assetNo: text("asset_no").notNull(), name: text("name").notNull(),
  category: text("category").notNull().default("一般"), purchaseDate: text("purchase_date"),
  cost: integer("cost").notNull().default(0), salvageValue: integer("salvage_value").notNull().default(0),
  usefulLifeMonths: integer("useful_life_months").notNull().default(1),
  depreciationMethod: text("depreciation_method").notNull().default("straight_line"),
  status: text("status").notNull().default("active"), locationNote: text("location_note"),
  custodianId: integer("custodian_id"), notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, t => [uniqueIndex("uq_erp_assets_no").on(t.assetNo), index("idx_erp_assets_status").on(t.status)]);
export const erpAssetDepreciationsTable = pgTable("erp_asset_depreciations", {
  id: serial("id").primaryKey(), assetId: integer("asset_id").notNull().references(() => erpAssetsTable.id, { onDelete: "cascade" }),
  period: text("period").notNull(), amount: integer("amount").notNull().default(0), journalEntryId: integer("journal_entry_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, t => [uniqueIndex("uq_erp_asset_depreciations_asset_period").on(t.assetId, t.period)]);
export const erpAssetMaintenancesTable = pgTable("erp_asset_maintenances", {
  id: serial("id").primaryKey(), assetId: integer("asset_id").notNull().references(() => erpAssetsTable.id, { onDelete: "cascade" }),
  maintenanceDate: text("maintenance_date").notNull(), type: text("type").notNull().default("routine"),
  cost: integer("cost").notNull().default(0), vendor: text("vendor"), notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, t => [index("idx_erp_asset_maintenances_asset").on(t.assetId)]);