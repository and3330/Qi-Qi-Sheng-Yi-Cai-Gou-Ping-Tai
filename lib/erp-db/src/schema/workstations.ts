import { sql } from "drizzle-orm";
import { pgTable, text, serial, timestamp, integer, numeric } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const workstationsTable = pgTable("workstations", {
  tenantId: integer("tenant_id").notNull().default(sql`(current_setting('app.tenant_id'::text))::integer`),
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  productionCapacity: integer("production_capacity").notNull().default(1),
  hourRate: numeric("hour_rate", { precision: 12, scale: 2 }).notNull().default("0"),
  status: text("status").notNull().default("Active"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertWorkstationSchema = createInsertSchema(workstationsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertWorkstation = z.infer<typeof insertWorkstationSchema>;
export type Workstation = typeof workstationsTable.$inferSelect;
