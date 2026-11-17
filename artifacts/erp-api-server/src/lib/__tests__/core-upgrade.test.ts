import { describe, it, expect, vi } from "vitest";

// 只測純計算；不讓資料庫模組初始化
vi.mock("@workspace/erp-db", () => ({ itemsTable: {}, stockEntriesTable: {}, warehousesTable: {} }));
vi.mock("@workspace/erp-db/schema", () => ({ journalEntriesTable: {} }));
vi.mock("../auto-journal", () => ({ assertPeriodOpen: vi.fn(), resolveJournalLinesStrict: vi.fn() }));

import { assignmentProblem, componentProblem, summarizeComponents } from "../salary-components";
import { agingParts, buildSchedule, normalizeInstallments, scheduleStatus, termProblem } from "../payment-terms";
import { countDifferences, stockSign } from "../stock-ledger";
import { conversionCost, hourlyCostOf, summarizeLabor, timesheetProblem } from "../timesheets";
import { budgetVariance, dunningLevel, nextRunAfter, recurringProblem, spreadAnnual } from "../finance-extras";

describe("薪資項目", () => {
  it("加項、減項、不列入投保的加項分開加總，金額 0 的略過", () => {
    const result = summarizeComponents([
      { componentId: 1, name: "伙食津貼", kind: "earning", amount: 3000, insurable: false },
      { componentId: 2, name: "職務加給", kind: "earning", amount: 5000, insurable: true },
      { componentId: 3, name: "福利金", kind: "deduction", amount: 200 },
      { componentId: 4, name: "交通津貼", kind: "earning", amount: 0 },
      { componentId: 5, name: "不明", kind: "other", amount: 999 },
    ]);
    expect(result.earnings).toBe(8000);
    expect(result.nonInsurableEarnings).toBe(3000);
    expect(result.deductions).toBe(200);
    expect(result.lines.map(l => l.name)).toEqual(["伙食津貼", "職務加給", "福利金"]);
  });

  it("檢查項目與員工結構的輸入", () => {
    expect(componentProblem({ name: "", kind: "earning" })).toBeTruthy();
    expect(componentProblem({ name: "伙食津貼", kind: "bonus" })).toBeTruthy();
    expect(componentProblem({ name: "伙食津貼", kind: "earning", defaultAmount: -1 })).toBeTruthy();
    expect(componentProblem({ name: "伙食津貼", kind: "earning", defaultAmount: 3000 })).toBeNull();
    expect(assignmentProblem([{ componentId: 1, amount: 100 }, { componentId: 1, amount: 200 }])).toContain("重複");
    expect(assignmentProblem([{ componentId: 1, amount: 1.5 }])).toBeTruthy();
    expect(assignmentProblem([{ componentId: 1, amount: 100 }, { componentId: 2, amount: 0 }])).toBeNull();
  });
});

describe("付款條件", () => {
  const deposit = [{ label: "訂金", percent: 30, days: 0 }, { label: "尾款", percent: 70, days: 30 }];

  it("比例要加起來 100、天數由小到大", () => {
    expect(termProblem("訂金尾款", deposit)).toBeNull();
    expect(termProblem("", deposit)).toBeTruthy();
    expect(termProblem("少一點", [{ label: "全額", percent: 90, days: 30 }])).toContain("100%");
    expect(termProblem("順序反了", [{ label: "尾款", percent: 70, days: 30 }, { label: "訂金", percent: 30, days: 0 }])).toContain("由小到大");
    expect(normalizeInstallments("不是陣列")).toBeNull();
    expect(normalizeInstallments([{ label: " 訂金 ", percent: "30", days: "0" }])).toEqual([{ label: "訂金", percent: 30, days: 0 }]);
  });

  it("各期金額加總等於發票總額，尾差放最後一期", () => {
    const schedule = buildSchedule(1000.01, "2026-01-31", [{ label: "一", percent: 33.33, days: 0 }, { label: "二", percent: 33.33, days: 30 }, { label: "三", percent: 33.34, days: 60 }]);
    expect(schedule.map(r => r.dueDate)).toEqual(["2026-01-31", "2026-03-02", "2026-04-01"]);
    expect(Math.round(schedule.reduce((s, r) => s + r.amount, 0) * 100) / 100).toBe(1000.01);
  });

  it("收款從第一期往後沖，逾期只算已到期還沒收完的", () => {
    const schedule = buildSchedule(10000, "2026-01-01", deposit);
    const status = scheduleStatus(schedule, 3500, "2026-01-15");
    expect(status.rows.map(r => r.remaining)).toEqual([0, 6500]);
    expect(status.overdueAmount).toBe(0);
    expect(status.nextDueDate).toBe("2026-01-31");
    expect(scheduleStatus(schedule, 3500, "2026-02-10").overdueAmount).toBe(6500);
    expect(scheduleStatus(schedule, 0, "2026-01-02").overdueAmount).toBe(3000);
  });

  it("帳齡依各期到期日拆開；對不起來就不拆", () => {
    const schedule = buildSchedule(10000, "2026-01-01", deposit);
    const invoice = { invoiceDate: "2026-01-01", dueDate: "2026-01-31", paidAmount: 0, paymentSchedule: schedule };
    expect(agingParts(invoice, 10000, "2026-02-10")).toEqual([{ dueDate: "2026-01-01", amount: 3000 }, { dueDate: "2026-01-31", amount: 7000 }]);
    expect(agingParts(invoice, 8000, "2026-02-10")).toEqual([{ dueDate: "2026-01-31", amount: 8000 }]);
    expect(agingParts({ invoiceDate: "2026-01-01" }, 500, "2026-02-10")).toEqual([{ dueDate: "2026-01-01", amount: 500 }]);
  });
});

