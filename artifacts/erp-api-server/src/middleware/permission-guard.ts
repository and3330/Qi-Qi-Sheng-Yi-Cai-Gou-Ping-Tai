import type { Request, Response, NextFunction } from "express";
import { customRoleForUser, roleAllows, type CustomRole, type PermissionAction } from "../lib/custom-roles";
import { menuPathsForApi } from "./module-guard";

/**
 * 權限把關：依「角色能對這個功能做什麼」決定請求能不能過。
 *
 * - 擁有者、管理員、平台管理員：全部放行。
 * - 員工自助帳號：另有 employee-access-guard 管，這裡不處理。
 * - 套用了自訂角色的帳號：依角色的勾選表（檢視／新增／修改／刪除）把關。
 * - 內建的「一般員工（僅可檢視）」：只能讀，不能新增、修改、刪除。
 * - 其他內建角色：維持原本各路由自己的角色檢查。
 * - API 金鑰：有自己的權限等級，不經過這裡。
 */

const FULL_ACCESS_ROLES = ["owner", "admin", "super_admin"];
const ACTION_LABEL: Record<PermissionAction, string> = { view: "檢視", create: "新增", edit: "修改", delete: "刪除" };

/** 每個人都需要、不屬於任何功能頁的基本操作：登入登出、通知、搜尋、附件、選單與角色資料 */
const ALWAYS_ALLOWED = ["/admin/", "/notifications", "/global-search", "/attachments", "/menu-permissions", "/config", "/health", "/billing", "/public/", "/setup/status", "/dashboard"];

/** 「一般員工」雖然只能檢視，但自己的打卡、請假、AI 查詢仍然要能用 */
const VIEWER_SELF_SERVICE = ["/attendance", "/leaves", "/ai/"];

/** 這些路徑用 POST 只是為了帶查詢條件，實際上是讀資料 */
const READ_ONLY_POST = ["/ai/", "/reports/", "/bi/", "/anomaly-check", "/global-search"];

const startsWithAny = (path: string, prefixes: string[]) =>
  prefixes.some((p) => path === p || path.startsWith(p.endsWith("/") ? p : p + "/"));

/** 由請求方法與路徑判斷這是哪一種動作 */
export function actionForRequest(method: string, path: string, apiPrefix: string | null): PermissionAction {
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") return "view";
  if (method === "DELETE") return "delete";
  if (method === "POST") {
    if (startsWithAny(path, READ_ONLY_POST)) return "view";
    // 對整個清單 POST 是新增；對某一筆底下的動作（轉單、作廢、送審…）算修改
    return apiPrefix && path !== apiPrefix ? "edit" : "create";
  }
  return "edit";
}

/** 純函式：給定角色與請求，回傳被擋的原因；可以通過則回傳 null（供中介層與測試共用） */
export function customRoleDenial(role: Pick<CustomRole, "name" | "permissions">, method: string, path: string): string | null {
  if (startsWithAny(path, ALWAYS_ALLOWED)) return null;
  const { prefix, menuPaths } = menuPathsForApi(path);
  // 沒有對應功能頁的端點交給原本的角色檢查
  if (menuPaths.length === 0) return null;
  const action = actionForRequest(method, path, prefix);
  if (menuPaths.some((p) => roleAllows(role, p, action))) return null;
  return `您的角色「${role.name}」沒有這個功能的「${ACTION_LABEL[action]}」權限`;
}

export function viewerDenial(method: string, path: string): string | null {
  if (startsWithAny(path, ALWAYS_ALLOWED) || startsWithAny(path, VIEWER_SELF_SERVICE)) return null;
  const { prefix } = menuPathsForApi(path);
  if (actionForRequest(method, path, prefix) === "view") return null;
  return "您的角色是「一般員工」，只能檢視資料，不能新增、修改或刪除";
}

export async function permissionGuard(req: Request, res: Response, next: NextFunction): Promise<void> {
  const user = (req as any).session?.user as { id?: number; role?: string; tenantId?: number } | undefined;
  if (!user?.id || !user.role || FULL_ACCESS_ROLES.includes(user.role) || user.role === "employee") { next(); return; }
  const tenantId = ((req as any).tenantId as number | undefined) ?? user.tenantId;
  if (!tenantId) { next(); return; }

  let role: CustomRole | null = null;
  try {
    role = await customRoleForUser(tenantId, user.id);
  } catch (err) {
    // 讀不到角色資料時不放寬也不誤擋：內建角色照舊，由各路由自己的檢查把關
    (req as any).log?.error({ err }, "custom role lookup failed");
  }

  const denial = role ? customRoleDenial(role, req.method, req.path) : user.role === "viewer" ? viewerDenial(req.method, req.path) : null;
  if (denial) {
    res.status(403).json({ error: denial, code: "permission_denied" });
    return;
  }
  next();
}
