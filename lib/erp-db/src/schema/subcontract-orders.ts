import { sql } from "drizzle-orm";
import { pgTable, text, serial, timestamp, integer, numeric, boolean, jsonb, uniqueIndex, index } from "drizzle-orm/pg-core";

/** 外包單上的一項材料：每做一個成品要多少、已經發給代工廠多少、用掉多少、退回多少、損耗多少 */
export interface SubcontractMaterial {
  itemId: number;
  itemName: string;
  unit: string;
  perUnit: number;
  requiredQty: number;
  issuedQty: number;
  consumedQty: number;
  returnedQty: number;
  lossQty: number;
}

/**
 * 外包單（供料加工）：材料是自己的，發給代工廠加工，對方交回成品、只收加工費。
 * 材料發出去只是換位置（移到代工廠倉），仍是公司的庫存；
 * 成品交回時才把用掉的材料與加工費一起算進成品成本，加工費同時變成應付帳款。
 */
export const subcontractOrdersTable = pgTable("subcontract_orders", {
  tenantId: integer("tenant_id").notNull().default(sql`(current_setting('app.tenant_id'::text))::integer`),
  id: serial("id").primaryKey(),
  orderNumber: text("order_number").notNull(),
  supplierId: integer("supplier_id").notNull(),
  itemId: integer("item_id").notNull(),
  bomId: integer("bom_id"),
  projectId: integer("project_id").notNull(),
  quantity: numeric("quantity", { precision: 12, scale: 2 }).notNull(),
  receivedQuantity: numeric("received_quantity", { precision: 12, scale: 2 }).notNull().default("0"),
  // 每一個成品的加工費（未稅）
  unitFee: numeric("unit_fee", { precision: 12, scale: 2 }).notNull().default("0"),
  // 加工費是否另加 5% 營業稅
  taxable: boolean("taxable").notNull().default(true),
  vendorWarehouseId: integer("vendor_warehouse_id").notNull(),
  // Open 進行中、Completed 成品已全數交回、Closed 已結案（剩料已處理）、Cancelled 已取消
  status: text("status").notNull().default("Open"),
  orderDate: text("order_date").notNull(),
  expectedDate: text("expected_date"),
  remarks: text("remarks"),
  materials: jsonb("materials").$type<SubcontractMaterial[]>().notNull().default([]),
  // 累計：已算進成品的材料成本、加工費（未稅）、結案時的損耗金額
  materialCost: numeric("material_cost", { precision: 14, scale: 2 }).notNull().default("0"),
  feeAmount: numeric("fee_amount", { precision: 14, scale: 2 }).notNull().default("0"),
  lossAmount: numeric("loss_amount", { precision: 14, scale: 2 }).notNull().default("0"),
  createdBy: text("created_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (t) => [
  uniqueIndex("subcontract_orders_number_unique").on(t.tenantId, t.orderNumber),
  index("subcontract_orders_supplier_idx").on(t.tenantId, t.supplierId),
]);

export type SubcontractOrder = typeof subcontractOrdersTable.$inferSelect;
