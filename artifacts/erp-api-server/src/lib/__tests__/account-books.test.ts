import { describe, expect, it } from "vitest";
import { cashBook, expandAccountIds, journalBook, periodTotals, flattenLines, splitLineText, subledger, type BookAccount, type BookEntry } from "../account-books";

const acc = (id: number, accountNumber: string, accountName: string, accountType: string, extra: Partial<BookAccount> = {}): BookAccount =>
  ({ id, accountNumber, accountName, accountType, parentAccountId: null, balance: 0, isGroup: false, ...extra });
const accounts: BookAccount[] = [
  acc(1, "1111", "庫存現金", "Asset", { balance: 100 }),
  acc(2, "1113", "銀行存款", "Asset"),
  acc(3, "1141", "應收帳款", "Asset"),
  acc(4, "4111", "商品收入", "Income"),
  acc(5, "2281", "銷項稅額", "Liability"),
  acc(9, "11", "現金及約當現金", "Asset", { isGroup: true }),
];
accounts[0].parentAccountId = 9; accounts[1].parentAccountId = 9;
const map = new Map(accounts.map(a => [a.id, a]));
const e = (id: number, date: string, desc: string, lines: BookEntry["lines"]): BookEntry =>
  ({ id, entryNumber: `JE-${id}`, entryDate: date, description: desc, projectId: null, departmentId: null, lines });
const entries: BookEntry[] = [
  e(1, "2026-09-30", "Ecount 2026/09/30-1｜甲公司｜九月貨款", [
    { accountId: 3, debit: 105, credit: 0, description: "甲公司｜九月貨款" },
    { accountId: 4, debit: 0, credit: 100, description: "甲公司｜九月貨款" },
    { accountId: 5, debit: 0, credit: 5, description: "甲公司｜九月貨款" },
  ]),
  e(2, "2026-10-02", "Ecount 2026/10/02-1｜甲公司｜收款", [
    { accountId: 1, debit: 105, credit: 0, description: "現金｜收款" },
    { accountId: 3, debit: 0, credit: 105, description: "甲公司｜收款" },
  ]),
  e(3, "2026-10-03", "存入銀行", [
    { accountId: 2, debit: 50, credit: 0 },
    { accountId: 1, debit: 0, credit: 50 },
  ]),
];

describe("account books", () => {
  it("splits party and summary", () => {
    expect(splitLineText("甲公司｜九月貨款", null)).toEqual({ party: "甲公司", summary: "九月貨款" });
    expect(splitLineText(undefined, "Ecount 2026/10/01-3｜勞動部｜勞保")).toEqual({ party: "", summary: "勞保" });
  });

  it("expands group accounts to leaves", () => {
    expect([...expandAccountIds([9], accounts)].sort()).toEqual([1, 2]);
  });

  it("journal book uses Ecount reference and filters by party", () => {
    const r = journalBook(entries, map, { party: "甲" });
    expect(r.rows.map(x => x.reference)).toEqual(["2026/09/30-1", "2026/09/30-1", "2026/09/30-1", "2026/10/02-1"]);
    expect(r.totalDebit).toBe(105);
    expect(r.totalCredit).toBe(210);
  });

  it("period totals by month", () => {
    const p = periodTotals(flattenLines(entries, map), map, "month");
    expect(p.map(x => x.period)).toEqual(["2026-09", "2026-10"]);
    expect(p[1].totalDebit).toBe(155);
    expect(p[1].totalCredit).toBe(155);
  });

  it("account/party subledger carries opening balance per party", () => {
    const s = subledger(entries, map, { group: "account-party", accountIds: new Set([3]), startDate: "2026-10-01", includeStaticBalance: true, hideEmpty: false });
    expect(s).toHaveLength(1);
    expect(s[0]).toMatchObject({ party: "甲公司", openingBalance: 105, totalCredit: 105, closingBalance: 0 });
  });

  it("income accounts carry over only from Jan 1", () => {
    const s = subledger(entries, map, { group: "account-party", accountIds: new Set([4]), startDate: "2027-01-01", includeStaticBalance: true, hideEmpty: false });
    expect(s).toHaveLength(0);
    const same = subledger(entries, map, { group: "account-party", accountIds: new Set([4]), startDate: "2026-10-01", includeStaticBalance: true, hideEmpty: false });
    expect(same[0]).toMatchObject({ party: "甲公司", openingBalance: 100 });
  });

  it("cash book skips cash-to-bank only when both sides are cash", () => {
    const onlyCash = cashBook(entries, map, new Set([1]), "2026-10-01");
    expect(onlyCash.openingBalance).toBe(100);
    expect(onlyCash.rows.map(r => [r.counterAccount, r.debit, r.credit])).toEqual([["應收帳款", 105, 0], ["銀行存款", 0, 50]]);
    expect(onlyCash.closingBalance).toBe(155);
    const withBank = cashBook(entries, map, new Set([1, 2]), "2026-10-01");
    expect(withBank.rows).toHaveLength(1);
  });
});
