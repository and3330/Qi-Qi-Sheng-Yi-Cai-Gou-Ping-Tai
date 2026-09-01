import { index, integer, pgTable, serial, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
export const erpInspectionsTable = pgTable("erp_inspections", {
  id: serial("id").primaryKey(), inspectionNo: text("inspection_no").notNull(), type: text("type").notNull().default("incoming"),
  refType: text("ref_type").notNull().default("other"), refId: integer("ref_id"), productId: integer("product_id").notNull(),
  sampleSize: integer("sample_size").notNull().default(0), passedQty: integer("passed_qty").notNull().default(0),
  failedQty: integer("failed_qty").notNull().default(0), result: text("result").notNull().default("pass"),
  inspectorId: integer("inspector_id"), inspectedAt: timestamp("inspected_at", { withTimezone: true }).notNull().defaultNow(), notes: text("notes"),
}, t => [uniqueIndex("uq_erp_inspections_no").on(t.inspectionNo)]);
export const erpNonconformancesTable = pgTable("erp_nonconformances", {
  id: serial("id").primaryKey(), ncNo: text("nc_no").notNull(), inspectionId: integer("inspection_id"), productId: integer("product_id"),
  description: text("description").notNull(), severity: text("severity").notNull().default("minor"),
  status: text("status").notNull().default("open"), disposition: text("disposition"),
  closedAt: timestamp("closed_at", { withTimezone: true }),
}, t => [uniqueIndex("uq_erp_nonconformances_no").on(t.ncNo), index("idx_erp_nonconformances_status").on(t.status)]);
export const erpCapasTable = pgTable("erp_capas", {
  id: serial("id").primaryKey(), capaNo: text("capa_no").notNull(), nonconformanceId: integer("nonconformance_id"),
  type: text("type").notNull().default("corrective"), rootCause: text("root_cause").notNull(),
  actionPlan: text("action_plan").notNull(), ownerId: integer("owner_id"), dueDate: text("due_date"),
  status: text("status").notNull().default("open"), verifiedAt: timestamp("verified_at", { withTimezone: true }),
}, t => [uniqueIndex("uq_erp_capas_no").on(t.capaNo), index("idx_erp_capas_status").on(t.status)]);