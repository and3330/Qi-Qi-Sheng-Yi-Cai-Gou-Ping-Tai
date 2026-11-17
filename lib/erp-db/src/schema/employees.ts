import { sql } from "drizzle-orm";
import {pgTable, text, serial, timestamp, integer, numeric, boolean, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { departmentsTable } from "./departments";

export const employeesTable = pgTable("employees", {
  tenantId: integer("tenant_id").notNull().default(sql`(current_setting('app.tenant_id'::text))::integer`),
  id: serial("id").primaryKey(),
  employeeId: text("employee_id").notNull(),
  firstName: text("first_name").notNull(),
  lastName: text("last_name").notNull(),
  email: text("email").notNull(),
  phone: text("phone"),
  departmentId: integer("department_id").references(() => departmentsTable.id),
  designation: text("designation"),
  status: text("status").notNull().default("Active"),
  dateOfJoining: text("date_of_joining").notNull(),
  salary: numeric("salary", { precision: 12, scale: 2 }),
  healthInsuranceDependents: integer("health_insurance_dependents").notNull().default(0),
  pensionSelfRate: integer("pension_self_rate").notNull().default(0),
  shiftTypeId: integer("shift_type_id"),
  // 職級（職級管理的清單）；職級上設定的薪資範圍用來提醒薪資是否落在範圍內
  gradeId: integer("grade_id"),
  // 打卡圍欄例外（外勤人員可在任意地點打卡）
  geofenceExempt: boolean("geofence_exempt").notNull().default(false),
  // 離職日：特休結算、缺勤計算、薪資都以這天為界
  resignationDate: text("resignation_date"),
  birthDate: text("birth_date"),
  emergencyContact: text("emergency_contact"),
  emergencyPhone: text("emergency_phone"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (t) => [
  uniqueIndex("employees_employee_id_unique").on(t.tenantId, t.employeeId),
  uniqueIndex("employees_email_unique").on(t.tenantId, t.email),
]);

export const insertEmployeeSchema = createInsertSchema(employeesTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertEmployee = z.infer<typeof insertEmployeeSchema>;
export type Employee = typeof employeesTable.$inferSelect;
