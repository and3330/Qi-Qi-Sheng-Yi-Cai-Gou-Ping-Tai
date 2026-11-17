import { sql } from "drizzle-orm";
import { index, integer, jsonb, pgTable, serial, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { invoicesTable } from "./invoices";
import { salesOrdersTable } from "./sales-orders";

export const ecpayInvoiceIssueRequestsTable = pgTable("ecpay_invoice_issue_requests", {
  tenantId: integer("tenant_id").notNull().default(sql`(current_setting('app.tenant_id'::text))::integer`),
  id: serial("id").primaryKey(),
  salesOrderId: integer("sales_order_id").notNull().references(() => salesOrdersTable.id),
  invoiceId: integer("invoice_id").references(() => invoicesTable.id),
  idempotencyKey: text("idempotency_key").notNull(),
  relateNumber: text("relate_number").notNull(),
  payloadHash: text("payload_hash").notNull(),
  requestPayload: jsonb("request_payload").notNull(),
  status: text("status").notNull().default("Pending"),
  ecpayInvoiceNumber: text("ecpay_invoice_number"),
  ecpayInvoiceDate: text("ecpay_invoice_date"),
  ecpayRandomNumber: text("ecpay_random_number"),
  ecpayResponse: jsonb("ecpay_response"),
  errorMessage: text("error_message"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => [
  uniqueIndex("ecpay_invoice_issue_requests_tenant_key_unique").on(table.tenantId, table.idempotencyKey),
  uniqueIndex("ecpay_invoice_issue_requests_relate_number_unique").on(table.relateNumber),
  index("ecpay_invoice_issue_requests_order_idx").on(table.tenantId, table.salesOrderId),
]);

export type EcpayInvoiceIssueRequest = typeof ecpayInvoiceIssueRequestsTable.$inferSelect;