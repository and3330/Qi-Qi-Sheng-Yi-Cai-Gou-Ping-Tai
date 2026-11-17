import { useState, useEffect } from "react";
import { Link, useLocation } from "wouter";
import { useAuth } from "@/contexts/auth-context";
import { LogOut, Moon, Sun } from "lucide-react";
import { APP_VERSION } from "@/lib/app-version";
import { useTheme } from "@/lib/theme";
import { GlobalSearchDialog, useGlobalSearchHotkey } from "@/components/global-search";
import {
  LayoutDashboard, Star, Users, Building2, CalendarCheck, CalendarOff,
  ShoppingCart, Package, Warehouse, ArrowLeftRight,
  UserPlus, Target, FolderKanban, ListTodo,
  BookOpen, FileText, Receipt, ChevronDown, ChevronRight,
  Menu, X, ChevronLeft, Truck, ClipboardList, Settings, Award, Layers,
  Clock, Calculator, FileSpreadsheet, Shield, Timer,
  CreditCard, HandCoins, Banknote, Contact,
  PieChart, Scale, Key, FileCode,
  BarChart3, TrendingUp, Search, AlertTriangle,
  DollarSign, ShoppingBag, Boxes, Wallet,
  PackageCheck, RotateCcw, Tag, Send,
  HardDrive, FolderOpen, TrendingDown, Wrench, GraduationCap,
  Factory, Cog, ClipboardCheck, FileWarning, ShieldCheck, Cpu, ScrollText, AlertOctagon,
  Headphones, BookOpenCheck, FileCheck, Landmark, LifeBuoy,
  GitBranch, Bell, KeyRound, Paperclip, Printer, History, Calendar, Coins, ArrowUpDown, HelpCircle,
  Briefcase, Building, Server, Database, Sparkles, MessageSquare, MapPin,
  Crown, BadgePercent, Activity, LineChart
} from "lucide-react";

import { HR_ROLES, FINANCE_ROLES, PAYROLL_ROLES, SYSTEM_ADMIN_ROLES, ROLE_EMPLOYEE } from "@/lib/roles";
import { useMenuAllowed } from "@/hooks/use-menu-allowed";

export interface NavChild {
  label: string;
  path: string;
  icon: React.ReactNode;
  roles?: readonly string[];
}

export interface NavItem {
  label: string;
  path?: string;
  icon: React.ReactNode;
  children?: NavChild[];
  roles?: readonly string[];
  /** 選單只顯示一個入口，子功能改在頁面內用分頁切換（子項目仍保留，供選單權限與模組停用設定使用） */
  singleEntry?: boolean;
  /** 單一入口要連到的總覽頁；沒設就連到第一個有權限的子功能 */
  hubPath?: string;
}

export interface NavGroup {
  groupLabel: string;
  groupIcon: React.ReactNode;
  items: NavItem[];
  roles?: readonly string[];
}

export const topLevelNavs: NavItem[] = [
  {
    label: "AI 助理",
    icon: <Sparkles size={18} />,
    singleEntry: true,
    children: [
      { label: "AI 對話", path: "/ai/chat", icon: <MessageSquare size={16} /> },
      { label: "AI 查詢助理", path: "/ai/assistant", icon: <Sparkles size={16} /> },
      { label: "AI 異常偵測", path: "/ai/anomalies", icon: <ShieldCheck size={16} /> },
      { label: "AI 月報撰寫", path: "/ai/monthly-report", icon: <FileText size={16} /> },
      { label: "AI 文件 OCR", path: "/ai/document-ocr", icon: <Search size={16} /> },
      { label: "AI 客訴分類", path: "/ai/complaint-classify", icon: <MessageSquare size={16} /> },
      { label: "AI 商品描述", path: "/ai/product-description", icon: <Package size={16} /> },
    ],
  }
];

