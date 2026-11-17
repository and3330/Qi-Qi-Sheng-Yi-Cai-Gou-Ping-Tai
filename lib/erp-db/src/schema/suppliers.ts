import { sql } from "drizzle-orm";
import { pgTable, boolean, text, serial, timestamp, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const suppliersTable = pgTable("suppliers", {
  tenantId: integer("tenant_id").notNull().default(sql`(current_setting('app.tenant_id'::text))::integer`),
  id: serial("id").primaryKey(),
  supplierCode: text("supplier_code"),
  name: text("name").notNull(),
  shortName: text("short_name"),
  email: text("email"),
  phone: text("phone"),
  mobile: text("mobile"),
  contactPerson: text("contact_person"),
  address: text("address"),
  city: text("city"),
  country: text("country"),
  taxId: text("tax_id"),
  // 預設付款條件：開發票時自動帶入
  paymentTermId: integer("payment_term_id"),
  category: text("category").default("一般供應商"),
  // 停用：不再往來的對象。資料與歷史單據都留著，只是開單選對象時不會出現
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertSupplierSchema = createInsertSchema(suppliersTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertSupplier = z.infer<typeof insertSupplierSchema>;
export type Supplier = typeof suppliersTable.$inferSelect;
