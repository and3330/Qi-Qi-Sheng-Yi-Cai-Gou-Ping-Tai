import { pgTable, serial, text, timestamp, integer, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const articlesTable = pgTable("articles", {
  id: serial("id").primaryKey(),
  // article | faq
  kind: text("kind").notNull().default("article"),
  title: text("title").notNull(),
  category: text("category").notNull(),
  summary: text("summary"),
  content: text("content"),
  imageUrl: text("image_url"),
  // draft（草稿）| review（送審中）| published（已上架）| archived（已下架）
  status: text("status").notNull().default("published"),
  publishedAt: timestamp("published_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const announcementsTable = pgTable("announcements", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  content: text("content"),
  // 平台公告 | 產品快報 | 活動訊息 | 合作醫院 | 知識文章
  category: text("category").notNull().default("平台公告"),
  imageUrl: text("image_url"),
  // draft | review | published | archived
  status: text("status").notNull().default("published"),
  publishedAt: timestamp("published_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

/** 內容版本紀錄：每次編輯／狀態變更留存快照 */
export const contentRevisionsTable = pgTable(
  "content_revisions",
  {
    id: serial("id").primaryKey(),
    // article | announcement
    entityKind: text("entity_kind").notNull(),
    entityId: integer("entity_id").notNull(),
    title: text("title").notNull(),
    category: text("category"),
    summary: text("summary"),
    content: text("content"),
    status: text("status").notNull(),
    // 編輯者（管理員 id）
    editedBy: integer("edited_by"),
    note: text("note"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [index("idx_content_revisions_entity").on(t.entityKind, t.entityId, t.createdAt)],
);

export type ContentRevision = typeof contentRevisionsTable.$inferSelect;

export const insertArticleSchema = createInsertSchema(articlesTable).omit({
  id: true,
});
export type InsertArticle = z.infer<typeof insertArticleSchema>;
export type Article = typeof articlesTable.$inferSelect;
export type Announcement = typeof announcementsTable.$inferSelect;
