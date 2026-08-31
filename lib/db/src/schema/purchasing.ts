import {
  pgTable,
  serial,
  text,
  integer,
  timestamp,
} from "drizzle-orm/pg-core";
import { suppliersTable } from "./suppliers";

export const purchaseOrdersTable = pgTable("purchase_orders", {
  id: serial("id").primaryKey(),
  poNo: text("po_no").notNull().unique(),
  supplierId: integer("supplier_id")
    .notNull()
    .references(() => suppliersTable.id),
  // draft | ordered | received | cancelled
  status: text("status").notNull().default("draft"),
  totalAmount: integer("total_amount").notNull().default(0),
  note: text("note"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  orderedAt: timestamp("ordered_at"),
  receivedAt: timestamp("received_at"),
});

export const purchaseOrderItemsTable = pgTable("purchase_order_items", {
  id: serial("id").primaryKey(),
  purchaseOrderId: integer("purchase_order_id")
    .notNull()
    .references(() => purchaseOrdersTable.id),
  productId: integer("product_id").notNull(),
  productName: text("product_name").notNull(),
  productCode: text("product_code").notNull(),
  unitCost: integer("unit_cost").notNull(),
  quantity: integer("quantity").notNull(),
});

export type PurchaseOrder = typeof purchaseOrdersTable.$inferSelect;
export type PurchaseOrderItem = typeof purchaseOrderItemsTable.$inferSelect;
