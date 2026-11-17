import { describe, expect, it } from "vitest";
import { batchDeleteRule, batchRoleError, batchUpdateError, isDraftStatus } from "../batch-policy";

describe("批次操作：角色", () => {
  it("會計資料只有財會角色能批次操作", () => {
    expect(batchRoleError("journal-entries", { role: "accountant" })).toBeNull();
    expect(batchRoleError("journal-entries", { role: "super_admin" })).toBeNull();
    expect(batchRoleError("journal-entries", { role: "sales" })).toMatch("權限不足");
    expect(batchRoleError("vouchers", { role: "hr_admin" })).toMatch("權限不足");
    expect(batchRoleError("accounts", { role: null })).toMatch("權限不足");
  });

  it("員工與薪資只有人資相關角色能批次操作", () => {
    expect(batchRoleError("employees", { role: "hr_admin" })).toBeNull();
    expect(batchRoleError("employees", { role: "accountant" })).toMatch("權限不足");
    expect(batchRoleError("salary-slips", { role: "finance_admin" })).toBeNull();
  });

  it("API Key 只有 admin 權限可操作受角色保護的資料；一般資料不受影響", () => {
    expect(batchRoleError("invoices", { apiKey: true, apiKeyPermissions: "readwrite" })).toMatch("API Key");
    expect(batchRoleError("invoices", { apiKey: true, apiKeyPermissions: "admin" })).toBeNull();
    expect(batchRoleError("customers", { role: "sales" })).toBeNull();
  });
});

describe("批次操作：狀態管制", () => {
  it("狀態會連動庫存或帳務的單據不能批次改狀態", () => {
    for (const entity of ["sales-orders", "delivery-notes", "purchase-receipts", "journal-entries", "invoices", "vouchers", "salary-slips", "work-orders"]) {
      expect(batchUpdateError(entity, "單據", ["status"])).toMatch("不能批次變更");
    }
  });

  it("不影響其他欄位，也不影響沒有連動的資料", () => {
    expect(batchUpdateError("sales-orders", "銷貨單", ["label"])).toBeNull();
    expect(batchUpdateError("work-orders", "工單", ["priority"])).toBeNull();
    expect(batchUpdateError("customers", "客戶", ["status"])).toBeNull();
    expect(batchUpdateError("quality-inspections", "品檢", ["status"])).toBeNull();
  });
});

describe("批次操作：刪除管制", () => {
  it("已入帳的流水紀錄不能批次刪除", () => {
    for (const entity of ["stock-entries", "invoices", "vouchers", "asset-depreciation"]) {
      expect(batchDeleteRule(entity).kind).toBe("forbidden");
    }
  });

  it("交易單據只能刪草稿；主檔維持原本的參照檢查", () => {
    for (const entity of ["journal-entries", "sales-orders", "delivery-notes", "purchase-receipts", "work-orders", "salary-slips"]) {
      expect(batchDeleteRule(entity).kind).toBe("draft-only");
    }
    expect(batchDeleteRule("customers").kind).toBe("open");
  });

  it("草稿狀態的各種寫法都認得，已過帳的不算", () => {
    expect(isDraftStatus("Draft")).toBe(true);
    expect(isDraftStatus("draft")).toBe(true);
    expect(isDraftStatus("草稿")).toBe(true);
    expect(isDraftStatus("Posted")).toBe(false);
    expect(isDraftStatus(null)).toBe(false);
  });
});
