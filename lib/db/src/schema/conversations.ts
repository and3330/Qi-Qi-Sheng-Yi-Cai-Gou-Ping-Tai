import { pgTable, serial, text, integer, boolean, timestamp, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { membersTable } from "./members";

/**
 * AI 對話串
 * kind: admin（後台 AI 行政助理）| support（會員端衛教客服）
 */
export const conversations = pgTable(
  "conversations",
  {
    id: serial("id").primaryKey(),
    kind: text("kind").notNull().default("admin"),
    memberId: integer("member_id")
      .notNull()
      .references(() => membersTable.id),
    title: text("title").notNull(),
    // 衛教客服：需要真人接手
    needsHuman: boolean("needs_human").notNull().default(false),
    // open | closed
    status: text("status").notNull().default("open"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("conversations_member_idx").on(t.memberId, t.kind)],
);

export const insertConversationSchema = createInsertSchema(conversations).omit({
  id: true,
  createdAt: true,
});

export type Conversation = typeof conversations.$inferSelect;
export type InsertConversation = z.infer<typeof insertConversationSchema>;
