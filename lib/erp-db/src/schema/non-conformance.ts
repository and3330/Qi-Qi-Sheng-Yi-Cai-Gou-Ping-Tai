import { sql } from "drizzle-orm";
import {pgTable, text, serial, timestamp, integer, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { itemsTable } from "./items";

export const nonConformanceReportsTable = pgTable("non_conformance_reports", {
  tenantId: integer("tenant_id").notNull().default(sql`(current_setting('app.tenant_id'::text))::integer`),
  id: serial("id").primaryKey(),
  reportNumber: text("report_number").notNull(),
  title: text("title").notNull(),
  itemId: integer("item_id").references(() => itemsTable.id),
  referenceType: text("reference_type"),
  referenceId: integer("reference_id"),
  severity: text("severity").notNull().default("Minor"),
  status: text("status").notNull().default("Open"),
  description: text("description").notNull(),
  rootCause: text("root_cause"),
  correctiveAction: text("corrective_action"),
  reportedBy: text("reported_by"),
  reportDate: text("report_date").notNull(),
  closedDate: text("closed_date"),
  remarks: text("remarks"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (t) => [
  uniqueIndex("non_conformance_reports_report_number_unique").on(t.tenantId, t.reportNumber),
]);

export const insertNonConformanceReportSchema = createInsertSchema(nonConformanceReportsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertNonConformanceReport = z.infer<typeof insertNonConformanceReportSchema>;
export type NonConformanceReport = typeof nonConformanceReportsTable.$inferSelect;