describe("庫存紀錄與盤點", () => {
  it("入庫為正、出庫為負", () => {
    expect([stockSign("Receipt"), stockSign("Issue"), stockSign("Transfer"), stockSign("???")]).toEqual([1, -1, -1, 0]);
  });

  it("只調整有填而且和帳上不同的品項", () => {
    const line = (itemId: number, systemQty: number, countedQty: number | null, unitCost: number) => ({ itemId, itemCode: `I${itemId}`, itemName: `品項${itemId}`, systemQty, countedQty, unitCost });
    const result = countDifferences([line(1, 10, 12, 50), line(2, 5, 3, 100), line(3, 8, 8, 20), line(4, 7, null, 999)]);
    expect(result.rows.map(r => [r.itemId, r.diff])).toEqual([[1, 2], [2, -2]]);
    expect(result.gain).toBe(100);
    expect(result.loss).toBe(200);
    expect(result.countedLines).toBe(3);
  });
});

describe("工時表與成品成本", () => {
  it("時薪＝月薪 ÷ 時薪除數", () => {
    expect(hourlyCostOf(48000, 240)).toBe(200);
    expect(hourlyCostOf("36000", null)).toBe(150);
    expect(hourlyCostOf(0, 240)).toBe(0);
  });

  it("擋掉不合理的工時", () => {
    const base = { workDate: "2026-11-10", today: "2026-11-12", hoursAlreadyThatDay: 0 };
    expect(timesheetProblem({ ...base, hours: 3.5 })).toBeNull();
    expect(timesheetProblem({ ...base, hours: 0 })).toBeTruthy();
    expect(timesheetProblem({ ...base, hours: 3.1 })).toContain("0.25");
    expect(timesheetProblem({ ...base, hours: 2, workDate: "2026-11-13" })).toContain("未來");
    expect(timesheetProblem({ ...base, hours: 4, hoursAlreadyThatDay: 21 })).toContain("24");
  });

  it("只有已核准的工時算成本", () => {
    const rows = [
      { projectId: 1, projectName: "A", employeeId: 1, hours: 4, costAmount: 800, status: "Approved" },
      { projectId: 1, projectName: "A", employeeId: 2, hours: 2, costAmount: 300, status: "Approved" },
      { projectId: 1, projectName: "A", employeeId: 2, hours: 3, costAmount: 450, status: "Submitted" },
      { projectId: 2, projectName: "B", employeeId: 1, hours: 9, costAmount: 1800, status: "Rejected" },
    ];
    expect(summarizeLabor(rows)).toEqual([{ projectId: 1, projectName: "A", approvedHours: 6, approvedCost: 1100, pendingHours: 3, people: 2 }]);
  });

  it("成品成本加上人工與工作站費用", () => {
    expect(conversionCost({ timesheetCosts: [800, 300.5], jobCards: [{ totalHours: 2.5, hourRate: 400 }, { totalHours: 1, hourRate: 0 }] })).toEqual({ labor: 1100.5, overhead: 1000, total: 2100.5 });
    expect(conversionCost({ timesheetCosts: [], jobCards: [] }).total).toBe(0);
  });
});

describe("催款、定期發票、預算", () => {
  it("催款階段依逾期天數", () => {
    expect([dunningLevel(5).level, dunningLevel(45).level, dunningLevel(61).level]).toEqual([1, 2, 3]);
  });

  it("下次開立日遇到小月退到月底，跨年正確", () => {
    expect(nextRunAfter("2026-01-31", "monthly")).toBe("2026-02-28");
    expect(nextRunAfter("2026-11-15", "quarterly")).toBe("2027-02-15");
    expect(nextRunAfter("2024-02-29", "yearly")).toBe("2025-02-28");
    expect(nextRunAfter("2026-12-01", "monthly")).toBe("2027-01-01");
  });

  it("定期發票範本的檢查", () => {
    const ok = { name: "月費", invoiceType: "Sales", customerId: 1, projectId: 2, frequency: "monthly", nextRunDate: "2026-12-01", items: [{ itemId: 1, quantity: 1, rate: 3000 }] };
    expect(recurringProblem(ok)).toBeNull();
    expect(recurringProblem({ ...ok, projectId: undefined })).toContain("專案");
    expect(recurringProblem({ ...ok, customerId: undefined })).toContain("客戶");
    expect(recurringProblem({ ...ok, endDate: "2026-11-01" })).toContain("結束日期");
    expect(recurringProblem({ ...ok, items: [] })).toBeTruthy();
  });

  it("年度預算平均分 12 個月，加總不差一毛", () => {
    const months = spreadAnnual(100000);
    expect(months).toHaveLength(12);
    expect(Math.round(months.reduce((s, n) => s + n, 0) * 100) / 100).toBe(100000);
  });

  it("費用看超支、收入看未達標", () => {
    expect(budgetVariance("Expense", 1000, 1200)).toMatchObject({ variance: 200, usedPercent: 120, over: true, short: false });
    expect(budgetVariance("Income", 1000, 800)).toMatchObject({ variance: -200, over: false, short: true });
    expect(budgetVariance("Expense", 0, 500)).toMatchObject({ usedPercent: null, over: false });
  });
});
