import { sql } from "drizzle-orm";
import { pgTable, text, serial, timestamp, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const shiftTypesTable = pgTable("shift_types", {
  tenantId: integer("tenant_id").notNull().default(sql`(current_setting('app.tenant_id'::text))::integer`),
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  startTime: text("start_time").notNull(),
  endTime: text("end_time").notNull(),
  breakStart: text("break_start"),
  breakEnd: text("break_end"),
  workingHours: text("working_hours").notNull().default("8"),
  status: text("status").notNull().default("active"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertShiftTypeSchema = createInsertSchema(shiftTypesTable).omit({ id: true, createdAt: true });
export type InsertShiftType = z.infer<typeof insertShiftTypeSchema>;
export type ShiftType = typeof shiftTypesTable.$inferSelect;
