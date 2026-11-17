import type { Request, Response, NextFunction } from "express";
import { db } from "@workspace/erp-db";
import { menuPermissionsTable } from "@workspace/erp-db/schema";

/**
 * 模組停用守門員：平台方在 menu_permissions 以 "__disabled__" 哨兵停用的模組，
 * 不只前端隱藏選單，對應的 API 路由群組也在伺服器端回 403。
 *
 * 對照表：前端選單 path → 該頁面使用的 API 路由前綴。
 * 多個選單 path 可共用同一個 API 前綴（例如三種發票頁都用 /invoices）；
 * 共用前綴只有在「所有對應選單 path 都被停用」時才會被擋，避免誤傷仍開放的模組。
 */
/**
 * 基礎功能頁：平台後台不可停用（前端選擇器隱藏、後端寫入時剝除哨兵）。
 * 這些頁面的 API（登入/帳務/通知鈴鐺/附件等）為全系統共用，停用會癱瘓基本操作，
 * 因此對應的 /admin/、/notifications、/attachments 豁免是合理的：沒有任何可停用模組依賴它們被擋。
 */
export const FOUNDATION_PATHS: readonly string[] = [
  "/billing",
  "/hr/me",
  "/hr/my-requests",
  "/platform/tenants",
  "/admin/permissions",
  "/admin/menu-permissions",
  "/admin/api-docs",
  "/system/notifications",
  "/system/file-management",
];

