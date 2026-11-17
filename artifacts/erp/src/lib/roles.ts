export const ROLE_OWNER = "owner";
export const ROLE_ADMIN = "admin";
export const ROLE_SUPER_ADMIN = "super_admin";
export const ROLE_HR_ADMIN = "hr_admin";
export const ROLE_FINANCE_ADMIN = "finance_admin";
export const ROLE_ACCOUNTANT = "accountant";
export const ROLE_MANAGER = "manager";
export const ROLE_EMPLOYEE = "employee";

export const ADMIN_ROLES = [ROLE_OWNER, ROLE_ADMIN] as const;
export const HR_ROLES = [...ADMIN_ROLES, ROLE_HR_ADMIN] as const;
export const FINANCE_ROLES = [...ADMIN_ROLES, ROLE_FINANCE_ADMIN, ROLE_ACCOUNTANT] as const;
export const PAYROLL_ROLES = [...ADMIN_ROLES, ROLE_HR_ADMIN, ROLE_FINANCE_ADMIN] as const;
export const SYSTEM_ADMIN_ROLES = [...ADMIN_ROLES] as const;

export const ROLE_LABELS: Record<string, string> = {
  super_admin: "超級管理員",
  owner: "擁有者",
  admin: "管理員",
  manager: "主管",
  hr_admin: "人資管理員",
  finance_admin: "財務管理員",
  accountant: "會計",
  viewer: "一般員工",
  employee: "員工自助",
};

/** 員工自助帳號可使用的頁面 */
export const EMPLOYEE_ALLOWED_PATHS = ["/hr/clock-in", "/hr/leaves", "/hr/timesheets", "/hr/me", "/hr/my-requests", "/ai/chat", "/ai/assistant", "/help"] as const;
