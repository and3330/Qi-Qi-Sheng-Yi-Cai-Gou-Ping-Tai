import { describe, expect, it } from "vitest";
import { isCashAccount, isRealDate, payrollJournalAmounts } from "../cash-accounts";

const account = (extra: Record<string, unknown>) => ({
  accountType: "Asset", isGroup: false, accountNumber: "1111", accountName: "庫存現金", cashFlowCategory: null, parentName: null, ...extra,
});

describe("收付款帳戶的判斷", () => {
  it("現金、零用金、銀行存款都算", () => {
    for (const accountName of ["庫存現金", "零用金、週轉金", "銀行存款-國泰板橋", "現金-支付寶", "銀行存摺-某協會（代管）"]) {
      expect(isCashAccount(account({ accountName }))).toBe(true);
    }
  });

  it("掛在「現金及約當現金」底下的明細科目都算", () => {
    expect(isCashAccount(account({ accountName: "約當現金", parentName: "現金及約當現金" }))).toBe(true);
  });

  it("彙總科目、非資產、名稱只是帶到現金的科目不算", () => {
    expect(isCashAccount(account({ isGroup: true }))).toBe(false);
    expect(isCashAccount(account({ accountType: "Liability", accountName: "銀行借款" }))).toBe(false);
    expect(isCashAccount(account({ accountName: "人壽保險現金解約價值" }))).toBe(false);
    expect(isCashAccount(account({ accountName: "應收帳款" }))).toBe(false);
  });

  it("現金流量分類設成「現金」的一定算，設成其他活動的不算", () => {
    expect(isCashAccount(account({ accountName: "LINE Pay 餘額", cashFlowCategory: "cash" }))).toBe(true);
    expect(isCashAccount(account({ accountName: "銀行存款-質押定存", cashFlowCategory: "investing" }))).toBe(false);
  });
});

describe("薪資發放分錄", () => {
  it("沒有出勤扣款：薪資費用等於應發", () => {
    const a = payrollJournalAmounts({ grossSalary: 42000, totalDeductions: 1600, attendanceDeduction: 0, netSalary: 40400, employerCost: 6000 });
    expect(a).toMatchObject({ salaryExpense: 42000, withheld: 1600, net: 40400, employerCost: 6000, balanced: true });
  });

  it("出勤與請假扣款從薪資費用扣掉，不算進代扣負債", () => {
    const a = payrollJournalAmounts({ grossSalary: 42000, totalDeductions: 3000, attendanceDeduction: 1400, netSalary: 39000, employerCost: 6000 });
    expect(a.salaryExpense).toBe(40600);
    expect(a.withheld).toBe(1600);
    // 借方（薪資 + 雇主負擔）＝ 貸方（代扣 + 雇主應付 + 實發）
    expect(a.salaryExpense + a.employerCost).toBe(a.withheld + a.employerCost + a.net);
    expect(a.balanced).toBe(true);
  });

  it("薪資單金額對不起來時會被擋下", () => {
    expect(payrollJournalAmounts({ grossSalary: 42000, totalDeductions: 1600, attendanceDeduction: 0, netSalary: 41000, employerCost: 0 }).balanced).toBe(false);
  });
});

describe("日期檢查", () => {
  it("不存在的日期不通過", () => {
    expect(isRealDate("2026-11-12")).toBe(true);
    expect(isRealDate("2026-11-31")).toBe(false);
    expect(isRealDate("2026/11/12")).toBe(false);
    expect(isRealDate(undefined)).toBe(false);
  });
});

import { openingEntryLines, settlementJournalLines } from "../cash-accounts";

const BANK = { accountId: 13, accountNumber: "1113", accountName: "銀行存款-國泰板橋" };
const sum = (lines: { debit: number; credit: number }[], side: "debit" | "credit") => Math.round(lines.reduce((s, l) => s + l[side], 0) * 100) / 100;

describe("收付款分錄", () => {
  it("一般收款：借銀行、貸應收", () => {
    const lines = settlementJournalLines({ kind: "receipt", voucherNumber: "RC-1", cash: BANK, parts: [{ amount: 8600 }] });
    expect(lines.map(l => [l.accountName, l.debit, l.credit])).toEqual([["銀行存款-國泰板橋", 8600, 0], ["應收帳款", 0, 8600]]);
  });

  it("訂單還沒成立先收的訂金記預收款項，其餘沖應收", () => {
    const lines = settlementJournalLines({ kind: "receipt", voucherNumber: "RC-2", cash: BANK, parts: [{ amount: 3000, deposit: true }, { amount: 5000 }] });
    expect(lines.find(l => l.accountName === "預收款項")).toMatchObject({ credit: 3000 });
    expect(lines.find(l => l.accountName === "應收帳款")).toMatchObject({ credit: 5000 });
    expect(sum(lines, "debit")).toBe(sum(lines, "credit"));
  });

  it("外幣收款：匯率升值認列兌換利益", () => {
    // 發票 1,000 美元，入帳匯率 31；收款當天 32
    const lines = settlementJournalLines({ kind: "receipt", voucherNumber: "RC-3", cash: BANK, parts: [{ amount: 1000, invoiceRate: 31, paymentRate: 32 }] });
    expect(lines.find(l => l.accountName === "銀行存款-國泰板橋")).toMatchObject({ debit: 32000 });
    expect(lines.find(l => l.accountName === "應收帳款")).toMatchObject({ credit: 31000 });
    expect(lines.find(l => l.accountName === "兌換利益")).toMatchObject({ credit: 1000 });
    expect(sum(lines, "debit")).toBe(sum(lines, "credit"));
  });

  it("外幣付款：付出的新台幣比帳上多認列兌換損失；沒填當天匯率就沒有損益", () => {
    const lines = settlementJournalLines({ kind: "payment", voucherNumber: "PY-1", cash: BANK, parts: [{ amount: 1000, invoiceRate: 31, paymentRate: 31.5 }] });
    expect(lines.find(l => l.accountName === "應付帳款")).toMatchObject({ debit: 31000 });
    expect(lines.find(l => l.accountName === "兌換損失")).toMatchObject({ debit: 500 });
    expect(sum(lines, "debit")).toBe(sum(lines, "credit"));
    const same = settlementJournalLines({ kind: "payment", voucherNumber: "PY-2", cash: BANK, parts: [{ amount: 1000, invoiceRate: 31 }] });
    expect(same).toHaveLength(2);
  });
});

