/**
 * AI CMO 排程決策與日期邊界單元測試
 * 執行：pnpm --filter @workspace/api-server run test:cmo
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { decideCmoActions, taipeiHour } from "./cmoScheduler";
import { addDays, taipeiDateString, taipeiDayStart } from "./cmoMetrics";
import { goalWindow, isValidCalendarDate } from "./cmoReport";

test("isValidCalendarDate：拒絕不存在的日曆日期", () => {
  assert.equal(isValidCalendarDate("2026-02-28"), true);
  assert.equal(isValidCalendarDate("2026-02-31"), false);
  assert.equal(isValidCalendarDate("2028-02-29"), true); // 閏年
  assert.equal(isValidCalendarDate("2026-13-01"), false);
  assert.equal(isValidCalendarDate("2026-9-1"), false);
});

test("goalWindow daily：每天獨立考核（隔天窗口重置）", () => {
  const w1 = goalWindow("daily", "2026-09-01", "2026-09-01", "2026-09-30");
  assert.deepEqual(w1, { winStart: "2026-09-01", winEnd: "2026-09-01", lastDay: "2026-09-01" });
  const w2 = goalWindow("daily", "2026-09-02", "2026-09-01", "2026-09-30");
  assert.deepEqual(w2, { winStart: "2026-09-02", winEnd: "2026-09-02", lastDay: "2026-09-02" });
});

test("goalWindow weekly：ISO 週一~週日，夾限於目標起迄", () => {
  // 2026-09-02 是週三 → 該週為 08-31（一）~ 09-06（日）
  const w = goalWindow("weekly", "2026-09-02", "2026-09-01", "2026-09-30");
  assert.deepEqual(w, { winStart: "2026-09-01", winEnd: "2026-09-06", lastDay: "2026-09-02" });
  // 下一週窗口切換
  const w2 = goalWindow("weekly", "2026-09-07", "2026-09-01", "2026-09-30");
  assert.deepEqual(w2, { winStart: "2026-09-07", winEnd: "2026-09-13", lastDay: "2026-09-07" });
});

test("goalWindow monthly / quarterly：月曆月與季界，跨窗口重算", () => {
  const m = goalWindow("monthly", "2026-09-15", "2026-08-01", "2026-12-31");
  assert.deepEqual(m, { winStart: "2026-09-01", winEnd: "2026-09-30", lastDay: "2026-09-15" });
  const m2 = goalWindow("monthly", "2026-10-01", "2026-08-01", "2026-12-31");
  assert.deepEqual(m2, { winStart: "2026-10-01", winEnd: "2026-10-31", lastDay: "2026-10-01" });
  const q = goalWindow("quarterly", "2026-08-10", "2026-01-01", "2026-12-31");
  assert.deepEqual(q, { winStart: "2026-07-01", winEnd: "2026-09-30", lastDay: "2026-08-10" });
});

test("goalWindow：asOf 在期間外回傳 null", () => {
  assert.equal(goalWindow("monthly", "2026-08-31", "2026-09-01", "2026-09-30"), null);
});

test("taipeiDateString：UTC 深夜跨日（台北已是隔天）", () => {
  // 2026-08-31 22:30 UTC = 2026-09-01 06:30 台北
  assert.equal(taipeiDateString(new Date("2026-08-31T22:30:00Z")), "2026-09-01");
  // 2026-09-01 15:59 UTC = 2026-09-01 23:59 台北
  assert.equal(taipeiDateString(new Date("2026-09-01T15:59:00Z")), "2026-09-01");
  // 2026-09-01 16:00 UTC = 2026-09-02 00:00 台北
  assert.equal(taipeiDateString(new Date("2026-09-01T16:00:00Z")), "2026-09-02");
});

test("taipeiDayStart / addDays：跨月與整日區間", () => {
  assert.equal(addDays("2026-09-01", -1), "2026-08-31");
  assert.equal(addDays("2026-08-31", 1), "2026-09-01");
  assert.equal(addDays("2026-12-31", 1), "2027-01-01");
  // 台北 9/1 00:00 = UTC 8/31 16:00
  assert.equal(taipeiDayStart("2026-09-01").toISOString(), "2026-08-31T16:00:00.000Z");
  // 一整日 = 24 小時
  const start = taipeiDayStart("2026-09-01").getTime();
  const end = taipeiDayStart(addDays("2026-09-01", 1)).getTime();
  assert.equal(end - start, 86400000);
});

test("taipeiHour：UTC 轉台北時", () => {
  assert.equal(taipeiHour(new Date("2026-09-01T16:05:00Z")), 0); // 台北 00:05
  assert.equal(taipeiHour(new Date("2026-08-31T23:00:00Z")), 7); // 台北 07:00
});

test("凌晨 tick：finalize 昨日快照，但 07:00 前不生成報告", () => {
  const d = decideCmoActions({
    hour: 0,
    today: "2026-09-02",
    finalizedFor: "2026-09-01", // 昨天 finalize 過，今日尚未
    yesterdaySnapshotExists: true,
    yesterdayDailyReportExists: false,
  });
  assert.equal(d.collectYesterday, true);
  assert.equal(d.generateYesterdayReport, false);
});

test("07:00 後：昨日報告不存在 → 生成（針對已完整結束的昨日）", () => {
  const d = decideCmoActions({
    hour: 7,
    today: "2026-09-02",
    finalizedFor: "2026-09-02",
    yesterdaySnapshotExists: true,
    yesterdayDailyReportExists: false,
  });
  assert.equal(d.collectYesterday, false);
  assert.equal(d.generateYesterdayReport, true);
});

test("07:00 後：昨日報告已存在 → 不重複生成（冪等）", () => {
  const d = decideCmoActions({
    hour: 9,
    today: "2026-09-02",
    finalizedFor: "2026-09-02",
    yesterdaySnapshotExists: true,
    yesterdayDailyReportExists: true,
  });
  assert.equal(d.generateYesterdayReport, false);
});

test("伺服器整夜停機後首個 tick：補收昨日快照並補生成報告", () => {
  const d = decideCmoActions({
    hour: 10,
    today: "2026-09-02",
    finalizedFor: null, // 剛啟動
    yesterdaySnapshotExists: false,
    yesterdayDailyReportExists: false,
  });
  assert.equal(d.collectYesterday, true);
  assert.equal(d.generateYesterdayReport, true);
});
