import { describe, expect, it } from "vitest";
import { flattenLines, type BookAccount, type BookEntry } from "../account-books";
import {
  accountDailyChanges, accountingSummary, accountPartyBalances, partyTransactions, balanceAging, cashFlowSummary, fundMovements, fundStatus,
  monthlyPartyTotals, monthlyProfitLoss, vatBook, voucherTotals,
} from "../business-reports";

const acc = (id: number, accountNumber: string, accountName: string, accountType: string, extra: Partial<BookAccount> = {}): BookAccount =>
  ({ id, accountNumber, accountName, accountType, parentAccountId: null, balance: 0, isGroup: false, ...extra });
const accounts: BookAccount[] = [
  acc(1, "1111", "庫存現金", "Asset", { balance: 1000 }),
  acc(2, "1113", "銀行存款", "Asset"),
  acc(3, "1141", "應收帳款", "Asset"),
  acc(4, "4111", "商品收入", "Income"),
  acc(5, "2281", "銷項稅額", "Liability"),
  acc(6, "2141", "應付帳款", "Liability"),
  acc(7, "6111", "文具用品", "Expense"),
  acc(8, "1281", "進項稅額", "Asset"),
  acc(9, "6112", "手續費", "Expense"),
];
const map = new Map(accounts.map(a => [a.id, a]));
const e = (id: number, date: string, desc: string, lines: BookEntry["lines"]): BookEntry =>
  ({ id, entryNumber: `JE-${id}`, entryDate: date, description: desc, projectId: null, departmentId: null, lines });
const entries: BookEntry[] = [
  // 8 月賣給甲 1,050（含稅）
  e(1, "2026-08-15", "Ecount 2026/08/15-1｜甲公司｜八月貨款", [
    { accountId: 3, debit: 1050, credit: 0, description: "甲公司｜八月貨款" },
    { accountId: 4, debit: 0, credit: 1000, description: "甲公司｜八月貨款" },
    { accountId: 5, debit: 0, credit: 50, description: "甲公司｜八月貨款" },
  ]),
  // 10 月再賣給甲 2,100
  e(2, "2026-10-01", "Ecount 2026/10/01-1｜甲公司｜十月貨款", [
    { accountId: 3, debit: 2100, credit: 0, description: "甲公司｜十月貨款" },
    { accountId: 4, debit: 0, credit: 2000, description: "甲公司｜十月貨款" },
    { accountId: 5, debit: 0, credit: 100, description: "甲公司｜十月貨款" },
  ]),
  // 10 月甲付 1,050，匯費 30
  e(3, "2026-10-05", "Ecount 2026/10/05-1｜甲公司｜收款", [
    { accountId: 2, debit: 1020, credit: 0, description: "國泰｜收款" },
    { accountId: 9, debit: 30, credit: 0, description: "甲公司｜匯費" },
    { accountId: 3, debit: 0, credit: 1050, description: "甲公司｜收款" },
  ]),
  // 10 月向乙買文具 210（含稅），掛應付
  e(4, "2026-10-08", "Ecount 2026/10/08-1｜乙文具｜文具", [
    { accountId: 7, debit: 200, credit: 0, description: "乙文具｜文具" },
    { accountId: 8, debit: 10, credit: 0, description: "乙文具｜文具" },
    { accountId: 6, debit: 0, credit: 210, description: "乙文具｜文具" },
  ]),
  // 10 月付乙 210（現金）
  e(5, "2026-10-20", "Ecount 2026/10/20-1｜乙文具｜付款", [
    { accountId: 6, debit: 210, credit: 0, description: "乙文具｜付款" },
    { accountId: 1, debit: 0, credit: 210, description: "現金｜付款" },
  ]),
];
const fund = new Set([1, 2]);
const noDim = () => ({ project: null, department: null });

