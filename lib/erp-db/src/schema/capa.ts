import { sql } from "drizzle-orm";
import {pgTable, text, serial, timestamp, integer, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { nonConformanceReportsTable } from "./non-conformance";

export const capaActionsTable = pgTable("capa_actions", {
  tenantId: integer("tenant_id").notNull().default(sql`(current_setting('app.tenant_id'::text))::integer`),
  id: serial("id").primaryKey(),
  capaNumber: text("capa_number").notNull(),
  title: text("title").notNull(),
  type: text("type").notNull().default("Corrective"),
  nonConformanceId: integer("non_conformance_id").references(() => nonConformanceReportsTable.id),
  status: text("status").notNull().default("Open"),
  priority: text("priority").notNull().default("Medium"),
  description: text("description").notNull(),
  assignedTo: text("assigned_to"),
  dueDate: text("due_date"),
  completedDate: text("completed_date"),
  verificationResult: text("verification_result"),
  remarks: text("remarks"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (t) => [
  uniqueIndex("capa_actions_capa_number_unique").on(t.tenantId, t.capaNumber),
]);

export const insertCapaActionSchema = createInsertSchema(capaActionsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertCapaAction = z.infer<typeof insertCapaActionSchema>;
export type CapaAction = typeof capaActionsTable.$inferSelect;
