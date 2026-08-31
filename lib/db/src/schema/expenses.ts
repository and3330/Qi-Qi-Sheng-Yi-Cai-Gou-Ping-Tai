import {
  pgTable,
  serial,
  text,
  integer,
  timestamp,
} from "drizzle-orm/pg-core";

export const expensesTable = pgTable("expenses", {
  id: serial("id").primaryKey(),
  // purchase (進貨款) | operating (營運費用) | logistics (物流) | marketing (行銷) | other
  category: text("category").notNull().default("other"),
  title: text("title").notNull(),
  // NT$
  amount: integer("amount").notNull(),
  note: text("note"),
  // 支出發生日
  spentAt: timestamp("spent_at").notNull().defaultNow(),
  createdBy: integer("created_by"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type Expense = typeof expensesTable.$inferSelect;
