import { describe, expect, it } from "vitest";
import {
  addMonths, annualLeaveDaysForYears, computeCheckout, countLeaveDays, currentAnnualLeavePeriod,
  isDateString, lateMinutesFor, leaveLimitProblem, nextAnnualLeaveGrant, seniorityText, summarizeMonth,
} from "../hr-rules";

const DAY_SHIFT = { startTime: "09:00", endTime: "18:00", breakStart: "12:00", breakEnd: "13:00", workingHours: "8" };
const NIGHT_SHIFT = { startTime: "22:00", endTime: "06:00", breakStart: "02:00", breakEnd: "03:00", workingHours: "7" };

describe("特休天數（勞基法第 38 條）", () => {
  it("依年資對照法定天數", () => {
    expect([1, 2, 3, 4, 5, 9].map(annualLeaveDaysForYears)).toEqual([7, 10, 14, 14, 15, 15]);
    expect(annualLeaveDaysForYears(10)).toBe(16);
    expect(annualLeaveDaysForYears(11)).toBe(17);
    expect(annualLeaveDaysForYears(24)).toBe(30);
    expect(annualLeaveDaysForYears(40)).toBe(30);
  });

  it("到職未滿半年沒有特休，滿半年給 3 天到滿一年前一天", () => {
    expect(currentAnnualLeavePeriod("2026-01-15", "2026-07-14")).toBeNull();
    expect(currentAnnualLeavePeriod("2026-01-15", "2026-07-15")).toMatchObject({
      periodStart: "2026-07-15", periodEnd: "2027-01-14", days: 3, label: "滿半年",
    });
  });

  it("滿一年起每年一個區間", () => {
    expect(currentAnnualLeavePeriod("2024-03-01", "2026-11-11")).toMatchObject({
      periodStart: "2026-03-01", periodEnd: "2027-02-28", days: 10, seniorityYears: 2,
    });
    expect(currentAnnualLeavePeriod("2016-11-11", "2026-11-11")).toMatchObject({ days: 16, seniorityYears: 10 });
  });

  it("月底到職的人用當月最後一天計算", () => {
    expect(addMonths("2025-08-31", 6)).toBe("2026-02-28");
    expect(currentAnnualLeavePeriod("2024-02-29", "2025-03-01")).toMatchObject({ periodStart: "2025-02-28", days: 7 });
  });

  it("算出下一次發放的日期與天數", () => {
    expect(nextAnnualLeaveGrant("2026-09-01", "2026-11-11")).toEqual({ date: "2027-03-01", days: 3, label: "滿半年" });
    expect(nextAnnualLeaveGrant("2024-03-01", "2026-11-11")).toMatchObject({ date: "2027-03-01", days: 14 });
  });

  it("年資文字", () => {
    expect(seniorityText("2024-03-01", "2026-11-11")).toBe("2 年 8 個月");
    expect(seniorityText("2026-09-20", "2026-11-11")).toBe("1 個月");
  });

  it("不存在的日期不算日期", () => {
    expect(isDateString("2026-02-30")).toBe(false);
    expect(isDateString("2026-02-28")).toBe(true);
  });
});

describe("請假天數", () => {
  it("不把六日與假日算進去", () => {
    // 2026-11-13（五）到 11-17（二）：中間隔一個週末
    expect(countLeaveDays({ leaveType: "Casual Leave", fromDate: "2026-11-13", toDate: "2026-11-17" })).toBe(3);
    expect(countLeaveDays({ leaveType: "Casual Leave", fromDate: "2026-11-13", toDate: "2026-11-17", holidays: new Set(["2026-11-16"]) })).toBe(2);
    expect(countLeaveDays({ leaveType: "Casual Leave", fromDate: "2026-11-14", toDate: "2026-11-15" })).toBe(0);
  });

  it("半天假算 0.5 天", () => {
    expect(countLeaveDays({ leaveType: "Annual Leave", fromDate: "2026-11-13", toDate: "2026-11-13", dayPart: "am" })).toBe(0.5);
  });

  it("產假以日曆天計算", () => {
    expect(countLeaveDays({ leaveType: "Maternity Leave", fromDate: "2026-11-01", toDate: "2026-12-26" })).toBe(56);
  });

  it("事假一年 14 天，家庭照顧假併入計算", () => {
    const existing = [
      { leaveType: "Casual Leave", fromDate: "2026-03-02", toDate: "2026-03-13", totalDays: 10 },
      { leaveType: "Family Care Leave", fromDate: "2026-05-04", toDate: "2026-05-06", totalDays: 3 },
    ];
    expect(leaveLimitProblem({ leaveType: "Casual Leave", fromDate: "2026-11-12", requestedDays: 1, existing })).toBeNull();
    expect(leaveLimitProblem({ leaveType: "Casual Leave", fromDate: "2026-11-12", requestedDays: 2, existing })).toContain("14");
    expect(leaveLimitProblem({ leaveType: "Family Care Leave", fromDate: "2026-11-12", requestedDays: 2, existing })).toContain("14");
  });

  it("生理假每月 1 天", () => {
    const existing = [{ leaveType: "Menstrual Leave", fromDate: "2026-11-03", toDate: "2026-11-03", totalDays: 1 }];
    expect(leaveLimitProblem({ leaveType: "Menstrual Leave", fromDate: "2026-11-20", requestedDays: 1, existing })).toContain("每月");
    expect(leaveLimitProblem({ leaveType: "Menstrual Leave", fromDate: "2026-12-01", requestedDays: 1, existing })).toBeNull();
  });
});

