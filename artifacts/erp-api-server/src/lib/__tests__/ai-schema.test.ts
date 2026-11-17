import { describe, expect, it } from "vitest";
import { getTableColumns, getTableName, isTable } from "drizzle-orm";
import * as schema from "@workspace/erp-db/schema";
import { AI_FORBIDDEN_TABLES, AI_SCHEMA_PROMPT } from "../ai-schema";

/** 實際的資料表 → 欄位名稱（資料庫裡的 snake_case 名稱） */
const actual = new Map<string, Set<string>>();
for (const value of Object.values(schema)) {
  if (!isTable(value)) continue;
  actual.set(getTableName(value), new Set(Object.values(getTableColumns(value)).map((c: any) => c.name)));
}

/** 說明文件中宣告的資料表與欄位：每行開頭為「table (col, col, …)」 */
const declared = [...AI_SCHEMA_PROMPT.matchAll(/^([a-z_]+) \(([^)]+)\)\s*$/gm)]
  .map(match => ({ table: match[1], columns: match[2].split(",").map(c => c.trim()) }));

describe("AI 查詢助理的資料庫說明", () => {
  it("涵蓋銷售、採購、收付款、會計、製造與庫存的主要資料表", () => {
    const tables = declared.map(d => d.table);
    for (const table of [
      "customers", "suppliers", "items", "stock_entries", "quotations", "sales_orders", "delivery_notes",
      "purchase_orders", "purchase_receipts", "invoices", "vouchers", "invoice_settlements", "payment_requests",
      "accounts", "journal_entries", "bank_reconciliation_entries", "work_orders", "quality_inspections",
    ]) expect(tables, `缺少 ${table}`).toContain(table);
  });

  it("宣告的每一張表、每一個欄位都真的存在（表或欄位改名時這裡會失敗）", () => {
    const problems: string[] = [];
    for (const { table, columns } of declared) {
      const real = actual.get(table);
      if (!real) { problems.push(`資料表不存在：${table}`); continue; }
      for (const column of columns) if (!real.has(column)) problems.push(`${table}.${column} 不存在`);
    }
    expect(problems).toEqual([]);
  });

  it("不暴露敏感資料表與敏感欄位", () => {
    const tables = declared.map(d => d.table);
    for (const table of AI_FORBIDDEN_TABLES) expect(tables).not.toContain(table);
    for (const table of ["salary_slips", "tenants", "ai_actions"]) expect(tables).not.toContain(table);
    const columns = declared.flatMap(d => d.columns.map(c => `${d.table}.${c}`));
    for (const sensitive of ["payment_requests.bank_account", "bank_statements.account_number", "invoices.ecpay_buyer_email", "invoices.ecpay_response"]) {
      expect(columns).not.toContain(sensitive);
    }
  });

  it("單據狀態與系統實際使用的值一致", () => {
    // 銷貨單：營收只算這三種（與 auto-journal 的 REVENUE_ORDER_STATUSES 相同）
    for (const status of ["Confirmed", "To Deliver", "Completed"]) expect(AI_SCHEMA_PROMPT).toContain(status);
    expect(AI_SCHEMA_PROMPT).toContain("status IN ('Confirmed', 'To Deliver', 'Completed')");
    // 舊說明裡不存在的銷貨單狀態不能再出現在規則中
    expect(AI_SCHEMA_PROMPT).not.toMatch(/只納入 Submitted、Closed/);
    expect(AI_SCHEMA_PROMPT).not.toMatch(/sales_orders[^\n]*\n\s*-- status: Draft, Submitted, Closed/);
    for (const status of ["Unpaid", "WrittenOff", "Credit Note", "Debit Note", "To Receive", "In Progress", "Converted", "Unmatched"]) {
      expect(AI_SCHEMA_PROMPT).toContain(status);
    }
  });
});
