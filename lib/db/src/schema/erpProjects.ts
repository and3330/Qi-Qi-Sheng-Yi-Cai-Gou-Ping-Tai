import { index, integer, numeric, pgTable, serial, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

export const erpProjectsTable = pgTable("erp_projects", {
  id: serial("id").primaryKey(),
  projectNo: text("project_no").notNull(),
  name: text("name").notNull(),
  customerId: integer("customer_id"),
  managerId: integer("manager_id"),
  status: text("status").notNull().default("planning"),
  startDate: text("start_date"),
  endDate: text("end_date"),
  budget: integer("budget"),
  description: text("description"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("uq_erp_projects_no").on(t.projectNo),
  index("idx_erp_projects_status").on(t.status),
]);

export const erpProjectTasksTable = pgTable("erp_project_tasks", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull().references(() => erpProjectsTable.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  description: text("description"),
  assigneeId: integer("assignee_id"),
  status: text("status").notNull().default("todo"),
  priority: text("priority").notNull().default("medium"),
  dueDate: text("due_date"),
  sortOrder: integer("sort_order").notNull().default(0),
  estimatedHours: numeric("estimated_hours", { mode: "number" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
}, (t) => [
  index("idx_erp_project_tasks_project").on(t.projectId),
  index("idx_erp_project_tasks_assignee").on(t.assigneeId),
]);

export const erpJobCardsTable = pgTable("erp_job_cards", {
  id: serial("id").primaryKey(),
  taskId: integer("task_id").references(() => erpProjectTasksTable.id, { onDelete: "set null" }),
  projectId: integer("project_id").notNull().references(() => erpProjectsTable.id, { onDelete: "cascade" }),
  memberId: integer("member_id").notNull(),
  workDate: text("work_date").notNull(),
  hours: numeric("hours", { mode: "number" }).notNull(),
  description: text("description"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("idx_erp_job_cards_project").on(t.projectId),
  index("idx_erp_job_cards_member").on(t.memberId),
]);