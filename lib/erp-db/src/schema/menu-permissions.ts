import { sql } from "drizzle-orm";
import { pgTable, text, timestamp, integer, primaryKey } from "drizzle-orm/pg-core";

export const menuPermissionsTable = pgTable("menu_permissions", {
  tenantId: integer("tenant_id").notNull().default(sql`(current_setting('app.tenant_id'::text))::integer`),
  path: text("path").notNull(),
  roles: text("roles").array().notNull().default([]),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  pk: primaryKey({ columns: [t.tenantId, t.path] }),
}));

export type MenuPermission = typeof menuPermissionsTable.$inferSelect;
