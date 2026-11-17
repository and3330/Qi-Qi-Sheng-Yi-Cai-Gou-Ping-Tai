import { sql } from "drizzle-orm";
import { pgTable, text, serial, timestamp, integer, numeric, index } from "drizzle-orm/pg-core";
import { employeesTable } from "./employees";

/**
 * 特休發放紀錄。
 * source = auto：系統依到職日與勞基法第 38 條自動發放（每個年資區間一筆）
 * source = manual：人資手動調整（可為負數，例如系統上線前已經休掉的天數、遞延的天數）
 * 期滿或離職時沒休完的天數要折發工資，結清後記在 settled_* 欄位。
 */
export const leaveGrantsTable = pgTable("leave_grants", {
  tenantId: integer("tenant_id").notNull().default(sql`(current_setting('app.tenant_id'::text))::integer`),
  id: serial("id").primaryKey(),
  employeeId: integer("employee_id").notNull().references(() => employeesTable.id),
  leaveType: text("leave_type").notNull().default("Annual Leave"),
  periodStart: text("period_start").notNull(),
  periodEnd: text("period_end").notNull(),
  days: numeric("days", { precision: 5, scale: 1 }).notNull(),
  source: text("source").notNull().default("auto"),
  note: text("note"),
  createdBy: text("created_by"),
  settledAt: timestamp("settled_at", { withTimezone: true }),
  settledDays: numeric("settled_days", { precision: 5, scale: 1 }),
  settledAmount: numeric("settled_amount", { precision: 12, scale: 2 }),
  settledNote: text("settled_note"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("leave_grants_employee_idx").on(t.tenantId, t.employeeId, t.periodStart),
]);

export type LeaveGrant = typeof leaveGrantsTable.$inferSelect;
