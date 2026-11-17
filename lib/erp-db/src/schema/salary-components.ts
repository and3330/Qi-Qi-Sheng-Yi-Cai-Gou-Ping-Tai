import { sql } from "drizzle-orm";
import { pgTable, text, serial, timestamp, integer, boolean, uniqueIndex, index } from "drizzle-orm/pg-core";

/**
 * 薪資項目：公司自己定義的固定加項（伙食津貼、交通津貼、職務加給…）與減項（福利金、借支扣回…）。
 * 原本薪資單只有一格「其他津貼」，每個月要自己加總後手動輸入。
 */
export const salaryComponentsTable = pgTable("salary_components", {
  tenantId: integer("tenant_id").notNull().default(sql`(current_setting('app.tenant_id'::text))::integer`),
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  // earning 加項、deduction 減項
  kind: text("kind").notNull().default("earning"),
  defaultAmount: integer("default_amount").notNull().default(0),
  // 加項是否算進投保薪資（伙食津貼等免稅、不列入投保的項目關掉）
  insurable: boolean("insurable").notNull().default(true),
  isActive: boolean("is_active").notNull().default(true),
  sortOrder: integer("sort_order").notNull().default(0),
  note: text("note"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("salary_components_name_unique").on(t.tenantId, t.name),
]);

/** 員工的薪資結構：這位員工每個月固定有哪些項目、各多少錢 */
export const employeeSalaryComponentsTable = pgTable("employee_salary_components", {
  tenantId: integer("tenant_id").notNull().default(sql`(current_setting('app.tenant_id'::text))::integer`),
  id: serial("id").primaryKey(),
  employeeId: integer("employee_id").notNull(),
  componentId: integer("component_id").notNull(),
  amount: integer("amount").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("employee_salary_components_unique").on(t.tenantId, t.employeeId, t.componentId),
  index("employee_salary_components_emp_idx").on(t.tenantId, t.employeeId),
]);

export type SalaryComponent = typeof salaryComponentsTable.$inferSelect;
export type EmployeeSalaryComponent = typeof employeeSalaryComponentsTable.$inferSelect;