export const navGroups: NavGroup[] = [
  {
    groupLabel: "進銷存系統",
    groupIcon: <Boxes size={14} />,
    items: [
      {
        label: "報價管理", icon: <FileText size={18} />,
        children: [
          { label: "報價單", path: "/sales/quotations", icon: <FileText size={16} /> },
          { label: "價目表", path: "/sales/price-lists", icon: <Tag size={16} /> },
        ]
      },
      {
        label: "銷售管理", icon: <ShoppingCart size={18} />,
        children: [
          { label: "客戶", path: "/sales/customers", icon: <UserPlus size={16} /> },
          { label: "銷售訂單", path: "/sales/orders", icon: <ClipboardList size={16} /> },
          { label: "快速錄單", path: "/sales/quick-entry", icon: <FileSpreadsheet size={16} /> },
          { label: "送貨單", path: "/sales/delivery-notes", icon: <PackageCheck size={16} /> },
          { label: "銷售退貨", path: "/sales/returns", icon: <RotateCcw size={16} /> },
          { label: "銷售發票", path: "/sales/invoices", icon: <Receipt size={16} /> },
        ]
      },
      {
        label: "模板設定", icon: <Layers size={18} />,
        children: [
          { label: "報價模板", path: "/sales/quotation-templates", icon: <Layers size={16} /> },
          { label: "單據欄位模板", path: "/sales/order-templates", icon: <Layers size={16} /> },
          { label: "列印模板", path: "/system/print-templates", icon: <Printer size={16} /> },
        ]
      },
      {
        label: "採購管理", icon: <Truck size={18} />,
        children: [
          { label: "供應商", path: "/purchasing/suppliers", icon: <UserPlus size={16} /> },
          { label: "請購單", path: "/purchasing/material-requests", icon: <ClipboardList size={16} /> },
          { label: "詢價單", path: "/purchasing/rfqs", icon: <ClipboardList size={16} /> },
          { label: "採購訂單", path: "/purchasing/orders", icon: <ClipboardList size={16} /> },
          { label: "進貨單", path: "/purchasing/receipts", icon: <PackageCheck size={16} /> },
          { label: "採購退貨", path: "/purchasing/returns", icon: <RotateCcw size={16} /> },
          { label: "採購發票", path: "/purchasing/invoices", icon: <Receipt size={16} /> },
        ],
      },
      {
        label: "庫存管理", icon: <Package size={18} />,
        children: [
          { label: "查庫存", path: "/inventory/lookup", icon: <Search size={16} /> },
          { label: "品項", path: "/inventory/items", icon: <Package size={16} /> },
          { label: "品項分類", path: "/inventory/categories", icon: <Layers size={16} /> },
          { label: "品項類型", path: "/inventory/types", icon: <Layers size={16} /> },
          { label: "倉庫", path: "/inventory/warehouses", icon: <Warehouse size={16} /> },
          { label: "庫存異動", path: "/inventory/stock", icon: <ArrowLeftRight size={16} /> },
          { label: "盤點", path: "/inventory/stock-counts", icon: <ClipboardList size={16} /> },
        ],
      },
      {
        label: "專案管理", icon: <FolderKanban size={18} />,
        children: [
          { label: "所有專案", path: "/projects", icon: <FolderKanban size={16} /> },
          { label: "任務", path: "/projects/tasks", icon: <ListTodo size={16} /> },
          { label: "工時表", path: "/hr/timesheets", icon: <Timer size={16} /> },
          { label: "專案損益", path: "/projects/financials", icon: <TrendingUp size={16} />, roles: FINANCE_ROLES },
        ],
      },
      {
        label: "合約管理", icon: <FileCheck size={18} />,
        children: [
          { label: "合約", path: "/contracts", icon: <FileCheck size={16} /> },
        ],
      },
      {
        label: "客服中心", icon: <Headphones size={18} />,
        children: [
          { label: "客訴工單", path: "/helpdesk/tickets", icon: <LifeBuoy size={16} /> },
          { label: "知識庫", path: "/helpdesk/knowledge-base", icon: <BookOpenCheck size={16} /> },
          { label: "SLA 與分類", path: "/helpdesk/sla", icon: <Timer size={16} /> },
        ],
      },
      {
        label: "資產管理", icon: <HardDrive size={18} />,
        children: [
          { label: "資產登記冊", path: "/assets/register", icon: <FolderOpen size={16} /> },
          { label: "資產類別", path: "/assets/categories", icon: <Layers size={16} /> },
          { label: "折舊排程", path: "/assets/depreciation", icon: <TrendingDown size={16} /> },
          { label: "資產維護", path: "/assets/maintenance", icon: <Wrench size={16} /> },
        ],
      },
      {
        label: "製造", icon: <Factory size={18} />,
        children: [
          { label: "工作站", path: "/manufacturing/workstations", icon: <Cpu size={16} /> },
          { label: "物料清單", path: "/manufacturing/bom", icon: <ScrollText size={16} /> },
          { label: "工單", path: "/manufacturing/work-orders", icon: <ClipboardList size={16} /> },
          { label: "外包單", path: "/manufacturing/subcontract-orders", icon: <Factory size={16} /> },
          { label: "作業卡", path: "/manufacturing/job-cards", icon: <Cog size={16} /> },
          { label: "生產計畫", path: "/manufacturing/production-planning", icon: <Factory size={16} /> },
        ],
      },
      {
        label: "品質管理", icon: <ShieldCheck size={18} />,
        children: [
          { label: "檢驗範本", path: "/quality/templates", icon: <ClipboardCheck size={16} /> },
          { label: "品質檢驗", path: "/quality/inspections", icon: <ClipboardCheck size={16} /> },
          { label: "不符合報告", path: "/quality/non-conformance", icon: <AlertOctagon size={16} /> },
          { label: "CAPA", path: "/quality/capa", icon: <FileWarning size={16} /> },
        ],
      },
    ],
  },
  {
    groupLabel: "人事管理",
    groupIcon: <Users size={14} />,
    items: [
      {
        label: "組織與員工", icon: <Building2 size={18} />,
        children: [
          { label: "部門管理", path: "/hr/departments", icon: <Building2 size={16} />, roles: HR_ROLES },
          { label: "員工", path: "/hr/employees", icon: <Users size={16} />, roles: HR_ROLES },
          { label: "老師管理", path: "/hr/teachers", icon: <GraduationCap size={16} />, roles: HR_ROLES },
          { label: "人事合約", path: "/hr/contracts", icon: <FileCheck size={16} />, roles: HR_ROLES },
        ]
      },
      {
        label: "出勤與打卡", icon: <Clock size={18} />,
        children: [
          { label: "打卡系統", path: "/hr/clock-in", icon: <Clock size={16} /> },
          { label: "出勤紀錄", path: "/hr/attendance", icon: <CalendarCheck size={16} />, roles: HR_ROLES },
          { label: "請假管理", path: "/hr/leaves", icon: <CalendarOff size={16} /> },
          { label: "班制設定", path: "/hr/shift-types", icon: <Timer size={16} />, roles: HR_ROLES },
          { label: "打卡地點", path: "/hr/clock-in-locations", icon: <MapPin size={16} />, roles: HR_ROLES },
        ]
      },
      {
        label: "薪資與保險", icon: <Wallet size={18} />,
        children: [
          { label: "薪資計算", path: "/hr/salary-calc", icon: <Calculator size={16} />, roles: PAYROLL_ROLES },
          { label: "薪資項目", path: "/hr/salary-components", icon: <ClipboardList size={16} />, roles: PAYROLL_ROLES },
          { label: "薪資單", path: "/hr/salary-slips", icon: <FileSpreadsheet size={16} />, roles: PAYROLL_ROLES },
          { label: "講師與服務費", path: "/hr/service-fees", icon: <HandCoins size={16} />, roles: [...PAYROLL_ROLES, "accountant"] },
          { label: "投保級距", path: "/hr/insurance-brackets", icon: <Shield size={16} />, roles: PAYROLL_ROLES },
        ]
      },
    ],
  },
  {
    groupLabel: "財務管理",
    groupIcon: <Landmark size={14} />,
    items: [
      {
        label: "會計作業", icon: <BookOpen size={18} />,
        children: [
          { label: "會計科目", path: "/accounting/accounts", icon: <BookOpen size={16} /> },
          { label: "付款條件", path: "/accounting/payment-terms", icon: <CreditCard size={16} />, roles: FINANCE_ROLES },
          { label: "定期發票", path: "/accounting/recurring-invoices", icon: <Receipt size={16} />, roles: FINANCE_ROLES },
          { label: "催款", path: "/accounting/dunning", icon: <AlertTriangle size={16} />, roles: FINANCE_ROLES },
          { label: "代墊款與借款", path: "/accounting/advances", icon: <Banknote size={16} />, roles: FINANCE_ROLES },
          { label: "預算", path: "/accounting/budgets", icon: <PieChart size={16} />, roles: FINANCE_ROLES },
          { label: "日記帳", path: "/accounting/journal", icon: <FileText size={16} /> },
          { label: "發票總表", path: "/accounting/invoices", icon: <Receipt size={16} /> },
          { label: "營業稅申報", path: "/accounting/vat-report", icon: <FileSpreadsheet size={16} /> },
          { label: "會計客戶", path: "/accounting/customers", icon: <Contact size={16} /> },
        ]
      },
      {
        label: "收付款", icon: <HandCoins size={18} />,
        children: [
          { label: "收款單", path: "/accounting/receipts", icon: <Banknote size={16} /> },
          { label: "付款單", path: "/accounting/payments", icon: <CreditCard size={16} /> },
          { label: "我的申請", path: "/hr/my-requests", icon: <Send size={16} /> },
          { label: "付款申請", path: "/accounting/payment-requests", icon: <Send size={16} /> },
          { label: "員工請款單", path: "/accounting/reimbursement", icon: <HandCoins size={16} /> },
          { label: "AI 草稿待確認", path: "/accounting/ai-drafts", icon: <Sparkles size={16} />, roles: FINANCE_ROLES },
          { label: "銀行對帳", path: "/accounting/bank-reconciliation", icon: <Landmark size={16} /> },
          { label: "應收帳款總覽", path: "/accounting/receivables", icon: <DollarSign size={16} />, roles: FINANCE_ROLES },
        ]
      },
      {
        label: "BI 決策中心", icon: <LineChart size={18} />,
        children: [
          { label: "營運總覽", path: "/bi/executive", icon: <Crown size={16} />, roles: FINANCE_ROLES },
          { label: "銷售與獲利", path: "/bi/sales", icon: <BadgePercent size={16} />, roles: FINANCE_ROLES },
          { label: "庫存與供應鏈", path: "/bi/inventory", icon: <PackageCheck size={16} />, roles: FINANCE_ROLES },
          { label: "人力成本與效能", path: "/bi/hr", icon: <Users size={16} />, roles: PAYROLL_ROLES },
          { label: "數據健康檢查", path: "/bi/observability", icon: <Activity size={16} />, roles: FINANCE_ROLES },
        ],
      },
      {
        // 報表中心：側邊欄只有一個入口，點進去是分類清單，再選要看的報表（老闆 2026-11-16）
        label: "報表中心",
        icon: <BarChart3 size={18} />,
        singleEntry: true,
        hubPath: "/reports",
        children: [
          { label: "損益表", path: "/accounting/income-statement", icon: <PieChart size={16} /> },
          { label: "資產負債表", path: "/accounting/balance-sheet", icon: <Scale size={16} /> },
          { label: "現金流量表", path: "/reports/cash-flow", icon: <TrendingUp size={16} />, roles: FINANCE_ROLES },
          { label: "試算表", path: "/reports/trial-balance", icon: <Scale size={16} />, roles: FINANCE_ROLES },
          { label: "會計帳簿", path: "/reports/books", icon: <BookOpen size={16} />, roles: FINANCE_ROLES },
          { label: "經營資料", path: "/reports/business", icon: <Wallet size={16} />, roles: FINANCE_ROLES },
          { label: "部門損益", path: "/hr/dept-financials", icon: <TrendingUp size={16} />, roles: FINANCE_ROLES },
          { label: "總分類帳", path: "/reports/general-ledger", icon: <Search size={16} />, roles: FINANCE_ROLES },
          { label: "月結摘要", path: "/reports/monthly-digest", icon: <FileSpreadsheet size={16} />, roles: FINANCE_ROLES },
          { label: "應收帳齡", path: "/reports/ar-aging", icon: <AlertTriangle size={16} />, roles: FINANCE_ROLES },
          { label: "應付帳齡", path: "/reports/ap-aging", icon: <AlertTriangle size={16} />, roles: FINANCE_ROLES },
          { label: "預算vs實際", path: "/reports/budget-vs-actual", icon: <DollarSign size={16} />, roles: FINANCE_ROLES },
          { label: "銷售分析", path: "/reports/sales-analysis", icon: <ShoppingCart size={16} /> },
          { label: "毛利分析", path: "/reports/gross-margin", icon: <TrendingUp size={16} /> },
          { label: "採購分析", path: "/reports/purchase-analysis", icon: <ShoppingBag size={16} /> },
          { label: "庫存狀況", path: "/reports/inventory-status", icon: <Boxes size={16} /> },
          { label: "BU 報表", path: "/reports/bu", icon: <Building2 size={16} />, roles: FINANCE_ROLES },
          { label: "出勤彙總", path: "/reports/attendance-summary", icon: <CalendarCheck size={16} />, roles: HR_ROLES },
          { label: "薪資彙總", path: "/reports/salary-summary", icon: <Wallet size={16} />, roles: PAYROLL_ROLES },
        ],
      },
    ],
  },
  {
    groupLabel: "系統設定",
    groupIcon: <Settings size={14} />,
    items: [
      {
        label: "審批與通知", icon: <ClipboardCheck size={18} />,
        children: [
          { label: "審批請求", path: "/system/approval-requests", icon: <ClipboardCheck size={16} /> },
          { label: "審批流程", path: "/system/approval-workflows", icon: <GitBranch size={16} /> },
          { label: "通知中心", path: "/system/notifications", icon: <Bell size={16} /> },
        ]
      },
      {
        label: "公司設定", icon: <Building2 size={18} />,
        children: [
          { label: "品牌管理", path: "/system/brands", icon: <Building2 size={16} /> },
          { label: "多幣別", path: "/system/currencies", icon: <Coins size={16} /> },
          { label: "行事曆", path: "/system/calendar", icon: <Calendar size={16} /> },
          { label: "寄信設定", path: "/system/email-settings", icon: <Bell size={16} />, roles: SYSTEM_ADMIN_ROLES },
          { label: "串接金鑰", path: "/system/integration-keys", icon: <KeyRound size={16} />, roles: SYSTEM_ADMIN_ROLES },
        ]
      },
      {
        label: "資料與紀錄", icon: <Database size={18} />,
        children: [
          { label: "匯入匯出", path: "/system/import-export", icon: <ArrowUpDown size={16} />, roles: SYSTEM_ADMIN_ROLES },
          { label: "檔案管理", path: "/system/file-management", icon: <Paperclip size={16} /> },
          { label: "稽核紀錄", path: "/system/audit-logs", icon: <History size={16} />, roles: SYSTEM_ADMIN_ROLES },
          { label: "排程任務", path: "/system/scheduled-jobs", icon: <Clock size={16} />, roles: SYSTEM_ADMIN_ROLES },
        ]
      },
      {
        label: "使用者與權限", icon: <Shield size={18} />,
        children: [
          { label: "職稱管理", path: "/admin/designations", icon: <Award size={16} />, roles: SYSTEM_ADMIN_ROLES },
          { label: "職級管理", path: "/admin/grades", icon: <Layers size={16} />, roles: SYSTEM_ADMIN_ROLES },
          { label: "帳號管理", path: "/admin/permissions", icon: <Settings size={16} />, roles: SYSTEM_ADMIN_ROLES },
          { label: "角色管理", path: "/admin/roles", icon: <ShieldCheck size={16} />, roles: SYSTEM_ADMIN_ROLES },
          { label: "選單顯示", path: "/admin/menu-permissions", icon: <Shield size={16} />, roles: SYSTEM_ADMIN_ROLES },
        ],
      },
      {
        label: "系統與 API", icon: <Server size={18} />,
        children: [
          { label: "API 金鑰", path: "/admin/api-keys", icon: <Key size={16} />, roles: SYSTEM_ADMIN_ROLES },
          { label: "外部串接", path: "/admin/integrations", icon: <Key size={16} />, roles: FINANCE_ROLES },
          { label: "API 文件", path: "/admin/api-docs", icon: <FileCode size={16} />, roles: SYSTEM_ADMIN_ROLES },
          { label: "資料庫備份", path: "/admin/backup", icon: <Database size={16} />, roles: ["super_admin"] },
        ]
      }
    ],
  },
];

