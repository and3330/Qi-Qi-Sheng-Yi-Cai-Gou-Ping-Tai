import { sql } from "drizzle-orm";
import { pgTable, serial, text, timestamp, integer, jsonb, boolean, uniqueIndex } from "drizzle-orm/pg-core";

/**
 * 畫面版面設定（老闆 2026-11-17：視覺化編輯，每個視窗、每張表格的內容都可以改）。
 * layoutKey 是視窗的名稱（例如「進貨單」）；config 記這個視窗改了什麼：
 *   title    視窗標題改叫什麼
 *   fields   表頭欄位：{ 原本的名稱: { label 改叫什麼, hidden 不顯示, order 順序 } }
 *   columns  明細表格的欄：同上
 *   labels   表單上的欄位名稱：{ 原本的名稱: 改叫什麼 }
 */
export interface UiLayoutItem { label?: string; hidden?: boolean; order?: number }
export interface UiLayoutConfig { title?: string; fields?: Record<string, UiLayoutItem>; columns?: Record<string, UiLayoutItem>; labels?: Record<string, string> }

export const uiLayoutsTable = pgTable("ui_layouts", {
  tenantId: integer("tenant_id").notNull().default(sql`(current_setting('app.tenant_id'::text))::integer`),
  id: serial("id").primaryKey(),
  layoutKey: text("layout_key").notNull(),
  config: jsonb("config").$type<UiLayoutConfig>().notNull().default(sql`'{}'::jsonb`),
  updatedBy: text("updated_by"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("ui_layouts_key_unique").on(t.tenantId, t.layoutKey)]);

/**
 * 收付款單模板：同一種收款或付款常常長一樣（每月房租、講師費、平台撥款…），
 * 先做成模板，新增單據時選模板就帶出預設的帳戶、專案、摘要行，還可以加這類單據才需要的自訂欄位。
 */
export interface VoucherTemplateField { name: string; label: string; type: "text" | "number" | "date" | "select"; options?: string[]; required?: boolean }
export interface VoucherTemplateConfig {
  description?: string;
  projectId?: number | null;
  departmentId?: number | null;
  cashAccountId?: number | null;
  lines?: Array<{ description: string; amount?: number | null }>;
  fields?: VoucherTemplateField[];
}

export const voucherTemplatesTable = pgTable("voucher_templates", {
  tenantId: integer("tenant_id").notNull().default(sql`(current_setting('app.tenant_id'::text))::integer`),
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  voucherType: text("voucher_type").notNull(),
  description: text("description"),
  config: jsonb("config").$type<VoucherTemplateConfig>().notNull().default(sql`'{}'::jsonb`),
  isActive: boolean("is_active").notNull().default(true),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export type UiLayout = typeof uiLayoutsTable.$inferSelect;
export type VoucherTemplate = typeof voucherTemplatesTable.$inferSelect;
