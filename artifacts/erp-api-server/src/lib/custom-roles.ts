import { eq, like } from "drizzle-orm";
import { db } from "@workspace/erp-db";
import { menuPermissionsTable } from "@workspace/erp-db/schema";
import { FOUNDATION_PATHS, MODULE_API_MAP } from "../middleware/module-guard";
import { FULL_ACCESS_ROLES, cleanPermissions, defaultRolePermissions, isEditableBuiltinRole, withInvoicePermissions, type RolePermissions } from "./role-defaults";

/**
 * 自訂角色。
 *
 * 一個自訂角色＝「以某個內建角色為基礎」＋「每個功能頁可以做哪些動作」。
 * - 基礎角色決定上限：後端原有的角色檢查（例如只有財務角色能看分錄）照舊生效，
 *   所以自訂角色只會比基礎角色更嚴，不會更寬。
 * - 動作分四種：檢視、新增、修改、刪除，由 permission-guard 在每個請求把關。
 *
 * 儲存位置：沿用已有公司隔離（RLS）的 menu_permissions 表，
 * 每個角色一列，path 是 "@role/<id>"，roles 陣列只放一個 JSON 字串。
 * 這樣不用新增資料表；讀寫都集中在這個檔案，之後要搬到專屬資料表只需要改這裡。
 */

export const ROLE_ROW_PREFIX = "@role/";
export const PERMISSION_ACTIONS = ["view", "create", "edit", "delete"] as const;
export type PermissionAction = (typeof PERMISSION_ACTIONS)[number];

/** 可以當作基礎的內建角色（擁有者、管理員擁有全部權限，不能拿來做受限角色） */
export const BASE_ROLES = ["manager", "hr_admin", "finance_admin", "accountant", "sales", "warehouse", "viewer"] as const;

/**
 * 內建角色（財務長、會計、主管、業務、倉管、人資、一般職員）也有一張勾選表：
 * 沒改過就用 role-defaults.ts 的預設；改過的存在同一張表，path 是 "@role/builtin-<角色>"，
 * 讀自訂角色時會跳過這些列。
 */
export const BUILTIN_ROW_ID_PREFIX = "builtin-";
const SELF_SERVICE_MENU_PATHS = ["/hr/me", "/hr/my-requests", "/hr/clock-in", "/hr/leaves", "/hr/timesheets", "/ai/chat", "/ai/assistant"];
/** 所有可以勾選的功能頁 */
export const ALL_MENU_PATHS: readonly string[] = [...new Set([...Object.keys(MODULE_API_MAP), ...FOUNDATION_PATHS, ...SELF_SERVICE_MENU_PATHS])];

export interface CustomRole {
  id: string;
  name: string;
  description: string;
  baseRole: string;
  /** 功能頁路徑（與選單相同）→ 允許的動作 */
  permissions: Record<string, PermissionAction[]>;
  /** 套用這個角色的帳號 */
  userIds: number[];
}

export const isRoleRow = (path: string) => path.startsWith(ROLE_ROW_PREFIX);

function parseRow(row: { path: string; roles: string[] | null }): CustomRole | null {
  if (row.path.startsWith(ROLE_ROW_PREFIX + BUILTIN_ROW_ID_PREFIX)) return null;
  try {
    const data = JSON.parse(row.roles?.[0] || "");
    if (!data || typeof data.name !== "string") return null;
    const permissions: Record<string, PermissionAction[]> = {};
    for (const [path, actions] of Object.entries(data.permissions || {})) {
      if (Array.isArray(actions)) permissions[path] = actions.filter((a): a is PermissionAction => (PERMISSION_ACTIONS as readonly string[]).includes(a));
    }
    return {
      id: row.path.slice(ROLE_ROW_PREFIX.length),
      name: data.name,
      description: typeof data.description === "string" ? data.description : "",
      baseRole: (BASE_ROLES as readonly string[]).includes(data.baseRole) ? data.baseRole : "viewer",
      permissions: withInvoicePermissions(data.baseRole, permissions),
      userIds: Array.isArray(data.userIds) ? data.userIds.map(Number).filter((n: number) => Number.isInteger(n) && n > 0) : [],
    };
  } catch {
    return null;
  }
}

/** 30 秒快取：把關時每個請求都要查，不能每次都打資料庫 */
const cache = new Map<number, { roles: CustomRole[]; at: number }>();
const CACHE_MS = 30_000;

export function invalidateCustomRoles(tenantId: number): void {
  cache.delete(tenantId);
}

/** 讀出這家公司的所有自訂角色（db 在租戶環境內執行，只看得到自己公司的列） */
export async function loadCustomRoles(tenantId: number, executor: any = db, fresh = false): Promise<CustomRole[]> {
  const hit = cache.get(tenantId);
  if (!fresh && hit && Date.now() - hit.at < CACHE_MS) return hit.roles;
  const rows = await executor.select().from(menuPermissionsTable).where(like(menuPermissionsTable.path, `${ROLE_ROW_PREFIX}%`));
  const roles = (rows as { path: string; roles: string[] | null }[]).map(parseRow).filter((r): r is CustomRole => r !== null);
  cache.set(tenantId, { roles, at: Date.now() });
  return roles;
}