export const MODULE_API_MAP: Record<string, string[]> = {
  // HR
  "/hr/employees": ["/employees"],
  "/hr/teachers": ["/teachers"],
  "/hr/contracts": ["/hr-contracts"],
  "/hr/departments": ["/departments"],
  // 部門／專案損益頁：沒有自己的前綴，改由 EXCLUSIVE_API_RULES 精準封鎖 /:id/financials
  "/hr/dept-financials": [],
  "/hr/attendance": ["/attendance"],
  "/hr/clock-in": ["/attendance"],
  "/hr/clock-in-locations": ["/clock-in-locations"],
  "/hr/leaves": ["/leaves"],
  "/hr/shift-types": ["/shift-types"],
  "/hr/salary-calc": ["/salary-slips", "/payroll-settings"],
  "/hr/salary-slips": ["/salary-slips", "/payroll-settings"],
  "/hr/service-fees": ["/service-fees"],
  "/hr/salary-components": ["/salary-components"],
  "/hr/timesheets": ["/timesheets"],
  "/accounting/payment-terms": [],
  "/inventory/stock-counts": ["/stock-counts"],
  "/accounting/dunning": ["/dunning"],
  "/accounting/recurring-invoices": ["/recurring-invoices"],
  "/accounting/budgets": ["/budgets"],
  "/purchasing/material-requests": ["/material-requests"],
  "/hr/insurance-brackets": ["/insurance-brackets"],
  // 銷售
  "/sales/customers": ["/customers"],
  "/sales/orders": ["/sales-orders", "/registrants"],
  "/sales/quick-entry": ["/sales-orders"],
  "/sales/quotations": ["/quotations", "/ai/quotation-import"],
  "/sales/order-templates": ["/order-templates"],
  "/sales/quotation-templates": ["/quotation-templates"],
  "/sales/invoices": ["/invoices"],
  "/sales/delivery-notes": ["/delivery-notes"],
  "/sales/returns": ["/sales-returns"],
  "/sales/price-lists": ["/price-lists"],
  // 採購
  "/purchasing/suppliers": ["/suppliers"],
  "/purchasing/orders": ["/purchase-orders"],
  "/purchasing/invoices": ["/invoices"],
  "/purchasing/receipts": ["/purchase-receipts"],
  "/purchasing/returns": ["/purchase-returns"],
  // 庫存
  // 查庫存：專用的查詢端點（只有數量與售價，不含成本）
  "/inventory/lookup": ["/inventory-lookup"],
  "/inventory/items": ["/items"],
  "/inventory/categories": ["/item-categories"],
  "/inventory/types": ["/item-types"],
  "/inventory/warehouses": ["/warehouses"],
  "/inventory/stock": ["/stock-entries"],
  // 專案
  "/projects": ["/projects"],
  "/projects/tasks": ["/tasks"],
  "/projects/financials": [],
  "/projects/course-project": ["/noncodingai"],
  "/projects/cm-life": ["/cm-life"],
  // 會計
  "/accounting/accounts": ["/accounts"],
  "/accounting/ai-drafts": ["/ai-drafts"],
  "/accounting/journal": ["/journal-entries"],
  "/accounting/invoices": ["/invoices"],
  "/accounting/vat-report": ["/vat-report"],
  "/accounting/customers": ["/customers"],
  "/accounting/reimbursement": ["/reimbursement"],
  "/accounting/receipts": ["/vouchers"],
  "/accounting/payments": ["/vouchers"],
  "/accounting/payment-requests": ["/payment-requests"],
  "/accounting/bank-reconciliation": ["/bank-reconciliation", "/bank-statements", "/ai/bank-match"],
  "/accounting/income-statement": ["/reports/income-statement"],
  "/accounting/balance-sheet": ["/reports/balance-sheet"],
  // 報表（各頁對應各自的 /reports/<name> 前綴，停用單一報表即可精準封鎖）
  "/reports/cash-flow": ["/reports/cash-flow"],
  "/reports/trial-balance": ["/reports/trial-balance"],
  "/reports/general-ledger": ["/reports/general-ledger"],
  "/reports/ar-aging": ["/reports/ar-aging"],
  "/reports/ap-aging": ["/reports/ap-aging"],
  "/reports/budget-vs-actual": ["/reports/budget-vs-actual"],
  "/reports/sales-analysis": ["/reports/sales-analysis"],
  "/reports/gross-margin": ["/reports/gross-margin"],
  "/reports/monthly-digest": ["/reports/monthly-digest"],
  "/reports/purchase-analysis": ["/reports/purchase-analysis"],
  "/reports/attendance-summary": ["/reports/attendance-summary"],
  "/reports/salary-summary": ["/reports/salary-summary"],
  "/reports/inventory-status": ["/reports/inventory-status", "/reports/inventory"],
  "/reports/bu": ["/reports/bu"],
  // BI 決策中心：各頁獨立指標端點；/bi/ai-consultant 為五頁共用（全部停用才擋）
  "/bi/executive": ["/bi/executive", "/bi/ai-consultant"],
  "/bi/sales": ["/bi/sales", "/bi/ai-consultant"],
  "/bi/inventory": ["/bi/inventory", "/bi/ai-consultant"],
  "/bi/hr": ["/bi/hr", "/bi/ai-consultant"],
  "/bi/observability": ["/bi/observability"],
  // 資產
  "/assets/register": ["/assets"],
  "/assets/categories": ["/asset-categories"],
  "/assets/depreciation": ["/assets"],
  "/assets/maintenance": ["/asset-maintenance"],
  // 製造
  "/manufacturing/workstations": ["/workstations"],
  "/manufacturing/bom": ["/boms"],
  "/manufacturing/work-orders": ["/work-orders"],
  "/manufacturing/subcontract-orders": ["/subcontract-orders"],
  "/manufacturing/job-cards": ["/job-cards"],
  "/manufacturing/production-planning": ["/production-planning"],
  // 品質
  "/quality/templates": ["/quality-inspection-templates"],
  "/quality/inspections": ["/quality-inspections"],
  "/quality/non-conformance": ["/non-conformance-reports"],
  "/quality/capa": ["/capa-actions"],
  // 客服 / 合約
  "/helpdesk/tickets": ["/support-tickets"],
  "/helpdesk/knowledge-base": ["/kb-articles", "/kb-categories"],
  "/helpdesk/sla": ["/sla-definitions", "/ticket-categories"],
  "/contracts": ["/contracts"],
  // 系統
  "/system/approval-workflows": ["/approval-workflows"],
  "/system/approval-requests": ["/approval-requests"],
  "/system/print-templates": ["/print-templates"],
  "/system/brands": ["/brands"],
  "/system/audit-logs": ["/audit-logs"],
  "/system/calendar": ["/calendar-events"],
  "/system/currencies": ["/currencies", "/exchange-rates"],
  "/system/import-export": ["/import-export"],
  "/system/scheduled-jobs": ["/scheduled-jobs"],
  "/system/email-settings": ["/email-settings"],
  "/system/integration-keys": ["/settings/integrations"],
  // 管理
  "/admin/roles": ["/roles"],
  "/admin/designations": ["/designations"],
  "/admin/grades": ["/grades"],
  "/admin/api-keys": ["/api-keys"],
  "/admin/integrations": ["/integrations"],
  "/system/legacy-documents": ["/legacy-documents"],
  "/accounting/advances": ["/advances"],
  "/accounting/receivables": ["/receivables"],
  "/purchasing/rfqs": ["/rfqs"],
  "/admin/backup": ["/backup"],
  // AI（各頁對應各自的 /ai/<action> 端點，停用單頁即精準封鎖該頁的 AI 功能；
  //   /ai/bank-match 與 /ai/quotation-import 分屬銀行對帳與報價單頁，掛在該頁項下）
  "/ai/chat": ["/ai/chat"],
  "/ai/assistant": ["/ai/ask", "/ai/customer-draft", "/ai/document-draft"],
  "/ai/anomalies": ["/ai/anomalies", "/anomaly-check"],
  "/ai/monthly-report": ["/ai/monthly-report"],
  "/ai/document-ocr": ["/ai/document-ocr"],
  "/ai/complaint-classify": ["/ai/classify-complaint"],
  "/ai/product-description": ["/ai/product-description"],
};

