import { sql } from "drizzle-orm";
import {pgTable, text, serial, timestamp, integer, jsonb, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { itemsTable } from "./items";

export const qualityInspectionTemplatesTable = pgTable("quality_inspection_templates", {
  tenantId: integer("tenant_id").notNull().default(sql`(current_setting('app.tenant_id'::text))::integer`),
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  inspectionType: text("inspection_type").notNull().default("Incoming"),
  itemId: integer("item_id").references(() => itemsTable.id),
  criteria: jsonb("criteria").notNull().default([]),
  remarks: text("remarks"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const qualityInspectionsTable = pgTable("quality_inspections", {
  tenantId: integer("tenant_id").notNull().default(sql`(current_setting('app.tenant_id'::text))::integer`),
  id: serial("id").primaryKey(),
  inspectionNumber: text("inspection_number").notNull(),
  templateId: integer("template_id").references(() => qualityInspectionTemplatesTable.id),
  inspectionType: text("inspection_type").notNull().default("Incoming"),
  itemId: integer("item_id").references(() => itemsTable.id),
  referenceType: text("reference_type"),
  referenceId: integer("reference_id"),
  inspectedQuantity: integer("inspected_quantity").notNull().default(0),
  acceptedQuantity: integer("accepted_quantity").notNull().default(0),
  rejectedQuantity: integer("rejected_quantity").notNull().default(0),
  status: text("status").notNull().default("Draft"),
  result: text("result"),
  inspectorName: text("inspector_name"),
  inspectionDate: text("inspection_date").notNull(),
  results: jsonb("results").notNull().default([]),
  remarks: text("remarks"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (t) => [
  uniqueIndex("quality_inspections_inspection_number_unique").on(t.tenantId, t.inspectionNumber),
]);

export const insertQualityInspectionTemplateSchema = createInsertSchema(qualityInspectionTemplatesTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertQualityInspectionTemplate = z.infer<typeof insertQualityInspectionTemplateSchema>;
export type QualityInspectionTemplate = typeof qualityInspectionTemplatesTable.$inferSelect;

export const insertQualityInspectionSchema = createInsertSchema(qualityInspectionsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertQualityInspection = z.infer<typeof insertQualityInspectionSchema>;
export type QualityInspection = typeof qualityInspectionsTable.$inferSelect;
