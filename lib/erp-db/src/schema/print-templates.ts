import { sql } from "drizzle-orm";
import { pgTable, text, serial, timestamp, integer, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const printTemplatesTable = pgTable("print_templates", {
  tenantId: integer("tenant_id").notNull().default(sql`(current_setting('app.tenant_id'::text))::integer`),
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  module: text("module").notNull(),
  documentType: text("document_type").notNull(),
  format: text("format").notNull().default("A4"),
  orientation: text("orientation").notNull().default("portrait"),
  headerHtml: text("header_html"),
  bodyHtml: text("body_html"),
  footerHtml: text("footer_html"),
  cssStyles: text("css_styles"),
  /** 視覺化編輯器的版面設定（見前端 lib/print-layout.ts） */
  layout: jsonb("layout"),
  isDefault: text("is_default").notNull().default("No"),
  status: text("status").notNull().default("Active"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertPrintTemplateSchema = createInsertSchema(printTemplatesTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertPrintTemplate = z.infer<typeof insertPrintTemplateSchema>;
export type PrintTemplate = typeof printTemplatesTable.$inferSelect;
