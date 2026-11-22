import { sql } from "drizzle-orm";
import { pgTable, boolean, text, serial, timestamp, integer, numeric } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const customersTable = pgTable("customers", {
  tenantId: integer("tenant_id").notNull().default(sql`(current_setting('app.tenant_id'::text))::integer`),
  id: serial("id").primaryKey(),
  customerCode: text("customer_code"),
  name: text("name").notNull(),
  shortName: text("short_name"),
  email: text("email"),
  phone: text("phone"),
  mobile: text("mobile"),
  contactPerson: text("contact_person"),
  salesPerson: text("sales_person"),
  address: text("address"),
  city: text("city"),
  country: text("country"),
  taxId: text("tax_id"),
  // 預設付款條件：開發票時自動帶入
  paymentTermId: integer("payment_term_id"),
  // 信用額度：客戶最多可以欠多少。空白或 0 是不限
  creditLimit: numeric("credit_limit", { precision: 14, scale: 2 }),
  category: text("category").default("一般客戶"),
  // 備註：給內部看的說明
  remarks: text("remarks"),
  // 停用：不再往來的對象。資料與歷史單據都留著，只是開單選對象時不會出現
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertCustomerSchema = createInsertSchema(customersTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertCustomer = z.infer<typeof insertCustomerSchema>;
export type Customer = typeof customersTable.$inferSelect;