const employeeNavGroups: NavGroup[] = [
  {
    groupLabel: "員工自助",
    groupIcon: <Users size={14} />,
    items: [
      { label: "打卡系統", path: "/hr/clock-in", icon: <Clock size={18} /> },
      { label: "AI 助理（報銷、請假）", path: "/ai/chat", icon: <MessageSquare size={18} /> },
      { label: "AI 拍照報銷", path: "/ai/assistant", icon: <Sparkles size={18} /> },
      { label: "我的申請（請款、付款）", path: "/hr/my-requests", icon: <Send size={18} /> },
      { label: "我的出勤與薪資", path: "/hr/me", icon: <CalendarCheck size={18} /> },
      { label: "請假申請", path: "/hr/leaves", icon: <CalendarOff size={18} /> },
      { label: "工時表", path: "/hr/timesheets", icon: <Timer size={18} /> },
    ],
  },
];
export const allNavItems = [...topLevelNavs, ...navGroups.flatMap(g => g.items)];

/** 依路徑找出選單項目的預設角色（含子選單） */
/** 目前網址屬於哪個功能頁（取最長相符的選單路徑）；首頁或不在選單裡的畫面回傳 null */
export function menuPathForLocation(location: string): string | null {
  let best: string | null = null;
  const consider = (path?: string) => {
    if (!path || path === "/") return;
    if ((location === path || location.startsWith(path + "/")) && (!best || path.length > best.length)) best = path;
  };
  for (const it of allNavItems) {
    consider(it.path);
    it.children?.forEach((c) => consider(c.path));
  }
  return best;
}

