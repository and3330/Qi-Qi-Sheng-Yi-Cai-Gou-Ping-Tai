import { boolean, index, integer, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { membersTable } from "./members";

export const erpNotificationsTable = pgTable("erp_notifications", {
  id: serial("id").primaryKey(),
  memberId: integer("member_id").notNull().references(() => membersTable.id, { onDelete: "cascade" }),
  type: text("type").notNull(),
  title: text("title").notNull(),
  body: text("body"),
  linkPath: text("link_path"),
  isRead: boolean("is_read").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [index("idx_erp_notifications_member_read").on(table.memberId, table.isRead)]);