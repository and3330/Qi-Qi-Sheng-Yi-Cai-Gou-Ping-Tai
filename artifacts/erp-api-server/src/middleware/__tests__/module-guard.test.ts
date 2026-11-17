import { describe, it, expect, vi } from "vitest";

// This suite exercises only the exported path-mapping pure functions. Keep the
// production DB proxy from initializing so it remains safe without DB config.
vi.mock("@workspace/erp-db", () => ({ db: {} }));

import { isApiPathBlocked, MODULE_API_MAP, FOUNDATION_PATHS } from "../module-guard";
// sidebar 選單 path 清單（與 artifacts/erp/src/components/layout/sidebar.tsx 對照）
// 這裡列出所有平台後台可勾選停用的頁面，驗證每一頁都有伺服器端對應。
const SIDEBAR_PATHS = [
  "/accounting/accounts", "/accounting/balance-sheet", "/accounting/bank-reconciliation",
  "/accounting/customers", "/accounting/income-statement", "/accounting/invoices",
  "/accounting/journal", "/accounting/payment-requests", "/accounting/payment-terms", "/accounting/payments",
  "/accounting/dunning", "/accounting/recurring-invoices", "/accounting/budgets", "/accounting/advances", "/accounting/receivables", "/purchasing/rfqs", "/purchasing/material-requests",
  "/accounting/receipts", "/accounting/reimbursement", "/accounting/vat-report",
  "/admin/api-docs", "/admin/api-keys", "/admin/backup", "/admin/designations", "/admin/integrations",
  "/admin/grades", "/admin/menu-permissions", "/admin/permissions",
  "/ai/anomalies", "/ai/assistant", "/ai/chat", "/ai/complaint-classify", "/ai/document-ocr",
  "/ai/monthly-report", "/ai/product-description",
  "/assets/categories", "/assets/depreciation", "/assets/maintenance", "/assets/register",
  "/billing", "/contracts",
  "/bi/executive", "/bi/sales", "/bi/inventory", "/bi/hr", "/bi/observability",
  "/helpdesk/knowledge-base", "/helpdesk/sla", "/helpdesk/tickets",
  "/hr/attendance", "/hr/clock-in", "/hr/clock-in-locations", "/hr/departments", "/hr/dept-financials",
  "/hr/employees", "/hr/insurance-brackets", "/hr/leaves", "/hr/me",
  "/hr/salary-calc", "/hr/salary-components", "/hr/salary-slips", "/hr/service-fees", "/hr/shift-types", "/hr/teachers", "/hr/timesheets",
  "/inventory/categories", "/inventory/items", "/inventory/stock", "/inventory/stock-counts", "/inventory/types", "/inventory/warehouses",
  "/manufacturing/bom", "/manufacturing/job-cards", "/manufacturing/production-planning",
  "/manufacturing/subcontract-orders", "/manufacturing/work-orders", "/manufacturing/workstations",
  "/platform/tenants",
  "/projects", "/projects/cm-life", "/projects/course-project", "/projects/financials", "/projects/tasks",
  "/purchasing/invoices", "/purchasing/orders", "/purchasing/receipts", "/purchasing/returns", "/purchasing/suppliers",
  "/quality/capa", "/quality/inspections", "/quality/non-conformance", "/quality/templates",
  "/reports/ap-aging", "/reports/ar-aging", "/reports/attendance-summary", "/reports/bu",
  "/reports/budget-vs-actual", "/reports/cash-flow", "/reports/general-ledger", "/reports/gross-margin",
  "/reports/inventory-status", "/reports/monthly-digest", "/reports/purchase-analysis",
  "/reports/salary-summary", "/reports/sales-analysis", "/reports/trial-balance",
  "/sales/customers", "/sales/delivery-notes", "/sales/invoices", "/sales/orders",
  "/sales/order-templates", "/sales/price-lists", "/sales/quick-entry", "/sales/quotations",
  "/sales/quotation-templates", "/sales/returns",
  "/system/approval-requests", "/system/approval-workflows", "/system/audit-logs",
  "/system/brands", "/system/calendar", "/system/currencies", "/system/email-settings", "/system/file-management",
  "/system/import-export", "/system/notifications",
  "/system/print-templates", "/system/scheduled-jobs",
];