/**
 * 頁面專屬操作規則：某頁被停用時，即使它與其他仍開放頁面共用 API 前綴，
 * 其「專屬操作端點」仍必須被擋（action/子路徑層級授權）。
 * 與 MODULE_API_MAP 的差異：這裡的規則只要該頁停用就生效，不需整組停用。
 */
export interface ExclusiveRule { method?: string; re: RegExp }
export const EXCLUSIVE_API_RULES: Record<string, ExclusiveRule[]> = {
  // 折舊排程頁：折舊操作是它的專屬功能（資產登記冊仍可開放）
  "/assets/depreciation": [{ re: /^\/assets\/[^/]+\/depreciate$/ }, { re: /^\/assets\/batch-depreciate$/ }],
  // 部門／專案損益頁：損益查詢端點是它們的專屬功能（部門、專案管理頁仍可開放）
  "/hr/dept-financials": [{ re: /^\/departments\/[^/]+\/financials$/ }],
  "/projects/financials": [{ re: /^\/projects\/[^/]+\/financials$/ }],
  // 快速下單頁：專屬的快速建單端點（一般訂單頁仍可開放）
  "/sales/quick-entry": [{ re: /^\/create-sales-order$/ }],
  // 薪資計算頁：試算與批次產生是它的專屬功能（薪資單列表頁仍可開放）
  "/hr/salary-calc": [
    { re: /^\/salary-slips\/calculate$/ },
    { re: /^\/salary-slips\/batch-generate$/ },
    { re: /^\/salary-slips\/attendance-basis$/ },
  ],
  // 打卡頁：上/下班打卡操作與即時狀態是它的專屬功能；
  // 出勤管理頁只讀取列表/月彙總（GET /attendance、GET /attendance/monthly-summary），不受影響
  "/hr/clock-in": [
    { re: /^\/attendance\/today-state$/ },
    { method: "POST", re: /^\/attendance$/ },
    { method: "PATCH", re: /^\/attendance\/[^/]+$/ },
  ],
};

/**
 * 共用 API 的停用語義（與平台後台一致）：
 * 銷售/採購/會計發票、收款/付款（vouchers）等頁面是「同一模組資料的不同檢視」，
 * 沒有專屬端點；只停用其中一頁時，仍開放的頁面本來就能存取相同資料與操作，
 * 因此共用前綴只有在整組頁面都停用時才擋 —— 單頁停用不會、也不可能
 * 讓使用者取得任何仍開放頁面拿不到的能力。
 * 有專屬操作的頁面（見 EXCLUSIVE_API_RULES）則不受此限，單頁停用即擋專屬端點。
 */

/** API 前綴 → 對應的所有選單 path（反向索引，啟動時建一次） */
const PREFIX_TO_MENU_PATHS = new Map<string, string[]>();
for (const [menuPath, prefixes] of Object.entries(MODULE_API_MAP)) {
  for (const p of prefixes) {
    const list = PREFIX_TO_MENU_PATHS.get(p) || [];
    list.push(menuPath);
    PREFIX_TO_MENU_PATHS.set(p, list);
  }
}

/**
 * 某個 API 路徑屬於哪些功能頁（取最長相符的前綴）。
 * 供 permission-guard 依角色權限把關；找不到對應時 menuPaths 是空陣列。
 */
