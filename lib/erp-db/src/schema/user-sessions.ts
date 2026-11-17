import { pgTable, varchar, json, timestamp, index } from "drizzle-orm/pg-core";

// connect-pg-simple 的標準 schema。納入 drizzle schema 是為了避免 drizzle-kit push 把它刪掉。
export const userSessionsTable = pgTable(
  "user_sessions",
  {
    sid: varchar("sid").primaryKey().notNull(),
    sess: json("sess").notNull(),
    expire: timestamp("expire", { precision: 6, mode: "date" }).notNull(),
  },
  (t) => ({
    expireIdx: index("IDX_user_sessions_expire").on(t.expire),
  }),
);
