import { sql } from "drizzle-orm";
import { pgTable, text, serial, timestamp, integer, numeric } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { assetsTable } from "./assets";
import { journalEntriesTable } from "./journal-entries";

export const assetDepreciationEntriesTable = pgTable("asset_depreciation_entries", {
  tenantId: integer("tenant_id").notNull().default(sql`(current_setting('app.tenant_id'::text))::integer`),
  id: serial("id").primaryKey(),
  assetId: integer("asset_id").notNull().references(() => assetsTable.id),
  depreciationDate: text("depreciation_date").notNull(),
  depreciationAmount: numeric("depreciation_amount", { precision: 14, scale: 2 }).notNull(),
  accumulatedAmount: numeric("accumulated_amount", { precision: 14, scale: 2 }).notNull(),
  bookValue: numeric("book_value", { precision: 14, scale: 2 }).notNull(),
  period: text("period").notNull(),
  journalEntryId: integer("journal_entry_id").references(() => journalEntriesTable.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertAssetDepreciationEntrySchema = createInsertSchema(assetDepreciationEntriesTable).omit({ id: true, createdAt: true });
export type InsertAssetDepreciationEntry = z.infer<typeof insertAssetDepreciationEntrySchema>;
export type AssetDepreciationEntry = typeof assetDepreciationEntriesTable.$inferSelect;
