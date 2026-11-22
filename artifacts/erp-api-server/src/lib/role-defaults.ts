/**
 * 內建角色與它們預設能做的事（純資料與純函式，不碰資料庫）。
 *
 * 老闆 2026-11-18 定的原則：
 * - 財務長以下的每個人都可以：新建收款單草稿（從「我的申請」送財務確認）、付款申請、開報價單、新建銷貨單。
 * - 進貨、出貨、庫存異動、調撥、盤點由倉管負責。
 * - 所有人都看得到庫存。
 * - 這些角色（老闆、系統管理員、員工自助以外）都可以在「角色與權限」逐張表單改新增／修改／刪除；
 *   這裡只是一開始的預設。
 *
 * 勾選只能在各功能原本的規定之內調整：財務帳、薪資、人事資料、系統設定這些敏感區，
 * 後端本身另有角色限制，勾選不會把它們開給原本沒有權限的角色。
 */

export type PermissionAction = "view" | "create" | "edit" | "delete";
export type RolePermissions = Record<string, PermissionAction[]>;

export const INVOICE_ACTION_PATHS = {
  issue: "/actions/invoices/issue",
  print: "/actions/invoices/print",
} as const;

/** Preserve old effective access only when the new explicit switches are absent. */
export function withInvoicePermissions(role: string, permissions: RolePermissions): RolePermissions {
  const result = { ...permissions };
  const eligible = ["finance_admin", "accountant", "manager"].includes(role);
  for (const [action, key] of Object.entries(INVOICE_ACTION_PATHS)) {
    if (Object.hasOwn(result, key)) continue;
    const pages = action === "issue" ? ["/sales/orders"] : ["/sales/invoices", "/accounting/invoices"];
    result[key] = eligible && pages.some(page => permissions[page]?.includes("edit")) ? ["view"] : [];
  }
  return result;
}

/** 系統所有內建角色（帳號的角色欄只接受這些值，super_admin 另由平台指派） */
export const BUILTIN_ROLES = ["owner", "admin", "finance_admin", "accountant", "manager", "sales", "warehouse", "hr_admin", "viewer", "employee"] as const;
export type BuiltinRole = (typeof BUILTIN_ROLES)[number];

export const ROLE_LABEL: Record<string, string> = {
  super_admin: "平台管理員",
  owner: "老闆",
  admin: "系統管理員",
  finance_admin: "財務長",
  accountant: "會計",
  manager: "主管",
  sales: "業務",
  warehouse: "倉管",
  hr_admin: "人資",
  viewer: "一般職員",
  employee: "員工自助",
};

export const ROLE_DESCRIPTION: Record<string, string> = {
  super_admin: "平台維運用，全部權限",
  owner: "全部權限，不能被限制",
  admin: "全部權限，含帳號與系統設定",
  finance_admin: "所有財務：收付款入帳、審核、分錄、發票、結帳",
  accountant: "財務登打；最後核准由財務長或老闆",
  manager: "共同權限，加上核准部門的請假與付款申請；進出貨只能看",
  sales: "共同權限，加上價格表、專案、客服單、合約",
  warehouse: "共同權限，加上進貨、出貨、庫存異動、調撥、盤點",
  hr_admin: "共同權限，加上人事、出勤、薪資",
  viewer: "共同權限：收款單草稿、付款申請、報價單、銷貨單、看庫存",
  employee: "只能打卡、請假、看自己的薪資單與申請",
};

/** 全部權限、不能改的角色 */
export const FULL_ACCESS_ROLES = ["owner", "admin", "super_admin"];
/** 可以在「角色與權限」點進去改的內建角色 */
export const EDITABLE_BUILTIN_ROLES: readonly string[] = ["finance_admin", "accountant", "manager", "sales", "warehouse", "hr_admin", "viewer"];
export const isEditableBuiltinRole = (role: unknown): role is string => typeof role === "string" && EDITABLE_BUILTIN_ROLES.includes(role);

