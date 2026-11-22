import { describe, expect, it, vi } from "vitest";

// 單元測試不連資料庫（CI 沒有 DATABASE_URL）
vi.mock("@workspace/erp-db", () => ({ db: {} }));
vi.mock("@workspace/erp-db/schema", () => ({ menuPermissionsTable: {} }));

import { actAsUser, canBindKeyTo, machineOnly } from "./api-key-actor";
import { requireRole, sessionEmployeeScope, sessionOnly } from "../middleware/require-auth";
import { employeeAccessGuard } from "../middleware/employee-access-guard";
import { userEndpointDenial, whoAmI, type UserProfile } from "../mcp/user-identity";
import { ROLE_TOOLS } from "../mcp/identity";
import { bearerProblem, mcpAuthHeader } from "../mcp/auth-help";
import { customRoleApplies } from "./custom-roles";
import { APPROVER_ROLES } from "../utils/approval-helper";
import { ROLE_LABEL } from "./role-defaults";

/** 老闆 2026-11-19：API 金鑰沒有自己的權限，跟著綁定的使用者角色走 */

function mockRes() {
  const res: any = { statusCode: 0, body: undefined };
  res.status = vi.fn((c: number) => { res.statusCode = c; return res; });
  res.json = vi.fn((b: unknown) => { res.body = b; return res; });
  return res;
}
const run = (mw: any, req: any) => { const res = mockRes(); const next = vi.fn(); mw(req, res, next); return { res, next }; };

const keyReqAs = (role: string, extra: Record<string, unknown> = {}) => {
  const req: any = { apiKeyAuth: true, apiKey: { id: 9, keyName: "k", tenantId: 1, permissions: "admin" }, session: {}, ...extra };
  actAsUser(req, { id: 5, username: "u", displayName: "小明", role, tenantId: 1, employeeId: 3 });
  return req;
};

describe("金鑰以綁定的使用者身分執行", () => {
  it("掛上去的身分讀得到，但不會讓 session 被存下來（不可列舉）", () => {
    const req = keyReqAs("sales");
    expect(req.session.user.role).toBe("sales");
    expect(JSON.stringify(req.session)).toBe("{}");
    expect(machineOnly(req)).toBe(false);
  });

  it("角色守衛看的是使用者角色，不是金鑰舊的 admin 等級", () => {
    expect(run(requireRole("owner", "admin"), keyReqAs("sales")).res.statusCode).toBe(403);
    expect(run(requireRole("owner", "sales"), keyReqAs("sales")).next).toHaveBeenCalled();
    expect(run(requireRole("finance_admin"), keyReqAs("owner")).res.statusCode).toBe(403);
    expect(run(requireRole("finance_admin"), keyReqAs("super_admin")).next).toHaveBeenCalled();
  });

  it("綁到員工自助帳號：一樣只能用自助功能", () => {
    const req = keyReqAs("employee", { path: "/customers", method: "GET" });
    expect(sessionEmployeeScope(req)).toEqual({ isEmployee: true, employeeId: 3 });
    expect(run(employeeAccessGuard, req).res.statusCode).toBe(403);
    expect(run(employeeAccessGuard, keyReqAs("employee", { path: "/leaves", method: "POST" })).next).toHaveBeenCalled();
  });

  it("帳號、金鑰、備份這些仍然只限登入的人", () => {
    expect(run(sessionOnly, keyReqAs("owner")).res.statusCode).toBe(403);
  });

  it("沒有對應使用者的舊機器身分維持原本規則", () => {
    const req: any = { apiKeyAuth: true, apiKey: { permissions: "read", tenantId: 1 }, session: {} };
    expect(machineOnly(req)).toBe(true);
    expect(run(requireRole("sales"), req).res.statusCode).toBe(403);
  });
});

describe("誰可以把金鑰綁給誰", () => {
  it("老闆綁誰都可以；系統管理員不能綁給老闆或平台管理員；其他人都不行", () => {
    expect(canBindKeyTo("owner", "owner")).toBe(true);
    expect(canBindKeyTo("admin", "sales")).toBe(true);
    expect(canBindKeyTo("admin", "admin")).toBe(true);
    expect(canBindKeyTo("admin", "owner")).toBe(false);
    expect(canBindKeyTo("admin", "super_admin")).toBe(false);
    expect(canBindKeyTo("sales", "sales")).toBe(false);
  });
});

