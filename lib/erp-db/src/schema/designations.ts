import { sql } from "drizzle-orm";
import { pgTable, text, serial, timestamp, boolean, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { departmentsTable } from "./departments";

export const designationsTable = pgTable("designations", {
  tenantId: integer("tenant_id").notNull().default(sql`(current_setting('app.tenant_id'::text))::integer`),
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  departmentId: integer("department_id").references(() => departmentsTable.id),
  description: text("description"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertDesignationSchema = createInsertSchema(designationsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertDesignation = z.infer<typeof insertDesignationSchema>;
export type Designation = typeof designationsTable.$inferSelect;