describe("打卡計算", () => {
  it("5 分鐘內不算遲到，超過就從表定時間起算", () => {
    expect(lateMinutesFor(DAY_SHIFT, "09:05")).toBe(0);
    expect(lateMinutesFor(DAY_SHIFT, "09:10")).toBe(10);
    expect(lateMinutesFor(DAY_SHIFT, "08:40")).toBe(0);
  });

  it("下班算工時、早退、加班（半小時為單位）", () => {
    expect(computeCheckout(DAY_SHIFT, "09:00", "18:00")).toEqual({ workingHours: 8, overtimeHours: 0, earlyLeaveMinutes: 0 });
    expect(computeCheckout(DAY_SHIFT, "09:00", "17:30")).toMatchObject({ workingHours: 7.5, earlyLeaveMinutes: 30 });
    expect(computeCheckout(DAY_SHIFT, "09:00", "20:50")).toMatchObject({ workingHours: 10.83, overtimeHours: 2.5 });
  });

  it("跨夜班過了午夜才下班", () => {
    expect(computeCheckout(NIGHT_SHIFT, "22:00", "06:00")).toEqual({ workingHours: 7, overtimeHours: 0, earlyLeaveMinutes: 0 });
    expect(lateMinutesFor(NIGHT_SHIFT, "22:20")).toBe(20);
  });
});

describe("月出勤彙總", () => {
  const record = (date: string, extra: Record<string, unknown> = {}) => ({
    date, status: "Present", lateMinutes: 0, earlyLeaveMinutes: 0, workingHours: "8", overtimeHours: "0",
    checkIn: "09:00", checkOut: "18:00", ...extra,
  });

  it("今天與未來的日子不算缺勤", () => {
    // 2026-11：11/2（一）～11/10（二）有 7 個工作日，今天是 11/11
    const s = summarizeMonth({ year: 2026, month: 11, today: "2026-11-11", records: [record("2026-11-02")], approvedLeaves: [] });
    expect(s.absentDays).toBe(6);
    expect(s.workingDays).toBe(21);
  });

  it("到職前、離職後、假日不算缺勤", () => {
    const s = summarizeMonth({
      year: 2026, month: 11, today: "2026-12-01",
      joinDate: "2026-11-09", resignationDate: "2026-11-20", holidays: new Set(["2026-11-12"]),
      records: [], approvedLeaves: [],
    });
    // 11/9～11/20 共 10 個平日，扣掉 1 天假日
    expect(s.workingDays).toBe(9);
    expect(s.absentDays).toBe(9);
  });

  it("請假不算缺勤，事假與病假換算扣薪天數", () => {
    const s = summarizeMonth({
      year: 2026, month: 11, today: "2026-12-01", joinDate: "2026-11-23",
      records: [record("2026-11-23"), record("2026-11-27", { checkOut: null, workingHours: null })],
      approvedLeaves: [
        { leaveType: "Casual Leave", fromDate: "2026-11-24", toDate: "2026-11-25", totalDays: 2 },
        { leaveType: "Sick Leave", fromDate: "2026-11-26", toDate: "2026-11-26", totalDays: 1 },
        { leaveType: "Annual Leave", fromDate: "2026-11-30", toDate: "2026-12-02", totalDays: 3 },
      ],
    });
    expect(s.absentDays).toBe(0);
    expect(s.leaveDays).toBe(4); // 特休跨月，只算 11/30 這一天
    expect(s.unpaidLeaveDays).toBe(2.5);
    expect(s.missingCheckoutDays).toBe(1);
  });
});
