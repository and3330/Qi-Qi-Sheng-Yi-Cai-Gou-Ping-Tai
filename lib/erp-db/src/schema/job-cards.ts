import { sql } from "drizzle-orm";
import {pgTable, text, serial, timestamp, integer, numeric, boolean, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { workOrdersTable } from "./work-orders";
import { workstationsTable } from "./workstations";

export const jobCardsTable = pgTable("job_cards", {
  tenantId: integer("tenant_id").notNull().default(sql`(current_setting('app.tenant_id'::text))::integer`),
  id: serial("id").primaryKey(),
  jobCardNumber: text("job_card_number").notNull(),
  workOrderId: integer("work_order_id").notNull().references(() => workOrdersTable.id),
  workstationId: integer("workstation_id").references(() => workstationsTable.id),
  operationName: text("operation_name").notNull(),
  sequenceNo: integer("sequence_no").notNull().default(1),
  status: text("status").notNull().default("Open"),
  plannedQuantity: numeric("planned_quantity", { precision: 12, scale: 2 }).notNull(),
  completedQuantity: numeric("completed_quantity", { precision: 12, scale: 2 }).notNull().default("0"),
  startTime: text("start_time"),
  endTime: text("end_time"),
  totalHours: numeric("total_hours", { precision: 8, scale: 2 }).notNull().default("0"),
  // 這張工單卡的工作站費用是否已計入成品成本
  costApplied: boolean("cost_applied").notNull().default(false),
  remarks: text("remarks"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (t) => [
  uniqueIndex("job_cards_job_card_number_unique").on(t.tenantId, t.jobCardNumber),
]);

export const insertJobCardSchema = createInsertSchema(jobCardsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertJobCard = z.infer<typeof insertJobCardSchema>;
export type JobCard = typeof jobCardsTable.$inferSelect;