describe("模組停用對照表覆蓋率", () => {
  it("每個 sidebar 選單 path 不是基礎功能就是有 API 對照", () => {
    const uncovered = SIDEBAR_PATHS.filter(
      (p) => !FOUNDATION_PATHS.includes(p) && !MODULE_API_MAP[p],
    );
    expect(uncovered).toEqual([]);
  });

  it("基礎功能頁不得出現在 API 對照表（不可停用）", () => {
    const overlap = FOUNDATION_PATHS.filter((p) => MODULE_API_MAP[p]);
    expect(overlap).toEqual([]);
  });

  it("對照表中的每個 API 前綴都對應實際存在的路由", () => {
    // 由 src/routes/*.ts 的 router.get/post/...("...") 宣告整理出的實際端點前綴
    const ACTUAL_ROUTES = [
      "/email-settings",
      "/settings/integrations",
      "/accounting-settings", "/accounts", "/admin", "/ai", "/ai-drafts", "/anomaly-check", "/api-keys",
      "/approval-requests", "/approval-workflows", "/asset-categories", "/asset-maintenance",
      "/assets", "/attachments", "/attendance", "/audit-logs", "/backup",
      "/bank-reconciliation", "/bank-statements", "/batch", "/billing", "/boms", "/brands",
      "/calendar-events", "/capa-actions", "/clock-in-locations", "/cm-life", "/config",
      "/contracts", "/currencies", "/exchange-rates", "/customers", "/dashboard", "/data-sync",
      "/delivery-notes", "/departments", "/designations", "/employees", "/grades", "/hr-contracts",
      "/import-export", "/insurance-brackets", "/inventory-lookup", "/invoices", "/item-categories", "/items",
      "/item-types", "/job-cards", "/journal-entries", "/kb-articles", "/kb-categories",
      "/leads", "/leaves", "/menu-permissions", "/noncodingai", "/non-conformance-reports",
      "/notifications", "/opportunities", "/order-templates", "/payment-requests", "/platform",
      "/payroll-settings", "/price-lists", "/print-templates", "/production-planning",
      "/projects", "/purchase-orders", "/purchase-receipts", "/purchase-returns",
      "/quality-inspections", "/quality-inspection-templates", "/quotations",
      "/quotation-templates", "/registrants", "/reimbursement", "/roles", "/salary-components", "/salary-slips", "/service-fees", "/stock-counts", "/timesheets", "/payment-terms", "/dunning", "/recurring-invoices", "/budgets", "/material-requests", "/subcontract-orders", "/integrations", "/legacy-documents", "/advances", "/receivables", "/rfqs",
      "/create-sales-order", "/sales-orders", "/sales-returns", "/scheduled-jobs",
      "/shift-types", "/sla-definitions", "/stock-entries", "/suppliers", "/support-tickets",
      "/tasks", "/teachers", "/ticket-categories", "/vat-report", "/vouchers", "/warehouses",
      "/work-orders", "/workstations",
      // reports.ts / inventory-report.ts / bu-report.ts 的實際端點
      "/reports/ap-aging", "/reports/ar-aging", "/reports/attendance-summary",
      "/reports/balance-sheet", "/reports/budget-vs-actual", "/reports/cash-flow",
      "/reports/general-ledger", "/reports/gross-margin", "/reports/income-statement",
      "/reports/inventory-status", "/reports/monthly-digest", "/reports/purchase-analysis",
      "/reports/salary-summary", "/reports/sales-analysis", "/reports/trial-balance",
      "/reports/inventory", "/reports/inventory/warehouse-summary", "/reports/bu",
      "/bi/executive", "/bi/sales", "/bi/inventory", "/bi/hr", "/bi/observability", "/bi/ai-consultant",
      // ai-*.ts 的實際端點
      "/ai/chat", "/ai/ask", "/ai/customer-draft", "/ai/document-draft", "/ai/anomalies",
      "/ai/monthly-report", "/ai/document-ocr", "/ai/classify-complaint",
      "/ai/product-description", "/ai/product-description/items",
      "/ai/bank-match", "/ai/quotation-import",
    ];
    const badPrefixes: string[] = [];
    for (const prefixes of Object.values(MODULE_API_MAP)) {
      for (const prefix of prefixes) {
        const hits = ACTUAL_ROUTES.some((r) => r === prefix || r.startsWith(prefix + "/"));
        if (!hits) badPrefixes.push(prefix);
      }
    }
    expect([...new Set(badPrefixes)]).toEqual([]);
  });
});

