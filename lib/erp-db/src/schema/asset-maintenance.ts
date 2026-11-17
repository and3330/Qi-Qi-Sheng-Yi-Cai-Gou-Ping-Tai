import { sql } from "drizzle-orm";
import { pgTable, text, serial, timestamp, integer, numeric } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { assetsTable } from "./assets";

export const assetMaintenanceTable = pgTable("asset_maintenance", {
  tenantId: integer("tenant_id").notNull().default(sql`(current_setting('app.tenant_id'::text))::integer`),
  id: serial("id").primaryKey(),
  assetId: integer("asset_id").notNull().references(() => assetsTable.id),
  maintenanceType: text("maintenance_type").notNull(),
  description: text("description"),
  scheduledDate: text("scheduled_date").notNull(),
  completedDate: text("completed_date"),
  cost: numeric("cost", { precision: 14, scale: 2 }).notNull().default("0"),
  vendor: text("vendor"),
  status: text("status").notNull().default("Scheduled"),
  remarks: text("remarks"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertAssetMaintenanceSchema = createInsertSchema(assetMaintenanceTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertAssetMaintenance = z.infer<typeof insertAssetMaintenanceSchema>;
export type AssetMaintenance = typeof assetMaintenanceTable.$inferSelect;
