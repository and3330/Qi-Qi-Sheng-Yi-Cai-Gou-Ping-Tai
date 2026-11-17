import { sql } from "drizzle-orm";
import {pgTable, text, serial, timestamp, integer, numeric, date, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const contractsTable = pgTable("contracts", {
  tenantId: integer("tenant_id").notNull().default(sql`(current_setting('app.tenant_id'::text))::integer`),
  id: serial("id").primaryKey(),
  contractNumber: text("contract_number").notNull(),
  title: text("title").notNull(),
  partyType: text("party_type").notNull().default("Customer"),
  customerId: integer("customer_id"),
  supplierId: integer("supplier_id"),
  status: text("status").notNull().default("Draft"),
  startDate: date("start_date"),
  endDate: date("end_date"),
  contractValue: numeric("contract_value", { precision: 14, scale: 2 }),
  terms: text("terms"),
  description: text("description"),
  renewalDate: date("renewal_date"),
  autoRenew: text("auto_renew").default("No"),
  contactPerson: text("contact_person"),
  // 人事合約（partyType = Employee／Teacher／Person）用的欄位
  employeeId: integer("employee_id"),
  teacherId: integer("teacher_id"),
  contractType: text("contract_type"),
  payBasis: text("pay_basis"),
  signedDate: date("signed_date"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (t) => [
  uniqueIndex("contracts_contract_number_unique").on(t.tenantId, t.contractNumber),
]);

export const insertContractSchema = createInsertSchema(contractsTable).omit({ id: true, contractNumber: true, createdAt: true, updatedAt: true });
export type InsertContract = z.infer<typeof insertContractSchema>;
export type Contract = typeof contractsTable.$inferSelect;
