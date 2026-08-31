import {
  pgTable,
  serial,
  integer,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
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
    // 多規格：所選規格（無規格商品為 null）
    variantId: integer("variant_id"),
    quantity: integer("quantity").notNull().default(1),
  },
  (t) => [
    // 同會員＋商品＋規格唯一（null 規格以 0 代替參與唯一性判斷）
    uniqueIndex("cart_member_product_variant_idx").on(
      t.memberId,
      t.productId,
      sql`coalesce(${t.variantId}, 0)`,
    ),
  ],
);

export const insertCartItemSchema = createInsertSchema(cartItemsTable).omit({
  id: true,
});
export type InsertCartItem = z.infer<typeof insertCartItemSchema>;
export type CartItem = typeof cartItemsTable.$inferSelect;
