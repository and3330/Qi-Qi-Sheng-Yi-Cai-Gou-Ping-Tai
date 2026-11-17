import { sql } from "drizzle-orm";
import { pgTable, serial, integer, text, numeric, jsonb, timestamp, uniqueIndex, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { invoicesTable } from "./invoices";

export const ecpayInvoiceAllowancesTable = pgTable("ecpay_invoice_allowances", {
  tenantId: integer("tenant_id").notNull().default(sql`(current_setting('app.tenant_id'::text))::integer`),
  id: serial("id").primaryKey(),
  invoiceId: integer("invoice_id").notNull().references(() => invoicesTable.id),
  idempotencyKey: text("idempotency_key").notNull(),
  allowanceNumber: text("allowance_number"),
  allowanceDate: text("allowance_date").notNull(),
  amount: numeric("amount", { precision: 14, scale: 2 }).notNull(),
  items: jsonb("items").notNull(),
  reason: text("reason").notNull(),
  notifyType: text("notify_type").notNull().default("N"),
  status: text("status").notNull().default("Pending"),
  voidReason: text("void_reason"),
  voidRequestedAt: timestamp("void_requested_at", { withTimezone: true }),
  voidedAt: timestamp("voided_at", { withTimezone: true }),
  ecpayResponse: jsonb("ecpay_response"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (t) => [
  uniqueIndex("ecpay_allowances_idempotency_unique").on(t.tenantId, t.invoiceId, t.idempotencyKey),
  uniqueIndex("ecpay_allowances_number_unique").on(t.tenantId, t.allowanceNumber),
  index("ecpay_allowances_invoice_idx").on(t.tenantId, t.invoiceId),
]);

export const insertEcpayInvoiceAllowanceSchema = createInsertSchema(ecpayInvoiceAllowancesTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertEcpayInvoiceAllowance = z.infer<typeof insertEcpayInvoiceAllowanceSchema>;
export type EcpayInvoiceAllowance = typeof ecpayInvoiceAllowancesTable.$inferSelect;