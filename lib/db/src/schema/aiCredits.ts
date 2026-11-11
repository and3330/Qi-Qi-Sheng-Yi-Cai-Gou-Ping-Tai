import { sql } from "drizzle-orm";
import {
  pgTable,
  serial,
  text,
  integer,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

/**
 * AI 點數餘額（整個系統一個帳戶，固定 id = 1）。
 * 只能透過 lib/aiCredits.ts 的函式增減：儲值由 Stripe 付款入帳，使用時原子扣點。
 */
export const aiCreditAccountTable = pgTable("ai_credit_account", {
  id: integer("id").primaryKey(),
  balance: integer("balance").notNull().default(0),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

/**
 * AI 點數異動紀錄。delta 正數為儲值、負數為使用。
 * stripeRef：Stripe Checkout Session id；部分唯一索引確保同一筆付款只入帳一次。
 */
export const aiCreditTransactionsTable = pgTable(
  "ai_credit_transactions",
  {
    id: serial("id").primaryKey(),
    delta: integer("delta").notNull(),
    balanceAfter: integer("balance_after").notNull(),
    reason: text("reason").notNull(),
    stripeRef: text("stripe_ref"),
    memberId: integer("member_id"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("uq_ai_credit_tx_stripe_ref")
      .on(t.stripeRef)
      .where(sql`${t.stripeRef} IS NOT NULL`),
  ],
);

export type AiCreditTransaction = typeof aiCreditTransactionsTable.$inferSelect;
