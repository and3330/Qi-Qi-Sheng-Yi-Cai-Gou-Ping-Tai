import { pgTable, text, serial, timestamp, boolean, integer, uniqueIndex, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { employeesTable } from "./employees";

export const adminUsersTable = pgTable("admin_users", {
  tenantId: integer("tenant_id").notNull().default(1),
  id: serial("id").primaryKey(),
  username: text("username").notNull(),
  passwordHash: text("password_hash").notNull(),
  displayName: text("display_name").notNull(),
  role: text("role").notNull().default("admin"),
  isActive: boolean("is_active").notNull().default(true),
  employeeId: integer("employee_id").references(() => employeesTable.id, { onDelete: "set null" }),
  // 「我的頁面」自己挑的常用功能（選單路徑），存在帳號上，換電腦也一樣
  homeShortcuts: jsonb("home_shortcuts").$type<string[]>(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (t) => ({
  tenantUsernameUnique: uniqueIndex("admin_users_tenant_username_unique").on(t.tenantId, t.username),
  employeeIdUnique: uniqueIndex("admin_users_employee_id_unique").on(t.employeeId),
}));

export const insertAdminUserSchema = createInsertSchema(adminUsersTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertAdminUser = z.infer<typeof insertAdminUserSchema>;
export type AdminUser = typeof adminUsersTable.$inferSelect;
