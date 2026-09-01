import { boolean, index, integer, pgTable, serial, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

export const erpContractsTable = pgTable("erp_contracts", {
  id: serial("id").primaryKey(),
  contractNo: text("contract_no").notNull(),
  title: text("title").notNull(),
  partyType: text("party_type").notNull().default("other"),
  customerId: integer("customer_id"),
  supplierId: integer("supplier_id"),
  amount: integer("amount"),
  signedDate: text("signed_date"),
  startDate: text("start_date"),
  endDate: text("end_date"),
  status: text("status").notNull().default("draft"),
  renewalNotice: boolean("renewal_notice").notNull().default(false),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("uq_erp_contracts_no").on(t.contractNo),
  index("idx_erp_contracts_status").on(t.status),
  index("idx_erp_contracts_end_date").on(t.endDate),
]);