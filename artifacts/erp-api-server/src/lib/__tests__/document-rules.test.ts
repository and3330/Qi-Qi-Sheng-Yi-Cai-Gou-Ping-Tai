import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { assertDeletableDraft } from "../document-rules";

describe("單據刪除規則", () => {
  it("草稿可以刪", () => {
    expect(() => assertDeletableDraft("銷貨單", "Draft", "取消")).not.toThrow();
    expect(() => assertDeletableDraft("薪資單", "draft", "退回草稿")).not.toThrow();
  });

  it("已成立的單據不能刪，並告知要改用作廢", () => {
    for (const status of ["Confirmed", "To Deliver", "Completed", "Cancelled", "Unpaid", "Paid", "Sent", "confirmed"]) {
      expect(() => assertDeletableDraft("銷貨單", status, "取消")).toThrow(/只能刪除草稿狀態的銷貨單.*改為「取消」/);
    }
  });
});

describe("各單據的刪除端點都套用草稿限定", () => {
  const routes = join(__dirname, "..", "..", "routes");
  const deleteBody = (file: string, route: string) => {
    const source = readFileSync(join(routes, file), "utf8");
    const start = source.indexOf(`router.delete("${route}"`);
    expect(start, `${file} 應有 ${route} 刪除端點`).toBeGreaterThan(-1);
    const next = source.indexOf("\nrouter.", start + 10);
    return source.slice(start, next === -1 ? undefined : next);
  };

  it.each([
    ["sales-orders.ts", "/sales-orders/:id"],
    ["quotations.ts", "/quotations/:id"],
    ["salary-slips.ts", "/salary-slips/:id"],
    ["invoices.ts", "/invoices/:id"],
  ])("%s 使用 assertDeletableDraft", (file, route) => {
    expect(deleteBody(file, route)).toContain("assertDeletableDraft(");
  });

  it.each([
    ["delivery-notes.ts", "/delivery-notes/:id"],
    ["purchase-receipts.ts", "/purchase-receipts/:id"],
    ["sales-returns.ts", "/sales-returns/:id"],
    ["purchase-returns.ts", "/purchase-returns/:id"],
    ["payment-requests.ts", "/payment-requests/:id"],
    ["work-orders.ts", "/work-orders/:id"],
    ["assets.ts", "/assets/:id"],
  ])("%s 只允許刪草稿", (file, route) => {
    expect(deleteBody(file, route)).toMatch(/status !== "Draft"/);
  });
});