describe("收付款單的手續費與每一行的科目", () => {
  const FEE = { accountId: 61, accountNumber: "6131", accountName: "銀行手續費" };
  const INTEREST = { accountId: 71, accountNumber: "7101", accountName: "利息收入" };
  const shape = (lines: { accountName: string; debit: number; credit: number }[]) => lines.map(l => [l.accountName, l.debit, l.credit]);

  it("收款有手續費：銀行只進（金額 − 手續費），手續費記費用，應收照全額沖掉", () => {
    const lines = settlementJournalLines({ kind: "receipt", voucherNumber: "RC-9", cash: BANK, parts: [{ amount: 1000 }], fee: 15, feeAccount: FEE });
    expect(shape(lines)).toEqual([["銀行存款-國泰板橋", 985, 0], ["銀行手續費", 15, 0], ["應收帳款", 0, 1000]]);
  });

  it("付款有手續費：銀行付出（金額 ＋ 手續費），應付只沖金額", () => {
    const lines = settlementJournalLines({ kind: "payment", voucherNumber: "PY-9", cash: BANK, parts: [{ amount: 1000 }], fee: 30, feeAccount: FEE });
    expect(shape(lines)).toEqual([["應付帳款", 1000, 0], ["銀行手續費", 30, 0], ["銀行存款-國泰板橋", 0, 1030]]);
  });

  it("這一行自己選了科目就記那個科目，不記應收；同一張單其他行照舊沖應收", () => {
    const lines = settlementJournalLines({ kind: "receipt", voucherNumber: "RC-10", cash: BANK, parts: [{ amount: 5000 }, { amount: 120, account: INTEREST }], fee: 15, feeAccount: FEE });
    expect(shape(lines)).toEqual([["銀行存款-國泰板橋", 5105, 0], ["銀行手續費", 15, 0], ["應收帳款", 0, 5000], ["利息收入", 0, 120]]);
    expect(sum(lines, "debit")).toBe(sum(lines, "credit"));
  });

  it("外幣收款同時有手續費和實際入帳的台幣：差額扣掉手續費後才是兌換損益", () => {
    // 發票 1,000 美元、入帳匯率 31（應收 31,000）；銀行實際進 31,485，另外被扣 15 手續費 → 兌換利益 500
    const lines = settlementJournalLines({ kind: "receipt", voucherNumber: "RC-11", cash: BANK, parts: [{ amount: 1000, invoiceRate: 31 }], actualCash: 31485, fee: 15, feeAccount: FEE });
    expect(lines.find(l => l.accountName === "銀行存款-國泰板橋")).toMatchObject({ debit: 31485 });
    expect(lines.find(l => l.accountName === "兌換利益")).toMatchObject({ credit: 500 });
    expect(sum(lines, "debit")).toBe(sum(lines, "credit"));
  });

  it("有手續費卻沒有手續費科目、或手續費吃掉整筆收款，都不入帳", () => {
    expect(() => settlementJournalLines({ kind: "receipt", voucherNumber: "RC-12", cash: BANK, parts: [{ amount: 100 }], fee: 15 })).toThrow("手續費");
    expect(() => settlementJournalLines({ kind: "receipt", voucherNumber: "RC-13", cash: BANK, parts: [{ amount: 100 }], fee: 100, feeAccount: FEE })).toThrow("手續費不能大於或等於");
  });

  it("沒填手續費、沒選科目時，分錄和原本一模一樣", () => {
    expect(shape(settlementJournalLines({ kind: "payment", voucherNumber: "PY-10", cash: BANK, parts: [{ amount: 700 }], fee: 0, feeAccount: null })))
      .toEqual([["應付帳款", 700, 0], ["銀行存款-國泰板橋", 0, 700]]);
  });
});

describe("開帳分錄", () => {
  it("資產在借方、負債與權益在貸方，負數放到反方向", () => {
    const built = openingEntryLines([
      { accountId: 1, accountName: "銀行存款", accountType: "Asset", amount: 500000 },
      { accountId: 2, accountName: "備抵呆帳", accountType: "Asset", amount: -20000 },
      { accountId: 3, accountName: "應付帳款", accountType: "Liability", amount: 80000 },
      { accountId: 4, accountName: "股本", accountType: "Equity", amount: 300000 },
      { accountId: 5, accountName: "沒有餘額", accountType: "Asset", amount: 0 },
    ]);
    expect(built.lines).toHaveLength(4);
    expect(built.lines.find(l => l.accountId === 2)).toMatchObject({ debit: 0, credit: 20000 });
    expect(built.totalDebit).toBe(500000);
    expect(built.totalCredit).toBe(400000);
    // 差額 100,000 就是開帳日以前的累積盈餘
    expect(built.difference).toBe(100000);
  });
});
