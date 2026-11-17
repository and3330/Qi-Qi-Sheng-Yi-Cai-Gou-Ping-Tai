import { sql } from "drizzle-orm";
import { pgTable, serial, integer, text, jsonb, timestamp, index, check, pgPolicy } from "drizzle-orm/pg-core";

export const aiActionsTable = pgTable("ai_actions", {
  id: serial("id").primaryKey(),
  // Explicit trusted application context on every INSERT; no Publish-parsed default.
  tenantId: integer("tenant_id").notNull(),
  tool: text("tool").notNull(),
  args: jsonb("args").notNull(),
  resultSummary: text("result_summary").notNull(),
  status: text("status", { enum: ["ok", "denied", "error"] }).notNull(),
  targetType: text("target_type"),
  targetId: integer("target_id"),
  ip: text("ip"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, t => [
  index("ai_actions_tenant_created_idx").on(t.tenantId, t.createdAt),
  check("ai_actions_status_check", sql`${t.status} IN ('ok','denied','error')`),
  pgPolicy("tenant_isolation", { for: "all", to: "public", using: sql`${t.tenantId} = (current_setting('app.tenant_id'::text))::integer`, withCheck: sql`${t.tenantId} = (current_setting('app.tenant_id'::text))::integer` }),
]).enableRLS();

export type AiAction = typeof aiActionsTable.$inferSelect;
export type InsertAiAction = typeof aiActionsTable.$inferInsert;

export const aiDraftDocumentsTable = pgTable("ai_draft_documents", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull(),
  docType: text("doc_type").notNull(),
  payload: jsonb("payload").notNull(),
  status: text("status", { enum: ["pending", "confirmed", "rejected"] }).notNull().default("pending"),
  summary: text("summary").notNull(),
  createdBy: text("created_by").notNull().default("ai"),
  confirmedBy: integer("confirmed_by"),
  confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
  resultDocumentId: integer("result_document_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, t => [
  index("ai_drafts_tenant_created_idx").on(t.tenantId, t.createdAt),
  check("ai_draft_documents_status_check", sql`${t.status} IN ('pending','confirmed','rejected')`),
  check("ai_draft_documents_doc_type_check", sql`${t.docType} IN ('receipt','payment','quotation','payment_request','sales_invoice')`),
  pgPolicy("tenant_isolation", { for: "all", to: "public", using: sql`${t.tenantId} = (current_setting('app.tenant_id'::text))::integer`, withCheck: sql`${t.tenantId} = (current_setting('app.tenant_id'::text))::integer` }),
]).enableRLS();

export type AiDraftDocument = typeof aiDraftDocumentsTable.$inferSelect;
export type InsertAiDraftDocument = typeof aiDraftDocumentsTable.$inferInsert;

/** AI-proposed customer master records; a human confirms them into `customers`. */
export const aiCustomerDraftsTable = pgTable("ai_customer_drafts", {
  id: serial("id").primaryKey(),
  // Explicit trusted application context on every INSERT; no database default.
  tenantId: integer("tenant_id").notNull(),
  payload: jsonb("payload").notNull(),
  status: text("status", { enum: ["pending", "confirmed", "rejected"] }).notNull().default("pending"),
  summary: text("summary").notNull(),
  createdBy: text("created_by").notNull().default("ai"),
  confirmedBy: integer("confirmed_by"),
  confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
  resultCustomerId: integer("result_customer_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, t => [
  index("ai_customer_drafts_tenant_created_idx").on(t.tenantId, t.createdAt),
  check("ai_customer_drafts_status_check", sql`${t.status} IN ('pending','confirmed','rejected')`),
  pgPolicy("tenant_isolation", { for: "all", to: "public", using: sql`${t.tenantId} = (current_setting('app.tenant_id'::text))::integer`, withCheck: sql`${t.tenantId} = (current_setting('app.tenant_id'::text))::integer` }),
]).enableRLS();

export type AiCustomerDraft = typeof aiCustomerDraftsTable.$inferSelect;
export type InsertAiCustomerDraft = typeof aiCustomerDraftsTable.$inferInsert;
