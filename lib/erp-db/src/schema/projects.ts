import { sql } from "drizzle-orm";
import { pgTable, text, serial, timestamp, numeric, boolean, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { departmentsTable } from "./departments";

export const projectsTable = pgTable("projects", {
  tenantId: integer("tenant_id").notNull().default(sql`(current_setting('app.tenant_id'::text))::integer`),
  id: serial("id").primaryKey(),
  // 所屬部門 (BU): 一個部門可對應多個專案
  departmentId: integer("department_id").references(() => departmentsTable.id, { onDelete: "set null" }),
  // 主專案：例如「夏令營」是主專案，底下每一年各一個子專案。只有兩層，子專案底下不能再有子專案
  parentId: integer("parent_id"),
  name: text("name").notNull(),
  description: text("description"),
  status: text("status").notNull().default("Open"),
  priority: text("priority").notNull().default("Medium"),
  startDate: text("start_date"),
  endDate: text("end_date"),
  progress: numeric("progress", { precision: 5, scale: 2 }).notNull().default("0"),
  budgetIncome: numeric("budget_income", { precision: 14, scale: 2 }).notNull().default("0"),
  budgetExpense: numeric("budget_expense", { precision: 14, scale: 2 }).notNull().default("0"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertProjectSchema = createInsertSchema(projectsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertProject = z.infer<typeof insertProjectSchema>;
export type Project = typeof projectsTable.$inferSelect;
