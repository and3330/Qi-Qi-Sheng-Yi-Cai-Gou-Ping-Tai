import { describe, expect, it } from "vitest";
import { needsReceiptReview } from "./receipt-review-rule";

describe("員工用 AI 開收款單要先給財務確認", () => {
  const receipt = { voucherType: "收款單", customerId: 1, items: [{ amount: 100 }] };
  it("一般員工、主管開的收款單要送審", () => {
    expect(needsReceiptReview("POST", "/vouchers", receipt, "staff")).toBe(true);
    expect(needsReceiptReview("POST", "/vouchers", receipt, "manager")).toBe(true);
    expect(needsReceiptReview("POST", "/vouchers", receipt, null)).toBe(true);
  });
  it("財務、會計、管理員自己開的直接入帳", () => {
    for (const role of ["accountant", "finance_admin", "owner", "admin", "super_admin"]) expect(needsReceiptReview("POST", "/vouchers", receipt, role)).toBe(false);
  });
  it("付款單和其他動作不受影響", () => {
    expect(needsReceiptReview("POST", "/vouchers", { ...receipt, voucherType: "付款單" }, "staff")).toBe(false);
    expect(needsReceiptReview("PATCH", "/vouchers", receipt, "staff")).toBe(false);
    expect(needsReceiptReview("POST", "/quotations", receipt, "staff")).toBe(false);
  });
});
