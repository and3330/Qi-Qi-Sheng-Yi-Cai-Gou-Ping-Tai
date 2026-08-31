import {
  pgTable,
  serial,
  text,
  integer,
  timestamp,
} from "drizzle-orm/pg-core";
import { membersTable } from "./members";

export const walletTransactionsTable = pgTable("wallet_transactions", {
  id: serial("id").primaryKey(),
  memberId: integer("member_id")
    .notNull()
    .references(() => membersTable.id),
  // deposit | payment | refund | profit_share | adjust
  type: text("type").notNull(),
  // signed amount: positive = 入帳, negative = 扣款 (NT$)
  amount: integer("amount").notNull(),
  balanceAfter: integer("balance_after").notNull(),
  reason: text("reason"),
  // e.g. 訂單編號
  refNo: text("ref_no"),
  // 管理員操作者 id（儲值／調整時）
  createdBy: integer("created_by"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type WalletTransaction = typeof walletTransactionsTable.$inferSelect;