export function menuPathsForApi(path: string): { prefix: string | null; menuPaths: string[] } {
  let best: string | null = null;
  for (const prefix of PREFIX_TO_MENU_PATHS.keys()) {
    if ((path === prefix || path.startsWith(prefix + "/")) && (!best || prefix.length > best.length)) best = prefix;
  }
  return { prefix: best, menuPaths: best ? PREFIX_TO_MENU_PATHS.get(best) || [] : [] };
}

/**
 * 這些前綴永遠不擋。每一項都對應「不可停用的基礎功能」（見 FOUNDATION_PATHS）：
 * - /admin/：登入、登出、目前使用者、使用者/角色管理（基礎帳號功能；可停用的管理頁
 *   designations/grades/api-keys/backup 都使用獨立前綴，不在 /admin 之下）
 * - /notifications：全站通知鈴鐺；/attachments：各模組共用的附件
 * - 其餘為帳務、平台管理、選單權限本身與公開端點
 */
const NEVER_BLOCK = ["/admin/", "/billing", "/public/", "/stripe/", "/health", "/config", "/menu-permissions", "/platform", "/signup", "/notifications", "/global-search", "/attachments", "/external"];

const DISABLED = "__disabled__";

/** 60 秒租戶停用模組快取，避免每個請求都查 menu_permissions */
const disabledCache = new Map<number, { paths: Set<string>; at: number }>();
const CACHE_MS = 60_000;

export function invalidateModuleCache(tenantId: number): void {
  disabledCache.delete(tenantId);
}

async function loadDisabledPaths(tenantId: number): Promise<Set<string>> {
  const hit = disabledCache.get(tenantId);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.paths;
  // db 在 tenant context 內執行，RLS 已限定為該租戶的 menu_permissions
  const rows = await db.select().from(menuPermissionsTable);
  const paths = new Set(rows.filter((r) => (r.roles || []).includes(DISABLED)).map((r) => r.path));
  disabledCache.set(tenantId, { paths, at: Date.now() });
  return paths;
}

/** 判斷某 API 前綴是否應被擋：對應到它的所有選單 path 都被停用才擋 */
/** 指定選單頁是否被平台停用（供共用端點依實際頁面再把關，例如 BI AI 顧問） */
export async function isMenuPathDisabled(tenantId: number, menuPath: string): Promise<boolean> {
  return (await loadDisabledPaths(tenantId)).has(menuPath);
}

function isPrefixBlocked(prefix: string, disabled: Set<string>): boolean {
  const menuPaths = PREFIX_TO_MENU_PATHS.get(prefix);
  if (!menuPaths || menuPaths.length === 0) return false;
  return menuPaths.every((p) => disabled.has(p));
}

/** 純函式：給定 API path 與停用選單集合，回傳是否應擋（供中介層與測試共用） */
export function isApiPathBlocked(path: string, disabled: Set<string>, method?: string): boolean {
  if (NEVER_BLOCK.some((p) => path === p || path.startsWith(p.endsWith("/") ? p : p + "/"))) return false;
  if (disabled.size === 0) return false;
  // 頁面專屬操作：該頁停用即擋，不需整組停用
  for (const menuPath of disabled) {
    const rules = EXCLUSIVE_API_RULES[menuPath];
    if (rules && rules.some((r) => (!r.method || !method || r.method === method) && r.re.test(path))) return true;
  }
  for (const prefix of PREFIX_TO_MENU_PATHS.keys()) {
    if ((path === prefix || path.startsWith(prefix + "/")) && isPrefixBlocked(prefix, disabled)) return true;
  }
  return false;
}

/**
 * 模組守門員：掛在 subscriptionGate 之後。
 * 被平台方停用模組對應的 API 路由群組一律回 403（平台方 tenant 1 不受影響）。
 */
export async function moduleGuard(req: Request, res: Response, next: NextFunction): Promise<void> {
  const tenantId = (req as any).tenantId as number | undefined;
  if (!tenantId || tenantId === 1) { next(); return; }
  if (NEVER_BLOCK.some((p) => req.path === p || req.path.startsWith(p.endsWith("/") ? p : p + "/"))) { next(); return; }
  const disabled = await loadDisabledPaths(tenantId);
  if (isApiPathBlocked(req.path, disabled, req.method)) {
    res.status(403).json({ error: "此模組未開放", code: "module_disabled", message: "此模組未開放使用，如需開通請聯絡平台管理員。" });
    return;
  }
  next();
}
