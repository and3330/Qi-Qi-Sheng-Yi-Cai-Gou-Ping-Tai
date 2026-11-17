import { sql } from "drizzle-orm";
import { pgTable, text, serial, timestamp, integer, numeric, uniqueIndex, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { employeesTable } from "./employees";

export const salarySlipsTable = pgTable("salary_slips", {
  tenantId: integer("tenant_id").notNull().default(sql`(current_setting('app.tenant_id'::text))::integer`),
  id: serial("id").primaryKey(),
  employeeId: integer("employee_id").notNull().references(() => employeesTable.id),
  year: integer("year").notNull(),
  month: integer("month").notNull(),
  // 這筆薪資成本歸屬的專案
  projectId: integer("project_id"),
  baseSalary: integer("base_salary").notNull(),
  overtimePay: integer("overtime_pay").notNull().default(0),
  otherAllowances: integer("other_allowances").notNull().default(0),
  // 薪資項目明細（加項已含在 otherAllowances、減項已含在 otherDeductions）
  components: jsonb("components").$type<Array<{ componentId: number | null; name: string; kind: string; amount: number; insurable?: boolean }> | null>(),
  // 薪資項目的減項合計（福利金、借支扣回等），已含在 totalDeductions
  otherDeductions: integer("other_deductions").notNull().default(0),
  attendanceDeduction: integer("attendance_deduction").notNull().default(0),
  attendanceSummary: jsonb("attendance_summary").$type<{
    presentDays: number;
    lateCount: number;
    totalLateMinutes: number;
    earlyLeaveCount: number;
    totalWorkingHours: number;
    totalOvertimeHours: number;
    leaveDays: number;
    absentDays: number;
    workingDays: number;
  } | null>(),
  grossSalary: integer("gross_salary").notNull(),
  laborInsuranceBracket: integer("labor_insurance_bracket").notNull(),
  laborInsuranceEmployee: integer("labor_insurance_employee").notNull(),
  laborInsuranceEmployer: integer("labor_insurance_employer").notNull(),
  healthInsuranceBracket: integer("health_insurance_bracket").notNull(),
  healthInsuranceDependents: integer("health_insurance_dependents").notNull().default(0),
  healthInsuranceEmployee: integer("health_insurance_employee").notNull(),
  healthInsuranceEmployer: integer("health_insurance_employer").notNull(),
  pensionBracket: integer("pension_bracket").notNull(),
  pensionEmployer: integer("pension_employer").notNull(),
  pensionEmployeeSelfRate: integer("pension_employee_self_rate").notNull().default(0),
  pensionEmployeeSelf: integer("pension_employee_self").notNull().default(0),
  totalDeductions: integer("total_deductions").notNull(),
  netSalary: integer("net_salary").notNull(),
  status: text("status").notNull().default("draft"),
  note: text("note"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (t) => [
  uniqueIndex("salary_slips_emp_ym_uniq").on(t.tenantId, t.employeeId, t.year, t.month),
]);

export const insertSalarySlipSchema = createInsertSchema(salarySlipsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertSalarySlip = z.infer<typeof insertSalarySlipSchema>;
export type SalarySlip = typeof salarySlipsTable.$inferSelect;
