import { sql } from "drizzle-orm";
import { pgTable, text, serial, timestamp, integer, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const auditLogsTable = pgTable("audit_logs", {
  tenantId: integer("tenant_id").notNull().default(sql`(current_setting('app.tenant_id'::text))::integer`),
  id: serial("id").primaryKey(),
  action: text("action").notNull(),
  module: text("module").notNull(),
  documentType: text("document_type"),
  documentId: integer("document_id"),
  documentNumber: text("document_number"),
  userId: text("user_id"),
  userName: text("user_name"),
  ipAddress: text("ip_address"),
  oldValues: jsonb("old_values"),
  newValues: jsonb("new_values"),
  description: text("description"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertAuditLogSchema = createInsertSchema(auditLogsTable).omit({ id: true, createdAt: true });
export type InsertAuditLog = z.infer<typeof insertAuditLogSchema>;
export type AuditLog = typeof auditLogsTable.$inferSelect;
