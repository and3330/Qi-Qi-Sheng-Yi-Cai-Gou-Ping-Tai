import { sql } from "drizzle-orm";
import { pgTable, serial, text, date, integer, numeric, timestamp } from "drizzle-orm/pg-core";

export const receivablePayableEntriesTable = pgTable("receivable_payable_entries", {
  tenantId: integer("tenant_id").notNull().default(sql`(current_setting('app.tenant_id'::text))::integer`),
  id: serial("id").primaryKey(),
  entryType: text("entry_type").notNull(),
  entryDate: date("entry_date").notNull(),
  entryNumber: text("entry_number"),
  transactionType: text("transaction_type"),
  debtNumber: text("debt_number"),
  passbookCode: text("passbook_code"),
  partyName: text("party_name"),
  customerId: integer("customer_id"),
  supplierId: integer("supplier_id"),
  accountName: text("account_name"),
  accountId: integer("account_id"),
  departmentId: integer("department_id"),
  projectId: integer("project_id"),
  description: text("description"),
  increaseAmount: numeric("increase_amount").default("0"),
  decreaseAmount: numeric("decrease_amount").default("0"),
  balance: numeric("balance").default("0"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});
