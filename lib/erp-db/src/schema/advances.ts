import { sql } from "drizzle-orm";
import { pgTable, text, serial, timestamp, integer, numeric, jsonb, uniqueIndex, index } from "drizzle-orm/pg-core";

export interface AdvanceRepayment { date: string; amount: number; cashAccountName: string; journalEntryNumber: string | null; by: string }

/**
 * 代墊款與借款：老闆或員工先幫公司出錢，公司之後要還。
 * - loan：借錢給公司周轉（錢進公司的帳戶）
 * - expense：代墊（幫公司付了某筆費用或貨款，錢沒有經過公司帳戶）
 * 帳上都是公司欠這個人的錢（負債），還款時才減少。
 */
export const advancesTable = pgTable("advances", {
  tenantId: integer("tenant_id").notNull().default(sql`(current_setting('app.tenant_id'::text))::integer`),
  id: serial("id").primaryKey(),
  advanceNumber: text("advance_number").notNull(),
  // owner 老闆／股東、employee 員工
  partyType: text("party_type").notNull(),
  employeeId: integer("employee_id"),
  partyName: text("party_name").notNull(),
  kind: text("kind").notNull(),
  amount: numeric("amount", { precision: 14, scale: 2 }).notNull(),
  taxAmount: numeric("tax_amount", { precision: 14, scale: 2 }).notNull().default("0"),
  repaidAmount: numeric("repaid_amount", { precision: 14, scale: 2 }).notNull().default("0"),
  entryDate: text("entry_date").notNull(),
  description: text("description"),
  projectId: integer("project_id"),
  departmentId: integer("department_id"),
  // loan：錢進到哪個現金或銀行科目；expense：代墊的錢花在哪個科目（費用、存貨、應付帳款…）
  counterAccountId: integer("counter_account_id").notNull(),
  // 欠這個人的錢記在哪個負債科目（建立時決定，還款時沖同一個）
  liabilityAccountId: integer("liability_account_id").notNull(),
  // Open 還沒還清、Settled 已還清、Voided 已作廢
  status: text("status").notNull().default("Open"),
  journalEntryId: integer("journal_entry_id"),
  repayments: jsonb("repayments").$type<AdvanceRepayment[]>().notNull().default([]),
  createdBy: text("created_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("advances_number_unique").on(t.tenantId, t.advanceNumber),
  index("advances_party_idx").on(t.tenantId, t.partyType, t.partyName),
]);

export type Advance = typeof advancesTable.$inferSelect;
