import { sql } from "drizzle-orm";
import { pgTable, text, serial, timestamp, integer, numeric, boolean, jsonb, uniqueIndex, index } from "drizzle-orm/pg-core";

/**
 * 外部系統串接（CM生活+、AI 大學、ICTA PRO…）。
 * 所有外部網站都用同一種格式把單據送進「收件匣」，再依對應表歸到專案、部門、科目與品項。
 * 新增一個網站只要新增來源與對應設定，不用再為它寫一支同步程式。
 */

/** 來源：一個外部網站或系統 */
export const integrationSourcesTable = pgTable("integration_sources", {
  tenantId: integer("tenant_id").notNull().default(sql`(current_setting('app.tenant_id'::text))::integer`),
  id: serial("id").primaryKey(),
  // 外部系統送資料時用的代號，例如 cm-life、ai-university、icta-pro
  code: text("code").notNull(),
  name: text("name").notNull(),
  // 綁定的 API 金鑰：有設定時，只有這把金鑰可以替這個來源送資料
  apiKeyId: integer("api_key_id"),
  // 沒有對應到更細的規則時，用這裡的預設值
  defaultProjectId: integer("default_project_id"),
  defaultDepartmentId: integer("default_department_id"),
  // 錢進到哪個現金或銀行科目（金流撥款的帳戶）
  defaultCashAccountId: integer("default_cash_account_id"),
  isActive: boolean("is_active").notNull().default(true),
  note: text("note"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("integration_sources_code_unique").on(t.tenantId, t.code),
]);

/** 對應表：這個來源的哪一種訂單，歸到哪個專案、部門、收入科目 */
export const integrationMappingsTable = pgTable("integration_mappings", {
  tenantId: integer("tenant_id").notNull().default(sql`(current_setting('app.tenant_id'::text))::integer`),
  id: serial("id").primaryKey(),
  sourceId: integer("source_id").notNull(),
  // 外部系統的類型：訂單類型（product、course…）、費用類別（ad、tool…）、報酬類別
  externalType: text("external_type").notNull(),
  label: text("label"),
  projectId: integer("project_id"),
  departmentId: integer("department_id"),
  // 收入科目；沒設定時實體商品記銷貨收入、其他記勞務收入
  revenueAccountId: integer("revenue_account_id"),
  // 費用類的單據記到哪個費用科目
  expenseAccountId: integer("expense_account_id"),
  // 這一類訂單沒有對到品項時用的預設品項（通常是一個「服務」品項）
  defaultItemId: integer("default_item_id"),
  // 這一類訂單要用哪個銷貨訂單模組（居家、活動、課程…）。沒設定＝不套模組
  templateId: integer("template_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("integration_mappings_unique").on(t.tenantId, t.sourceId, t.externalType),
]);

/** 品項對應：外部系統的商品編號 → ERP 的品項（對得到才會扣庫存） */
export const integrationItemMapsTable = pgTable("integration_item_maps", {
  tenantId: integer("tenant_id").notNull().default(sql`(current_setting('app.tenant_id'::text))::integer`),
  id: serial("id").primaryKey(),
  sourceId: integer("source_id").notNull(),
  externalSku: text("external_sku").notNull(),
  externalName: text("external_name"),
  itemId: integer("item_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("integration_item_maps_unique").on(t.tenantId, t.sourceId, t.externalSku),
]);

/** 處理結果：這筆外部單據在 ERP 產生了哪些東西 */
export interface IntegrationResult {
  serviceFeeId?: number;
  serviceFeeNumber?: string;
  assetId?: number;
  salesOrderId?: number;
  salesOrderNumber?: string;
  journalEntryNumbers?: string[];
  customerId?: number;
  storedValueBalance?: number;
  summary?: string;
}

/**
 * 收件匣：外部系統送來的每一筆單據。
 * 同一個來源、同一種單據、同一個外部編號只會收一次，重送不會重複入帳。
 */
export const integrationEventsTable = pgTable("integration_events", {
  tenantId: integer("tenant_id").notNull().default(sql`(current_setting('app.tenant_id'::text))::integer`),
  id: serial("id").primaryKey(),
  sourceId: integer("source_id").notNull(),
  // order 訂單、stored_value 儲值、refund 退款、expense 費用、payout 人員報酬、asset_movement 資產異動
  kind: text("kind").notNull(),
  externalId: text("external_id").notNull(),
  occurredAt: text("occurred_at").notNull(),
  payload: jsonb("payload").notNull(),
  // pending 待處理、processed 已入帳、failed 失敗（可重試）、ignored 已略過
  status: text("status").notNull().default("pending"),
  error: text("error"),
  result: jsonb("result").$type<IntegrationResult | null>(),
  attempts: integer("attempts").notNull().default(0),
  amount: numeric("amount", { precision: 14, scale: 2 }).notNull().default("0"),
  summary: text("summary"),
  receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
  processedAt: timestamp("processed_at", { withTimezone: true }),
  processedBy: text("processed_by"),
}, (t) => [
  uniqueIndex("integration_events_unique").on(t.tenantId, t.sourceId, t.kind, t.externalId),
  index("integration_events_status_idx").on(t.tenantId, t.status),
]);

/**
 * 會員儲值金明細。儲值是「先收了錢、還沒給東西」，帳上是負債（預收款項），不是收入；
 * 會員拿餘額買東西時才轉成收入。每位會員的餘額＝這張表的加總。
 */
export const storedValueLedgerTable = pgTable("stored_value_ledger", {
  tenantId: integer("tenant_id").notNull().default(sql`(current_setting('app.tenant_id'::text))::integer`),
  id: serial("id").primaryKey(),
  sourceId: integer("source_id").notNull(),
  customerId: integer("customer_id").notNull(),
  // 儲值是正數、消費與退款是負數
  amount: numeric("amount", { precision: 14, scale: 2 }).notNull(),
  // topup 儲值、spend 消費、refund 退還儲值金、adjust 調整
  entryType: text("entry_type").notNull(),
  eventId: integer("event_id"),
  entryDate: text("entry_date").notNull(),
  note: text("note"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("stored_value_ledger_customer_idx").on(t.tenantId, t.sourceId, t.customerId),
]);

export type IntegrationSource = typeof integrationSourcesTable.$inferSelect;
export type IntegrationMapping = typeof integrationMappingsTable.$inferSelect;
export type IntegrationEvent = typeof integrationEventsTable.$inferSelect;
