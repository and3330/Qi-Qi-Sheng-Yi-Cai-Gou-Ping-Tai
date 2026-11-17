import { sql } from "drizzle-orm";
import { pgTable, text, serial, timestamp, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const kbCategoriesTable = pgTable("kb_categories", {
  tenantId: integer("tenant_id").notNull().default(sql`(current_setting('app.tenant_id'::text))::integer`),
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertKbCategorySchema = createInsertSchema(kbCategoriesTable).omit({ id: true, createdAt: true });
export type InsertKbCategory = z.infer<typeof insertKbCategorySchema>;
export type KbCategory = typeof kbCategoriesTable.$inferSelect;

export const kbArticlesTable = pgTable("kb_articles", {
  tenantId: integer("tenant_id").notNull().default(sql`(current_setting('app.tenant_id'::text))::integer`),
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  content: text("content"),
  categoryId: integer("category_id"),
  status: text("status").notNull().default("Draft"),
  authorId: integer("author_id"),
  tags: text("tags"),
  viewCount: integer("view_count").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertKbArticleSchema = createInsertSchema(kbArticlesTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertKbArticle = z.infer<typeof insertKbArticleSchema>;
export type KbArticle = typeof kbArticlesTable.$inferSelect;
