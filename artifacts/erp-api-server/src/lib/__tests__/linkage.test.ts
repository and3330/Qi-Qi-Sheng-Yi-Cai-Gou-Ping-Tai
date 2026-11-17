import { describe, expect, it, vi } from "vitest";

vi.mock("@workspace/erp-db", () => ({
  db: {}, journalEntriesTable: {}, invoicesTable: {}, salesOrdersTable: {}, accountsTable: {}, accountingSettingsTable: {},
  bankStatementsTable: {}, bankReconciliationEntriesTable: {}, vouchersTable: {},
}));
vi.mock("@workspace/erp-db/schema", () => ({
  journalEntriesTable: { __name: "journal_entries" }, invoicesTable: {}, salesOrdersTable: {}, accountsTable: {},
  accountingSettingsTable: { __name: "accounting_settings" }, qualityInspectionsTable: {}, qualityInspectionTemplatesTable: {},
}));
vi.mock("../../middleware/require-auth", () => ({
  requireAuth: (_req: unknown, _res: unknown, next: () => void) => next(),
  requireRole: () => (_req: unknown, _res: unknown, next: () => void) => next(),
  sessionOnly: (_req: unknown, _res: unknown, next: () => void) => next(),
}));
vi.mock("../../middleware/multer-error", () => ({ UploadRejectedError: class extends Error {} }));

import { selectAccountingBaseline } from "../accounting-baseline";
import { resolveJournalLines } from "../auto-journal";
import { itemUnitCost, nextMovingAvgCost, postAutoJournal, todayTaipei, workOrderWipBalance } from "../inventory-journal";
import { blockingInspections, itemsMissingInspection } from "../quality-gate";
import { bankEntryJournalLines } from "../../routes/bank-reconciliation";

const baselineLeafRows = () => selectAccountingBaseline("generic")
  .filter(a => !a.isGroup)
  .map((a, i) => ({ id: i + 1, accountNumber: a.code, accountName: a.displayName, accountType: a.accountType }));

/** 假交易：科目查詢回傳通用基線；分錄加總回傳指定金額；記下寫入的分錄 */
function fakeTx(opts: { lockDate?: string | null; sums?: Record<string, number>; accountRows?: any[] } = {}) {
  const inserted: any[] = [];
  const tx = {
    inserted,
    select: () => ({ from: () => ({ limit: async () => [{ lockDate: opts.lockDate ?? null }] }) }),
    execute: async (query: any) => {
      const text = JSON.stringify(query);
      if (text.includes("journal_entries")) {
        const key = Object.keys(opts.sums || {}).find(k => text.includes(`-${k}%`));
        return { rows: [{ total: key ? opts.sums![key] : 0 }] };
      }
      return { rows: opts.accountRows ?? baselineLeafRows() };
    },
    insert: () => ({ values: (v: any) => ({ returning: async () => { inserted.push(v); return [{ id: inserted.length, ...v }]; } }) }),
  };
  return tx;
}

describe("製造與庫存調整的科目", () => {
  it("通用科目表有專用的在製品、製成品、盤盈、盤損科目", async () => {
    const tx = { execute: async () => ({ rows: baselineLeafRows() }) };
    const resolved = await resolveJournalLines(tx, ["在製品", "製成品", "存貨盤盈", "存貨盤損"].map(accountName => ({ accountName, debit: 0, credit: 0 })));
    expect(resolved.map(l => l.accountName)).toEqual(["在製品", "製成品", "存貨盤盈", "存貨盤損"]);
    expect(resolved.every(l => l.accountId)).toBe(true);
  });

  it("科目表沒有專用科目時退回存貨／銷貨成本，不會卡住單據", async () => {
    const rows = [
      { id: 1, accountNumber: "1221", accountName: "商品存貨", accountType: "Asset" },
      { id: 2, accountNumber: "5111", accountName: "銷貨成本", accountType: "Expense" },
    ];
    const resolved = await resolveJournalLines({ execute: async () => ({ rows }) }, ["在製品", "製成品", "存貨盤損"].map(accountName => ({ accountName, debit: 0, credit: 0 })));
    expect(resolved.map(l => l.accountId)).toEqual([1, 1, 2]);
  });
});

