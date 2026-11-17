import { sql } from "drizzle-orm";
import { pgTable, serial, text, timestamp, integer, jsonb } from "drizzle-orm/pg-core";

/**
 * 異動申請（老闆 2026-11-16）：已過帳的單據要修改、要刪除，或關帳月份要解鎖，都先送這張申請，
 * 財務或超級管理員其中一人核准後系統才執行；財務自己送的交給超級管理員。
 * kind：unlock 解鎖月份／delete 刪除單據／edit 修改單據
 * targetType：period（關帳日）、journal_entry、voucher、invoice…；payload 放要套用的內容（解鎖的新關帳日、修改後的欄位）
 */
export const changeRequestsTable = pgTable("change_requests", {
  tenantId: integer("tenant_id").notNull().default(sql`(current_setting('app.tenant_id'::text))::integer`),
  id: serial("id").primaryKey(),
  requestNumber: text("request_number").notNull(),
  kind: text("kind").notNull(),
  targetType: text("target_type").notNull(),
  targetId: integer("target_id"),
  targetNumber: text("target_number"),
  title: text("title").notNull(),
  payload: jsonb("payload").notNull().default(sql`'{}'::jsonb`),
  original: jsonb("original"),
  reason: text("reason").notNull().default(""),
  requestedBy: text("requested_by").notNull(),
  requestedRole: text("requested_role"),
  status: text("status").notNull().default("Pending"),
  result: text("result"),
  appliedAt: timestamp("applied_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type ChangeRequest = typeof changeRequestsTable.$inferSelect;
