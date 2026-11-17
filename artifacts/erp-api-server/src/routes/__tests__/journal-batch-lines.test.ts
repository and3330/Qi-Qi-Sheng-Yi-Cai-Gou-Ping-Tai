import { describe, expect, it, vi } from "vitest";

vi.mock("@workspace/erp-db", () => ({ db: {}, journalEntriesTable: {}, accountsTable: {}, activitiesTable: {}, projectsTable: {}, departmentsTable: {}, vouchersTable: {}, accountingSettingsTable: {} }));

import { buildBatchEntryLines } from "../journal-entries";

const bank = { id: 1, name: "銀行存款" };
const fee = { id: 2, name: "手續費" };
const ar = { id: 3, name: "應收帳款" };
const sum = (lines: { debit: number; credit: number }[], k: "debit" | "credit") => lines.reduce((s, l) => s + l[k], 0);

describe("一張單多筆：每行拆成借貸平衡的分錄", () => {
  it("收款扣手續費：借 銀行 實收、借 手續費／貸 應收 全額", () => {
    const lines = buildBatchEntryLines("receipt", bank, fee, ar, { party: "王小明", amount: 10000, fee: 15, summary: "11 月學費" });
    expect(lines.map(l => [l.accountName, l.debit, l.credit])).toEqual([["銀行存款", 9985, 0], ["手續費", 15, 0], ["應收帳款", 0, 10000]]);
    expect(sum(lines, "debit")).toBe(sum(lines, "credit"));
    expect(lines[0].description).toBe("王小明｜11 月學費");
  });

  it("付款含手續費：借 對方科目＋手續費／貸 銀行 合計", () => {
    const lines = buildBatchEntryLines("payment", bank, fee, ar, { party: "", amount: 500, fee: 30, summary: "" });
    expect(lines.map(l => [l.accountName, l.debit, l.credit])).toEqual([["應收帳款", 500, 0], ["手續費", 30, 0], ["銀行存款", 0, 530]]);
    expect(lines[0]).not.toHaveProperty("description");
  });

  it("沒有手續費就只有兩行", () => {
    expect(buildBatchEntryLines("receipt", bank, null, ar, { party: "A", amount: 100, fee: 0, summary: "x" })).toHaveLength(2);
  });
});
