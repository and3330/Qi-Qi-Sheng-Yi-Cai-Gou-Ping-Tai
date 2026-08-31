import { pgTable, varchar, json, timestamp, index } from "drizzle-orm/pg-core";

// express-session store table (connect-pg-simple layout).
// Managed here so drizzle push creates it in every environment.
export const sessionsTable = pgTable(
  "session",
  {
    sid: varchar("sid").primaryKey(),
    sess: json("sess").notNull(),
    expire: timestamp("expire", { precision: 6 }).notNull(),
  },
  (t) => [index("IDX_session_expire").on(t.expire)],
);
