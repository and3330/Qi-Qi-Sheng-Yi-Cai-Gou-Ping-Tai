import { SYSTEM_ADMIN_ROLES, HR_ROLES } from './roles';

export interface NavItem {
  path: string;
  label: string;
  defaultRoles: string[]; // empty array means visible to all ERP users
  group: string;
}

export const NAV_CONFIG: NavItem[] = [
  { path: '/', label: '儀表板', defaultRoles: [], group: '儀表板' },
  { path: '/inventory/items', label: '品項', defaultRoles: [], group: '庫存' },
  { path: '/inventory/warehouses', label: '倉庫', defaultRoles: [], group: '庫存' },
  { path: '/inventory/movements', label: '庫存異動', defaultRoles: [], group: '庫存' },
  { path: '/sales/quotations', label: '報價單', defaultRoles: [], group: '銷售' },
  { path: '/sales/orders', label: '銷貨單', defaultRoles: [], group: '銷售' },
  { path: '/sales/returns', label: '銷貨退回', defaultRoles: [], group: '銷售' },
  { path: '/sales/price-lists', label: '價格表', defaultRoles: [], group: '銷售' },
  { path: '/purchasing/orders', label: '採購單', defaultRoles: [], group: '採購' },
  { path: '/purchasing/receiving', label: '採購收貨', defaultRoles: [], group: '採購' },
  { path: '/purchasing/returns', label: '採購退回', defaultRoles: [], group: '採購' },
  { path: '/partners/customers', label: '客戶', defaultRoles: [], group: '往來對象' },
  { path: '/partners/suppliers', label: '供應商', defaultRoles: [], group: '往來對象' },
  { path: '/system/users', label: '使用者與角色', defaultRoles: SYSTEM_ADMIN_ROLES, group: '系統管理' },
  { path: '/system/departments', label: '部門管理', defaultRoles: Array.from(new Set([...HR_ROLES, ...SYSTEM_ADMIN_ROLES])), group: '系統管理' },
  { path: '/system/menu-permissions', label: '選單權限', defaultRoles: SYSTEM_ADMIN_ROLES, group: '系統管理' },
  { path: '/system/audit-logs', label: '審計日誌', defaultRoles: SYSTEM_ADMIN_ROLES, group: '系統管理' }
];
