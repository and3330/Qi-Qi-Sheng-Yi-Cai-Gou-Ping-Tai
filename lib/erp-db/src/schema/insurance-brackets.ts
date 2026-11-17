import { pgTable, text, serial, integer, numeric } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const insuranceBracketsTable = pgTable("insurance_brackets", {
  id: serial("id").primaryKey(),
  type: text("type").notNull(),
  level: integer("level").notNull(),
  minSalary: integer("min_salary").notNull(),
  maxSalary: integer("max_salary"),
  insuredAmount: integer("insured_amount").notNull(),
});

export const insertInsuranceBracketSchema = createInsertSchema(insuranceBracketsTable).omit({ id: true });
export type InsertInsuranceBracket = z.infer<typeof insertInsuranceBracketSchema>;
export type InsuranceBracket = typeof insuranceBracketsTable.$inferSelect;
