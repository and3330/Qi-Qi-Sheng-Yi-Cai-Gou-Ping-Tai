import { sql } from "drizzle-orm";
import { pgTable, text, serial, timestamp, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { salesOrdersTable } from "./sales-orders";

export const orderRegistrantsTable = pgTable("order_registrants", {
  tenantId: integer("tenant_id").notNull().default(sql`(current_setting('app.tenant_id'::text))::integer`),
  id: serial("id").primaryKey(),
  salesOrderId: integer("sales_order_id").notNull().references(() => salesOrdersTable.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  contactInfo: text("contact_info"),
  age: text("age"),
  grade: text("grade"),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertOrderRegistrantSchema = createInsertSchema(orderRegistrantsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertOrderRegistrant = z.infer<typeof insertOrderRegistrantSchema>;
export type OrderRegistrant = typeof orderRegistrantsTable.$inferSelect;