export function defaultRolesForPath(path: string): readonly string[] | undefined {
  for (const it of allNavItems) {
    if (it.path === path) return it.roles;
    const child = it.children?.find((c) => c.path === path);
    if (child) return child.roles;
  }
  return undefined;
}

/** 選單以外、但手機標題列也要顯示名稱的頁面 */
const EXTRA_PAGE_TITLES: Record<string, string> = {
  "/": "首頁",
  "/my-page": "我的頁面",
  "/account/security": "帳號與安全性",
  "/system/notifications": "通知",
  "/help": "使用說明",
  "/billing": "方案與帳務",
};

/** 手機底部分頁列的頁面：這些是最上層，標題列不顯示返回鍵 */
export const MOBILE_ROOT_PATHS: readonly string[] = ["/", "/hr/clock-in", "/system/approval-requests", "/system/notifications", "/hr/leaves", "/hr/me"];

/** 依路徑找出頁面名稱（手機標題列用）；明細頁（例如 /sales/orders/12）會對到所屬的清單頁 */
export function navTitleForPath(path: string): string | undefined {
  const titles = new Map<string, string>(Object.entries(EXTRA_PAGE_TITLES));
  const groups = [...employeeNavGroups, ...navGroups];
  for (const it of [...topLevelNavs, ...groups.flatMap((g) => g.items)]) {
    if (it.path && !titles.has(it.path)) titles.set(it.path, it.label);
    for (const c of it.children || []) if (!titles.has(c.path)) titles.set(c.path, c.label);
  }
  if (titles.has(path)) return titles.get(path);
  let best: string | undefined;
  for (const key of titles.keys()) {
    if (key !== "/" && path.startsWith(key + "/") && (!best || key.length > best.length)) best = key;
  }
  return best ? titles.get(best) : undefined;
}

