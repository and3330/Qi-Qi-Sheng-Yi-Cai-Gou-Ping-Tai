import { boolean, index, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";

/** 管理員維護、提供會員客服 AI 使用的公開知識。 */
export const aiKnowledgeTable = pgTable(
  "ai_knowledge",
  {
    id: serial("id").primaryKey(),
    title: text("title").notNull(),
    category: text("category").notNull(),
    content: text("content").notNull(),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [index("ai_knowledge_active_idx").on(t.isActive)],
);

export type AiKnowledge = typeof aiKnowledgeTable.$inferSelect;