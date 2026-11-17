import { sql } from "drizzle-orm";
import {pgTable, text, serial, timestamp, numeric, date, integer, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const currenciesTable = pgTable("currencies", {
  tenantId: integer("tenant_id").notNull().default(sql`(current_setting('app.tenant_id'::text))::integer`),
  id: serial("id").primaryKey(),
  code: text("code").notNull(),
  name: text("name").notNull(),
  symbol: text("symbol").notNull(),
  isBase: text("is_base").notNull().default("No"),
  isActive: text("is_active").notNull().default("Yes"),
  decimalPlaces: text("decimal_places").notNull().default("2"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("currencies_code_unique").on(t.tenantId, t.code),
]);

export const insertCurrencySchema = createInsertSchema(currenciesTable).omit({ id: true, createdAt: true });
export type InsertCurrency = z.infer<typeof insertCurrencySchema>;
export type Currency = typeof currenciesTable.$inferSelect;

export const exchangeRatesTable = pgTable("exchange_rates", {
  tenantId: integer("tenant_id").notNull().default(sql`(current_setting('app.tenant_id'::text))::integer`),
  id: serial("id").primaryKey(),
  fromCurrency: text("from_currency").notNull(),
  toCurrency: text("to_currency").notNull(),
  rate: numeric("rate", { precision: 14, scale: 6 }).notNull(),
  effectiveDate: date("effective_date").notNull(),
  source: text("source").default("Manual"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertExchangeRateSchema = createInsertSchema(exchangeRatesTable).omit({ id: true, createdAt: true });
export type InsertExchangeRate = z.infer<typeof insertExchangeRateSchema>;
export type ExchangeRate = typeof exchangeRatesTable.$inferSelect;
