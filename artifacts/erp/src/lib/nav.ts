import { SYSTEM_ADMIN_ROLES, HR_ROLES } from './roles';

export interface NavItem {
  path: string;
  label: string;
  defaultRoles: string[]; // empty array means visible to all ERP users
  group: string;
}

export const NAV_CONFIG: NavItem[] = [
  { path: '/', label: '儀表板', defaultRoles: [], group: '儀表板' },
  { path: '/system/users', label: '使用者與角色', defaultRoles: SYSTEM_ADMIN_ROLES, group: '系統管理' },
  { path: '/system/departments', label: '部門管理', defaultRoles: Array.from(new Set([...HR_ROLES, ...SYSTEM_ADMIN_ROLES])), group: '系統管理' },
  { path: '/system/menu-permissions', label: '選單權限', defaultRoles: SYSTEM_ADMIN_ROLES, group: '系統管理' },
  { path: '/system/audit-logs', label: '審計日誌', defaultRoles: SYSTEM_ADMIN_ROLES, group: '系統管理' }
];