export function Sidebar({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const [location] = useLocation();
  const { hasRole, user } = useAuth();
  const isEmployee = user?.role === ROLE_EMPLOYEE;
  const { allowed } = useMenuAllowed();
  const filteredTopLevelNavs = isEmployee ? [] : topLevelNavs
    .map((it) => ({
      ...it,
      children: it.children?.filter((c) => allowed(c.path, c.roles)),
    }))
    .filter((it) => allowed(it.path, it.roles) && (!it.children || it.children.length > 0))
    // 單一入口：連到第一個有權限的子功能，其餘在頁面內的分頁切換
    .map((it) => (it.singleEntry && it.children?.length
      ? { ...it, path: it.hubPath ?? it.children[0].path, activePaths: [...(it.hubPath ? [it.hubPath] : []), ...it.children.map((c) => c.path)], children: undefined }
      : { ...it, activePaths: undefined as string[] | undefined }));

  const filteredNavGroups = isEmployee ? employeeNavGroups : navGroups
    .map((g) => ({
      ...g,
      items: g.items
        .filter((it) => allowed(it.path, it.roles))
        .map((it) => ({
          ...it,
          children: it.children?.filter((c) => allowed(c.path, c.roles)),
        }))
        .filter((it) => !it.children || it.children.length > 0)
        // 單一入口（報表中心）：選單只放一個連結，連到總覽頁；裡面的報表在那一頁選
        .map((it) => (it.singleEntry && it.hubPath && it.children?.length
          ? { ...it, path: it.hubPath, activePaths: [it.hubPath, ...it.children.map((c) => c.path)], children: undefined }
          : { ...it, activePaths: undefined as string[] | undefined })),
    }))
    .filter((g) => g.items.length > 0);
  const [expanded, setExpanded] = useState<Record<string, boolean>>(() => {
    const init: Record<string, boolean> = {};
    allNavItems.forEach((item) => {
      if (item.children) {
        const isActive = item.children.some((c) => location === c.path || location.startsWith(c.path + "/"));
        if (isActive) init[item.label] = true;
      }
    });
    return init;
  });
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});

  useEffect(() => {
    navGroups.forEach((group) => {
      group.items.forEach((item) => {
        if (item.children?.some((c) => location === c.path || location.startsWith(c.path + "/"))) {
          setExpanded((prev) => ({ ...prev, [item.label]: true }));
          setCollapsedGroups((prev) => ({ ...prev, [group.groupLabel]: false }));
        }
      });
    });
    topLevelNavs.forEach((item) => {
      if (item.children?.some((c) => location === c.path || location.startsWith(c.path + "/"))) {
        setExpanded((prev) => ({ ...prev, [item.label]: true }));
      }
    });
  }, [location]);

  const toggleExpand = (label: string) => {
    setExpanded((prev) => ({ ...prev, [label]: !prev[label] }));
  };

  const toggleGroup = (label: string) => {
    setCollapsedGroups((prev) => ({ ...prev, [label]: !prev[label] }));
  };

  const isActive = (path: string) => {
    if (path === "/") return location === "/";
    return location === path || location.startsWith(path + "/");
  };

  return (
    <>
      {isOpen && (
        <div
          className="fixed inset-0 bg-black/40 z-40 lg:hidden"
          onClick={onClose}
        />
      )}
      <aside
        className={`fixed top-0 left-0 z-50 h-full w-64 bg-sidebar border-r border-sidebar-border transition-transform duration-200 ease-in-out lg:translate-x-0 lg:static lg:z-auto ${
          isOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="flex items-center justify-between h-14 px-4 border-b border-sidebar-border">
          <Link href="/" className="flex items-center gap-2">
            <img src={`${import.meta.env.BASE_URL}logo.png`} alt="七期生醫" className="w-8 h-8 object-contain" />
            <span className="font-semibold text-sidebar-foreground text-lg">企業管理系統</span>
          </Link>
          <button onClick={onClose} className="lg:hidden p-1 rounded hover:bg-sidebar-accent">
            <X size={20} className="text-sidebar-foreground" />
          </button>
        </div>

        <nav className="p-3 space-y-1 overflow-y-auto h-[calc(100%-3.5rem)]">
          {!isEmployee && (
            <Link
              href="/"
              onClick={onClose}
              className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                isActive("/")
                  ? "bg-sidebar-primary text-sidebar-primary-foreground"
                  : "text-sidebar-foreground hover:bg-sidebar-accent"
              }`}
            >
              <LayoutDashboard size={18} />
              儀表板
            </Link>
          )}
          {!isEmployee && (
            <Link
              href="/my-page"
              onClick={onClose}
              className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                isActive("/my-page")
                  ? "bg-sidebar-primary text-sidebar-primary-foreground"
                  : "text-sidebar-foreground hover:bg-sidebar-accent"
              }`}
            >
              <Star size={18} />
              我的頁面
            </Link>
          )}

          {filteredTopLevelNavs.map((item) => (
            <div key={item.label} className="pt-1">
              {item.path ? (
                <Link
                  href={item.path}
                  onClick={onClose}
                  className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                    (item.activePaths ? item.activePaths.some((p) => isActive(p)) : isActive(item.path))
                      ? "bg-sidebar-primary text-sidebar-primary-foreground"
                      : "text-sidebar-foreground hover:bg-sidebar-accent"
                  }`}
                >
                  {item.icon}
                  {item.label}
                </Link>
              ) : (
                <>
                  <button
                    onClick={() => toggleExpand(item.label)}
                    className="flex items-center justify-between w-full px-3 py-2 rounded-lg text-sm font-medium text-sidebar-foreground hover:bg-sidebar-accent transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      {item.icon}
                      {item.label}
                    </div>
                    {expanded[item.label] ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                  </button>
                  {expanded[item.label] && item.children && (
                    <div className="ml-4 mt-1 space-y-0.5">
                      {item.children.map((child) => (
                        <Link
                          key={child.path}
                          href={child.path}
                          onClick={onClose}
                          className={`flex items-center gap-3 px-3 py-1.5 rounded-md text-sm transition-colors ${
                            isActive(child.path)
                              ? "bg-sidebar-primary text-sidebar-primary-foreground"
                              : "text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground"
                          }`}
                        >
                          {child.icon}
                          {child.label}
                        </Link>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
          ))}

          {filteredNavGroups.map((group) => (
            <div key={group.groupLabel} className="pt-3">
              <button
                onClick={() => toggleGroup(group.groupLabel)}
                className="flex items-center gap-2 px-3 py-1.5 w-full text-left"
              >
                {group.groupIcon}
                <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider flex-1">
                  {group.groupLabel}
                </span>
                {collapsedGroups[group.groupLabel]
                  ? <ChevronRight size={12} className="text-muted-foreground" />
                  : <ChevronDown size={12} className="text-muted-foreground" />
                }
              </button>

              {!collapsedGroups[group.groupLabel] && (
                <div className="mt-1 space-y-0.5">
                  {group.items.map((item) => (
                    <div key={item.label}>
                      {item.path ? (
                        <Link
                          href={item.path}
                          onClick={onClose}
                          className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                            (((item as { activePaths?: string[] }).activePaths ?? [item.path]).some((p) => isActive(p)))
                              ? "bg-sidebar-primary text-sidebar-primary-foreground"
                              : "text-sidebar-foreground hover:bg-sidebar-accent"
                          }`}
                        >
                          {item.icon}
                          {item.label}
                        </Link>
                      ) : (
                        <>
                          <button
                            onClick={() => toggleExpand(item.label)}
                            className="flex items-center justify-between w-full px-3 py-2 rounded-lg text-sm font-medium text-sidebar-foreground hover:bg-sidebar-accent transition-colors"
                          >
                            <div className="flex items-center gap-3">
                              {item.icon}
                              {item.label}
                            </div>
                            {expanded[item.label] ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                          </button>
                          {expanded[item.label] && item.children && (
                            <div className="ml-4 mt-1 space-y-0.5">
                              {item.children.map((child) => (
                                <Link
                                  key={child.path}
                                  href={child.path}
                                  onClick={onClose}
                                  className={`flex items-center gap-3 px-3 py-1.5 rounded-md text-sm transition-colors ${
                                    isActive(child.path)
                                      ? "bg-sidebar-primary text-sidebar-primary-foreground"
                                      : "text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground"
                                  }`}
                                >
                                  {child.icon}
                                  {child.label}
                                </Link>
                              ))}
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </nav>
      </aside>
    </>
  );
}

export function TopBar({ onMenuClick }: { onMenuClick: () => void }) {
  const { dark, toggle: toggleTheme } = useTheme();
  const [notifCount, setNotifCount] = useState(0);
  const [notifications, setNotifications] = useState<any[]>([]);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [location, navigate] = useLocation();
  const { user, logout } = useAuth();
  useGlobalSearchHotkey(setSearchOpen);
  const mobileTitle = navTitleForPath(location) || "七期生醫 ERP";
  const showBack = !MOBILE_ROOT_PATHS.includes(location);
  const goBack = () => { if (window.history.length > 1) window.history.back(); else navigate("/"); };
  const isPhone = () => window.matchMedia("(max-width: 767px)").matches;

  useEffect(() => {
    const base = import.meta.env.BASE_URL.endsWith("/") ? import.meta.env.BASE_URL : import.meta.env.BASE_URL + "/";
    const fetchNotifications = () => fetch(`/erp-api/notifications?limit=10`, { credentials: "include" })
      .then(r => r.ok ? r.json() : { notifications: [], unreadCount: 0 })
      .then(d => {
        setNotifCount(d.unreadCount || 0);
        setNotifications(d.notifications || []);
      })
      .catch(() => {});
    fetchNotifications();
    const interval = setInterval(fetchNotifications, 60000);
    return () => clearInterval(interval);
  }, []);

  const notificationPath = (notification: any) => {
    if (notification.documentType === "MaterialRequest") return "/purchasing/material-requests";
    if (notification.documentType === "RecurringInvoice") return "/accounting/recurring-invoices";
    if (notification.type === "approval") return notification.documentType && notification.documentId ? `/system/approval-requests?doc=${notification.documentType}:${notification.documentId}` : "/system/approval-requests";
    if (notification.documentType === "Setup") return "/";
    if (notification.module === "Inventory") return "/inventory/items";
    if (notification.module === "Sales") return "/sales/orders";
    if (notification.module === "Purchasing") return "/purchasing/orders";
    if (notification.module === "Accounting") return "/accounting/invoices";
    return "/system/notifications";
  };

  const markReadAndNavigate = async (notification: any) => {
    const base = import.meta.env.BASE_URL.endsWith("/") ? import.meta.env.BASE_URL : `${import.meta.env.BASE_URL}/`;
    if (notification.isRead === "No") {
      const response = await fetch(`/erp-api/notifications/${notification.id}/read`, { method: "PATCH", credentials: "include" });
      if (response.ok) {
        setNotifCount(count => Math.max(0, count - 1));
        setNotifications(rows => rows.map(row => row.id === notification.id ? { ...row, isRead: "Yes" } : row));
      }
    }
    setNotificationsOpen(false);
    navigate(notificationPath(notification));
  };

  const markAllRead = async () => {
    const base = import.meta.env.BASE_URL.endsWith("/") ? import.meta.env.BASE_URL : `${import.meta.env.BASE_URL}/`;
    const response = await fetch(`/erp-api/notifications/read-all`, { method: "PATCH", credentials: "include" });
    if (response.ok) {
      setNotifCount(0);
      setNotifications(rows => rows.map(row => ({ ...row, isRead: "Yes" })));
    }
  };

  const initial = user?.displayName?.[0] || user?.username?.[0] || "管";

  return (
    <header className="h-[calc(3.5rem+env(safe-area-inset-top))] border-b border-border bg-card/95 backdrop-blur-md md:bg-card md:backdrop-blur-none flex items-center px-2 md:px-4 gap-1 md:gap-4 sticky top-0 z-30 pt-[env(safe-area-inset-top)] select-none md:select-auto">
      {/* 手機：返回鍵＋頁面名稱，像 App 的標題列 */}
      <div className="flex min-w-0 flex-1 items-center md:hidden" data-testid="mobile-title-bar">
        {showBack ? (
          <button onClick={goBack} aria-label="返回上一頁" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full active:bg-accent touch-manipulation" data-testid="button-mobile-back">
            <ChevronLeft size={26} />
          </button>
        ) : <span className="w-2 shrink-0" />}
        <div className="truncate text-[17px] font-semibold leading-none" data-testid="text-mobile-title">{mobileTitle}</div>
      </div>
      <button onClick={() => setSearchOpen(true)} aria-label="搜尋" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full active:bg-accent touch-manipulation md:hidden" data-testid="button-mobile-search">
        <Search size={20} />
      </button>
      <button onClick={onMenuClick} className="hidden md:block lg:hidden p-2 rounded-md hover:bg-accent">
        <Menu size={20} />
      </button>
      <button
        onClick={() => setSearchOpen(true)}
        className="hidden md:flex items-center gap-2 px-3 py-1.5 rounded-md border bg-muted/40 hover:bg-muted text-sm text-muted-foreground w-full max-w-md touch-manipulation"
        data-testid="button-global-search"
      >
        <Search size={16} className="shrink-0" />
        <span className="flex-1 text-left truncate">搜尋...</span>
        <kbd className="hidden sm:inline-flex text-[10px] px-1.5 py-0.5 bg-background rounded border">⌘K</kbd>
      </button>
      <div className="hidden md:block flex-1" />
      <GlobalSearchDialog open={searchOpen} onClose={() => setSearchOpen(false)} />
      <div className="flex shrink-0 items-center gap-0 md:gap-3">
        <button
          onClick={() => navigate("/help")}
          className="hidden md:block p-2 rounded-md hover:bg-accent"
          aria-label="使用說明"
          title="使用說明與知識查詢"
          data-testid="button-help-center"
        >
          <HelpCircle size={18} />
        </button>
        <button
          onClick={toggleTheme}
          className="hidden md:block p-2 rounded-md hover:bg-accent"
          aria-label={dark ? "切換成淺色" : "切換成深色"}
          title={dark ? "切換成淺色" : "切換成深色"}
          data-testid="button-toggle-theme"
        >
          {dark ? <Sun size={18} /> : <Moon size={18} />}
        </button>
        <div className={user?.role === ROLE_EMPLOYEE ? "relative" : "relative max-md:hidden"}>
          <button onClick={() => { if (isPhone()) navigate("/system/notifications"); else setNotificationsOpen(open => !open); }} className="relative p-2 rounded-md hover:bg-accent max-md:flex max-md:h-11 max-md:w-11 max-md:items-center max-md:justify-center max-md:rounded-full max-md:active:bg-accent" aria-label="通知">
            <Bell size={18} />
            {notifCount > 0 && <span className="absolute -top-0.5 -right-0.5 max-md:top-1 max-md:right-1 min-w-[18px] h-[18px] rounded-full bg-destructive text-destructive-foreground text-[10px] font-bold flex items-center justify-center px-1">{notifCount > 99 ? "99+" : notifCount}</span>}
          </button>
          {notificationsOpen && (
            <div className="absolute right-0 mt-2 w-80 sm:w-96 rounded-lg border bg-popover text-popover-foreground shadow-lg overflow-hidden z-50">
              <div className="flex items-center justify-between px-4 py-3 border-b">
                <span className="font-semibold text-sm">通知</span>
                {notifCount > 0 && <button onClick={markAllRead} className="text-xs text-primary hover:underline">全部標為已讀</button>}
              </div>
              <div className="max-h-80 overflow-y-auto">
                {notifications.length > 0 ? notifications.map(notification => (
                  <button
                    key={notification.id}
                    onClick={() => markReadAndNavigate(notification)}
                    className={`w-full text-left px-4 py-3 border-b last:border-b-0 hover:bg-accent ${notification.isRead === "No" ? "bg-primary/5" : ""}`}
                  >
                    <div className="flex gap-2">
                      {notification.isRead === "No" && <span className="mt-1.5 h-2 w-2 rounded-full bg-primary shrink-0" />}
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate">{notification.title}</p>
                        <p className="text-xs text-muted-foreground line-clamp-2 mt-0.5">{notification.message}</p>
                        <p className="text-[10px] text-muted-foreground mt-1">{new Date(notification.createdAt).toLocaleString("zh-TW")}</p>
                      </div>
                    </div>
                  </button>
                )) : <p className="py-8 text-center text-sm text-muted-foreground">目前沒有通知</p>}
              </div>
              <button onClick={() => { setNotificationsOpen(false); navigate("/system/notifications"); }} className="w-full py-2.5 text-center text-xs text-primary hover:bg-accent border-t">查看全部通知</button>
            </div>
          )}
        </div>
        {user && (
          <div className="flex items-center gap-2 max-md:h-11 max-md:w-11 max-md:justify-center">
            <button
              type="button"
              onClick={() => navigate("/account/security")}
              className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center hover:ring-2 hover:ring-primary/30"
              title="帳號與安全性"
              aria-label="開啟帳號與安全性設定"
              data-testid="button-account-security"
            >
              <span className="text-primary text-xs font-semibold">{initial}</span>
            </button>
            <div className="hidden sm:flex flex-col leading-tight">
              <span className="text-xs font-medium">{user.displayName}</span>
              <span className="text-[10px] text-muted-foreground" title={`版本 ${APP_VERSION.version}`} data-testid="text-app-version">{user.role}<span className="hidden lg:inline">・{APP_VERSION.version}</span></span>
            </div>
            <button
              onClick={() => logout()}
              className="hidden md:block p-2 rounded-md hover:bg-accent text-muted-foreground hover:text-foreground"
              title="登出"
              data-testid="button-logout"
            >
              <LogOut size={16} />
            </button>
          </div>
        )}
      </div>
    </header>
  );
}
