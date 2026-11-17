import { sql } from "drizzle-orm";
import {pgTable, text, serial, timestamp, numeric, jsonb, integer, boolean, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const journalEntriesTable = pgTable("journal_entries", {
  tenantId: integer("tenant_id").notNull().default(sql`(current_setting('app.tenant_id'::text))::integer`),
  id: serial("id").primaryKey(),
  entryNumber: text("entry_number").notNull(),
  entryDate: text("entry_date").notNull(),
  description: text("description"),
  totalDebit: numeric("total_debit", { precision: 14, scale: 2 }).notNull().default("0"),
  totalCredit: numeric("total_credit", { precision: 14, scale: 2 }).notNull().default("0"),
  status: text("status").notNull().default("Draft"),
  lines: jsonb("lines").notNull().default([]),
  projectId: integer("project_id"),
  departmentId: integer("department_id"),
  // 內部轉撥 (BU 間交易): 標記後 BU 報表會呈現轉出/轉入
  isInternalTransfer: boolean("is_internal_transfer").notNull().default(false),
  transferFromDepartmentId: integer("transfer_from_department_id"),
  transferToDepartmentId: integer("transfer_to_department_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("journal_entries_entry_number_unique").on(t.tenantId, t.entryNumber),
]);

export const insertJournalEntrySchema = createInsertSchema(journalEntriesTable).omit({ id: true, createdAt: true });
export type InsertJournalEntry = z.infer<typeof insertJournalEntrySchema>;
export type JournalEntry = typeof journalEntriesTable.$inferSelect;
