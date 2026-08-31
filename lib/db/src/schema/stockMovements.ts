import {
  pgTable,
  serial,
  text,
  integer,
  timestamp,
} from "drizzle-orm/pg-core";
import { productsTable } from "./products";

export const stockMovementsTable = pgTable("stock_movements", {
  id: serial("id").primaryKey(),
  productId: integer("product_id")
    .notNull()
    .references(() => productsTable.id),
  // purchase | sale | adjust
  type: text("type").notNull(),
  // signed quantity: positive = stock in, negative = stock out
  quantity: integer("quantity").notNull(),
  stockAfter: integer("stock_after").notNull(),
  // e.g. 盤點 / 報廢 / 進貨單號 / 訂單編號
  reason: text("reason"),
  refNo: text("ref_no"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type StockMovement = typeof stockMovementsTable.$inferSelect;
