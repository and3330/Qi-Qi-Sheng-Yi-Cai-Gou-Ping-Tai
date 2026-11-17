import { sql } from "drizzle-orm";
import { pgTable, text, serial, timestamp, integer, numeric, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// 打卡地點（GPS 圍欄）：打卡時必須位於任一啟用地點的半徑範圍內
export const clockInLocationsTable = pgTable("clock_in_locations", {
  tenantId: integer("tenant_id").notNull().default(sql`(current_setting('app.tenant_id'::text))::integer`),
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  latitude: numeric("latitude", { precision: 10, scale: 7 }).notNull(),
  longitude: numeric("longitude", { precision: 10, scale: 7 }).notNull(),
  radiusMeters: integer("radius_meters").notNull().default(300),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertClockInLocationSchema = createInsertSchema(clockInLocationsTable).omit({ id: true, createdAt: true });
export type InsertClockInLocation = z.infer<typeof insertClockInLocationSchema>;
export type ClockInLocation = typeof clockInLocationsTable.$inferSelect;
