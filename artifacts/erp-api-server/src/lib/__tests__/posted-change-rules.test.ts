import { describe, expect, it } from "vitest";
import { changedOnly, driftedFields, isNormalFlow, isPostedStatus, matchPostedRule, originalFor, sameValue } from "../posted-change-rules";

describe("已入帳單據的修改、作廢要送審", () => {
  it("找得到每種單據的修改、作廢網址", () => {
    expect(matchPostedRule("PATCH", "/invoices/12")).toMatchObject({ id: 12, rule: { table: "invoices", action: "修改" } });
    expect(matchPostedRule("post", "/invoices/12/write-off")?.rule.action).toBe("沖銷呆帳");
    expect(matchPostedRule("POST", "/payment-requests/3/void")?.rule.table).toBe("payment_requests");
    expect(matchPostedRule("PUT", "/stock-counts/9")?.rule.table).toBe("stock_counts");
    expect(matchPostedRule("PUT", "/salary-slips/5/status")?.rule.table).toBe("salary_slips");
    // 新增、刪除、查詢不擋
    expect(matchPostedRule("POST", "/invoices")).toBeNull();
    expect(matchPostedRule("DELETE", "/invoices/12")).toBeNull();
    expect(matchPostedRule("GET", "/invoices/12")).toBeNull();
    expect(matchPostedRule("PATCH", "/invoices/12/extra")).toBeNull();
  });

  it("草稿可以自由改，入帳後才要審", () => {
    const inv = matchPostedRule("PATCH", "/invoices/1")!.rule;
    expect(isPostedStatus(inv, "Draft")).toBe(false);
    expect(isPostedStatus(inv, "Unpaid")).toBe(true);
    expect(isPostedStatus(inv, "Cancelled")).toBe(false);
    const so = matchPostedRule("PATCH", "/sales-orders/1")!.rule;
    expect(isPostedStatus(so, "Draft")).toBe(false);
    expect(isPostedStatus(so, "Confirmed")).toBe(true);
    const pr = matchPostedRule("POST", "/payment-requests/1/void")!.rule;
    expect(isPostedStatus(pr, "Approved")).toBe(false);
    expect(isPostedStatus(pr, "Paid")).toBe(true);
  });

  it("往下一步走的狀態變更不用審；取消、改內容要審", () => {
    const so = matchPostedRule("PATCH", "/sales-orders/1")!.rule;
    expect(isNormalFlow(so, { status: "Completed" })).toBe(true);
    expect(isNormalFlow(so, { status: "Cancelled" })).toBe(false);
    expect(isNormalFlow(so, { status: "Completed", remarks: "x" })).toBe(false);
    expect(isNormalFlow(so, { remarks: "x" })).toBe(false);
    const sr = matchPostedRule("PATCH", "/sales-returns/1")!.rule;
    expect(isNormalFlow(sr, { status: "Completed" })).toBe(false);
  });

  it("改之前的值從資料表欄位對過來", () => {
    expect(originalFor({ remarks: "舊", invoice_title: "A 公司", status: "Unpaid" }, { remarks: "新", invoiceTitle: "B 公司", other: 1 }))
      .toEqual({ remarks: "舊", invoiceTitle: "A 公司" });
  });

  it("只送審真的有改的欄位", () => {
    const row = { remarks: "舊", invoice_title: "A 公司", delivery_date: new Date(2026, 10, 16), class_weeks: null, teacher_fee_per_session: "1500.00", extra_fields: { a: 1 }, status: "Completed" };
    expect(changedOnly(row, { remarks: "新", invoiceTitle: "A 公司", deliveryDate: "2026-11-16", classWeeks: "", teacherFeePerSession: 1500, extraFields: { a: 1 }, overrideCreditLimit: true }))
      .toEqual({ remarks: "新", overrideCreditLimit: true });
    expect(changedOnly(row, { remarks: "舊", status: "Completed" })).toEqual({});
    expect(changedOnly(row, { status: "Cancelled" })).toEqual({ status: "Cancelled" });
    expect(sameValue("10", 10.0)).toBe(true);
    expect(sameValue(null, 0)).toBe(false);
  });

  it("進貨單攤入附加費用也要審", () => {
    expect(matchPostedRule("POST", "/purchase-receipts/7/landed-cost")?.rule.action).toBe("攤入附加費用");
  });

  it("送審後單據又被改過會被擋下來", () => {
    expect(driftedFields({ remarks: "舊", status: "Completed" }, { remarks: "舊" })).toEqual([]);
    expect(driftedFields({ remarks: "別人改的", status: "Completed" }, { remarks: "舊" })).toEqual(["remarks"]);
    expect(driftedFields({ remarks: "舊" }, null)).toEqual([]);
  });
});
