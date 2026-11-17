import { sql } from "drizzle-orm";
import { pgTable, text, serial, timestamp, integer, numeric, date } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const bankStatementsTable = pgTable("bank_statements", {
  tenantId: integer("tenant_id").notNull().default(sql`(current_setting('app.tenant_id'::text))::integer`),
  id: serial("id").primaryKey(),
  bankName: text("bank_name").notNull(),
  accountNumber: text("account_number"),
  statementDate: date("statement_date").notNull(),
  openingBalance: numeric("opening_balance", { precision: 14, scale: 2 }).notNull().default("0"),
  closingBalance: numeric("closing_balance", { precision: 14, scale: 2 }).notNull().default("0"),
  status: text("status").notNull().default("Pending"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertBankStatementSchema = createInsertSchema(bankStatementsTable).omit({ id: true, createdAt: true });
export type InsertBankStatement = z.infer<typeof insertBankStatementSchema>;
export type BankStatement = typeof bankStatementsTable.$inferSelect;

export const bankReconciliationEntriesTable = pgTable("bank_reconciliation_entries", {
  tenantId: integer("tenant_id").notNull().default(sql`(current_setting('app.tenant_id'::text))::integer`),
  id: serial("id").primaryKey(),
  statementId: integer("statement_id").notNull(),
  transactionDate: date("transaction_date").notNull(),
  description: text("description"),
  debit: numeric("debit", { precision: 14, scale: 2 }).default("0"),
  credit: numeric("credit", { precision: 14, scale: 2 }).default("0"),
  balance: numeric("balance", { precision: 14, scale: 2 }).default("0"),
  reference: text("reference"),
  matchedVoucherId: integer("matched_voucher_id"),
  matchStatus: text("match_status").notNull().default("Unmatched"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertBankReconciliationEntrySchema = createInsertSchema(bankReconciliationEntriesTable).omit({ id: true, createdAt: true });
export type InsertBankReconciliationEntry = z.infer<typeof insertBankReconciliationEntrySchema>;
export type BankReconciliationEntry = typeof bankReconciliationEntriesTable.$inferSelect;
