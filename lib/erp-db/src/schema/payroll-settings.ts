import { sql } from "drizzle-orm";
import { pgTable, serial, integer, numeric, boolean, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// 薪資計算設定（單例：只會有一筆）
export const payrollSettingsTable = pgTable("payroll_settings", {
  tenantId: integer("tenant_id").notNull().default(sql`(current_setting('app.tenant_id'::text))::integer`),
  id: serial("id").primaryKey(),
  // 時薪 = 月薪 / monthlyDivisor
  monthlyDivisor: integer("monthly_divisor").notNull().default(240),
  // 平日加班前 N 小時倍率（台灣勞基法：前 2 小時 1.34）
  otRate1: numeric("ot_rate1", { precision: 4, scale: 2 }).notNull().default("1.34"),
  // 超過 N 小時後倍率（1.67）
  otRate2: numeric("ot_rate2", { precision: 4, scale: 2 }).notNull().default("1.67"),
  // 每日以 rate1 計算的加班時數上限
  otThresholdHours: numeric("ot_threshold_hours", { precision: 4, scale: 1 }).notNull().default("2"),
  // 遲到扣款開關（依分鐘數 × 時薪/60）
  lateDeductionEnabled: boolean("late_deduction_enabled").notNull().default(false),
  // 缺勤扣款開關（缺勤天數 × 月薪/30）
  absenceDeductionEnabled: boolean("absence_deduction_enabled").notNull().default(false),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertPayrollSettingsSchema = createInsertSchema(payrollSettingsTable).omit({ id: true, updatedAt: true });
export type InsertPayrollSettings = z.infer<typeof insertPayrollSettingsSchema>;
export type PayrollSettings = typeof payrollSettingsTable.$inferSelect;
