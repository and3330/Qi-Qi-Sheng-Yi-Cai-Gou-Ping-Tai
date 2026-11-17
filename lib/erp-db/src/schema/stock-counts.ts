import { sql } from "drizzle-orm";
import { pgTable, text, serial, timestamp, integer, jsonb, uniqueIndex } from "drizzle-orm/pg-core";

export interface StockCountLine {
  itemId: number;
  itemCode: string;
  itemName: string;
  /** 開單當下系統帳上的數量 */
  systemQty: number;
  /** 實際點到的數量；還沒點的品項是 null，過帳時不調整 */
  countedQty: number | null;
  unitCost: number;
}

/**
 * 盤點單：開單時把帳上數量存下來，現場填實盤數量，過帳時依差異自動產生盤盈、盤損的庫存異動與分錄。
 */
export const stockCountsTable = pgTable("stock_counts", {
  tenantId: integer("tenant_id").notNull().default(sql`(current_setting('app.tenant_id'::text))::integer`),
  id: serial("id").primaryKey(),
  countNumber: text("count_number").notNull(),
  warehouseId: integer("warehouse_id").notNull(),
  countDate: text("count_date").notNull(),
  // warehouse：帳上數量取這間倉庫的數量；total：取品項主檔的全公司合計
  basis: text("basis").notNull().default("warehouse"),
  // 盤盈、盤損歸屬的專案
  projectId: integer("project_id").notNull(),
  // Draft 盤點中、Posted 已過帳、Cancelled 已取消
  status: text("status").notNull().default("Draft"),
  lines: jsonb("lines").$type<StockCountLine[]>().notNull().default([]),
  remarks: text("remarks"),
  createdBy: text("created_by"),
  postedBy: text("posted_by"),
  postedAt: timestamp("posted_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("stock_counts_number_unique").on(t.tenantId, t.countNumber),
]);

export type StockCount = typeof stockCountsTable.$inferSelect;
