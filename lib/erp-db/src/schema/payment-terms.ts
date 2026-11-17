import { sql } from "drizzle-orm";
import { pgTable, text, serial, timestamp, integer, boolean, jsonb, uniqueIndex } from "drizzle-orm/pg-core";

export interface PaymentInstallment {
  /** 這一期的名稱，例如「訂金」「尾款」 */
  label: string;
  /** 佔總額的百分比，全部加起來要等於 100 */
  percent: number;
  /** 發票日之後幾天到期 */
  days: number;
}

export interface PaymentScheduleRow {
  label: string;
  percent: number;
  dueDate: string;
  amount: number;
}

/**
 * 付款條件：一張發票分幾期、各佔幾成、各在發票日後幾天到期。
 * 例如「訂金 30% 當天、尾款 70% 月結 30 天」。客戶與供應商可以各自設定預設條件。
 */
export const paymentTermsTable = pgTable("payment_terms", {
  tenantId: integer("tenant_id").notNull().default(sql`(current_setting('app.tenant_id'::text))::integer`),
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  installments: jsonb("installments").$type<PaymentInstallment[]>().notNull().default([]),
  isActive: boolean("is_active").notNull().default(true),
  note: text("note"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("payment_terms_name_unique").on(t.tenantId, t.name),
]);

export type PaymentTerm = typeof paymentTermsTable.$inferSelect;
