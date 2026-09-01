import {
  pgTable,
  serial,
  text,
  integer,
  timestamp,
  boolean,
  jsonb,
  index,
} from "drizzle-orm/pg-core";

/** ERP 部門 */
export const erpDepartmentsTable = pgTable("erp_departments", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  parentId: integer("parent_id"),
  // 主管（members.id，弱關聯）
  managerId: integer("manager_id"),
  costCenter: text("cost_center"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

/** ERP 選單權限覆寫：path → 允許角色清單 */
export const erpMenuPermissionsTable = pgTable("erp_menu_permissions", {
  path: text("path").primaryKey(),
  roles: text("roles").array().notNull().default([]),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

/** ERP 審計日誌 */
export const erpAuditLogsTable = pgTable(
  "erp_audit_logs",
  {
    id: serial("id").primaryKey(),
    // create | update | delete | ...
    action: text("action").notNull(),
    module: text("module").notNull(),
    documentType: text("document_type"),
    documentId: text("document_id"),
    userId: integer("user_id").notNull(),
    userName: text("user_name").notNull().default(""),
    description: text("description"),
    oldValues: jsonb("old_values"),
    newValues: jsonb("new_values"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("idx_erp_audit_logs_module").on(t.module),
    index("idx_erp_audit_logs_created").on(t.createdAt),
  ],
);

export type ErpDepartmentRow = typeof erpDepartmentsTable.$inferSelect;
export type ErpMenuPermissionRow = typeof erpMenuPermissionsTable.$inferSelect;
export type ErpAuditLogRow = typeof erpAuditLogsTable.$inferSelect;
