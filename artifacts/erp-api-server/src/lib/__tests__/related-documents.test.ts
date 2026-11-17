import { describe, expect, it } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import { isDocType, relatedDocuments } from "../related-documents";

/**
 * 用一個假的資料庫測單據鏈：報價單 1 → 銷貨單 10 → 出貨單 20 → 銷貨退回 30；
 * 銷貨單 10 另有發票 40，發票 40 有付款申請 50 和收款單 60。
 */
const dialect = new PgDialect();
function fakeDb() {
  const log: string[] = [];
  const answer = (text: string, params: unknown[]): any[] => {
    const id = Number(params[0]);
    const pointer = (table: string, column: string, map: Record<number, number>) =>
      text.includes(`SELECT ${column} AS id FROM ${table} `) ? (map[id] ? [{ id: map[id] }] : []) : null;
    const children = (table: string, column: string, map: Record<number, number[]>) =>
      text.includes(`SELECT id FROM ${table} WHERE ${column} =`) ? (map[id] ?? []).map(i => ({ id: i })) : null;
    const hit =
      pointer("sales_orders", "quotation_id", { 10: 1 }) ?? pointer("delivery_notes", "sales_order_id", { 20: 10 }) ??
      pointer("sales_returns", "delivery_note_id", { 30: 20 }) ?? pointer("invoices", "sales_order_id", { 40: 10 }) ??
      children("sales_orders", "quotation_id", { 1: [10] }) ?? children("delivery_notes", "sales_order_id", { 10: [20] }) ??
      children("invoices", "sales_order_id", { 10: [40] }) ?? children("sales_returns", "delivery_note_id", { 20: [30] }) ??
      children("payment_requests", "invoice_id", { 40: [50] });
    if (hit) return hit;
    if (text.includes("FROM invoice_settlements WHERE invoice_id")) return id === 40 ? [{ id: 60 }] : [];
    if (text.includes("FROM journal_entries WHERE entry_number ~")) return String(params[0]).includes("DN") && String(params[0]).includes("20") ? [{ id: 900 }] : [];
    if (text.includes("FROM journal_entries")) return [
      { id: 900, entry_number: "JE-12345678-DN20", entry_date: "2026-11-01", status: "Posted", total_debit: "500.00" },
      { id: 901, entry_number: "JE-R900-123456", entry_date: "2026-11-02", status: "Posted", total_debit: "500.00" },
    ];
    if (text.includes("cogs_journal_entry_id FROM delivery_notes")) return [{ cogs_journal_entry_id: null }];
    // describe()：照 id 清單回單頭
    const m = /FROM (\w+) WHERE id IN/.exec(text);
    if (m) return params.map(p => ({ id: Number(p), number: `${m[1]}-${p}`, date: "2026-11-01", status: "Completed", amount: "100", kind: m[1] === "invoices" ? "Sales" : m[1] === "vouchers" ? "Receipt" : null }));
    return [];
  };
  return {
    log,
    execute: async (q: any) => {
      const { sql: text, params } = dialect.sqlToQuery(q);
      const flat = text.replace(/\s+/g, " ");
      log.push(flat);
      return { rows: answer(flat, params) };
    },
  };
}

describe("relatedDocuments", () => {
  it("只認得列出來的單據種類", () => {
    expect(isDocType("delivery_note")).toBe(true);
    expect(isDocType("journal_entries; drop")).toBe(false);
    expect(isDocType("toString")).toBe(false);
  });

  it("出貨單：往上追到銷貨單和報價單，往下找到退回，並列出分錄和沖銷分錄", async () => {
    const list = await relatedDocuments(fakeDb(), "delivery_note", 20, true);
    expect(list.filter(d => d.group === "source").map(d => `${d.type}:${d.id}`)).toEqual(["sales_order:10", "quotation:1"]);
    expect(list.filter(d => d.group === "next").map(d => `${d.type}:${d.id}`)).toEqual(["sales_return:30"]);
    expect(list.filter(d => d.group === "entry").map(d => d.label)).toEqual(["分錄", "沖銷分錄"]);
    expect(list.find(d => d.type === "sales_order")?.href).toBe("/sales/orders/10");
    expect(list.find(d => d.type === "sales_return")?.href).toBe("/sales/returns?open=30");
  });

  it("銷貨單：後續單據一路往下（出貨、退回、發票、付款申請、收款單），同一張不重複", async () => {
    const list = await relatedDocuments(fakeDb(), "sales_order", 10, false);
    expect(list.filter(d => d.group === "source").map(d => d.type)).toEqual(["quotation"]);
    expect(list.filter(d => d.group === "next").map(d => `${d.type}:${d.id}`).sort()).toEqual(
      ["delivery_note:20", "invoice:40", "payment_request:50", "sales_return:30", "voucher:60"]);
    expect(list.find(d => d.type === "invoice")?.label).toBe("銷售發票");
    expect(list.find(d => d.type === "voucher")?.label).toBe("收款單");
    expect(list.some(d => d.group === "entry")).toBe(false);
  });

  it("非財務角色不查分錄", async () => {
    const db = fakeDb();
    await relatedDocuments(db, "delivery_note", 20, false);
    expect(db.log.some(q => q.includes("journal_entries"))).toBe(false);
  });
});
