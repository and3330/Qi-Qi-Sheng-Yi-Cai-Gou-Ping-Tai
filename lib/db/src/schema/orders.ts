import {
  pgTable,
  serial,
  text,
  integer,
  timestamp,
  index,
  jsonb,
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
  // 錢包付款來源：member（個人錢包）| institution（機構共用錢包）；非錢包付款為 null
  walletSource: text("wallet_source"),
  // 出貨照片存證（物件路徑陣列，如 ["/objects/uploads/xxx"]）
  shipmentPhotos: jsonb("shipment_photos").$type<string[]>().notNull().default([]),
  totalAmount: integer("total_amount").notNull(),
  // 點數折抵：本單使用點數（1 點 = NT$1，折抵後為 totalAmount）與折抵前金額
  pointsUsed: integer("points_used").notNull().default(0),
  // 完成訂單時累積的點數（每滿 NT$100 得 1 點）
  pointsEarned: integer("points_earned").notNull().default(0),
  shippingAddress: text("shipping_address"),
  receiverName: text("receiver_name"),
  receiverPhone: text("receiver_phone"),
  note: text("note"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => [index("idx_orders_member_created").on(t.memberId, t.createdAt)]);

export const orderItemsTable = pgTable("order_items", {
  id: serial("id").primaryKey(),
  orderId: integer("order_id")
    .notNull()
    .references(() => ordersTable.id),
  productId: integer("product_id").notNull(),
  // 多規格：所選規格（無規格商品為 null）
  variantId: integer("variant_id"),
  variantName: text("variant_name"),
  productName: text("product_name").notNull(),
  productCode: text("product_code").notNull(),
  unitPrice: integer("unit_price").notNull(),
  quantity: integer("quantity").notNull(),
  // 成本快照（下單當時的商品成本，NT$）
  unitCost: integer("unit_cost").notNull().default(0),
});

export const insertOrderSchema = createInsertSchema(ordersTable).omit({
  id: true,
  createdAt: true,
});
export type InsertOrder = z.infer<typeof insertOrderSchema>;
export type Order = typeof ordersTable.$inferSelect;
export type OrderItem = typeof orderItemsTable.$inferSelect;
