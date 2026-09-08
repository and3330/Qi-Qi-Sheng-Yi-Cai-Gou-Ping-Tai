import {
  pgTable,
  serial,
  text,
  integer,
  timestamp,
} from "drizzle-orm/pg-core";
import { suppliersTable } from "./suppliers";
import { erpEmployeesTable } from "./erpHr";

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
  warehouseId: integer("warehouse_id"),
  createdBy: integer("created_by"),
    // 製單人：可與建立帳號（createdBy）不同
    creatorEmployeeId: integer("creator_employee_id").references(() => erpEmployeesTable.id),
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
  // 多規格：收貨補到指定規格庫存（無規格商品為 null）
  variantId: integer("variant_id"),
  variantName: text("variant_name"),
  productName: text("product_name").notNull(),
  productCode: text("product_code").notNull(),
  unitCost: integer("unit_cost").notNull(),
  quantity: integer("quantity").notNull(),
});

export type PurchaseOrder = typeof purchaseOrdersTable.$inferSelect;
export type PurchaseOrderItem = typeof purchaseOrderItemsTable.$inferSelect;