describe("成本計算", () => {
  it("單位成本以移動平均優先，沒有時用進價", () => {
    expect(itemUnitCost({ movingAvgCost: "12.5", buyingPrice: "10" })).toBe(12.5);
    expect(itemUnitCost({ movingAvgCost: "0", buyingPrice: "10" })).toBe(10);
    expect(itemUnitCost(null)).toBe(0);
  });

  it("入庫後移動平均為加權平均；原庫存為零或負時採用本次成本", () => {
    expect(nextMovingAvgCost(10, 100, 10, 2000)).toBe(150);
    expect(nextMovingAvgCost(0, 100, 5, 600)).toBe(120);
    expect(nextMovingAvgCost(-3, 100, 5, 600)).toBe(120);
  });

  it("日期採臺灣時間", () => {
    expect(todayTaipei(new Date("2026-11-10T17:00:00Z"))).toBe("2026-11-11");
  });
});

describe("自動分錄", () => {
  it("建立借貸平衡的已過帳分錄，編號尾碼帶來源單據鍵", async () => {
    const tx = fakeTx();
    const je = await postAutoJournal(tx, {
      key: "WO7-M", entryDate: "2026-11-11", description: "工單發料", action: "工單發料",
      lines: [{ accountName: "在製品", debit: 300, credit: 0 }, { accountName: "存貨", debit: 0, credit: 300 }],
    });
    expect(je?.entryNumber).toMatch(/-WO7-M$/);
    expect(tx.inserted[0]).toMatchObject({ status: "Posted", totalDebit: "300", totalCredit: "300" });
    expect(tx.inserted[0].lines.every((l: any) => l.accountId)).toBe(true);
  });

  it("金額為 0 不建立分錄；已關帳期間拋錯", async () => {
    const tx = fakeTx();
    expect(await postAutoJournal(tx, { key: "SE1", entryDate: "2026-11-11", description: "", action: "", lines: [{ accountName: "存貨", debit: 0, credit: 0 }] })).toBeNull();
    expect(tx.inserted).toHaveLength(0);
    await expect(postAutoJournal(fakeTx({ lockDate: "2026-12-31" }), {
      key: "SE2", entryDate: "2026-11-11", description: "", action: "建立庫存異動",
      lines: [{ accountName: "存貨", debit: 50, credit: 0 }, { accountName: "存貨盤盈", debit: 0, credit: 50 }],
    })).rejects.toThrow("已關帳");
  });

  it("工單在製品餘額＝已發料 − 已完工轉出 − 已結轉", async () => {
    expect(await workOrderWipBalance(fakeTx({ sums: { "WO7-M": 1000, "WO7-F": 600, "WO7-C": 100 } }), 7)).toBe(300);
  });
});

describe("品質檢驗關卡", () => {
  it("連結的檢驗單只要有一張未合格就擋下", () => {
    expect(blockingInspections([
      { inspectionNumber: "QI-1", status: "Accepted", itemId: 1 },
      { inspectionNumber: "QI-2", status: "Draft", itemId: 2 },
      { inspectionNumber: "QI-3", status: "Rejected", itemId: 3 },
    ])).toEqual(["QI-2", "QI-3"]);
  });

  it("必檢品項要有合格的檢驗單才算通過", () => {
    const inspections = [{ inspectionNumber: "QI-1", status: "Accepted", itemId: 1 }];
    expect(itemsMissingInspection([1, 2], inspections)).toEqual([2]);
    expect(itemsMissingInspection([], inspections)).toEqual([]);
  });
});

describe("銀行明細直接入帳", () => {
  const counter = { id: 9, accountNumber: "6136", accountName: "手續費(營)" };
  const bank = { id: 3, accountNumber: "1113", accountName: "銀行存款-主要帳戶" };

  it("支出：借 對方科目／貸 銀行", () => {
    const lines = bankEntryJournalLines({ debit: "30", credit: "0", description: "轉帳手續費" }, counter, bank);
    expect(lines).toMatchObject([{ accountId: 9, debit: 30, credit: 0 }, { accountId: 3, debit: 0, credit: 30 }]);
  });

  it("存入：借 銀行／貸 對方科目；沒指定銀行科目時用預設的現金/銀行", () => {
    const lines = bankEntryJournalLines({ debit: "0", credit: "120" }, { id: 5, accountNumber: "7101", accountName: "利息收入" }, null);
    expect(lines).toMatchObject([{ accountName: "現金/銀行", debit: 120, credit: 0 }, { accountId: 5, debit: 0, credit: 120 }]);
  });

  it("借貸兩邊都有或都沒有金額時拒絕", () => {
    expect(() => bankEntryJournalLines({ debit: "0", credit: "0" }, counter, bank)).toThrow();
    expect(() => bankEntryJournalLines({ debit: "10", credit: "10" }, counter, bank)).toThrow();
  });
});
