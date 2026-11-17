import { sql } from "drizzle-orm";
import { pgTable, text, serial, timestamp, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { assetsTable } from "./assets";
import { departmentsTable } from "./departments";

export const assetMovementsTable = pgTable("asset_movements", {
  tenantId: integer("tenant_id").notNull().default(sql`(current_setting('app.tenant_id'::text))::integer`),
  id: serial("id").primaryKey(),
  assetId: integer("asset_id").notNull().references(() => assetsTable.id),
  fromDepartmentId: integer("from_department_id").references(() => departmentsTable.id),
  toDepartmentId: integer("to_department_id").references(() => departmentsTable.id),
  fromLocation: text("from_location"),
  toLocation: text("to_location"),
  movementDate: text("movement_date").notNull(),
  reason: text("reason"),
  performedBy: text("performed_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertAssetMovementSchema = createInsertSchema(assetMovementsTable).omit({ id: true, createdAt: true });
export type InsertAssetMovement = z.infer<typeof insertAssetMovementSchema>;
export type AssetMovement = typeof assetMovementsTable.$inferSelect;
