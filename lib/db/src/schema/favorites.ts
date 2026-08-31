import { pgTable, serial, integer, uniqueIndex } from "drizzle-orm/pg-core";
import { membersTable } from "./members";
import { productsTable } from "./products";

export const favoritesTable = pgTable(
  "favorites",
  {
    id: serial("id").primaryKey(),
    memberId: integer("member_id")
      .notNull()
      .references(() => membersTable.id),
    productId: integer("product_id")
      .notNull()
      .references(() => productsTable.id),
  },
  (t) => [uniqueIndex("fav_member_product_idx").on(t.memberId, t.productId)],
);

export type Favorite = typeof favoritesTable.$inferSelect;