describe("isApiPathBlocked", () => {
  it("獨立前綴：停用選單 path → 對應 API 被擋（含子路徑與模組本身）", () => {
    const disabled = new Set(["/hr/leaves", "/admin/api-keys", "/admin/backup"]);
    expect(isApiPathBlocked("/leaves", disabled)).toBe(true);
    expect(isApiPathBlocked("/leaves/123", disabled)).toBe(true);
    expect(isApiPathBlocked("/api-keys", disabled)).toBe(true);
    expect(isApiPathBlocked("/backup", disabled)).toBe(true);
  });

  it("未停用的模組不受影響", () => {
    const disabled = new Set(["/hr/leaves"]);
    expect(isApiPathBlocked("/employees", disabled)).toBe(false);
    expect(isApiPathBlocked("/sales-orders", disabled)).toBe(false);
  });

  it("共用前綴：只停用其中一頁不擋（避免誤傷仍開放的頁面）", () => {
    // /invoices 由 銷售/採購/會計 三頁共用
    const disabled = new Set(["/sales/invoices"]);
    expect(isApiPathBlocked("/invoices", disabled)).toBe(false);
  });

  it("報表頁使用前端實際呼叫的 API path 驗證停用後被擋", () => {
    // 庫存狀況頁實際呼叫 /reports/inventory 與 /reports/inventory/warehouse-summary
    const inv = new Set(["/reports/inventory-status"]);
    expect(isApiPathBlocked("/reports/inventory", inv)).toBe(true);
    expect(isApiPathBlocked("/reports/inventory/warehouse-summary", inv)).toBe(true);
    expect(isApiPathBlocked("/reports/inventory-status", inv)).toBe(true);
    // BU 報表頁實際呼叫 /reports/bu
    expect(isApiPathBlocked("/reports/bu", new Set(["/reports/bu"]))).toBe(true);
    // 只停用單一報表不影響其他報表
    expect(isApiPathBlocked("/reports/cash-flow", inv)).toBe(false);
    expect(isApiPathBlocked("/reports/income-statement", new Set(["/accounting/balance-sheet"]))).toBe(false);
    expect(isApiPathBlocked("/reports/income-statement/cross", new Set(["/accounting/income-statement"]))).toBe(true);
  });

  it("共用前綴：全部對應頁面都停用才擋", () => {
    const disabled = new Set(["/sales/invoices", "/purchasing/invoices", "/accounting/invoices"]);
    expect(isApiPathBlocked("/invoices", disabled)).toBe(true);
    // /sales-orders 由 orders + quick-entry 共用
    expect(isApiPathBlocked("/sales-orders", new Set(["/sales/orders"]))).toBe(false);
    expect(isApiPathBlocked("/sales-orders", new Set(["/sales/orders", "/sales/quick-entry"]))).toBe(true);
  });

  it("基礎功能 API 永遠不擋（登入/通知/附件/帳務/選單權限）", () => {
    const disabled = new Set(SIDEBAR_PATHS); // 極端情境：全部停用
    for (const p of ["/admin/login", "/admin/me", "/notifications", "/attachments/1", "/billing", "/menu-permissions", "/config", "/health"]) {
      expect(isApiPathBlocked(p, disabled)).toBe(false);
    }
  });

  it("頁面專屬操作：單頁停用即擋專屬端點，共用前綴其餘端點不受影響", () => {
    // 折舊排程停用、資產登記冊仍開放 → 折舊操作被擋，一般資產 CRUD 不擋
    const dep = new Set(["/assets/depreciation"]);
    expect(isApiPathBlocked("/assets/123/depreciate", dep)).toBe(true);
    expect(isApiPathBlocked("/assets/batch-depreciate", dep)).toBe(true);
    expect(isApiPathBlocked("/assets", dep)).toBe(false);
    expect(isApiPathBlocked("/assets/123", dep)).toBe(false);
    // 快速下單停用 → /create-sales-order 被擋，一般訂單 API 不擋
    const qe = new Set(["/sales/quick-entry"]);
    expect(isApiPathBlocked("/create-sales-order", qe)).toBe(true);
    expect(isApiPathBlocked("/sales-orders", qe)).toBe(false);
    // 薪資計算停用 → 試算/批次產生被擋，薪資單列表不擋
    const sc = new Set(["/hr/salary-calc"]);
    expect(isApiPathBlocked("/salary-slips/calculate", sc)).toBe(true);
    expect(isApiPathBlocked("/salary-slips/batch-generate", sc)).toBe(true);
    expect(isApiPathBlocked("/salary-slips", sc)).toBe(false);
    // 打卡頁停用 → 上/下班打卡與狀態端點被擋，出勤管理讀取不擋
    const ci = new Set(["/hr/clock-in"]);
    expect(isApiPathBlocked("/attendance/today-state", ci, "GET")).toBe(true);
    expect(isApiPathBlocked("/attendance", ci, "POST")).toBe(true);
    expect(isApiPathBlocked("/attendance/12", ci, "PATCH")).toBe(true);
    expect(isApiPathBlocked("/attendance", ci, "GET")).toBe(false);
    expect(isApiPathBlocked("/attendance/monthly-summary", ci, "GET")).toBe(false);
  });

  it("AI 各頁停用即精準封鎖各自的 /ai 端點", () => {
    const asst = new Set(["/ai/assistant"]);
    expect(isApiPathBlocked("/ai/ask", asst)).toBe(true);
    expect(isApiPathBlocked("/ai/customer-draft", asst)).toBe(true);
    expect(isApiPathBlocked("/ai/document-draft", asst)).toBe(true);
    expect(isApiPathBlocked("/ai/monthly-report", asst)).toBe(false);
    expect(isApiPathBlocked("/ai/monthly-report", new Set(["/ai/monthly-report"]))).toBe(true);
    expect(isApiPathBlocked("/ai/classify-complaint", new Set(["/ai/complaint-classify"]))).toBe(true);
    expect(isApiPathBlocked("/ai/document-ocr", new Set(["/ai/document-ocr"]))).toBe(true);
    expect(isApiPathBlocked("/ai/product-description", new Set(["/ai/product-description"]))).toBe(true);
    expect(isApiPathBlocked("/ai/anomalies", new Set(["/ai/anomalies"]))).toBe(true);
    // bank-match / quotation-import 隨所屬頁面停用
    expect(isApiPathBlocked("/ai/bank-match/3", new Set(["/accounting/bank-reconciliation"]))).toBe(true);
    expect(isApiPathBlocked("/ai/quotation-import", new Set(["/sales/quotations"]))).toBe(true);
    expect(isApiPathBlocked("/ai/bank-match/3", asst)).toBe(false);
    // 單一對話入口有自己的開關；停用查詢助理不會連帶關掉對話入口（對話內部呼叫查詢時仍會被擋）
    expect(isApiPathBlocked("/ai/chat", new Set(["/ai/chat"]))).toBe(true);
    expect(isApiPathBlocked("/ai/chat", asst)).toBe(false);
    expect(isApiPathBlocked("/ai/ask", new Set(["/ai/chat"]))).toBe(false);
  });

  it("BI 各頁獨立封鎖，共用 AI 顧問端點需全部 BI 頁停用才擋", () => {
    expect(isApiPathBlocked("/bi/sales", new Set(["/bi/sales"]))).toBe(true);
    expect(isApiPathBlocked("/bi/executive", new Set(["/bi/sales"]))).toBe(false);
    expect(isApiPathBlocked("/bi/ai-consultant", new Set(["/bi/sales"]))).toBe(false);
    expect(isApiPathBlocked("/bi/ai-consultant", new Set(["/bi/executive", "/bi/sales", "/bi/inventory", "/bi/hr"]))).toBe(true);
    expect(isApiPathBlocked("/bi/observability", new Set(["/bi/observability"]))).toBe(true);
  });

  it("沒有任何停用時全部放行", () => {
    expect(isApiPathBlocked("/leaves", new Set())).toBe(false);
  });
});

describe("部門／專案損益頁停用", () => {
  it("只擋損益端點，不影響部門與專案管理", () => {
    const dept = new Set(["/hr/dept-financials"]);
    expect(isApiPathBlocked("/departments/3/financials", dept, "GET")).toBe(true);
    expect(isApiPathBlocked("/departments", dept, "GET")).toBe(false);
    expect(isApiPathBlocked("/departments/3", dept, "PATCH")).toBe(false);

    const proj = new Set(["/projects/financials"]);
    expect(isApiPathBlocked("/projects/7/financials", proj, "GET")).toBe(true);
    expect(isApiPathBlocked("/projects/7", proj, "GET")).toBe(false);
  });
});
