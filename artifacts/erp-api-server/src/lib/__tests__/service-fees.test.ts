import { describe, expect, it, vi } from "vitest";

vi.mock("@workspace/erp-db/schema", () => ({ journalEntriesTable: {} }));
vi.mock("../auto-journal", () => ({ assertPeriodOpen: vi.fn(), resolveJournalLinesStrict: vi.fn() }));

import { serviceFeeProblem, suggestWithholding, summarizeAnnualFees, type FeeRow } from "../service-fees";
import { finishCostShare, nextMovingAvgCost } from "../inventory-journal";
import { buildSetupReminders } from "../setup-reminders";

describe("服務費的代扣試算", () => {
  it("授課鐘點費（薪資）：未達起扣點免扣繳，達基本工資扣補充保費", () => {
    expect(suggestWithholding({ incomeType: "50", amount: 12000, payeeType: "teacher" })).toMatchObject({ withholdingTax: 0, nhiSupplement: 0, netAmount: 12000 });
    const s = suggestWithholding({ incomeType: "50", amount: 30000, payeeType: "teacher" });
    expect(s).toMatchObject({ withholdingTax: 0, nhiSupplement: 633, netAmount: 29367 });
  });

  it("薪資單次達起扣點扣 5%", () => {
    expect(suggestWithholding({ incomeType: "50", amount: 100000, payeeType: "teacher" })).toMatchObject({ withholdingTax: 5000, nhiSupplement: 2110, netAmount: 92890 });
  });

  it("自家員工的授課費不另扣補充保費", () => {
    expect(suggestWithholding({ incomeType: "50", amount: 40000, payeeType: "employee" }).nhiSupplement).toBe(0);
  });

  it("講演鐘點費：20,000 以下免扣繳，超過扣 10%；滿 20,000 扣補充保費", () => {
    expect(suggestWithholding({ incomeType: "9B", amount: 20000, payeeType: "teacher" })).toMatchObject({ withholdingTax: 0, nhiSupplement: 422, netAmount: 19578 });
    expect(suggestWithholding({ incomeType: "9B", amount: 30000, payeeType: "teacher" })).toMatchObject({ withholdingTax: 3000, nhiSupplement: 633, netAmount: 26367 });
    expect(suggestWithholding({ incomeType: "9A", amount: 8000, payeeType: "teacher" })).toMatchObject({ withholdingTax: 0, nhiSupplement: 0 });
  });

  it("擋下不合理的金額", () => {
    expect(serviceFeeProblem({ amount: 0, withholdingTax: 0, nhiSupplement: 0 })).toContain("大於 0");
    expect(serviceFeeProblem({ amount: 1000, withholdingTax: 900, nhiSupplement: 100 })).toContain("代扣");
    expect(serviceFeeProblem({ amount: 5000, withholdingTax: 0, nhiSupplement: 0, hours: 3, rate: 1600 })).toContain("時數");
    expect(serviceFeeProblem({ amount: 4800, withholdingTax: 0, nhiSupplement: 0, hours: 3, rate: 1600 })).toBeNull();
  });
});

describe("年度所得彙總", () => {
  const row = (extra: Partial<FeeRow>): FeeRow => ({
    payeeType: "teacher", teacherId: 1, employeeId: null, payeeName: "林老師", incomeType: "50",
    amount: 10000, withholdingTax: 0, nhiSupplement: 0, netAmount: 10000, status: "Paid", ...extra,
  });

  it("同一個人同一種所得合成一列，不同所得類別分開", () => {
    const rows = summarizeAnnualFees([
      row({}), row({ amount: 30000, nhiSupplement: 633, netAmount: 29367 }),
      row({ incomeType: "9B", amount: 30000, withholdingTax: 3000, nhiSupplement: 633, netAmount: 26367 }),
      row({ payeeType: "employee", teacherId: null, employeeId: 7, payeeName: "王小明", amount: 6000, netAmount: 6000 }),
    ], [row({ amount: 8000, status: "Confirmed" })]);
    expect(rows).toHaveLength(3);
    const salary = rows.find(r => r.payeeName === "林老師" && r.incomeType === "50")!;
    expect(salary).toMatchObject({ count: 2, gross: 40000, nhiSupplement: 633, net: 39367, unpaid: 8000 });
    expect(rows.find(r => r.incomeType === "9B")).toMatchObject({ gross: 30000, withholdingTax: 3000 });
    expect(rows.find(r => r.payeeType === "employee")).toMatchObject({ payeeId: 7, gross: 6000 });
  });
});

describe("成本計算", () => {
  it("同一商品不同進價會加權平均", () => {
    // 原有 10 個、成本 100；再進 10 個、每個 120 → 平均 110
    expect(nextMovingAvgCost(10, 100, 10, 1200)).toBe(110);
    // 庫存是 0 時直接採用這次的進價
    expect(nextMovingAvgCost(0, 80, 5, 500)).toBe(100);
  });

  it("分批完工依數量分攤在製品成本，最後一批拿走剩下的", () => {
    // 計畫做 10 個，材料成本 1,000。先完工 4 個 → 400
    expect(finishCostShare(1000, 4, 10, 0)).toBe(400);
    // 再完工 6 個（最後一批）→ 剩下的 600 全部轉出
    expect(finishCostShare(600, 6, 10, 4)).toBe(600);
    // 一次全部完工
    expect(finishCostShare(1000, 10, 10, 0)).toBe(1000);
    expect(finishCostShare(0, 5, 10, 0)).toBe(0);
  });
});

describe("上線前設定提醒", () => {
  const counts = {
    activeEmployees: 3, employeesWithoutShift: 3, employeesWithoutGrade: 1, shiftTypes: 0, grades: 2,
    holidaysThisYear: 0, items: 5, virtualItems: 0, openingEntries: 0, journalEntries: 0, manualLeaveGrants: 0, cashAccounts: 4,
  };

  it("沒設定的項目列為未完成，已經有的自動打勾", () => {
    const list = buildSetupReminders(counts, 2026);
    const done = (key: string) => list.find(r => r.key === key)!.done;
    expect(done("holidays")).toBe(false);
    expect(done("shift-types")).toBe(false);
    expect(done("grades")).toBe(false);
    expect(done("opening-balance")).toBe(false);
    expect(done("cash-accounts")).toBe(true);
    expect(list.find(r => r.key === "holidays")!.title).toContain("2026");
  });

  it("全部設定好就沒有未完成的自動項目", () => {
    const list = buildSetupReminders({ ...counts, employeesWithoutShift: 0, employeesWithoutGrade: 0, shiftTypes: 2, holidaysThisYear: 12, virtualItems: 3, openingEntries: 1, manualLeaveGrants: 1 }, 2026);
    expect(list.filter(r => !r.done && r.kind === "auto")).toHaveLength(0);
  });
});
