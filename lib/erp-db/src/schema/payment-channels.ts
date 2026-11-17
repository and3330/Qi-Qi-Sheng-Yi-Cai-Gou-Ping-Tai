import { sql } from "drizzle-orm";
import { pgTable, text, serial, timestamp, integer, numeric, boolean, jsonb, uniqueIndex, index } from "drizzle-orm/pg-core";

/**
 * 金流通路（藍新、綠界、Stripe、Airwallex、和潤、中租…）。
 * 客人付款時錢是先進到通路，通路過幾天才把「一批訂單加總、扣掉手續費」的錢撥進公司銀行。
 * 所以訂單進來時先記成「通路欠我們的錢」，撥款進來再逐筆沖掉，銀行帳才對得上存摺。
 */
export const paymentChannelsTable = pgTable("payment_channels", {
  tenantId: integer("tenant_id").notNull().default(sql`(current_setting('app.tenant_id'::text))::integer`),
  id: serial("id").primaryKey(),
  code: text("code").notNull(),
  name: text("name").notNull(),
  // 外部訂單的付款方式（payments[].method）寫成哪些字，算是這個通路；一律小寫
  methods: jsonb("methods").$type<string[]>().notNull().default([]),
  // 通路欠款記在哪個科目（資產類明細科目，例如「應收帳款-綠界」）
  receivableAccountId: integer("receivable_account_id").notNull(),
  // 手續費記在哪個費用科目；沒設定用科目表的「金流手續費」
  feeAccountId: integer("fee_account_id"),
  // 撥款通常進哪個銀行帳戶（沖銷時可以改）
  bankAccountId: integer("bank_account_id"),
  // 從哪一天起的訂單改用「先掛通路欠款」的記法；沒填＝還沒啟用，維持直接記銀行收款
  startDate: text("start_date"),
  isActive: boolean("is_active").notNull().default(true),
  note: text("note"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("payment_channels_code_unique").on(t.tenantId, t.code),
]);

/** 通路欠款明細：每一筆經由通路收的錢（退款是負數）。payoutId 有值代表已經被某一次撥款沖掉 */
export const channelReceivablesTable = pgTable("channel_receivables", {
  tenantId: integer("tenant_id").notNull().default(sql`(current_setting('app.tenant_id'::text))::integer`),
  id: serial("id").primaryKey(),
  channelId: integer("channel_id").notNull(),
  // order 訂單收款、refund 退款、topup 會員儲值
  kind: text("kind").notNull().default("order"),
  sourceId: integer("source_id"),
  eventId: integer("event_id"),
  salesOrderId: integer("sales_order_id"),
  orderNumber: text("order_number"),
  // 對撥款明細用的編號：外部網站的訂單編號
  externalRef: text("external_ref").notNull(),
  entryDate: text("entry_date").notNull(),
  // 通路欠我們的金額（全額，還沒扣手續費）；退款是負數
  amount: numeric("amount", { precision: 14, scale: 2 }).notNull(),
  // 來源網站回報的手續費，只拿來跟實際扣的比對，不入帳
  expectedFee: numeric("expected_fee", { precision: 14, scale: 2 }),
  projectId: integer("project_id"),
  departmentId: integer("department_id"),
  payoutId: integer("payout_id"),
  // 撥款時實際被扣的手續費
  settledFee: numeric("settled_fee", { precision: 14, scale: 2 }),
  settledAt: timestamp("settled_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("channel_receivables_open_idx").on(t.tenantId, t.channelId, t.payoutId),
  index("channel_receivables_ref_idx").on(t.tenantId, t.channelId, t.externalRef),
]);

/** 一次撥款：通路把一批訂單的錢扣掉手續費後匯進銀行 */
export const channelPayoutsTable = pgTable("channel_payouts", {
  tenantId: integer("tenant_id").notNull().default(sql`(current_setting('app.tenant_id'::text))::integer`),
  id: serial("id").primaryKey(),
  payoutNumber: text("payout_number").notNull(),
  channelId: integer("channel_id").notNull(),
  payoutDate: text("payout_date").notNull(),
  bankAccountId: integer("bank_account_id").notNull(),
  // 沖掉的欠款合計、逐筆手續費合計、不屬於任何訂單的其他費用、實際進銀行的金額
  grossAmount: numeric("gross_amount", { precision: 14, scale: 2 }).notNull(),
  feeAmount: numeric("fee_amount", { precision: 14, scale: 2 }).notNull().default("0"),
  extraFee: numeric("extra_fee", { precision: 14, scale: 2 }).notNull().default("0"),
  bankAmount: numeric("bank_amount", { precision: 14, scale: 2 }).notNull(),
  lineCount: integer("line_count").notNull().default(0),
  reference: text("reference"),
  note: text("note"),
  journalEntryIds: jsonb("journal_entry_ids").$type<number[]>().notNull().default([]),
  // Posted 已入帳、Voided 已作廢（分錄已沖回，欠款重新變成未撥）
  status: text("status").notNull().default("Posted"),
  createdBy: text("created_by"),
  voidedBy: text("voided_by"),
  voidedAt: timestamp("voided_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("channel_payouts_number_unique").on(t.tenantId, t.payoutNumber),
  index("channel_payouts_channel_idx").on(t.tenantId, t.channelId),
]);

export type PaymentChannel = typeof paymentChannelsTable.$inferSelect;
export type ChannelReceivable = typeof channelReceivablesTable.$inferSelect;
export type ChannelPayout = typeof channelPayoutsTable.$inferSelect;
