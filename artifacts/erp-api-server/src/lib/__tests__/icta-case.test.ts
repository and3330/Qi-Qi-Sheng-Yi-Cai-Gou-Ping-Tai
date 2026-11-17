import { describe, expect, it } from "vitest";
import { ictaBaseUrlError, ictaCaseRecord, parseCaseTime, salesOrderToIctaCase } from "../icta-case";

const order = {
  orderNumber: "SO-2026-0001", status: "Confirmed", label: "115(上) A 國小 魔術社", courseStartDate: "2026-12-01", courseEndDate: "2027-01-12",
  caseTime: "13:30-15:00", classWeeks: 8, teacherFeePerSession: "1500.00", coursePeriod: "115上", remarks: "需自備撲克牌",
  items: [{ itemName: "魔術社團課", quantity: 8 }],
};
const customer = { name: "A 國小", address: "台北市某路 1 號" };

describe("銷貨單送件到 ICTA PRO", () => {
  it("把銷貨單整理成講師案件", () => {
    const r = salesOrderToIctaCase(order, customer);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.payload).toMatchObject({
      externalRef: "SO-2026-0001", title: "115(上) A 國小 魔術社", startDate: "2026-12-01", endDate: "2027-01-12",
      startTime: "13:30", endTime: "15:00", location: "A 國小", address: "台北市某路 1 號", sessions: 8, sessionFee: 1500, semester: "115上",
    });
    expect(r.payload.description).toContain("需自備撲克牌");
    expect(r.payload.description).toContain("魔術社團課 × 8");
    expect(r.payload.description).toContain("SO-2026-0001");
  });

  it("草稿、已取消、沒日期、沒客戶都不送，並說明原因", () => {
    expect(salesOrderToIctaCase({ ...order, status: "Draft" }, customer)).toMatchObject({ ok: false, error: expect.stringContaining("成立") });
    expect(salesOrderToIctaCase({ ...order, status: "Cancelled" }, customer).ok).toBe(false);
    expect(salesOrderToIctaCase({ ...order, courseStartDate: null }, customer)).toMatchObject({ ok: false, error: expect.stringContaining("課程開始日") });
    expect(salesOrderToIctaCase(order, null)).toMatchObject({ ok: false, error: expect.stringContaining("客戶") });
    expect(salesOrderToIctaCase({ ...order, courseEndDate: "2026-11-01" }, customer).ok).toBe(false);
  });

  it("沒填的欄位用合理的替代：交期當開始日、品名當案件名稱、堂數至少 1", () => {
    const r = salesOrderToIctaCase({ orderNumber: "SO-9", status: "Completed", deliveryDate: "2026-12-05", items: [{ itemName: "氣球課" }] }, { name: "B 幼兒園" });
    expect(r).toMatchObject({ ok: true, payload: { title: "氣球課", startDate: "2026-12-05", sessions: 1, location: "B 幼兒園" } });
    if (r.ok) { expect(r.payload.sessionFee).toBeUndefined(); expect(r.payload.startTime).toBeUndefined(); }
  });

  it("上課時間看得懂幾種寫法", () => {
    expect(parseCaseTime("13:30-15:00")).toEqual({ startTime: "13:30", endTime: "15:00" });
    expect(parseCaseTime("週三 8：10～9：00")).toEqual({ startTime: "08:10", endTime: "09:00" });
    expect(parseCaseTime("1330")).toEqual({ startTime: "13:30" });
    expect(parseCaseTime("下午")).toEqual({});
    expect(parseCaseTime(null)).toEqual({});
  });

  it("查詢現況時保留第一次送件的人和時間", () => {
    const first = ictaCaseRecord({ id: 7, status: "pending", statusLabel: "待媒合", teachers: [] }, null, "amy", "2026-11-16T01:00:00.000Z");
    const later = ictaCaseRecord({ id: 7, status: "confirmed", statusLabel: "已確認講師", teachers: [{ name: "王老師", role: "main" }, { role: "x" }] }, first, "bob", "2026-11-17T01:00:00.000Z");
    expect(later).toEqual({ id: 7, status: "confirmed", statusLabel: "已確認講師", teachers: [{ name: "王老師", role: "main" }], sentAt: "2026-11-16T01:00:00.000Z", sentBy: "amy", checkedAt: "2026-11-17T01:00:00.000Z" });
  });

  it("連線網址要 https，本機測試例外", () => {
    expect(ictaBaseUrlError("https://icta-pro.com")).toBeNull();
    expect(ictaBaseUrlError("http://localhost:5000")).toBeNull();
    expect(ictaBaseUrlError("http://icta-pro.com")).toMatch(/https/);
    expect(ictaBaseUrlError("https://user:pw@icta-pro.com")).toMatch(/網域/);
    expect(ictaBaseUrlError("icta-pro")).toMatch(/格式/);
  });
});
