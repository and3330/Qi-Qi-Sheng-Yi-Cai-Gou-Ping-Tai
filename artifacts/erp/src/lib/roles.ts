export const ROLE_OWNER = "owner";
export const ROLE_ADMIN = "admin";
export const ROLE_SUPER_ADMIN = "super_admin";
export const ROLE_HR_ADMIN = "hr_admin";
export const ROLE_FINANCE_ADMIN = "finance_admin";
export const ROLE_ACCOUNTANT = "accountant";
export const ROLE_MANAGER = "manager";
export const ROLE_SALES = "sales";
export const ROLE_WAREHOUSE = "warehouse";
export const ROLE_VIEWER = "viewer";
export const ROLE_EMPLOYEE = "employee";

export const ADMIN_ROLES = [ROLE_OWNER, ROLE_ADMIN] as const;
export const HR_ROLES = [...ADMIN_ROLES, ROLE_HR_ADMIN] as const;
export const FINANCE_ROLES = [...ADMIN_ROLES, ROLE_FINANCE_ADMIN, ROLE_ACCOUNTANT] as const;
export const INVOICE_ISSUE_PRINT_ROLES = [...FINANCE_ROLES, ROLE_MANAGER] as const;
export const PAYROLL_ROLES = [...ADMIN_ROLES, ROLE_HR_ADMIN, ROLE_FINANCE_ADMIN] as const;
export const SYSTEM_ADMIN_ROLES = [...ADMIN_ROLES] as const;

export const ROLE_LABELS: Record<string, string> = {
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

/** 帳號可選的角色（由大到小）；平台管理員另由平台指派 */
export const ASSIGNABLE_ROLE_ORDER = ["viewer", "sales", "warehouse", "manager", "hr_admin", "accountant", "finance_admin", "admin", "owner"] as const;

export const ROLE_DESCRIPTIONS: Record<string, string> = {
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

/** 員工自助帳號可使用的頁面 */
export const EMPLOYEE_ALLOWED_PATHS = ["/hr/clock-in", "/hr/leaves", "/hr/timesheets", "/hr/me", "/hr/my-requests", "/ai/chat", "/ai/assistant", "/help"] as const;
