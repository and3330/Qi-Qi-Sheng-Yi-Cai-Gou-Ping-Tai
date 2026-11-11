import { pgTable, serial, text, integer, timestamp, index } from "drizzle-orm/pg-core";
import { membersTable } from "./members";

/**
 * 忘記密碼的重設連結。只存權杖的雜湊；30 分鐘內有效、只能用一次。
 */
export const passwordResetTokensTable = pgTable(
  "password_reset_tokens",
  {
    id: serial("id").primaryKey(),
    memberId: integer("member_id")
      .notNull()
      .references(() => membersTable.id),
    tokenHash: text("token_hash").notNull().unique(),
    expiresAt: timestamp("expires_at").notNull(),
    usedAt: timestamp("used_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [index("idx_password_reset_member").on(t.memberId)],
);

/**
 * 商城設定（key/value）。目前用於匯款帳號資訊：
 * bank_name、bank_branch、bank_account、bank_holder、bank_note。
 */
export const shopSettingsTable = pgTable("shop_settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull().default(""),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
