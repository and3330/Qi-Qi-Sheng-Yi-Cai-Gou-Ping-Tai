import { describe, expect, it } from "vitest";
import {
  ensureAccountingBaseline,
  selectAccountingBaseline,
} from "../accounting-baseline";
import { resolveJournalLines } from "../auto-journal";

describe("immutable accounting baseline", () => {
  it("compiles all 476 bracket-coded workbook accounts, including textual suffixes", () => {
    const source = selectAccountingBaseline("yubang-83483621");
    expect(source).toHaveLength(476);
    expect(source.filter((account) => account.isGroup)).toHaveLength(106);
    expect(new Set(source.map((account) => account.code)).size).toBe(476);
    expect(source.filter((item) => [
      "1113.0", "1119.0", "1142-1", "1142-2", "6116-1", "6216-1", "6233-1",
    ].includes(item.code)).map((item) => item.code)).toEqual([
      "1113.0", "1119.0", "1142-1", "1142-2", "6116-1", "6216-1", "6233-1",
    ]);
  });

  it("preserves source labels and creates valid longest-group-prefix trees", () => {
    const source = selectAccountingBaseline("yubang-83483621");
    const byCode = new Map(source.map((account) => [account.code, account]));
    expect(byCode.get("1113")?.displayName).toBe("銀行存款-國泰板橋");
    expect(byCode.get("1113.0")?.displayName).toBe("銀行存款-國泰板橋(營隊專用)");
    expect(byCode.get("1113.0")?.parentCode).toBe("111");
    expect(byCode.get("1142-1")?.parentCode).toBe("1142");
    expect(byCode.get("1118")?.displayName).toBe("其他現金及 約當現金");
    expect(byCode.get("1120")?.displayName).toBe("銀行存摺-詠勝教育文化事業有限公司（代管）");
    for (const account of source) {
      if (!account.parentCode) {
        expect(account.level).toBe(0);
        continue;
      }
      const parent = byCode.get(account.parentCode);
      expect(parent, `${account.code} parent`).toBeDefined();
      expect(parent?.isGroup).toBe(true);
      expect(account.code.startsWith(account.parentCode)).toBe(true);
      expect(account.level).toBe((parent?.level ?? -1) + 1);
      const longer = source.find((candidate) =>
        candidate.isGroup &&
        candidate.code.length > account.parentCode!.length &&
        candidate.code.length < account.code.length &&
        account.code.startsWith(candidate.code));
      expect(longer, `${account.code} must use longest group prefix`).toBeUndefined();
    }
  });

  it("uses shared Income and maps contra revenue by root while cost is Expense", () => {
    const byCode = new Map(selectAccountingBaseline("generic").map((account) => [account.code, account]));
    expect(byCode.get("4111")?.accountType).toBe("Income");
    expect(byCode.get("4112")?.accountType).toBe("Income");
    expect(byCode.get("7101")?.accountType).toBe("Income");
    expect(byCode.get("4511")?.accountType).toBe("Expense");
    expect(byCode.get("6111")?.accountType).toBe("Expense");
    expect(byCode.get("5111")?.accountType).toBe("Expense");
    expect([...byCode.values()].some((account) => account.accountType === ("Revenue" as never))).toBe(false);
  });

  it("scrubs tenant-specific bank, managed-company, test, and person labels", () => {
    const names = selectAccountingBaseline("generic").map((account) => account.displayName).join("\n");
    for (const token of ["國泰板橋", "土地東板橋", "國際兒童才藝協會", "詠勝教育", "安廷", "弘晉", "猛璋", "應收帳款測試"]) {
      expect(names).not.toContain(token);
    }
    expect(selectAccountingBaseline("generic").map((account) => account.displayName))
      .toEqual(expect.arrayContaining([
        "銀行存款-主要帳戶", "銀行存款-第二帳戶", "代管銀行存款-第一帳戶",
        "代管銀行存款-第二帳戶", "銀行存款-專用帳戶", "代管銀行存款-專用帳戶",
      ]));
  });

  it("additively inserts an empty tenant and then preserves ids, balances, names and metadata", async () => {
    const rows: any[] = [];
    let id = 0;
    const tx = {
      select: () => ({
        from: () => {
          const result: any = Promise.resolve(rows);
          result.where = () => Promise.resolve(rows);
          return result;
        },
      }),
      insert: () => ({
        values: (value: any) => ({
          returning: async () => {
            rows.push({ ...value, id: ++id });
            return [{ id }];
          },
        }),
      }),
    };
    const baseline = selectAccountingBaseline("generic");
    expect(await ensureAccountingBaseline(tx, baseline, { tenantId: 99 })).toEqual({ inserted: 476, existing: 0 });
    const preservedId = rows.find((row) => row.accountNumber === "1113").id;
    rows.find((row) => row.accountNumber === "1113").balance = "123.45";
    rows.find((row) => row.accountNumber === "1113").accountName = "租戶自訂名稱";
    rows.find((row) => row.accountNumber === "1113").cashFlowCategory = "cash";
    expect(await ensureAccountingBaseline(tx, baseline, { tenantId: 99 })).toEqual({ inserted: 0, existing: 476 });
    expect(rows.find((row) => row.accountNumber === "1113")).toMatchObject({
      id: preservedId, balance: "123.45", accountName: "租戶自訂名稱", cashFlowCategory: "cash",
    });
    rows.find((row) => row.accountNumber === "1113").accountType = "Liability";
    await expect(ensureAccountingBaseline(tx, baseline, { tenantId: 99 }))
      .rejects.toThrow("會計科目 1113 結構衝突");
  });

  it("resolves generic expense journal lines to the workbook's existing expense leaf", async () => {
    const tx = {
      execute: async () => ({
        rows: [{
          id: 6234,
          accountNumber: "6234",
          accountName: "其他管理及總務費用(管)",
          accountType: "Expense",
        }],
      }),
    };
    expect(await resolveJournalLines(tx, [{ accountName: "費用", debit: 100, credit: 0 }])).toEqual([{
      accountId: 6234,
      accountNumber: "6234",
      accountName: "其他管理及總務費用(管)",
      debit: 100,
      credit: 0,
    }]);
  });
});