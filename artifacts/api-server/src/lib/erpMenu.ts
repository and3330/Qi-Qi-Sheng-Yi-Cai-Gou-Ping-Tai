import { eq } from "drizzle-orm";
import { db, erpMenuPermissionsTable } from "@workspace/db";

/**
 * ERP 選單預設權限（須與 artifacts/erp/src/lib/nav.ts 的 NAV_CONFIG 一致）。
 * 空陣列 = 所有 ERP 角色可用；super_admin 永遠通過。
 */
const SYSTEM_ADMIN_ROLES = ["super_admin", "admin"];
const HR_ROLES = ["super_admin", "admin", "hr_admin", "manager"];
const FINANCE_ROLES = ["super_admin", "admin", "finance_admin", "accountant"];

export const ERP_MENU_DEFAULTS: Record<string, string[]> = {
  "/": [],
  "/calendar": [],
  "/inventory/items": [],
  "/inventory/warehouses": [],
  "/inventory/movements": [],
  "/sales/quotations": [],
  "/sales/orders": [],
  "/sales/returns": [],
  "/sales/price-lists": [],
  "/purchasing/orders": [],
  "/purchasing/receiving": [],
  "/purchasing/returns": [],
  "/partners/customers": [],
  "/partners/suppliers": [],
  "/accounting/accounts": FINANCE_ROLES,
  "/accounting/journal": FINANCE_ROLES,
  "/accounting/invoices": FINANCE_ROLES,
  "/accounting/vouchers": FINANCE_ROLES,
  "/accounting/payment-requests": FINANCE_ROLES,
  "/accounting/bank-reconciliation": FINANCE_ROLES,
  "/accounting/vat-report": FINANCE_ROLES,
  "/reports/financial": FINANCE_ROLES,
  "/reports/aging": FINANCE_ROLES,
  "/reports/analysis": [],
  "/hr/employees": HR_ROLES,
  "/hr/attendance": [],
  "/hr/leaves": [],
  "/hr/payroll": ["super_admin", "admin", "hr_admin"],
  "/hr/settings": HR_ROLES,
  "/crm/leads": [],
  "/crm/opportunities": [],
  "/crm/complaints": [],
  "/crm/tickets": [],
  "/crm/knowledge-base": [],
  "/projects/list": [],
  "/projects/tasks": [],
  "/projects/timesheets": [],
  "/contracts/list": [],
  "/assets/list": [],
  "/assets/depreciation": FINANCE_ROLES,
  "/manufacturing/boms": [],
  "/manufacturing/work-orders": [],
  "/manufacturing/workstations": [],
  "/manufacturing/plans": [],
  "/quality/inspections": [],
  "/quality/nonconformances": [],
  "/quality/capas": [],
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
