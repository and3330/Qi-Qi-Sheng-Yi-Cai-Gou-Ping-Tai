import { describe, expect, it, vi } from "vitest";

vi.mock("@workspace/erp-db", () => ({ db: {}, journalEntriesTable: {}, invoicesTable: {}, salesOrdersTable: {}, accountsTable: {}, accountingSettingsTable: {} }));
vi.mock("@workspace/erp-db/schema", () => ({ journalEntriesTable: {}, invoicesTable: {}, salesOrdersTable: {}, accountsTable: {}, accountingSettingsTable: {} }));

import { resolveJournalLinesStrict } from "../auto-journal";

const fakeTx = (rows: Array<{ id: number; accountNumber: string; accountName: string; accountType: string }>) => ({
  execute: async () => ({ rows }),
});

describe("resolveJournalLinesStrict", () => {
  it("科目齊全時回傳帶 accountId 的明細", async () => {
    const tx = fakeTx([
      { id: 11, accountNumber: "1191", accountName: "應收帳款", accountType: "Asset" },
      { id: 41, accountNumber: "4111", accountName: "銷貨收入", accountType: "Income" },
    ]);
    const lines = await resolveJournalLinesStrict(tx, [
      { accountName: "應收帳款", debit: 100, credit: 0 },
      { accountName: "銷貨收入", debit: 0, credit: 100 },
    ]);
    expect(lines.map(l => l.accountId)).toEqual([11, 41]);
  });

  it("有金額的明細對不到科目時中止，並列出缺少的科目", async () => {
    const tx = fakeTx([{ id: 11, accountNumber: "1191", accountName: "應收帳款", accountType: "Asset" }]);
    await expect(resolveJournalLinesStrict(tx, [
      { accountName: "應收帳款", debit: 100, credit: 0 },
      { accountName: "銷貨收入", debit: 0, credit: 100 },
    ])).rejects.toThrow("會計科目表缺少科目：銷貨收入");
  });

  it("金額為 0 的明細不因缺科目而擋下", async () => {
    const tx = fakeTx([{ id: 11, accountNumber: "1191", accountName: "應收帳款", accountType: "Asset" }]);
    const lines = await resolveJournalLinesStrict(tx, [
      { accountName: "應收帳款", debit: 100, credit: 0 },
      { accountName: "代扣款項", debit: 0, credit: 0 },
    ]);
    expect(lines).toHaveLength(2);
  });
});
