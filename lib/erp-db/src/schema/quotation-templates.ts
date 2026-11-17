import { sql } from "drizzle-orm";
import {pgTable, text, serial, timestamp, jsonb, integer, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const quotationTemplatesTable = pgTable("quotation_templates", {
  tenantId: integer("tenant_id").notNull().default(sql`(current_setting('app.tenant_id'::text))::integer`),
  id: serial("id").primaryKey(),
  category: text("category").notNull(),
  terms: text("terms"),
  notes: text("notes"),
  items: jsonb("items").notNull().default([]),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (t) => [
  uniqueIndex("quotation_templates_category_unique").on(t.tenantId, t.category),
]);

export const insertQuotationTemplateSchema = createInsertSchema(quotationTemplatesTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertQuotationTemplate = z.infer<typeof insertQuotationTemplateSchema>;
export type QuotationTemplate = typeof quotationTemplatesTable.$inferSelect;
