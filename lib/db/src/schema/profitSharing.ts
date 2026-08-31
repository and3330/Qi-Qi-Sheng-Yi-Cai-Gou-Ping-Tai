import {
  pgTable,
  serial,
  text,
  integer,
  boolean,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { membersTable } from "./members";
import { ordersTable } from "./orders";

export const profitRulesTable = pgTable(
  "profit_rules",
  {
    id: serial("id").primaryKey(),
    name: text("name").notNull(),
    // hospital | clinic | consumer | all
    tier: text("tier").notNull().default("all"),
    // 分潤比例，basis points（100 = 1%）
    percentBps: integer("percent_bps").notNull(),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    // 同一身份同時間只允許一條啟用中的規則（資料庫層強制，避免併發繞過）
    uniqueIndex("profit_rules_one_active_per_tier")
      .on(t.tier)
      .where(sql`${t.isActive} = true`),
  ],
);

export const profitShareRecordsTable = pgTable("profit_share_records", {
  id: serial("id").primaryKey(),
  orderId: integer("order_id")
    .notNull()
    .references(() => ordersTable.id),
  orderNo: text("order_no").notNull(),
  memberId: integer("member_id")
    .notNull()
    .references(() => membersTable.id),
  ruleId: integer("rule_id"),
  ruleName: text("rule_name").notNull(),
  percentBps: integer("percent_bps").notNull(),
  // 佣金歸屬機構（下單人當時綁定的院所；未綁定則為 null，佣金入會員個人錢包）
  institutionId: integer("institution_id"),
  // 下單人當時綁定的科室快照
  department: text("department"),
  // 分潤基準金額（訂單金額）
  baseAmount: integer("base_amount").notNull(),
  // 實際分潤金額
  amount: integer("amount").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type ProfitRule = typeof profitRulesTable.$inferSelect;
export type ProfitShareRecord = typeof profitShareRecordsTable.$inferSelect;
