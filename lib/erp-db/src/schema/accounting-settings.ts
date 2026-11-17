import { sql } from "drizzle-orm";
import { pgTable, serial, text, timestamp, integer } from "drizzle-orm/pg-core";

export const accountingSettingsTable = pgTable("accounting_settings", {
  tenantId: integer("tenant_id").notNull().default(sql`(current_setting('app.tenant_id'::text))::integer`),
  id: serial("id").primaryKey(),
  lockDate: text("lock_date"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export type AccountingSettings = typeof accountingSettingsTable.$inferSelect;
