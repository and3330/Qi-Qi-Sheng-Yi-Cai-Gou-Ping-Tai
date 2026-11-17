import { describe, expect, it } from "vitest";
import { judgeRequest, normalizePath, trimResult } from "./admin-guard";
import { ROLE_TOOLS, ADMIN_ONLY_TOOLS, resolveIdentity } from "./identity";

const allowed = (method: string, path: string, body?: unknown) => judgeRequest(method, path, body).allowed;

describe("AI 全權身分的把關", () => {
  it("各模組的查詢與建立都可以", () => {
    for (const path of ["/purchase-orders", "/items", "/employees", "/salary-slips", "/leaves", "/work-orders", "/assets", "/journal-entries", "/rfqs"]) {
      expect(allowed("GET", path)).toBe(true);
    }
    expect(allowed("POST", "/purchase-orders", { supplierId: 1 })).toBe(true);
    expect(allowed("POST", "/purchase-receipts/from-order/5", {})).toBe(true);
    expect(allowed("POST", "/invoices", { invoiceType: "Sales" })).toBe(true);
    expect(allowed("POST", "/sales-orders/3/issue-ecpay-invoice", {})).toBe(true);
    expect(allowed("POST", "/leaves", { employeeId: 1 })).toBe(true);
    expect(allowed("PATCH", "/sales-orders/3", { status: "Confirmed" })).toBe(true);
    expect(allowed("PATCH", "/purchase-receipts/3", { status: "Submitted" })).toBe(true);
    expect(allowed("POST", "/vouchers", { voucherType: "收款單" })).toBe(true);
  });

  it("讓錢出去的動作留給人", () => {
    expect(allowed("POST", "/vouchers", { voucherType: "付款單" })).toBe(false);
    expect(allowed("PATCH", "/payment-requests/9", { status: "Paid" })).toBe(false);
    expect(allowed("POST", "/service-fees/2/pay", {})).toBe(false);
    expect(allowed("POST", "/advances/2/repay", {})).toBe(false);
    expect(allowed("PATCH", "/salary-slips/2", { status: "Paid" })).toBe(false);
  });

  it("作廢、取消、刪除、核准留給人", () => {
    expect(allowed("DELETE", "/customers/1")).toBe(false);
    expect(allowed("POST", "/payment-requests/1/void", {})).toBe(false);
    expect(allowed("POST", "/invoices/1/void-ecpay", {})).toBe(false);
    expect(allowed("PATCH", "/sales-orders/1", { status: "Cancelled" })).toBe(false);
    expect(allowed("PATCH", "/payment-requests/1", { status: "Approved" })).toBe(false);
    expect(allowed("PATCH", "/leaves/1/approve", {})).toBe(false);
    expect(allowed("PATCH", "/sales-orders/1", { status: "Confirmed", overrideCreditLimit: true })).toBe(false);
  });

  it("帳號、金鑰、備份完全不開放；系統設定只能查", () => {
    for (const path of ["/admin/users", "/api-keys", "/backup/run", "/billing", "/platform/tenants", "/auth/login", "/ai-drafts/1/confirm"]) {
      expect(allowed("GET", path)).toBe(false);
      expect(allowed("POST", path, {})).toBe(false);
    }
    expect(allowed("GET", "/accounting-settings")).toBe(true);
    expect(allowed("PUT", "/accounting-settings", { lockDate: "2026-01-01" })).toBe(false);
    expect(allowed("POST", "/batch/customers/update", {})).toBe(false);
    expect(allowed("POST", "/email/send", {})).toBe(false);
  });

  it("路徑只接受單純的形式", () => {
    expect(normalizePath("/purchase-orders")).toBe("/purchase-orders");
    expect(normalizePath("/api/items/3/")).toBe("/items/3");
    expect(normalizePath("/items?x=1")).toBe("/items");
    for (const bad of ["items", "/items/../admin", "/items//x", "/items/%2e%2e", "/a b", "http://evil.test/x", 5, ""]) {
      expect(normalizePath(bad)).toBeNull();
    }
    // 即使繞過正規化，封閉區的前綴比對也擋得住
    expect(allowed("GET", "/admin")).toBe(false);
    expect(allowed("GET", "/administrators")).toBe(true);
  });

  it("清單太長會截短並回報總數", () => {
    const rows = Array.from({ length: 250 }, (_, i) => ({ id: i }));
    expect(trimResult(rows)).toMatchObject({ truncated: true, total: 250 });
    expect((trimResult(rows).data as unknown[]).length).toBe(100);
    expect(trimResult({ data: rows, page: 1 })).toMatchObject({ truncated: true, total: 250 });
    expect(trimResult({ id: 1 })).toMatchObject({ truncated: false });
  });
});

