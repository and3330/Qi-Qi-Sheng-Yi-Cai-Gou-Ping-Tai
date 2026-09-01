import {
  boolean,
  index,
  integer,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

/** 人資－職級 */
export const erpJobGradesTable = pgTable("erp_job_grades", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  rank: integer("rank").notNull().default(0),
  minSalary: integer("min_salary").notNull().default(0),
  maxSalary: integer("max_salary").notNull().default(0),
});

/** 人資－員工主檔；memberId 為 members.id 弱關聯。 */
export const erpEmployeesTable = pgTable(
  "erp_employees",
  {
    id: serial("id").primaryKey(),
    employeeNo: text("employee_no").notNull(),
    name: text("name").notNull(),
    memberId: integer("member_id"),
    departmentId: integer("department_id"),
    jobTitle: text("job_title"),
    jobGradeId: integer("job_grade_id").references(() => erpJobGradesTable.id),
    hireDate: text("hire_date"),
    terminationDate: text("termination_date"),
    status: text("status").notNull().default("active"),
    email: text("email"),
    phone: text("phone"),
    idNumber: text("id_number"),
    birthDate: text("birth_date"),
    address: text("address"),
    emergencyContact: text("emergency_contact"),
    bankAccount: text("bank_account"),
    baseSalary: integer("base_salary").notNull().default(0),
    laborInsuranceGrade: integer("labor_insurance_grade"),
    healthInsuranceGrade: integer("health_insurance_grade"),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("uq_erp_employees_employee_no").on(t.employeeNo),
    uniqueIndex("uq_erp_employees_member").on(t.memberId).where(sql`member_id IS NOT NULL`),
    index("idx_erp_employees_department").on(t.departmentId),
  ],
);

/** 人資－班別 */
export const erpShiftsTable = pgTable("erp_shifts", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  startTime: text("start_time").notNull().default("09:00"),
  endTime: text("end_time").notNull().default("18:00"),
  breakMinutes: integer("break_minutes").notNull().default(60),
});

/** 人資－出勤 */
export const erpAttendanceRecordsTable = pgTable(
  "erp_attendance_records",
  {
    id: serial("id").primaryKey(),
    employeeId: integer("employee_id").notNull().references(() => erpEmployeesTable.id),
    workDate: text("work_date").notNull(),
    clockIn: timestamp("clock_in", { withTimezone: true }),
    clockOut: timestamp("clock_out", { withTimezone: true }),
    shiftId: integer("shift_id").references(() => erpShiftsTable.id),
    status: text("status").notNull().default("normal"),
    notes: text("notes"),
  },
  (t) => [
    uniqueIndex("uq_erp_attendance_employee_date").on(t.employeeId, t.workDate),
    index("idx_erp_attendance_date").on(t.workDate),
  ],
);

/** 人資－假別 */
export const erpLeaveTypesTable = pgTable("erp_leave_types", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  annualQuota: integer("annual_quota").notNull().default(0),
  requiresProof: boolean("requires_proof").notNull().default(false),
});

/** 人資－請假申請 */
export const erpLeaveRequestsTable = pgTable(
  "erp_leave_requests",
  {
    id: serial("id").primaryKey(),
    employeeId: integer("employee_id").notNull().references(() => erpEmployeesTable.id),
    leaveTypeId: integer("leave_type_id").notNull().references(() => erpLeaveTypesTable.id),
    startAt: timestamp("start_at", { withTimezone: true }).notNull(),
    endAt: timestamp("end_at", { withTimezone: true }).notNull(),
    hours: integer("hours").notNull().default(0),
    reason: text("reason"),
    status: text("status").notNull().default("pending"),
    approverId: integer("approver_id"),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    rejectReason: text("reject_reason"),
  },
  (t) => [index("idx_erp_leave_employee").on(t.employeeId), index("idx_erp_leave_status").on(t.status)],
);

/** 人資－薪資批次 */
export const erpPayrollRunsTable = pgTable("erp_payroll_runs", {
  id: serial("id").primaryKey(),
  period: text("period").notNull(),
  status: text("status").notNull().default("draft"),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("uq_erp_payroll_period").on(t.period)]);

/** 人資－薪資明細，所有金額皆為 NT$ 整數。 */
export const erpPayrollItemsTable = pgTable(
  "erp_payroll_items",
  {
    id: serial("id").primaryKey(),
    runId: integer("run_id").notNull().references(() => erpPayrollRunsTable.id, { onDelete: "cascade" }),
    employeeId: integer("employee_id").notNull().references(() => erpEmployeesTable.id),
    baseSalary: integer("base_salary").notNull().default(0),
    overtimePay: integer("overtime_pay").notNull().default(0),
    allowances: integer("allowances").notNull().default(0),
    laborInsurance: integer("labor_insurance").notNull().default(0),
    healthInsurance: integer("health_insurance").notNull().default(0),
    otherDeductions: integer("other_deductions").notNull().default(0),
    netPay: integer("net_pay").notNull().default(0),
    notes: text("notes"),
  },
  (t) => [uniqueIndex("uq_erp_payroll_item_employee").on(t.runId, t.employeeId)],
);

/** 人資－勞健保投保級距。 */
export const erpInsuranceBracketsTable = pgTable(
  "erp_insurance_brackets",
  {
    id: serial("id").primaryKey(),
    type: text("type").notNull(),
    grade: integer("grade").notNull(),
    salaryMin: integer("salary_min").notNull().default(0),
    salaryMax: integer("salary_max").notNull().default(0),
    employeeAmount: integer("employee_amount").notNull().default(0),
    employerAmount: integer("employer_amount").notNull().default(0),
  },
  (t) => [uniqueIndex("uq_erp_insurance_type_grade").on(t.type, t.grade)],
);

export type ErpEmployeeRow = typeof erpEmployeesTable.$inferSelect;
export type ErpPayrollItemRow = typeof erpPayrollItemsTable.$inferSelect;