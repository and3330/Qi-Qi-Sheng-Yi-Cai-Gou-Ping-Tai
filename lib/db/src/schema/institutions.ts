import { pgTable, serial, text, jsonb, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const institutionsTable = pgTable("institutions", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  // hospital | clinic | pharmacy
  type: text("type").notNull(),
  city: text("city").notNull(),
  address: text("address"),
  phone: text("phone"),
  hours: text("hours"),
  departments: jsonb("departments").$type<string[]>().notNull().default([]),
  // 機構分級 A/B/C；null = 未分級
  grade: text("grade"),
  // 機構共用錢包餘額 (NT$)，全機構成員共用
  walletBalance: integer("wallet_balance").notNull().default(0),
});

export const insertInstitutionSchema = createInsertSchema(
  institutionsTable,
).omit({ id: true });
export type InsertInstitution = z.infer<typeof insertInstitutionSchema>;
export type Institution = typeof institutionsTable.$inferSelect;
