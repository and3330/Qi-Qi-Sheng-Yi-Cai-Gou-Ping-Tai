import { sql } from "drizzle-orm";
import { pgTable, text, serial, integer, timestamp, jsonb, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { projectsTable } from "./projects";

export const orderTemplatesTable = pgTable("order_templates", {
  tenantId: integer("tenant_id").notNull().default(sql`(current_setting('app.tenant_id'::text))::integer`),
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  businessType: text("business_type").notNull(),
  projectId: integer("project_id").references(() => projectsTable.id, { onDelete: "set null" }),
  description: text("description"),
  fieldSchema: jsonb("field_schema").notNull().default([]),
  defaultValues: jsonb("default_values").notNull().default({}),
  isActive: boolean("is_active").notNull().default(true),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertOrderTemplateSchema = createInsertSchema(orderTemplatesTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertOrderTemplate = z.infer<typeof insertOrderTemplateSchema>;
export type OrderTemplate = typeof orderTemplatesTable.$inferSelect;
