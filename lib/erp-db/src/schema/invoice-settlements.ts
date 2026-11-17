import { sql } from "drizzle-orm";
import { pgTable, serial, integer, numeric, text, timestamp } from "drizzle-orm/pg-core";
import { invoicesTable } from "./invoices";
import { vouchersTable } from "./vouchers";
import { paymentRequestsTable } from "./payment-requests";

export const invoiceSettlementsTable = pgTable("invoice_settlements", {
  tenantId: integer("tenant_id").notNull().default(sql`(current_setting('app.tenant_id'::text))::integer`),
  id: serial("id").primaryKey(),
  voucherId: integer("voucher_id").references(() => vouchersTable.id, { onDelete: "cascade" }),
  paymentRequestId: integer("payment_request_id").references(() => paymentRequestsTable.id, { onDelete: "set null" }),
  invoiceId: integer("invoice_id").notNull().references(() => invoicesTable.id, { onDelete: "cascade" }),
  amount: numeric("amount", { precision: 14, scale: 2 }).notNull().default("0"),
  remarks: text("remarks"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type InvoiceSettlement = typeof invoiceSettlementsTable.$inferSelect;
