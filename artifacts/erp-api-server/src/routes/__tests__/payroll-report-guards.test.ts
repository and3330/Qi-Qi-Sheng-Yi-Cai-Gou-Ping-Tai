import { describe, expect, it } from "vitest";
import { finitePayrollAmount, positiveBaseSalary, validatePayrollIdentity } from "../payroll-guards";
import { isValidIsoDate, safeJournalLines, validateReportQuery } from "../report-guards";

describe("payroll boundary guards", () => {
  it("rejects zero or non-finite base salary while preserving valid salary", () => {
    expect(() => positiveBaseSalary(0)).toThrow("有效底薪");
    expect(() => positiveBaseSalary("not-a-number")).toThrow("有效底薪");
    expect(positiveBaseSalary("32000.4")).toBe(32000);
  });

  it("rejects malformed tenant-scoped IDs, periods and non-finite amounts", () => {
    expect(validatePayrollIdentity("foreign-looking-id", 2026, 2)).toContain("employeeId");
    expect(validatePayrollIdentity(3, 2026, 13)).toContain("month");
    expect(validatePayrollIdentity(3, 2026, 2)).toBeNull();
    expect(() => finitePayrollAmount("Infinity", "overtimePay")).toThrow("有限數字");
  });
});

describe("report historical-data and query guards", () => {
  it("accepts valid and truly empty journal lines", () => {
    const lines = safeJournalLines([{ accountId: 10, debit: "125.5", credit: 20 }]);
    expect(lines).toEqual([
      { accountId: 10, debit: 125.5, credit: 20 },
    ]);
    expect(safeJournalLines([])).toEqual([]);
    expect(safeJournalLines(null)).toEqual([]);
  });

  it("rejects malformed historical lines rather than returning clean-looking totals", () => {
    expect(() => safeJournalLines([{ accountId: 10, debit: "bad", credit: 0 }])).toThrow("歷史財務資料異常");
    expect(() => safeJournalLines([{ accountId: 11, debit: Infinity, credit: 20 }])).toThrow("有限數字");
    expect(() => safeJournalLines([{ accountId: "bad", debit: 999, credit: 0 }])).toThrow("科目 ID 無效");
    expect(() => safeJournalLines([null])).toThrow("明細格式錯誤");
  });

  it("rejects impossible dates, reversed ranges and invalid scoped IDs", () => {
    expect(isValidIsoDate("2024-02-29")).toBe(true);
    expect(isValidIsoDate("2025-02-29")).toBe(false);
    expect(validateReportQuery({ startDate: "2026-03-02", endDate: "2026-03-01" })).toContain("起始日期");
    expect(validateReportQuery({ projectId: "NaN" })).toContain("projectId");
    expect(validateReportQuery({ accountId: "4", startDate: "2026-03-01" })).toBeNull();
  });
});