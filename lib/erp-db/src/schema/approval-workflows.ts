import { sql } from "drizzle-orm";
import { pgTable, text, serial, timestamp, integer, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const approvalWorkflowsTable = pgTable("approval_workflows", {
  tenantId: integer("tenant_id").notNull().default(sql`(current_setting('app.tenant_id'::text))::integer`),
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  module: text("module").notNull(),
  documentType: text("document_type").notNull(),
  steps: jsonb("steps").notNull().default([]),
  isActive: text("is_active").notNull().default("Yes"),
  description: text("description"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertApprovalWorkflowSchema = createInsertSchema(approvalWorkflowsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertApprovalWorkflow = z.infer<typeof insertApprovalWorkflowSchema>;
export type ApprovalWorkflow = typeof approvalWorkflowsTable.$inferSelect;

export const approvalRequestsTable = pgTable("approval_requests", {
  tenantId: integer("tenant_id").notNull().default(sql`(current_setting('app.tenant_id'::text))::integer`),
  id: serial("id").primaryKey(),
  workflowId: integer("workflow_id"),
  documentType: text("document_type").notNull(),
  documentId: integer("document_id").notNull(),
  documentNumber: text("document_number"),
  requestedBy: text("requested_by").notNull(),
  currentStep: integer("current_step").notNull().default(1),
  totalSteps: integer("total_steps").notNull().default(1),
  status: text("status").notNull().default("Pending"),
  approvers: jsonb("approvers").notNull().default([]),
  comments: text("comments"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertApprovalRequestSchema = createInsertSchema(approvalRequestsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertApprovalRequest = z.infer<typeof insertApprovalRequestSchema>;
export type ApprovalRequest = typeof approvalRequestsTable.$inferSelect;
