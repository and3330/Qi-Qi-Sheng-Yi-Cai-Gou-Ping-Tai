import { sql } from "drizzle-orm";
import {pgTable, text, serial, timestamp, integer, numeric, boolean, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const accountsTable = pgTable("accounts", {
  tenantId: integer("tenant_id").notNull().default(sql`(current_setting('app.tenant_id'::text))::integer`),
  id: serial("id").primaryKey(),
  accountNumber: text("account_number").notNull(),
  accountName: text("account_name").notNull(),
  accountType: text("account_type").notNull(),
  parentAccountId: integer("parent_account_id"),
  balance: numeric("balance", { precision: 14, scale: 2 }).notNull().default("0"),
  isGroup: boolean("is_group").notNull().default(false),
  // 現金流量表分類覆蓋: operating | investing | financing | cash (現金及約當現金科目); null = 依科目編號自動判斷
  cashFlowCategory: text("cash_flow_category"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (t) => [
  uniqueIndex("accounts_account_number_unique").on(t.tenantId, t.accountNumber),
]);

export const insertAccountSchema = createInsertSchema(accountsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertAccount = z.infer<typeof insertAccountSchema>;
export type Account = typeof accountsTable.$inferSelect;
