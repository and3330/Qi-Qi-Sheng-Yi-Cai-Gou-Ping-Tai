import { sql } from "drizzle-orm";
import { pgTable, text, serial, timestamp, integer, numeric, boolean, index } from "drizzle-orm/pg-core";

/**
 * 工時表：員工把每天的工時填到專案（可再指定任務或工單）。
 * 核准後依當時的時薪換算成人工成本，專案看得到投入多少人力；
 * 填到工單的工時會在完工入庫時計入成品成本。
 */
export const timesheetsTable = pgTable("timesheets", {
  tenantId: integer("tenant_id").notNull().default(sql`(current_setting('app.tenant_id'::text))::integer`),
  id: serial("id").primaryKey(),
  employeeId: integer("employee_id").notNull(),
  workDate: text("work_date").notNull(),
  projectId: integer("project_id").notNull(),
  taskId: integer("task_id"),
  workOrderId: integer("work_order_id"),
  hours: numeric("hours", { precision: 6, scale: 2 }).notNull(),
  // 填寫當下的時薪（月薪 ÷ 時薪除數），之後調薪不會回頭改到舊紀錄
  hourlyCost: numeric("hourly_cost", { precision: 12, scale: 2 }).notNull().default("0"),
  costAmount: numeric("cost_amount", { precision: 12, scale: 2 }).notNull().default("0"),
  description: text("description"),
  // Submitted 待核准、Approved 已核准、Rejected 已退回
  status: text("status").notNull().default("Submitted"),
  approvedBy: text("approved_by"),
  // 工單工時是否已經計入成品成本，避免分批完工時重複計算
  costApplied: boolean("cost_applied").notNull().default(false),
  createdBy: text("created_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("timesheets_emp_date_idx").on(t.tenantId, t.employeeId, t.workDate),
  index("timesheets_project_idx").on(t.tenantId, t.projectId),
  index("timesheets_work_order_idx").on(t.tenantId, t.workOrderId),
]);

export type Timesheet = typeof timesheetsTable.$inferSelect;