describe("business reports", () => {
  it("fund status splits opening, increase, decrease per account", () => {
    const r = fundStatus(entries, map, fund, "2026-10-01", true);
    expect(r.rows.map(x => [x.accountName, x.opening, x.increase, x.decrease, x.closing])).toEqual([
      ["庫存現金", 1000, 0, 210, 790],
      ["銀行存款", 0, 1020, 0, 1020],
    ]);
    expect(r.total).toEqual({ opening: 1000, increase: 1020, decrease: 210, closing: 1810 });
  });

  it("fund movements list the counter accounts", () => {
    const m = fundMovements(entries, map, fund, "2026-10-01", "2026-10-31");
    // 匯費 30 從應收那筆扣掉，合計＝銀行實收 1,020
    expect(m.increase.map(x => [x.counterAccount, x.amount])).toEqual([["應收帳款", 1020]]);
    expect(m.decrease.map(x => [x.counterAccount, x.party, x.amount])).toEqual([["應付帳款", "乙文具", 210]]);
  });

  it("cash flow summary closes from opening", () => {
    const c = cashFlowSummary(entries, map, fund, "2026-10-01", "2026-10-31", true);
    expect(c.opening).toBe(1000);
    expect(c.closing).toBe(1000 + c.totalIncrease - c.totalDecrease);
  });

  it("monthly P&L by month with net", () => {
    const p = monthlyProfitLoss(entries, accounts, "2026-08-01", "2026-10-31");
    expect(p.months).toEqual(["2026-08", "2026-09", "2026-10"]);
    expect(p.income.months).toEqual([1000, 0, 2000]);
    expect(p.expense.total).toBe(230);
    expect(p.net.total).toBe(2770);
  });

  it("accounting summary by account carries opening; by party does not", () => {
    const lines = flattenLines(entries, map);
    const byAcc = accountingSummary(lines, map, { startDate: "2026-10-01", key1: "account", dimName: noDim });
    expect(byAcc.rows.find(r => r.key1.includes("應收帳款"))).toMatchObject({ opening: 1050, debit: 2100, credit: 1050, amount: 2100 });
    const byParty = accountingSummary(lines.filter(l => l.accountId === 3), map, { startDate: "2026-10-01", key1: "party", dimName: noDim });
    expect(byParty.rows).toEqual([{ key1: "甲公司", key2: "", opening: 0, debit: 2100, credit: 1050, amount: 1050 }]);
  });

  it("monthly sales include tax; purchases count only new payables", () => {
    const s = monthlyPartyTotals(entries, map, "sales", "2026-10-01", "2026-10-31");
    expect(s.rows).toEqual([{ party: "甲公司", months: [2100], total: 2100 }]);
    const p = monthlyPartyTotals(entries, map, "purchase", "2026-10-01", "2026-10-31");
    expect(p.total).toBe(210);
  });

  it("receipt and payment totals with fee column", () => {
    const r = voucherTotals(entries, map, "receipt", fund, "2026-10-01", "2026-10-31", noDim);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ fundAccount: "國泰", account: "應收帳款", party: "甲公司", amount: 1050, fee: 30 });
    const p = voucherTotals(entries, map, "payment", fund, "2026-10-01", "2026-10-31", noDim);
    expect(p.map(x => [x.account, x.amount])).toEqual([["應付帳款", 210]]);
  });

  it("VAT book separates sales and purchase with invoice numbers", () => {
    const v = vatBook(entries, map, "all", "2026-10-01", "2026-10-31", (_e, ref) => (ref === "2026/10/01-1" ? "AB12345678" : ""));
    expect(v.map(x => [x.kind, x.invoiceNumber, x.party, x.net, x.tax])).toEqual([
      ["sales", "AB12345678", "甲公司", 2000, 100],
      ["purchase", "", "乙文具", 200, 10],
    ]);
  });

  it("account daily changes", () => {
    const s = accountDailyChanges(flattenLines(entries, map), map, new Set([3]), "2026-10-01", true);
    expect(s[0]).toMatchObject({ opening: 1050, totalIncrease: 2100, totalDecrease: 1050, closing: 2100 });
    expect(s[0].days.map(d => d.balance)).toEqual([3150, 2100]);
  });

  it("receivable aging is first-in first-out", () => {
    const a = balanceAging(flattenLines(entries, map), map, new Set([3]), "2026-10-31", true);
    expect(a.months).toEqual(["2026-10", "2026-09", "2026-08", "2026-07"]);
    // 收的 1,050 先沖 8 月的帳，剩 10 月的 2,100
    expect(a.rows).toEqual([{ party: "甲公司", total: 2100, buckets: [2100, 0, 0, 0, 0] }]);
  });

  it("account detail splits receivables by party and keeps cash as one row", () => {
    const d = accountPartyBalances(flattenLines(entries, map), map, "2026-10-31", true);
    expect(d.find(x => x.accountNumber === "1111")).toMatchObject({ total: 790, rows: [{ party: "", amount: 790 }] });
    expect(d.find(x => x.accountNumber === "1141")?.rows).toEqual([{ party: "甲公司", amount: 2100 }]);
    // 收入是當年累計
    expect(d.find(x => x.accountNumber === "4111")?.total).toBe(3000);
    expect(accountPartyBalances(flattenLines(entries, map), map, "2027-01-31", true).find(x => x.accountNumber === "4111")).toBeUndefined();
  });

  it("party transactions list every line of the party", () => {
    const t = partyTransactions(flattenLines(entries, map), "2026-10-01", "2026-10-31");
    const a = t.find(x => x.party === "甲公司")!;
    expect(a.rows).toHaveLength(5);
    expect([a.totalDebit, a.totalCredit]).toEqual([2130, 3150]);
  });
});