export async function customRoleForUser(tenantId: number, userId: number): Promise<CustomRole | null> {
  const roles = await loadCustomRoles(tenantId);
  return roles.find((r) => r.userIds.includes(userId)) || null;
}

/** 全部權限的角色與員工自助帳號不套用自訂角色（名單上有殘留也不算） */
export const customRoleApplies = (accountRole: string | undefined): boolean =>
  !!accountRole && !FULL_ACCESS_ROLES.includes(accountRole) && accountRole !== "employee";

export async function saveCustomRole(tenantId: number, role: CustomRole, executor: any = db): Promise<void> {
  const { id, ...data } = role;
  const path = ROLE_ROW_PREFIX + id;
  const roles = [JSON.stringify(data)];
  await executor.insert(menuPermissionsTable).values({ path, roles })
    .onConflictDoUpdate({ target: [menuPermissionsTable.tenantId, menuPermissionsTable.path], set: { roles, updatedAt: new Date() } });
  invalidateCustomRoles(tenantId);
}

export async function deleteCustomRole(tenantId: number, id: string, executor: any = db): Promise<void> {
  await executor.delete(menuPermissionsTable).where(eq(menuPermissionsTable.path, ROLE_ROW_PREFIX + id));
  invalidateCustomRoles(tenantId);
}

/**
 * 帳號的角色被改掉或帳號被刪除時，把他從自訂角色移出。
 * 套用自訂角色的人，帳號角色一定等於那個自訂角色的基礎角色；改成別的角色就不再屬於它，
 * 不然同一個人會同時掛在兩種身分底下（例如帳號是系統管理員，名單上卻還在受限角色裡）。
 * keepBaseRole：新角色剛好等於基礎角色的自訂角色保留。
 */
export async function removeUserFromCustomRoles(tenantId: number, userId: number, keepBaseRole?: string, executor: any = db): Promise<number> {
  let removed = 0;
  for (const role of await loadCustomRoles(tenantId, executor, true)) {
    if (!role.userIds.includes(userId) || (keepBaseRole !== undefined && role.baseRole === keepBaseRole)) continue;
    await saveCustomRole(tenantId, { ...role, userIds: role.userIds.filter((id) => id !== userId) }, executor);
    removed++;
  }
  return removed;
}

export function newRoleId(): string {
  return "r" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

// ───────── 內建角色的勾選表 ─────────
const builtinCache = new Map<number, { overrides: Record<string, RolePermissions>; at: number }>();

/** 這家公司改過的內建角色勾選表（沒改過的角色不會出現在裡面） */
export async function loadBuiltinOverrides(tenantId: number, executor: any = db, fresh = false): Promise<Record<string, RolePermissions>> {
  const hit = builtinCache.get(tenantId);
  if (!fresh && hit && Date.now() - hit.at < CACHE_MS) return hit.overrides;
  const rows = await executor.select().from(menuPermissionsTable).where(like(menuPermissionsTable.path, `${ROLE_ROW_PREFIX}${BUILTIN_ROW_ID_PREFIX}%`));
  const overrides: Record<string, RolePermissions> = {};
  for (const row of rows as { path: string; roles: string[] | null }[]) {
    const role = row.path.slice((ROLE_ROW_PREFIX + BUILTIN_ROW_ID_PREFIX).length);
    if (!isEditableBuiltinRole(role)) continue;
    try { overrides[role] = withInvoicePermissions(role, cleanPermissions(JSON.parse(row.roles?.[0] || "{}").permissions, ALL_MENU_PATHS)); } catch { /* 壞掉的列當作沒改過 */ }
  }
  builtinCache.set(tenantId, { overrides, at: Date.now() });
  return overrides;
}

/** 內建角色目前生效的勾選表：改過的用改過的，沒改過用預設 */
export async function builtinRolePermissions(tenantId: number, role: string, executor: any = db): Promise<RolePermissions | null> {
  if (!isEditableBuiltinRole(role)) return null;
  const overrides = await loadBuiltinOverrides(tenantId, executor);
  return overrides[role] ?? defaultRolePermissions(role, ALL_MENU_PATHS);
}

export async function saveBuiltinOverride(tenantId: number, role: string, permissions: RolePermissions, updatedBy: string, executor: any = db): Promise<void> {
  const path = ROLE_ROW_PREFIX + BUILTIN_ROW_ID_PREFIX + role;
  const roles = [JSON.stringify({ permissions, updatedBy, updatedAt: new Date().toISOString() })];
  await executor.insert(menuPermissionsTable).values({ path, roles })
    .onConflictDoUpdate({ target: [menuPermissionsTable.tenantId, menuPermissionsTable.path], set: { roles, updatedAt: new Date() } });
  builtinCache.delete(tenantId);
}

export async function resetBuiltinOverride(tenantId: number, role: string, executor: any = db): Promise<void> {
  await executor.delete(menuPermissionsTable).where(eq(menuPermissionsTable.path, ROLE_ROW_PREFIX + BUILTIN_ROW_ID_PREFIX + role));
  builtinCache.delete(tenantId);
}

/** 這個角色能不能對某個功能頁做某個動作 */
export function roleAllows(role: Pick<CustomRole, "permissions">, menuPath: string, action: PermissionAction): boolean {
  return (role.permissions[menuPath] || []).includes(action);
}
