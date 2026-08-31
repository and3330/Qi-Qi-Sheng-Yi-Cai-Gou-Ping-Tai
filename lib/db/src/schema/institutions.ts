import { pgTable, serial, text, jsonb } from "drizzle-orm/pg-core";
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
});

export const insertInstitutionSchema = createInsertSchema(
  institutionsTable,
).omit({ id: true });
export type InsertInstitution = z.infer<typeof insertInstitutionSchema>;
export type Institution = typeof institutionsTable.$inferSelect;
