import { describe, it, expect, vi } from "vitest";

// 只測路徑與權限的判斷（純函式），不需要資料庫
vi.mock("@workspace/erp-db", () => ({ db: {} }));
vi.mock("@workspace/erp-db/schema", () => ({ menuPermissionsTable: {} }));

import { actionForRequest, customRoleDenial, viewerDenial } from "../permission-guard";

const role = {
  name: "倉管",
  permissions: {
    "/inventory/items": ["view", "edit"],
    "/inventory/lookup": ["view"],
    "/purchasing/orders": ["view", "create"],
  } as Record<string, any>,
};

describe("由請求判斷動作", () => {
  it("讀取是檢視、刪除是刪除、修改是修改", () => {
    expect(actionForRequest("GET", "/items", "/items")).toBe("view");
    expect(actionForRequest("DELETE", "/items/3", "/items")).toBe("delete");
    expect(actionForRequest("PATCH", "/items/3", "/items")).toBe("edit");
  });

  it("對清單 POST 是新增，對某一筆底下的動作算修改", () => {
    expect(actionForRequest("POST", "/purchase-orders", "/purchase-orders")).toBe("create");
    expect(actionForRequest("POST", "/quotations/4/convert-to-sales-order", "/quotations")).toBe("edit");
  });

  it("報表與 AI 查詢用 POST 仍算檢視", () => {
    expect(actionForRequest("POST", "/ai/ask", "/ai/ask")).toBe("view");
    expect(actionForRequest("POST", "/reports/sales-analysis", "/reports/sales-analysis")).toBe("view");
  });
});

describe("自訂角色把關", () => {
  it("有勾的動作放行", () => {
    expect(customRoleDenial(role, "GET", "/items")).toBeNull();
    expect(customRoleDenial(role, "PATCH", "/items/9")).toBeNull();
    expect(customRoleDenial(role, "POST", "/purchase-orders")).toBeNull();
    expect(customRoleDenial(role, "GET", "/inventory-lookup")).toBeNull();
  });

  it("沒勾的動作擋下，並說明缺哪一種權限", () => {
    expect(customRoleDenial(role, "POST", "/items")).toContain("新增");
    expect(customRoleDenial(role, "DELETE", "/items/9")).toContain("刪除");
    expect(customRoleDenial(role, "PATCH", "/purchase-orders/2")).toContain("修改");
  });

  it("完全沒勾的功能連檢視都不行", () => {
    expect(customRoleDenial(role, "GET", "/customers")).toContain("檢視");
    expect(customRoleDenial(role, "GET", "/journal-entries")).toContain("檢視");
  });

  it("登入、通知、搜尋這類基本操作不受影響", () => {
    expect(customRoleDenial(role, "GET", "/admin/me")).toBeNull();
    expect(customRoleDenial(role, "POST", "/admin/logout")).toBeNull();
    expect(customRoleDenial(role, "PATCH", "/notifications/5")).toBeNull();
    expect(customRoleDenial(role, "GET", "/global-search")).toBeNull();
  });

  it("共用同一組資料的頁面，只要其中一頁有權限就能用", () => {
    const sales = { name: "業務", permissions: { "/sales/orders": ["view", "create"] } as Record<string, any> };
    expect(customRoleDenial(sales, "POST", "/sales-orders")).toBeNull();
    expect(customRoleDenial(sales, "DELETE", "/sales-orders/1")).toContain("刪除");
  });
});

describe("一般員工（僅可檢視）", () => {
  it("可以讀，不能新增、修改、刪除", () => {
    expect(viewerDenial("GET", "/customers")).toBeNull();
    expect(viewerDenial("POST", "/customers")).toContain("只能檢視");
    expect(viewerDenial("PATCH", "/sales-orders/3")).toContain("只能檢視");
    expect(viewerDenial("DELETE", "/items/3")).toContain("只能檢視");
  });

  it("自己的打卡、請假、通知與 AI 查詢仍然可以用", () => {
    expect(viewerDenial("POST", "/attendance")).toBeNull();
    expect(viewerDenial("POST", "/leaves")).toBeNull();
    expect(viewerDenial("PATCH", "/notifications/1")).toBeNull();
    expect(viewerDenial("POST", "/ai/ask")).toBeNull();
    expect(viewerDenial("POST", "/admin/me/change-password")).toBeNull();
  });
});
