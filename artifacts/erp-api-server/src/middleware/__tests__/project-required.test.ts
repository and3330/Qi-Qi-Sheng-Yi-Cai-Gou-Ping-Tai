import { describe, expect, it, vi } from "vitest";
import { projectRequiredGuard, isMissingProject, PROJECT_REQUIRED_MESSAGE } from "../project-required";
import { missingRequiredFields } from "../../lib/template-fields";

function run(method: string, path: string, body: unknown) {
  const res: any = { status: vi.fn(() => res), json: vi.fn(() => res) };
  const next = vi.fn();
  projectRequiredGuard({ method, path, body } as any, res, next);
  return { res, next };
}

describe("專案必填守門", () => {
  it("新增收支單據沒帶專案會被擋下", () => {
    for (const path of ["/quotations", "/sales-orders", "/create-sales-order", "/purchase-orders", "/vouchers", "/payment-requests", "/delivery-notes"]) {
      const { res, next } = run("POST", path, { customerId: 1 });
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({ error: PROJECT_REQUIRED_MESSAGE });
      expect(next).not.toHaveBeenCalled();
    }
  });

  it("有帶專案就放行", () => {
    expect(run("POST", "/sales-orders", { projectId: 3 }).next).toHaveBeenCalled();
    expect(run("POST", "/quotations", { projectId: "7" }).next).toHaveBeenCalled();
  });

  it("連同客戶一起建立的報價單，專案放在 quotation 裡", () => {
    expect(run("POST", "/quotations/with-customer", { quotation: {} }).res.status).toHaveBeenCalledWith(400);
    expect(run("POST", "/quotations/with-customer", { quotation: { projectId: 2 } }).next).toHaveBeenCalled();
  });

  it("修改時沒帶專案不擋，但不能把專案清空", () => {
    expect(run("PATCH", "/sales-orders/5", { remarks: "x" }).next).toHaveBeenCalled();
    expect(run("PATCH", "/sales-orders/5", { projectId: null }).res.status).toHaveBeenCalledWith(400);
    expect(run("PATCH", "/vouchers/9", { projectId: "" }).res.status).toHaveBeenCalledWith(400);
  });

  it("不相干的路徑與子動作不受影響", () => {
    expect(run("POST", "/customers", {}).next).toHaveBeenCalled();
    expect(run("POST", "/delivery-notes/from-order/3", {}).next).toHaveBeenCalled();
    expect(run("POST", "/quotations/4/convert-to-sales-order", {}).next).toHaveBeenCalled();
    expect(run("GET", "/sales-orders", undefined).next).toHaveBeenCalled();
  });

  it("isMissingProject 判斷空值與無效編號", () => {
    expect(isMissingProject(undefined)).toBe(true);
    expect(isMissingProject("")).toBe(true);
    expect(isMissingProject(0)).toBe(true);
    expect(isMissingProject("abc")).toBe(true);
    expect(isMissingProject(12)).toBe(false);
  });
});

describe("模板必填欄位", () => {
  const schema = [
    { name: "eventName", label: "活動名稱", type: "text", required: true },
    { name: "eventDate", label: "活動日期", type: "date", required: true },
    { name: "note", label: "備註", type: "text", required: false },
  ];

  it("列出沒填的必填欄位名稱", () => {
    expect(missingRequiredFields(schema, { eventName: "營隊", eventDate: " " })).toEqual(["活動日期"]);
    expect(missingRequiredFields(schema, {})).toEqual(["活動名稱", "活動日期"]);
  });

  it("都填了或沒有欄位定義時回傳空陣列", () => {
    expect(missingRequiredFields(schema, { eventName: "營隊", eventDate: "2026-12-01" })).toEqual([]);
    expect(missingRequiredFields(null, {})).toEqual([]);
    expect(missingRequiredFields(schema.slice(2), null)).toEqual([]);
  });
});
