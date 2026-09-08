import {
  pgTable,
  serial,
  text,
  integer,
  boolean,
  timestamp,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { suppliersTable } from "./suppliers";
import { membersTable } from "./members";
import { institutionsTable } from "./institutions";
import { erpEmployeesTable } from "./erpHr";

/** 倉庫（單一預設倉為主，其他倉先做資料層準備） */
export const erpWarehousesTable = pgTable("erp_warehouses", {
  id: serial("id").primaryKey(),
  code: text("code").notNull().unique(),
  name: text("name").notNull(),
  address: text("address"),
  note: text("note"),
  isDefault: boolean("is_default").notNull().default(false),
  // 商城可售倉：商城可售量 = 各可售倉合計
  isSellable: boolean("is_sellable").notNull().default(true),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

/** 分倉庫存：product/variant × warehouse 的數量；總量（products/product_variants.stock）= 各倉合計 */
export const warehouseStockTable = pgTable(
  "warehouse_stock",
  {
    id: serial("id").primaryKey(),
    warehouseId: integer("warehouse_id")
      .notNull()
      .references(() => erpWarehousesTable.id),
    productId: integer("product_id").notNull(),
    // 多規格：無規格商品為 null
    variantId: integer("variant_id"),
    quantity: integer("quantity").notNull().default(0),
  },
  (t) => [
    uniqueIndex("uq_warehouse_stock_line").on(
      t.warehouseId,
      t.productId,
      sql`COALESCE(variant_id, 0)`,
    ),
    index("idx_warehouse_stock_product").on(t.productId),
  ],
);

/** 庫存調撥單：來源倉 → 目的倉 */
export const stockTransfersTable = pgTable(
  "stock_transfers",
  {
    id: serial("id").primaryKey(),
    stNo: text("st_no").notNull().unique(),
    fromWarehouseId: integer("from_warehouse_id")
      .notNull()
      .references(() => erpWarehousesTable.id),
    toWarehouseId: integer("to_warehouse_id")
      .notNull()
      .references(() => erpWarehousesTable.id),
    // draft | confirmed | cancelled
    status: text("status").notNull().default("draft"),
    note: text("note"),
    createdBy: integer("created_by"),
    // 製單人：可與建立帳號（createdBy）不同
    creatorEmployeeId: integer("creator_employee_id").references(() => erpEmployeesTable.id),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    confirmedAt: timestamp("confirmed_at"),
  },
  (t) => [index("idx_stock_transfers_status").on(t.status, t.createdAt)],
);

export const stockTransferItemsTable = pgTable("stock_transfer_items", {
  id: serial("id").primaryKey(),
  stockTransferId: integer("stock_transfer_id")
    .notNull()
    .references(() => stockTransfersTable.id),
  productId: integer("product_id").notNull(),
  variantId: integer("variant_id"),
  variantName: text("variant_name"),
  productName: text("product_name").notNull(),
  productCode: text("product_code").notNull(),
  quantity: integer("quantity").notNull(),
});

/** ERP 客戶：商城會員自動對應（member_id 唯一），也可建立非會員客戶 */
export const erpCustomersTable = pgTable(
  "erp_customers",
  {
    id: serial("id").primaryKey(),
    code: text("code").notNull().unique(),
    name: text("name").notNull(),
    memberId: integer("member_id").references(() => membersTable.id),
    institutionId: integer("institution_id").references(() => institutionsTable.id),
    contactPerson: text("contact_person"),
    phone: text("phone"),
    email: text("email"),
    address: text("address"),
    taxId: text("tax_id"),
    paymentTerms: text("payment_terms"),
    priceListId: integer("price_list_id"),
    note: text("note"),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("uq_erp_customers_member_id")
      .on(t.memberId)
      .where(sql`member_id IS NOT NULL`),
  ],
);

/** 價格表（客戶專屬報價） */
export const priceListsTable = pgTable("price_lists", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const priceListItemsTable = pgTable(
  "price_list_items",
  {
    id: serial("id").primaryKey(),
    priceListId: integer("price_list_id")
      .notNull()
      .references(() => priceListsTable.id),
    productId: integer("product_id").notNull(),
    variantId: integer("variant_id"),
    price: integer("price").notNull(),
  },
  (t) => [
    uniqueIndex("uq_price_list_items_line").on(
      t.priceListId,
      t.productId,
      sql`COALESCE(variant_id, 0)`,
    ),
  ],
);

/**
 * 銷貨單：商城訂單自動產生（source=shop，order_id 部分唯一索引防重複單據），
 * 也可由 ERP 直接開立（source=erp）
 */
export const salesOrdersTable = pgTable(
  "sales_orders",
  {
    id: serial("id").primaryKey(),
    soNo: text("so_no").notNull().unique(),
    // shop | erp | quotation
    source: text("source").notNull().default("erp"),
    customerId: integer("customer_id").references(() => erpCustomersTable.id),
    customerName: text("customer_name").notNull().default(""),
    // 對應商城訂單（source=shop / quotation）
    orderId: integer("order_id"),
    orderNo: text("order_no"),
    warehouseId: integer("warehouse_id"),
    // draft | confirmed | shipped | completed | cancelled | returned
    status: text("status").notNull().default("draft"),
    totalAmount: integer("total_amount").notNull().default(0),
    note: text("note"),
    createdBy: integer("created_by"),
    // 製單人：可與建立帳號（createdBy）不同
    creatorEmployeeId: integer("creator_employee_id").references(() => erpEmployeesTable.id),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    confirmedAt: timestamp("confirmed_at"),
    shippedAt: timestamp("shipped_at"),
    completedAt: timestamp("completed_at"),
  },
  (t) => [
    uniqueIndex("uq_sales_orders_order_id")
      .on(t.orderId)
      .where(sql`order_id IS NOT NULL`),
    index("idx_sales_orders_status").on(t.status, t.createdAt),
  ],
);

export const salesOrderItemsTable = pgTable("sales_order_items", {
  id: serial("id").primaryKey(),
  salesOrderId: integer("sales_order_id")
    .notNull()
    .references(() => salesOrdersTable.id),
  productId: integer("product_id").notNull(),
  variantId: integer("variant_id"),
  variantName: text("variant_name"),
  productName: text("product_name").notNull(),
  productCode: text("product_code").notNull(),
  unitPrice: integer("unit_price").notNull(),
  quantity: integer("quantity").notNull(),
  unitCost: integer("unit_cost").notNull().default(0),
  // 逐行快照：虛擬品項不動庫存
  isVirtual: boolean("is_virtual").notNull().default(false),
});

/** 銷貨退回 */
export const salesReturnsTable = pgTable(
  "sales_returns",
  {
    id: serial("id").primaryKey(),
    srNo: text("sr_no").notNull().unique(),
    salesOrderId: integer("sales_order_id").references(() => salesOrdersTable.id),
    customerId: integer("customer_id"),
    customerName: text("customer_name").notNull().default(""),
    warehouseId: integer("warehouse_id"),
    // draft | confirmed | cancelled
    status: text("status").notNull().default("draft"),
    totalAmount: integer("total_amount").notNull().default(0),
    reason: text("reason"),
    note: text("note"),
    createdBy: integer("created_by"),
    // 製單人：可與建立帳號（createdBy）不同
    creatorEmployeeId: integer("creator_employee_id").references(() => erpEmployeesTable.id),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    confirmedAt: timestamp("confirmed_at"),
  },
  (t) => [index("idx_sales_returns_status").on(t.status, t.createdAt)],
);

export const salesReturnItemsTable = pgTable("sales_return_items", {
  id: serial("id").primaryKey(),
  salesReturnId: integer("sales_return_id")
    .notNull()
    .references(() => salesReturnsTable.id),
  productId: integer("product_id").notNull(),
  variantId: integer("variant_id"),
  variantName: text("variant_name"),
  productName: text("product_name").notNull(),
  productCode: text("product_code").notNull(),
  unitPrice: integer("unit_price").notNull(),
  quantity: integer("quantity").notNull(),
  isVirtual: boolean("is_virtual").notNull().default(false),
});

/** 採購退回 */
export const purchaseReturnsTable = pgTable(
  "purchase_returns",
  {
    id: serial("id").primaryKey(),
    prNo: text("pr_no").notNull().unique(),
    supplierId: integer("supplier_id")
      .notNull()
      .references(() => suppliersTable.id),
    purchaseOrderId: integer("purchase_order_id"),
    warehouseId: integer("warehouse_id"),
    // draft | confirmed | cancelled
    status: text("status").notNull().default("draft"),
    totalAmount: integer("total_amount").notNull().default(0),
    reason: text("reason"),
    note: text("note"),
    createdBy: integer("created_by"),
    // 製單人：可與建立帳號（createdBy）不同
    creatorEmployeeId: integer("creator_employee_id").references(() => erpEmployeesTable.id),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    confirmedAt: timestamp("confirmed_at"),
  },
  (t) => [index("idx_purchase_returns_status").on(t.status, t.createdAt)],
);

export const purchaseReturnItemsTable = pgTable("purchase_return_items", {
  id: serial("id").primaryKey(),
  purchaseReturnId: integer("purchase_return_id")
    .notNull()
    .references(() => purchaseReturnsTable.id),
  productId: integer("product_id").notNull(),
  variantId: integer("variant_id"),
  variantName: text("variant_name"),
  productName: text("product_name").notNull(),
  productCode: text("product_code").notNull(),
  unitCost: integer("unit_cost").notNull(),
  quantity: integer("quantity").notNull(),
  isVirtual: boolean("is_virtual").notNull().default(false),
});

export type ErpWarehouse = typeof erpWarehousesTable.$inferSelect;
export type WarehouseStock = typeof warehouseStockTable.$inferSelect;
export type StockTransfer = typeof stockTransfersTable.$inferSelect;
export type StockTransferItem = typeof stockTransferItemsTable.$inferSelect;
export type ErpCustomer = typeof erpCustomersTable.$inferSelect;
export type PriceList = typeof priceListsTable.$inferSelect;
export type PriceListItem = typeof priceListItemsTable.$inferSelect;
export type SalesOrder = typeof salesOrdersTable.$inferSelect;
export type SalesOrderItem = typeof salesOrderItemsTable.$inferSelect;
export type SalesReturn = typeof salesReturnsTable.$inferSelect;
export type SalesReturnItem = typeof salesReturnItemsTable.$inferSelect;
export type PurchaseReturn = typeof purchaseReturnsTable.$inferSelect;
export type PurchaseReturnItem = typeof purchaseReturnItemsTable.$inferSelect;
