import {
  pgTable,
  serial,
  text,
  integer,
  timestamp,
  index,
} from "drizzle-orm/pg-core";
import { institutionsTable } from "./institutions";

/** 機構共用錢包交易明細（儲值/扣款/退款/調整） */
export const institutionWalletTransactionsTable = pgTable(
  "institution_wallet_transactions",
  {
    id: serial("id").primaryKey(),
    institutionId: integer("institution_id")
      .notNull()
      .references(() => institutionsTable.id),
    // 經手成員（下單人）或 null（管理員儲值/調整）
    memberId: integer("member_id"),
    // deposit | payment | refund | adjust
    type: text("type").notNull(),
    // signed amount: positive = 入帳, negative = 扣款 (NT$)
    amount: integer("amount").notNull(),
    balanceAfter: integer("balance_after").notNull(),
    reason: text("reason"),
    // e.g. 訂單編號
    refNo: text("ref_no"),
    // 管理員操作者 id（儲值/調整時）
    createdBy: integer("created_by"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [index("idx_inst_wallet_tx_institution").on(t.institutionId, t.createdAt)],
);

export type InstitutionWalletTransaction =
  typeof institutionWalletTransactionsTable.$inferSelect;
