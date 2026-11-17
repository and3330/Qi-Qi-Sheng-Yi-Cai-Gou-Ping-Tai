import { pgTable, text, serial, integer, timestamp, boolean } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

/** 各租戶寄信設定（每租戶一筆） */
export const emailSettingsTable = pgTable("email_settings", {
  tenantId: integer("tenant_id").notNull().primaryKey()
    .default(sql`(current_setting('app.tenant_id'::text))::integer`),
  /** 寄件顯示名稱，例如「育邦文化教育科技」 */
  senderName: text("sender_name").notNull().default(""),
  /** 回覆信箱（客戶按回覆時寄到這裡） */
  replyTo: text("reply_to"),
  /** 匯款帳戶資訊（多行文字，附在發票通知信中） */
  bankInfo: text("bank_info").notNull().default(""),
  /** 開立發票後自動寄通知信給客戶 */
  autoSendInvoice: boolean("auto_send_invoice").notNull().default(false),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

/** 寄信紀錄 */
export const emailLogsTable = pgTable("email_logs", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").notNull()
    .default(sql`(current_setting('app.tenant_id'::text))::integer`),
  /** quotation | sales_order | invoice */
  docType: text("doc_type").notNull(),
  docId: integer("doc_id").notNull(),
  recipient: text("recipient").notNull(),
  subject: text("subject").notNull(),
  /** sent | failed */
  status: text("status").notNull(),
  error: text("error"),
  /** manual | auto */
  trigger: text("trigger").notNull().default("manual"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type EmailSettings = typeof emailSettingsTable.$inferSelect;
export type EmailLog = typeof emailLogsTable.$inferSelect;
