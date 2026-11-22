import type { Request, Response } from "express";
import type { ActingUser } from "../lib/api-key-actor";
import { builtinRolePermissions, customRoleForUser, type CustomRole } from "../lib/custom-roles";
import { FULL_ACCESS_ROLES, ROLE_DESCRIPTION, ROLE_LABEL, type RolePermissions } from "../lib/role-defaults";
import { MODULE_API_MAP } from "../middleware/module-guard";
import { customRoleDenial } from "../middleware/permission-guard";
import { employeeAccessGuard } from "../middleware/employee-access-guard";
import { describeEndpoint } from "../lib/api-catalog";
import { ROLE_TOOLS, type McpRole } from "./identity";

/**
 * AI 助理（MCP）用 ERP 金鑰連進來時，能做什麼完全跟著金鑰綁定的使用者（老闆 2026-11-19）。
 *
 * - 通用操作（erp_request）是以那個人的身分轉呼叫 ERP，角色守衛與「角色與權限」勾選表照常把關。
 * - 直接寫資料的專用工具（建客戶、開報價單、對帳、各種草稿）只開給角色本來就做這些事的人：
 *   老闆／系統管理員全部、財務長與會計用財務工具、業務用業務工具；其他角色與套用自訂角色的人只用通用操作。
 * - erp_whoami 回答「我是誰、我能做什麼」，AI 一連上先問這個。
 */
export interface UserProfile {
  user: ActingUser;
  roleLabel: string;
  customRole: CustomRole | null;
  full: boolean;
  /** 功能頁 → 允許的動作；全權角色為 null（全部可以） */
  grid: RolePermissions | null;
  mcpRole: McpRole;
  tools: string[];
}

const GENERAL_TOOLS = ["erp_whoami", "erp_list_endpoints", "erp_request"];
const uniq = (xs: string[]) => [...new Set(xs)];

export async function buildUserProfile(tenantId: number, user: ActingUser): Promise<UserProfile> {
  const full = FULL_ACCESS_ROLES.includes(user.role);
  const customRole = full || user.role === "employee" ? null : await customRoleForUser(tenantId, user.id).catch(() => null);
  const grid = full ? null : customRole ? customRole.permissions : user.role === "employee" ? {} : (await builtinRolePermissions(tenantId, user.role).catch(() => null)) ?? {};
  let mcpRole: McpRole = "readonly";
  let tools = GENERAL_TOOLS;
  if (full) { mcpRole = "admin"; tools = uniq([...ROLE_TOOLS.admin, ...GENERAL_TOOLS]); }
  else if (!customRole && (user.role === "finance_admin" || user.role === "accountant")) { mcpRole = "finance"; tools = uniq([...ROLE_TOOLS.finance, ...GENERAL_TOOLS]); }
  else if (!customRole && user.role === "sales") { mcpRole = "sales"; tools = uniq([...ROLE_TOOLS.sales, ...GENERAL_TOOLS, "get_quotation_pdf"]); }
  return { user, roleLabel: ROLE_LABEL[user.role] || user.role, customRole, full, grid, mcpRole, tools };
}

/** 員工自助帳號的白名單是一支中介層：模擬跑一次看會不會被擋 */
function employeeAllows(user: ActingUser, method: string, path: string): boolean {
  let blocked = false;
  const req = { path, method, session: { user } } as unknown as Request;
  const res = { status: () => { blocked = true; return { json: () => undefined }; } } as unknown as Response;
  employeeAccessGuard(req, res, () => undefined);
  return !blocked;
}

/** 這個人能不能呼叫這個端點（只看角色與勾選表；各路由自己另有的細部限制要實際呼叫才知道） */
export function userEndpointDenial(profile: UserProfile, method: string, path: string): string | null {
  if (profile.full) return null;
  if (profile.user.role === "employee") return employeeAllows(profile.user, method, path) ? null : "員工自助帳號只能用打卡、請假、薪資單與自己的申請";
  return customRoleDenial({ name: profile.customRole?.name ?? profile.roleLabel, permissions: profile.grid ?? {} }, method, path);
}

const ACTION_LABEL: Record<string, string> = { view: "檢視", create: "新增", edit: "修改", delete: "刪除" };

/** erp_whoami：我是誰、我的角色能做什麼 */
export function whoAmI(profile: UserProfile, keyName: string) {
  const modules = profile.full ? null : Object.entries(profile.grid ?? {})
    .filter(([, actions]) => actions.length > 0)
    .map(([menuPath, actions]) => {
      const api = MODULE_API_MAP[menuPath] ?? [];
      const described = api[0] ? describeEndpoint("GET", api[0]) : null;
      return { menu: menuPath, module: described ? `${described.module}／${described.label}` : menuPath, api, allowed: actions.map(a => ACTION_LABEL[a] ?? a) };
    });
  // 分兩堆比較好讀：可以新增／修改／刪除的列出動作；只能看的只列名稱
  const canChange = modules?.filter(m => m.allowed.some(a => a !== "檢視")) ?? null;
  const viewOnly = modules?.filter(m => m.allowed.every(a => a === "檢視")).map(m => m.module) ?? null;
  return {
    you: { name: profile.user.displayName, username: profile.user.username, role: profile.roleLabel, roleDescription: ROLE_DESCRIPTION[profile.user.role] ?? null, customRole: profile.customRole?.name ?? null },
    key: keyName,
    rule: "這把金鑰沒有自己的權限：能做什麼完全跟著上面這個人目前的角色，跟他自己登入 ERP 操作一樣。角色被改了就跟著變，帳號停用金鑰也不能用。",
    access: profile.full
      ? "全權角色：所有模組都能查、新增、修改、刪除（帳號、金鑰、備份、訂閱、權限與系統設定、關帳年結、審批匣仍只能由人在 ERP 操作）。"
      : profile.user.role === "employee"
        ? "員工自助：只能打自己的卡、看自己的出勤與薪資單、請假，以及送出自己的付款／請款／收款申請。"
        : "只能使用下面列出的功能與動作；沒列出的功能不能用。",
    canChange,
    viewOnly,
    tools: profile.tools,
    howTo: "用 erp_list_endpoints（可加 keyword）看你能呼叫哪些端點，再用 erp_request 操作。被擋下時回應會說明原因。",
  };
}