describe("MCP 跟著使用者回答能做什麼", () => {
  const user = (role: string) => ({ id: 5, username: "u", displayName: "小明", role, tenantId: 1 });
  const profile = (role: string, grid: UserProfile["grid"], full = false): UserProfile =>
    ({ user: user(role), roleLabel: role, customRole: null, full, grid, mcpRole: full ? "admin" : "readonly", tools: full ? [...ROLE_TOOLS.admin, "erp_whoami"] : ["erp_whoami", "erp_list_endpoints", "erp_request"] });

  it("勾選表沒開的功能，端點清單標成不能用", () => {
    const p = profile("viewer", { "/sales/customers": ["view"] });
    expect(userEndpointDenial(p, "GET", "/customers")).toBeNull();
    expect(userEndpointDenial(p, "POST", "/customers")).toMatch(/新增/);
    expect(userEndpointDenial(p, "GET", "/purchase-orders")).toMatch(/檢視/);
  });

  it("全權角色都可以；員工自助只到自助功能", () => {
    expect(userEndpointDenial(profile("owner", null, true), "DELETE", "/customers/1")).toBeNull();
    const emp = profile("employee", {});
    expect(userEndpointDenial(emp, "GET", "/customers")).toMatch(/員工自助/);
    expect(userEndpointDenial(emp, "POST", "/leaves")).toBeNull();
  });

  it("erp_whoami 說出代表誰、什麼角色、能做哪些事", () => {
    const answer = whoAmI(profile("viewer", { "/sales/customers": ["view", "create"], "/purchasing/orders": [] }), "PC的ERP");
    expect(answer.you.name).toBe("小明");
    expect(answer.key).toBe("PC的ERP");
    expect(answer.rule).toMatch(/沒有自己的權限/);
    expect(answer.canChange).toHaveLength(1);
    expect(answer.canChange![0].allowed).toEqual(["檢視", "新增"]);
    expect(answer.viewOnly).toEqual([]);
  });
});

describe("MCP 連線被拒時說明原因", () => {
  it("依標頭長相說出哪裡錯", () => {
    expect(bearerProblem(undefined)).toMatch(/沒有收到驗證標頭/);
    expect(bearerProblem("Basic abc")).toMatch(/Bearer 開頭/);
    expect(bearerProblem("Bearer erpk_only")).toMatch(/少了 Secret/);
    expect(bearerProblem("Bearer erpk_a: secret")).toMatch(/空白/);
    expect(bearerProblem("Bearer a:b:c")).toMatch(/冒號太多/);
  });

  it("金鑰錯和密鑰錯回同一句，不透露金鑰存不存在", () => {
    expect(bearerProblem("Bearer erpk_a:whatever")).toMatch(/API Key 或 Secret 不正確/);
  });

  it("也接受 X-API-Key 加 X-API-Secret；Authorization 優先", () => {
    expect(mcpAuthHeader({ "x-api-key": " k ", "x-api-secret": "s" })).toBe("Bearer k:s");
    expect(mcpAuthHeader({ authorization: "Bearer a:b", "x-api-key": "k", "x-api-secret": "s" })).toBe("Bearer a:b");
    expect(mcpAuthHeader({ "x-api-key": "k" })).toBeUndefined();
    expect(mcpAuthHeader({})).toBeUndefined();
  });
});

describe("角色身分不重複", () => {
  it("全部權限的角色與員工自助不套用自訂角色", () => {
    for (const role of ["owner", "admin", "super_admin", "employee", undefined]) expect(customRoleApplies(role)).toBe(false);
    for (const role of ["viewer", "sales", "finance_admin"]) expect(customRoleApplies(role)).toBe(true);
  });

  it("審批關卡的角色名稱跟「角色與權限」是同一份", () => {
    for (const [role, label] of Object.entries(APPROVER_ROLES)) expect(label).toBe(ROLE_LABEL[role]);
    expect(APPROVER_ROLES.finance_admin).toBe("財務長");
    expect(APPROVER_ROLES.owner).toBe("老闆");
  });
});
