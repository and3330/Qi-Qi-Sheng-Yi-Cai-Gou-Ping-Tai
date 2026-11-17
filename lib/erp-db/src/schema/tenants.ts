import { pgTable, text, serial, timestamp, boolean, integer, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/** SaaS 租戶（每家公司一筆）。月費 US$49/租戶，AI 點數獨立計算。 */
export const tenantsTable = pgTable("tenants", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  companyCode: text("company_code"),
  /** trialing | active | past_due | canceled */
  status: text("status").notNull().default("trialing"),
  /** 內部/創始租戶免收費（例如 1 號租戶育邦） */
  isExempt: boolean("is_exempt").notNull().default(false),
  trialEndsAt: timestamp("trial_ends_at", { withTimezone: true }),
  stripeCustomerId: text("stripe_customer_id"),
  stripeSubscriptionId: text("stripe_subscription_id"),
  aiCredits: integer("ai_credits").notNull().default(10),
  contactEmail: text("contact_email"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (t) => ({
  companyCodeUnique: uniqueIndex("tenants_company_code_unique").on(t.companyCode),
}));

/** AI 點數異動紀錄（購買/扣點），stripe_ref 唯一避免重複入點 */
export const creditTransactionsTable = pgTable("credit_transactions", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull(),
  delta: integer("delta").notNull(),
  balanceAfter: integer("balance_after").notNull(),
  reason: text("reason").notNull(),
  stripeRef: text("stripe_ref"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  stripeRefUnique: uniqueIndex("credit_tx_stripe_ref_unique").on(t.stripeRef).where(sql`${t.stripeRef} IS NOT NULL`),
}));

export const insertTenantSchema = createInsertSchema(tenantsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertTenant = z.infer<typeof insertTenantSchema>;
export type Tenant = typeof tenantsTable.$inferSelect;
export type CreditTransaction = typeof creditTransactionsTable.$inferSelect;
