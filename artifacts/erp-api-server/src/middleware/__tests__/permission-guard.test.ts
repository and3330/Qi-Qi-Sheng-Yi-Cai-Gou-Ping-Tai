import { describe, it, expect, vi } from "vitest";

// 只測路徑與權限的判斷（純函式），不需要資料庫
vi.mock("@workspace/erp-db", () => ({ db: {} }));
vi.mock("@workspace/erp-db/schema", () => ({ menuPermissionsTable: {} }));

import { actionForRequest, customRoleDenial } from "../permission-guard";
import { ALL_MENU_PATHS } from "../../lib/custom-roles";
import { EDITABLE_BUILTIN_ROLES, cleanPermissions, defaultRolePermissions } from "../../lib/role-defaults";

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

describe("內建角色的預設勾選表（老闆 2026-11-18 定的原則）", () => {
  const as = (r: string) => ({ name: r, permissions: defaultRolePermissions(r, ALL_MENU_PATHS) });

  it("財務長以下每個人都能開報價單、銷貨單、收款與付款申請，也都看得到庫存", () => {
    for (const r of ["viewer", "sales", "warehouse", "hr_admin", "manager", "accountant"]) {
      expect(customRoleDenial(as(r), "POST", "/quotations"), r).toBeNull();
      expect(customRoleDenial(as(r), "POST", "/sales-orders"), r).toBeNull();
      expect(customRoleDenial(as(r), "POST", "/my-receipt-requests"), r).toBeNull();
      expect(customRoleDenial(as(r), "POST", "/my-requests"), r).toBeNull();
      expect(customRoleDenial(as(r), "GET", "/stock-entries"), r).toBeNull();
      expect(customRoleDenial(as(r), "GET", "/inventory-lookup"), r).toBeNull();
    }
  });

  it("進出貨只有倉管（和財務）能動，業務、一般職員、主管只能看", () => {
    for (const r of ["viewer", "sales", "manager", "hr_admin"]) {
      expect(customRoleDenial(as(r), "POST", "/delivery-notes"), r).toContain("新增");
      expect(customRoleDenial(as(r), "POST", "/purchase-receipts"), r).toContain("新增");
      expect(customRoleDenial(as(r), "POST", "/stock-entries"), r).toContain("新增");
      expect(customRoleDenial(as(r), "GET", "/delivery-notes"), r).toBeNull();
    }
    for (const r of ["warehouse", "finance_admin", "accountant"]) {
      expect(customRoleDenial(as(r), "POST", "/delivery-notes"), r).toBeNull();
      expect(customRoleDenial(as(r), "POST", "/purchase-receipts"), r).toBeNull();
      expect(customRoleDenial(as(r), "DELETE", "/stock-entries/3"), r).toBeNull();
    }
  });

  it("一般職員不能改商品主檔或刪單；倉管可以改商品", () => {
    expect(customRoleDenial(as("viewer"), "PATCH", "/items/3")).toContain("修改");
    expect(customRoleDenial(as("viewer"), "DELETE", "/sales-orders/3")).toContain("刪除");
    expect(customRoleDenial(as("warehouse"), "PATCH", "/items/3")).toBeNull();
  });

  it("自己的打卡、請假、通知與 AI 查詢不論勾選怎麼設都能用", () => {
    const none = { name: "空白", permissions: {} };
    expect(customRoleDenial(none, "POST", "/attendance")).toBeNull();
    expect(customRoleDenial(none, "POST", "/leaves")).toBeNull();
    expect(customRoleDenial(none, "PATCH", "/notifications/1")).toBeNull();
    expect(customRoleDenial(none, "POST", "/ai/ask")).toBeNull();
    expect(customRoleDenial(none, "POST", "/admin/me/change-password")).toBeNull();
  });

  it("送進來的勾選表只收認得的頁面，有勾其他動作會自動補檢視", () => {
    const clean = cleanPermissions({ "/sales/orders": ["create"], "/nope": ["view"], "/sales/quotations": ["fly"] }, ALL_MENU_PATHS);
    expect(clean).toEqual({ "/sales/orders": ["view", "create"] });
  });

  it("每個可編輯的內建角色都涵蓋所有功能頁的檢視，不會因為改版突然看不到東西", () => {
    for (const r of EDITABLE_BUILTIN_ROLES) {
      const perms = defaultRolePermissions(r, ALL_MENU_PATHS);
      for (const p of ALL_MENU_PATHS) expect(perms[p]?.includes("view"), `${r} ${p}`).toBe(true);
    }
  });
});
