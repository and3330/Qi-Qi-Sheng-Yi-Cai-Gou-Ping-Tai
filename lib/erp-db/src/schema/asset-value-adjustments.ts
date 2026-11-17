import { sql } from "drizzle-orm";
import { pgTable, text, serial, timestamp, integer, numeric } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { assetsTable } from "./assets";
import { journalEntriesTable } from "./journal-entries";

export const assetValueAdjustmentsTable = pgTable("asset_value_adjustments", {
  tenantId: integer("tenant_id").notNull().default(sql`(current_setting('app.tenant_id'::text))::integer`),
  id: serial("id").primaryKey(),
  assetId: integer("asset_id").notNull().references(() => assetsTable.id),
  adjustmentDate: text("adjustment_date").notNull(),
  previousValue: numeric("previous_value", { precision: 14, scale: 2 }).notNull(),
  newValue: numeric("new_value", { precision: 14, scale: 2 }).notNull(),
  adjustmentAmount: numeric("adjustment_amount", { precision: 14, scale: 2 }).notNull(),
  reason: text("reason").notNull(),
  journalEntryId: integer("journal_entry_id").references(() => journalEntriesTable.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertAssetValueAdjustmentSchema = createInsertSchema(assetValueAdjustmentsTable).omit({ id: true, createdAt: true });
export type InsertAssetValueAdjustment = z.infer<typeof insertAssetValueAdjustmentSchema>;
export type AssetValueAdjustment = typeof assetValueAdjustmentsTable.$inferSelect;
