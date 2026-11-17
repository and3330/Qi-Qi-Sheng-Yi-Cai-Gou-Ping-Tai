import { describe, it, expect, vi } from "vitest";
import { employeeAccessGuard } from "../employee-access-guard";

/** 員工自助帳號：只能碰自己申請的收據附件路徑，其他附件路徑一律擋 */
function run(path: string, method: string) {
  const next = vi.fn();
  const res: any = { status: vi.fn(() => res), json: vi.fn(() => res) };
  employeeAccessGuard({ path, method, session: { user: { role: "employee", username: "emp1" } } } as any, res, next);
  return next.mock.calls.length === 1;
}

describe("employee access guard: my-request attachments", () => {
  it("allows listing, uploading, opening and deleting attachments on own requests", () => {
    expect(run("/my-requests/12/attachments", "GET")).toBe(true);
    expect(run("/my-requests/12/attachments", "POST")).toBe(true);
    expect(run("/my-requests/12/attachments/5", "GET")).toBe(true);
    expect(run("/my-requests/12/attachments/5", "DELETE")).toBe(true);
  });

  it("still blocks the general attachment store and approval attachments", () => {
    expect(run("/attachments", "GET")).toBe(false);
    expect(run("/attachments/download/5", "GET")).toBe(false);
    expect(run("/approval-requests/3/attachments/5", "GET")).toBe(false);
    expect(run("/my-requests/12/attachments/5", "PATCH")).toBe(false);
    expect(run("/my-requests/abc/attachments", "POST")).toBe(false);
  });
});