const ALL: PermissionAction[] = ["view", "create", "edit", "delete"];
const WRITE: PermissionAction[] = ["view", "create", "edit"];
const VIEW: PermissionAction[] = ["view"];

/** 進出貨：只有倉管（和財務、老闆）能動，其他人只能看 */
export const STOCK_MOVE_PATHS = ["/inventory/stock", "/inventory/stock-counts", "/sales/delivery-notes", "/purchasing/receipts", "/purchasing/returns", "/sales/returns"];
/** 倉管另外管的庫存主檔 */
const WAREHOUSE_MASTER_PATHS = ["/inventory/items", "/inventory/categories", "/inventory/types", "/inventory/warehouses", "/inventory/lookup"];
/** 共同權限：財務長以下每個人都能開的單（開單時常要順手新增客戶，所以客戶也開） */
export const SHARED_WRITE_PATHS = ["/sales/quotations", "/sales/orders", "/sales/quick-entry", "/sales/customers", "/accounting/customers"];
/** 每個人自己要用的：打卡、請假、工時、自己的申請、AI 助理 */
const SELF_SERVICE_PATHS = ["/hr/clock-in", "/hr/leaves", "/hr/timesheets", "/hr/me", "/hr/my-requests", "/ai/chat", "/ai/assistant"];
/** 業務另外能動的銷售資料 */
const SALES_EXTRA_PATHS = ["/sales/price-lists", "/sales/order-templates", "/sales/quotation-templates", "/projects", "/projects/tasks", "/helpdesk/tickets", "/contracts"];

const set = (perms: RolePermissions, paths: readonly string[], actions: PermissionAction[]) => {
  for (const path of paths) perms[path] = [...actions];
};

/** 某個內建角色一開始的勾選表；menuPaths 是系統所有功能頁 */
export function defaultRolePermissions(role: string, menuPaths: readonly string[]): RolePermissions {
  const perms: RolePermissions = {};
  if (role === "finance_admin" || role === "accountant") {
    set(perms, menuPaths, ALL);
    return withInvoicePermissions(role, perms);
  }
  if (role === "manager") {
    set(perms, menuPaths, ALL);
    set(perms, STOCK_MOVE_PATHS, VIEW);
    return withInvoicePermissions(role, perms);
  }
  // 其他人：全部先能看（各功能原本的規定仍然會擋掉看不到的），再加上共同權限與自己的
  set(perms, menuPaths, VIEW);
  set(perms, SHARED_WRITE_PATHS, WRITE);
  set(perms, SELF_SERVICE_PATHS, WRITE);
  if (role === "sales") set(perms, SALES_EXTRA_PATHS, WRITE);
  if (role === "warehouse") { set(perms, STOCK_MOVE_PATHS, ALL); set(perms, WAREHOUSE_MASTER_PATHS, WRITE); }
  if (role === "hr_admin") set(perms, menuPaths.filter((p) => p.startsWith("/hr/")), ALL);
  return withInvoicePermissions(role, perms);
}

/** 檢查並整理送進來的勾選表：只收認得的功能頁與動作；有勾其他動作就自動補「檢視」 */
export function cleanPermissions(raw: unknown, menuPaths: readonly string[]): RolePermissions {
  const perms: RolePermissions = {};
  if (!raw || typeof raw !== "object") return perms;
  for (const [path, actions] of Object.entries(raw as Record<string, unknown>)) {
    if ((Object.values(INVOICE_ACTION_PATHS) as string[]).includes(path) && Array.isArray(actions)) {
      perms[path] = actions.includes("view") ? ["view"] : [];
      continue;
    }
    if (!menuPaths.includes(path) || !Array.isArray(actions)) continue;
    const clean = ALL.filter((a) => actions.includes(a));
    if (clean.length > 0 && !clean.includes("view")) clean.unshift("view");
    if (clean.length > 0) perms[path] = clean;
  }
  return perms;
}
