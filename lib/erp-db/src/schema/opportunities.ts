import { sql } from "drizzle-orm";
import { pgTable, text, serial, timestamp, integer, numeric } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { customersTable } from "./customers";

export const opportunitiesTable = pgTable("opportunities", {
  tenantId: integer("tenant_id").notNull().default(sql`(current_setting('app.tenant_id'::text))::integer`),
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  customerId: integer("customer_id").references(() => customersTable.id),
  status: text("status").notNull().default("Open"),
  stage: text("stage").notNull().default("Prospecting"),
  expectedValue: numeric("expected_value", { precision: 14, scale: 2 }).notNull().default("0"),
  probability: numeric("probability", { precision: 5, scale: 2 }).notNull().default("0"),
  expectedCloseDate: text("expected_close_date"),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertOpportunitySchema = createInsertSchema(opportunitiesTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertOpportunity = z.infer<typeof insertOpportunitySchema>;
export type Opportunity = typeof opportunitiesTable.$inferSelect;