describe("全權金鑰", () => {
  const key = (seed: string) => seed.repeat(30).slice(0, 32);
  it("只有全權身分拿得到通用操作與 PDF 工具，其他身分的權限沒有變多", () => {
    for (const tool of ADMIN_ONLY_TOOLS) {
      expect(ROLE_TOOLS.admin).toContain(tool);
      for (const role of ["sales", "finance", "readonly", "legacy"] as const) expect(ROLE_TOOLS[role]).not.toContain(tool);
    }
  });
  it("用 ERP_AI_KEY_ADMIN 設定；和其他金鑰相同就整個停用", () => {
    const env = { ERP_AI_KEY_ADMIN: key("a"), ERP_AI_KEY_SALES: key("s") };
    expect(resolveIdentity(`Bearer ${key("a")}`, env)).toEqual({ ok: true, role: "admin" });
    expect(resolveIdentity(`Bearer ${key("s")}`, env)).toEqual({ ok: true, role: "sales" });
    expect(resolveIdentity(`Bearer ${key("x")}`, env)).toEqual({ ok: false, reason: "unauthorized" });
    expect(resolveIdentity(`Bearer ${key("a")}`, { ERP_AI_KEY_ADMIN: key("a"), ERP_AI_KEY_SALES: key("a") })).toEqual({ ok: false, reason: "misconfigured" });
    expect(resolveIdentity("Bearer short", { ERP_AI_KEY_ADMIN: "short" })).toEqual({ ok: false, reason: "unconfigured" });
  });

  it("歷史資料匯入不開放給 AI（就算是使用者按過確認的內建對話也一樣）", () => {
    for (const path of ["/sales-orders/legacy-import", "/quotations/legacy-import", "/purchase-orders/legacy-import", "/purchase-receipts/legacy-import", "/vouchers/legacy-import", "/legacy-documents/import"]) {
      expect(judgeRequest("POST", path, { rows: [] }).allowed).toBe(false);
      expect(judgeRequest("POST", path, { rows: [] }, { humanConfirmed: true }).allowed).toBe(false);
    }
    expect(judgeRequest("GET", "/invoices/legacy", {}).allowed).toBe(true);
  });

  it("新的模組：人事合約與任務可以建立、修改；刪除與撤回留給人", () => {
    expect(judgeRequest("POST", "/hr-contracts", { title: "x" }).allowed).toBe(true);
    expect(judgeRequest("PATCH", "/hr-contracts/3", { endDate: "2027-01-01" }).allowed).toBe(true);
    expect(judgeRequest("DELETE", "/hr-contracts/3", {}).allowed).toBe(false);
    expect(judgeRequest("PATCH", "/tasks/3", { taskGroup: "開課前準備" }).allowed).toBe(true);
    expect(judgeRequest("POST", "/my-requests", { lines: [] }).allowed).toBe(true);
    expect(judgeRequest("POST", "/my-requests/3/cancel", {}).allowed).toBe(false);
    expect(judgeRequest("POST", "/batch/tasks/update", { ids: [1] }).allowed).toBe(false);
  });
});
