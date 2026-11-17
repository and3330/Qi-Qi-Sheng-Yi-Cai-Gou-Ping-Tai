import { sql } from "drizzle-orm";
import { pgTable, text, serial, timestamp, integer, numeric, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { employeesTable } from "./employees";

export const attendanceTable = pgTable("attendance", {
  tenantId: integer("tenant_id").notNull().default(sql`(current_setting('app.tenant_id'::text))::integer`),
  id: serial("id").primaryKey(),
  employeeId: integer("employee_id").notNull().references(() => employeesTable.id),
  date: text("date").notNull(),
  status: text("status").notNull(),
  checkIn: text("check_in"),
  checkOut: text("check_out"),
  workingHours: numeric("working_hours", { precision: 5, scale: 2 }),
  // 打卡強化: 遲到/早退分鐘數、加班時數 (依班別計算), 打卡位置與備註
  lateMinutes: integer("late_minutes").notNull().default(0),
  earlyLeaveMinutes: integer("early_leave_minutes").notNull().default(0),
  overtimeHours: numeric("overtime_hours", { precision: 5, scale: 2 }).notNull().default("0"),
  shiftTypeId: integer("shift_type_id"),
  checkInLocation: text("check_in_location"),
  checkOutLocation: text("check_out_location"),
  // 圍欄驗證通過的打卡地點名稱（如「公司」）
  checkInLocationName: text("check_in_location_name"),
  checkOutLocationName: text("check_out_location_name"),
  note: text("note"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("attendance_emp_date_uniq").on(t.tenantId, t.employeeId, t.date),
]);

export const insertAttendanceSchema = createInsertSchema(attendanceTable).omit({ id: true, createdAt: true });
export type InsertAttendance = z.infer<typeof insertAttendanceSchema>;
export type Attendance = typeof attendanceTable.$inferSelect;
