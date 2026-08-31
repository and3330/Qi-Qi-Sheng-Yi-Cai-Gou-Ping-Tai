import {
  pgTable,
  serial,
  integer,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { membersTable } from "./members";
import { productsTable } from "./products";

export const cartItemsTable = pgTable(
  "cart_items",
  {
    id: serial("id").primaryKey(),
    memberId: integer("member_id")
      .notNull()
      .references(() => membersTable.id),
    productId: integer("product_id")
      .notNull()
      .references(() => productsTable.id),
    quantity: integer("quantity").notNull().default(1),
  },
  (t) => [uniqueIndex("cart_member_product_idx").on(t.memberId, t.productId)],
);

export const insertCartItemSchema = createInsertSchema(cartItemsTable).omit({
  id: true,
});
export type InsertCartItem = z.infer<typeof insertCartItemSchema>;
export type CartItem = typeof cartItemsTable.$inferSelect;
