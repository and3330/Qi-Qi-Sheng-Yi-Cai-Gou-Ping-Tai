import { boolean, index, integer, numeric, pgTable, serial, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
export const erpBomsTable = pgTable("erp_boms", {
  id: serial("id").primaryKey(), productId: integer("product_id").notNull(), name: text("name").notNull(),
  version: text("version").notNull().default("1.0"), isActive: boolean("is_active").notNull().default(true), notes: text("notes"),
});
export const erpBomLinesTable = pgTable("erp_bom_lines", {
  id: serial("id").primaryKey(), bomId: integer("bom_id").notNull().references(() => erpBomsTable.id, { onDelete: "cascade" }),
  componentProductId: integer("component_product_id").notNull(), quantity: numeric("quantity", { mode: "number" }).notNull(),
  unit: text("unit").notNull().default("個"), notes: text("notes"),
}, t => [index("idx_erp_bom_lines_bom").on(t.bomId)]);
export const erpWorkstationsTable = pgTable("erp_workstations", {
  id: serial("id").primaryKey(), name: text("name").notNull(), code: text("code").notNull(),
  capacityPerDay: numeric("capacity_per_day", { mode: "number" }), notes: text("notes"), isActive: boolean("is_active").notNull().default(true),
}, t => [uniqueIndex("uq_erp_workstations_code").on(t.code)]);
export const erpWorkOrdersTable = pgTable("erp_work_orders", {
  id: serial("id").primaryKey(), workOrderNo: text("work_order_no").notNull(), bomId: integer("bom_id"),
  productId: integer("product_id").notNull(), quantity: numeric("quantity", { mode: "number" }).notNull(),
  status: text("status").notNull().default("draft"), workstationId: integer("workstation_id"),
  plannedStartDate: text("planned_start_date"), plannedEndDate: text("planned_end_date"),
  actualStartAt: timestamp("actual_start_at", { withTimezone: true }), actualEndAt: timestamp("actual_end_at", { withTimezone: true }),
  notes: text("notes"), createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, t => [uniqueIndex("uq_erp_work_orders_no").on(t.workOrderNo), index("idx_erp_work_orders_status").on(t.status)]);
export const erpProductionPlansTable = pgTable("erp_production_plans", {
  id: serial("id").primaryKey(), period: text("period").notNull(), productId: integer("product_id").notNull(),
  plannedQuantity: numeric("planned_quantity", { mode: "number" }).notNull(), notes: text("notes"),
}, t => [uniqueIndex("uq_erp_production_plans_period_product").on(t.period, t.productId)]);