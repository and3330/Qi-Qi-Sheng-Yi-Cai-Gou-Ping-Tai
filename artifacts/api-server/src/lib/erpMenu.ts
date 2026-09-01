import { eq } from "drizzle-orm";
import { db, erpMenuPermissionsTable } from "@workspace/db";

/**
 * ERP 選單預設權限（須與 artifacts/erp/src/lib/nav.ts 的 NAV_CONFIG 一致）。
 * 空陣列 = 所有 ERP 角色可用；super_admin 永遠通過。
 */
const SYSTEM_ADMIN_ROLES = ["super_admin", "admin"];
const HR_ROLES = ["super_admin", "admin", "hr_admin", "manager"];

export const ERP_MENU_DEFAULTS: Record<string, string[]> = {
  "/": [],
  "/system/users": SYSTEM_ADMIN_ROLES,
  "/system/departments": Array.from(
    new Set([...HR_ROLES, ...SYSTEM_ADMIN_ROLES]),
  ),
  "/system/menu-permissions": SYSTEM_ADMIN_ROLES,
  "/system/audit-logs": SYSTEM_ADMIN_ROLES,
};

export const ERP_MENU_PATHS = Object.keys(ERP_MENU_DEFAULTS);

/**
 * 解析某選單路徑目前允許的角色：
 * - 有覆寫列 → 以覆寫為準（空陣列 = 所有 ERP 角色）
 * - 無覆寫列 → 用預設（空陣列 = 所有 ERP 角色）
 */
export async function resolveMenuRoles(path: string): Promise<string[]> {
  const [row] = await db
    .select()
    .from(erpMenuPermissionsTable)
    .where(eq(erpMenuPermissionsTable.path, path))
    .limit(1);
  if (row) return row.roles;
  return ERP_MENU_DEFAULTS[path] ?? [];
}

/** 該有效 ERP 角色是否可用此選單（與前端 RoleGate 邏輯一致） */
export async function menuAllows(
  path: string,
  erpRole: string,
): Promise<boolean> {
  if (erpRole === "super_admin") return true;
  const roles = await resolveMenuRoles(path);
  return roles.length === 0 || roles.includes(erpRole);
}
