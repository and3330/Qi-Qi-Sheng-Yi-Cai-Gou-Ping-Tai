import { describe, expect, it } from "vitest";
import { parseActualCash, settlementJournalLines } from "../cash-accounts";
import { creditCheck } from "../credit-check";
import { compareQuotes } from "../rfq";

describe("實際進出的台幣（外幣貨款的匯差）", () => {
  it("沒填就照帳上金額，不會有兌換損益", () => {
    expect(parseActualCash(undefined, 1000)).toBeUndefined();
    expect(parseActualCash("", 1000)).toBeUndefined();
    const lines = settlementJournalLines({ kind: "payment", voucherNumber: "PY-1", cash: { accountName: "銀行存款" }, parts: [{ amount: 1000 }] });
    expect(lines).toHaveLength(2);
  });

  it("付出的台幣比帳上多：差額記兌換損失，借貸平衡", () => {
    const actualCash = parseActualCash(4480, 4400);
    const lines = settlementJournalLines({ kind: "payment", voucherNumber: "PY-1", cash: { accountName: "銀行存款" }, parts: [{ amount: 4400 }], actualCash });
    expect(lines.find(l => l.accountName === "應付帳款")).toMatchObject({ debit: 4400 });
    expect(lines.find(l => l.accountName === "銀行存款")).toMatchObject({ credit: 4480 });
    expect(lines.find(l => l.accountName === "兌換損失")).toMatchObject({ debit: 80 });
    expect(lines.reduce((s, l) => s + l.debit, 0)).toBe(lines.reduce((s, l) => s + l.credit, 0));
  });

  it("付出的台幣比帳上少：差額記兌換利益", () => {
    const lines = settlementJournalLines({ kind: "payment", voucherNumber: "PY-1", cash: { accountName: "銀行存款" }, parts: [{ amount: 4400 }], actualCash: 4350 });
    expect(lines.find(l => l.accountName === "兌換利益")).toMatchObject({ credit: 50 });
  });

  it("差太多（多半是填成外幣金額）或沒有帳款可沖就擋下來", () => {
    expect(() => parseActualCash(1000, 4400)).toThrow(/差超過三成/);
    expect(() => parseActualCash(-5, 4400)).toThrow(/大於 0/);
    expect(() => parseActualCash(4400, 0)).toThrow(/沒有可以沖銷/);
  });
});

describe("客戶信用額度", () => {
  it("沒設額度或 0 就是不限", () => {
    expect(creditCheck(null, 999999, 1)).toMatchObject({ limited: false, ok: true });
    expect(creditCheck(0, 999999, 1)).toMatchObject({ limited: false, ok: true });
  });
  it("欠款加新訂單剛好等於額度可以過，超過一元就擋", () => {
    expect(creditCheck(10000, 6000, 4000)).toMatchObject({ limited: true, ok: true, over: 0 });
    expect(creditCheck(10000, 6000, 4001)).toMatchObject({ ok: false, over: 1, after: 10001 });
  });
});

describe("詢價比價", () => {
  const items = [
    { itemId: 1, itemName: "積木", quantity: 10, unit: "盒" },
    { itemId: 2, itemName: "磁鐵", quantity: 5, unit: "組" },
  ];
  const quote = (supplierId: number, prices: Array<number | null>, extra: Record<string, unknown> = {}) => ({
    supplierId, supplierName: `供應商${supplierId}`, quotedAt: "2026-11-13", currency: "TWD", exchangeRate: 1, leadDays: null, validUntil: null, note: null, prices, ...extra,
  });

  it("外幣報價換成台幣後再比，總價最低的勝出", () => {
    const result = compareQuotes(items, [
      quote(1, [100, 200]),                                             // 1000 + 1000 = 2000
      quote(2, [20, 40], { currency: "CNY", exchangeRate: 4.5 }),       // 90*10 + 180*5 = 1800
    ], "2026-11-13");
    expect(result.quotes[1].totalTwd).toBe(1800);
    expect(result.cheapestSupplierId).toBe(2);
    expect(result.lowestByItem).toEqual([2, 2]);
    expect(result.spreadTwd).toBe(200);
  });

  it("只報部分品項的不參加總價比較，但單項最低照算", () => {
    const result = compareQuotes(items, [quote(1, [100, 200]), quote(2, [50, null])], "2026-11-13");
    expect(result.quotes[1]).toMatchObject({ complete: false, quotedCount: 1, totalTwd: 500 });
    expect(result.cheapestSupplierId).toBe(1);
    expect(result.lowestByItem).toEqual([2, 1]);
  });

  it("報價過了有效期限會標示；沒有報價時沒有最低", () => {
    expect(compareQuotes(items, [quote(1, [1, 1], { validUntil: "2026-11-01" })], "2026-11-13").quotes[0].expired).toBe(true);
    expect(compareQuotes(items, [], "2026-11-13")).toMatchObject({ cheapestSupplierId: null, lowestByItem: [null, null], spreadTwd: 0 });
  });
});
