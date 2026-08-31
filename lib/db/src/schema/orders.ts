import {
  pgTable,
  serial,
  text,
  integer,
  timestamp,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { membersTable } from "./members";

export const ordersTable = pgTable("orders", {
  id: serial("id").primaryKey(),
  orderNo: text("order_no").notNull().unique(),
  memberId: integer("member_id")
    .notNull()
    .references(() => membersTable.id),
  // pending | paid | shipped | completed | cancelled
  status: text("status").notNull().default("pending"),
  // bank_transfer | cod | wallet
  paymentMethod: text("payment_method").notNull(),
  totalAmount: integer("total_amount").notNull(),
  shippingAddress: text("shipping_address"),
  receiverName: text("receiver_name"),
  receiverPhone: text("receiver_phone"),
  note: text("note"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const orderItemsTable = pgTable("order_items", {
  id: serial("id").primaryKey(),
  orderId: integer("order_id")
    .notNull()
    .references(() => ordersTable.id),
  productId: integer("product_id").notNull(),
  productName: text("product_name").notNull(),
  productCode: text("product_code").notNull(),
  unitPrice: integer("unit_price").notNull(),
  quantity: integer("quantity").notNull(),
});

export const insertOrderSchema = createInsertSchema(ordersTable).omit({
  id: true,
  createdAt: true,
});
export type InsertOrder = z.infer<typeof insertOrderSchema>;
export type Order = typeof ordersTable.$inferSelect;
export type OrderItem = typeof orderItemsTable.$inferSelect;
