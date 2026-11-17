import { sql } from "drizzle-orm";
import { pgTable, text, serial, timestamp, integer, jsonb, uniqueIndex } from "drizzle-orm/pg-core";

export interface RfqItem { itemId: number | null; itemName: string; quantity: number; unit: string | null }
/** 一家供應商的報價。prices 的順序對應詢價單的品項順序；沒報的品項是 null */
export interface RfqQuote {
  supplierId: number;
  supplierName: string;
  quotedAt: string;
  currency: string;
  /** 外幣報價換成台幣的匯率（台幣為 1），比價時統一換成台幣 */
  exchangeRate: number;
  leadDays: number | null;
  validUntil: string | null;
  note: string | null;
  prices: Array<number | null>;
}

/**
 * 詢價單：同一批東西問幾家供應商，把各家報價放在一起比，選定後直接轉成採購單。
 * 狀態：Open 詢價中、Awarded 已選定（已轉採購單）、Cancelled 已取消
 */
export const rfqsTable = pgTable("rfqs", {
  tenantId: integer("tenant_id").notNull().default(sql`(current_setting('app.tenant_id'::text))::integer`),
  id: serial("id").primaryKey(),
  rfqNumber: text("rfq_number").notNull(),
  rfqDate: text("rfq_date").notNull(),
  dueDate: text("due_date"),
  title: text("title"),
  status: text("status").notNull().default("Open"),
  items: jsonb("items").$type<RfqItem[]>().notNull().default([]),
  quotes: jsonb("quotes").$type<RfqQuote[]>().notNull().default([]),
  projectId: integer("project_id"),
  departmentId: integer("department_id"),
  awardedSupplierId: integer("awarded_supplier_id"),
  purchaseOrderId: integer("purchase_order_id"),
  notes: text("notes"),
  createdBy: text("created_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (t) => [
  uniqueIndex("rfqs_number_unique").on(t.tenantId, t.rfqNumber),
]);

export type Rfq = typeof rfqsTable.$inferSelect;
