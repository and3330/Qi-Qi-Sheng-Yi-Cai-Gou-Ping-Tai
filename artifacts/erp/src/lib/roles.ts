export const ERP_ROLES = {
  super_admin: '系統最高管理員',
  admin: '系統管理員',
  manager: '主管',
  hr_admin: '人資管理員',
  finance_admin: '財務管理員',
  accountant: '會計',
  viewer: '檢視者',
} as const;

export type ErpRole = keyof typeof ERP_ROLES;

export const SYSTEM_ADMIN_ROLES = ['super_admin', 'admin'];
export const HR_ROLES = ['super_admin', 'admin', 'hr_admin', 'manager'];
export const FINANCE_ROLES = ['super_admin', 'admin', 'finance_admin', 'accountant'];
