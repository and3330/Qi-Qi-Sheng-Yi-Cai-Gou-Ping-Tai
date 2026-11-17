import { sql } from "drizzle-orm";
import { pgTable, text, serial, timestamp, integer, numeric, json, uniqueIndex, index } from "drizzle-orm/pg-core";

/**
 * 歷史單據：從舊系統（Ecount）搬過來、只供查詢的單據。
 * 這些單據不參與現在的庫存、應收應付與自動分錄（帳的部分另外由會計傳票搬入），
 * 所以放在獨立的表，不會被現行流程重複入帳或重複扣庫存。明細照舊系統的欄位原樣保存。
 */
export const legacyDocumentsTable = pgTable("legacy_documents", {
  tenantId: integer("tenant_id").notNull().default(sql`(current_setting('app.tenant_id'::text))::integer`),
  id: serial("id").primaryKey(),
  source: text("source").notNull().default("ecount"),
  // 舊系統的報表名稱，例如「銷貨單」「進貨單」「報價單」
  docType: text("doc_type").notNull(),
  docNumber: text("doc_number").notNull(),
  docDate: text("doc_date"),
  partyName: text("party_name"),
  projectName: text("project_name"),
  staffName: text("staff_name"),
  total: numeric("total", { precision: 16, scale: 2 }),
  lineCount: integer("line_count").notNull().default(0),
  // 搜尋用：品項名稱、摘要等文字
  searchText: text("search_text"),
  // 用 json 而不是 jsonb：要保留舊系統原本的欄位順序
  lines: json("lines").$type<Array<Record<string, string>>>().notNull().default([]),
  // 搬進來之後補的備註（歷史單的內容不能改，但可以補說明）
  note: text("note"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("legacy_documents_unique").on(t.tenantId, t.source, t.docType, t.docNumber),
  index("legacy_documents_type_date_idx").on(t.tenantId, t.docType, t.docDate),
  index("legacy_documents_party_idx").on(t.tenantId, t.partyName),
]);

export type LegacyDocument = typeof legacyDocumentsTable.$inferSelect;
