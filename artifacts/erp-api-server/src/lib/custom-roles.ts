import { eq, like } from "drizzle-orm";
import { db } from "@workspace/erp-db";
import { menuPermissionsTable } from "@workspace/erp-db/schema";

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
export const BASE_ROLES = ["manager", "hr_admin", "finance_admin", "accountant", "viewer"] as const;

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
      permissions,
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

export function newRoleId(): string {
  return "r" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

/** 這個角色能不能對某個功能頁做某個動作 */
export function roleAllows(role: Pick<CustomRole, "permissions">, menuPath: string, action: PermissionAction): boolean {
  return (role.permissions[menuPath] || []).includes(action);
}
