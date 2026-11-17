import { describe, expect, it, vi } from "vitest";

vi.mock("@workspace/erp-db", () => ({
  db: {},
  approvalWorkflowsTable: {}, approvalRequestsTable: {}, notificationsTable: {},
  adminUsersTable: { username: "username", displayName: "displayName", employeeId: "employeeId", isActive: "isActive" },
  employeesTable: { id: "id", departmentId: "departmentId" },
  departmentsTable: { id: "id", managerId: "managerId", parentId: "parentId" },
}));

import { resolveStep } from "../approval-helper";

/** 假的資料庫：每次查詢依序回傳下一組結果 */
function fakeDb(results: any[][]) {
  const queue = [...results];
  const chain: any = { from: () => chain, where: () => Promise.resolve(queue.shift() ?? []) };
  return { select: () => chain };
}

const step = { stepNumber: 1, approverName: "簡培芳", approverRole: "finance_admin" };

describe("自己申請、又被指定審自己", () => {
  it("改由直屬主管審", async () => {
    const db = fakeDb([
      [{ username: "pei", displayName: "簡培芳", employeeId: 84 }], // 申請人
      [{ departmentId: 13 }],                                       // 申請人的部門
      [{ managerId: 69, parentId: null }],                          // 部門主管
      [{ username: "andy", displayName: "鄭安廷" }],                // 主管的帳號
    ]);
    const out = await resolveStep(db, step, "pei");
    expect(out?.approverName).toBe("andy");
    expect(out?.label).toContain("直屬主管");
  });

  it("部門主管就是自己，往上一層找", async () => {
    const db = fakeDb([
      [{ username: "pei", displayName: "簡培芳", employeeId: 84 }],
      [{ departmentId: 13 }],
      [{ managerId: 84, parentId: 11 }],
      [{ managerId: 69, parentId: null }],
      [{ username: "andy", displayName: "鄭安廷" }],
    ]);
    expect((await resolveStep(db, step, "pei"))?.approverName).toBe("andy");
  });

  it("找不到直屬主管，交給老闆或管理員", async () => {
    const db = fakeDb([[{ username: "pei", displayName: "簡培芳", employeeId: 84 }], [{ departmentId: null }]]);
    const out = await resolveStep(db, step, "pei");
    expect(out?.approverName).toBe("");
    expect(out?.approverRole).toBe("owner");
    expect(out?.label).toContain("沒有直屬主管");
  });

  it("別人申請的單，維持原本指定的人", async () => {
    const db = fakeDb([[{ username: "owner67907", displayName: "老闆", employeeId: null }]]);
    expect(await resolveStep(db, step, "owner67907")).toBe(step);
  });
});
