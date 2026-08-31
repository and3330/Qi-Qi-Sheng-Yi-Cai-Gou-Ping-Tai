import { pgTable, serial, text, integer, timestamp, index } from "drizzle-orm/pg-core";
import { membersTable } from "./members";

/**
 * 會員點數異動紀錄
 * 規則：訂單完成後每滿 NT$100 累積 1 點；結帳可用點數折抵（1 點 = NT$1）
 */
export const pointTransactionsTable = pgTable(
  "point_transactions",
  {
    id: serial("id").primaryKey(),
    memberId: integer("member_id")
      .notNull()
      .references(() => membersTable.id),
    // earn（完成訂單累積）| redeem（結帳折抵）| refund（取消訂單退回折抵點數）| revoke（取消已入點的回收）| adjust（人工調整）
    type: text("type").notNull(),
    // 正數增加、負數減少
    delta: integer("delta").notNull(),
    balanceAfter: integer("balance_after").notNull(),
    orderId: integer("order_id"),
    note: text("note"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [index("idx_point_tx_member").on(t.memberId, t.createdAt)],
);

export type PointTransaction = typeof pointTransactionsTable.$inferSelect;
