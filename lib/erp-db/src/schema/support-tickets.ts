import { sql } from "drizzle-orm";
import {pgTable, text, serial, timestamp, integer, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const ticketCategoriesTable = pgTable("ticket_categories", {
  tenantId: integer("tenant_id").notNull().default(sql`(current_setting('app.tenant_id'::text))::integer`),
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  parentId: integer("parent_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertTicketCategorySchema = createInsertSchema(ticketCategoriesTable).omit({ id: true, createdAt: true });
export type InsertTicketCategory = z.infer<typeof insertTicketCategorySchema>;
export type TicketCategory = typeof ticketCategoriesTable.$inferSelect;

export const slaDefinitionsTable = pgTable("sla_definitions", {
  tenantId: integer("tenant_id").notNull().default(sql`(current_setting('app.tenant_id'::text))::integer`),
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  priority: text("priority").notNull().default("Medium"),
  responseTimeHours: integer("response_time_hours").notNull().default(4),
  resolutionTimeHours: integer("resolution_time_hours").notNull().default(24),
  description: text("description"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertSlaDefinitionSchema = createInsertSchema(slaDefinitionsTable).omit({ id: true, createdAt: true });
export type InsertSlaDefinition = z.infer<typeof insertSlaDefinitionSchema>;
export type SlaDefinition = typeof slaDefinitionsTable.$inferSelect;

export const supportTicketsTable = pgTable("support_tickets", {
  tenantId: integer("tenant_id").notNull().default(sql`(current_setting('app.tenant_id'::text))::integer`),
  id: serial("id").primaryKey(),
  ticketNumber: text("ticket_number").notNull(),
  subject: text("subject").notNull(),
  description: text("description"),
  status: text("status").notNull().default("Open"),
  priority: text("priority").notNull().default("Medium"),
  categoryId: integer("category_id"),
  customerId: integer("customer_id"),
  assignedTo: integer("assigned_to"),
  slaId: integer("sla_id"),
  responseDeadline: timestamp("response_deadline", { withTimezone: true }),
  resolutionDeadline: timestamp("resolution_deadline", { withTimezone: true }),
  firstResponseAt: timestamp("first_response_at", { withTimezone: true }),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  closedAt: timestamp("closed_at", { withTimezone: true }),
  resolution: text("resolution"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (t) => [
  uniqueIndex("support_tickets_ticket_number_unique").on(t.tenantId, t.ticketNumber),
]);

export const insertSupportTicketSchema = createInsertSchema(supportTicketsTable).omit({ id: true, ticketNumber: true, createdAt: true, updatedAt: true });
export type InsertSupportTicket = z.infer<typeof insertSupportTicketSchema>;
export type SupportTicket = typeof supportTicketsTable.$inferSelect;
