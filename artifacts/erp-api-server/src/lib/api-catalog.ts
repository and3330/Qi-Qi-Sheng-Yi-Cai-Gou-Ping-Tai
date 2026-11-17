/**
 * API 目錄：給「API 文件」頁與 AI（MCP 的 erp_list_endpoints）共用的端點說明。
 *
 * 端點清單是從實際掛上去的路由讀出來的（不是手寫），所以新增或移除端點時文件會自動跟著變；
 * 這個檔只負責把路徑翻成看得懂的中文：屬於哪個模組、這個端點在做什麼。
 * 純計算、不碰資料庫。
 */

export interface CatalogEndpoint { method: string; path: string }
export interface DescribedEndpoint extends CatalogEndpoint { resource: string; module: string; label: string; description: string }

/** 路徑第一段 → [模組, 這個資源的中文名稱] */
const RESOURCES: Record<string, [string, string]> = {
  // 銷售
  "customers": ["銷售", "客戶"], "quotations": ["銷售", "報價單"], "quotation-templates": ["銷售", "報價模板"],
  "sales-orders": ["銷售", "銷貨單"], "order-templates": ["銷售", "訂單模板"], "delivery-notes": ["銷售", "送貨單"],
  "sales-returns": ["銷售", "銷售退貨"], "price-lists": ["銷售", "價目表"], "leads": ["銷售", "潛在客戶"], "opportunities": ["銷售", "商機"],
  "create-sales-order": ["銷售", "外部建立銷貨單"], "registrants": ["銷售", "報名名單"],
  // 採購
  "suppliers": ["採購", "供應商"], "purchase-orders": ["採購", "採購單"], "purchase-receipts": ["採購", "進貨單"],
  "purchase-returns": ["採購", "採購退貨"], "rfqs": ["採購", "詢價單"], "material-requests": ["採購", "請購單"], "subcontract-orders": ["採購", "委外加工單"],
  // 庫存
  "items": ["庫存", "品項"], "item-categories": ["庫存", "品項分類"], "item-types": ["庫存", "品項類型"], "brands": ["庫存", "品牌"],
  "warehouses": ["庫存", "倉庫"], "stock-entries": ["庫存", "庫存異動"], "stock-counts": ["庫存", "盤點單"], "inventory-lookup": ["庫存", "查庫存"],
  // 會計與收付款
  "accounts": ["會計", "會計科目"], "journal-entries": ["會計", "日記帳分錄"], "invoices": ["會計", "發票"], "vouchers": ["會計", "收款單／付款單／傳票"],
  "payment-requests": ["會計", "付款申請"], "my-requests": ["會計", "我的申請（員工請款）"], "receivables": ["會計", "應收帳款"], "advances": ["會計", "預收／預付"],
  "payment-terms": ["會計", "付款條件"], "recurring-invoices": ["會計", "定期發票"], "dunning": ["會計", "催收"], "budgets": ["會計", "預算"],
  "bank-statements": ["會計", "銀行對帳單"], "bank-reconciliation": ["會計", "銀行對帳"], "currencies": ["會計", "幣別"], "exchange-rates": ["會計", "匯率"],
  "vat-report": ["會計", "營業稅申報"], "reimbursement": ["會計", "報銷"], "service-fees": ["會計", "講師與服務費"], "accounting-settings": ["會計", "會計設定"],
  "legacy-documents": ["會計", "歷史單據（Ecount 搬來的）"],
  // 報表
  "reports": ["報表", "報表"], "bi": ["報表", "經營分析"], "dashboard": ["報表", "儀表板"], "anomaly-check": ["報表", "異常檢查"],
  // 專案
  "projects": ["專案", "專案"], "tasks": ["專案", "任務"], "timesheets": ["專案", "工時表"], "calendar-events": ["專案", "行事曆"], "cm-life": ["專案", "CM 生活+ 串接"],
  // 人事
  "employees": ["人事", "員工"], "teachers": ["人事", "老師"], "departments": ["人事", "部門"], "designations": ["人事", "職稱"], "grades": ["人事", "職級"],
  "hr-contracts": ["人事", "人事合約"], "attendance": ["人事", "出勤"], "leaves": ["人事", "請假"], "shift-types": ["人事", "班制"], "clock-in-locations": ["人事", "打卡地點"],
  "salary-slips": ["人事", "薪資單"], "salary-components": ["人事", "薪資項目"], "insurance-brackets": ["人事", "投保級距"], "payroll-settings": ["人事", "薪資設定"],
  // 製造與品管
  "boms": ["製造", "物料清單（BOM）"], "workstations": ["製造", "工作站"], "work-orders": ["製造", "工單"], "job-cards": ["製造", "工作卡"], "production-planning": ["製造", "生產規劃"],
  "quality-inspections": ["品管", "品質檢驗"], "quality-inspection-templates": ["品管", "檢驗模板"], "non-conformance-reports": ["品管", "不合格報告"], "capa-actions": ["品管", "矯正預防措施"],
  // 資產
  "assets": ["資產", "固定資產"], "asset-categories": ["資產", "資產類別"], "asset-maintenance": ["資產", "資產維護"],
  // 客服與合約
  "support-tickets": ["客服", "客服工單"], "ticket-categories": ["客服", "工單分類"], "sla-definitions": ["客服", "服務水準"], "kb-articles": ["客服", "知識庫文章"], "kb-categories": ["客服", "知識庫分類"],
  "contracts": ["合約", "合約（客戶／供應商）"],
  // 系統
  "approval-workflows": ["系統", "審批流程"], "approval-requests": ["系統", "審批請求"], "notifications": ["系統", "通知"], "attachments": ["系統", "附件"],
  "print-templates": ["系統", "列印模板"], "audit-logs": ["系統", "操作紀錄"], "batch": ["系統", "批次更新／刪除"], "import-export": ["系統", "匯入匯出"],
  "roles": ["系統", "角色權限"], "menu-permissions": ["系統", "選單權限"], "email": ["系統", "寄信"], "email-settings": ["系統", "寄信設定"], "scheduled-jobs": ["系統", "排程"],
  "data-sync": ["系統", "資料同步"], "integrations": ["系統", "外部串接"], "config": ["系統", "系統設定"], "setup": ["系統", "初始設定"], "search": ["系統", "全站搜尋"],
  "api-catalog": ["系統", "API 目錄"], "ai": ["AI", "AI 助理"], "ai-drafts": ["AI", "AI 草稿"], "noncodingai": ["AI", "AI 大學串接"],
  "admin": ["帳號與平台", "帳號管理"], "api-keys": ["帳號與平台", "API 金鑰"], "backup": ["帳號與平台", "備份"], "billing": ["帳號與平台", "訂閱"], "platform": ["帳號與平台", "平台管理"],
  "public": ["帳號與平台", "公開端點"], "healthz": ["帳號與平台", "健康檢查"], "info": ["帳號與平台", "外部驗證"], "endpoints": ["帳號與平台", "外部驗證"],
};

export const MODULE_ORDER = ["銷售", "採購", "庫存", "會計", "報表", "專案", "人事", "製造", "品管", "資產", "客服", "合約", "系統", "AI", "帳號與平台", "其他"];

/** 路徑最後一段的動作 → 說明（{x} 會換成資源名稱） */
const ACTIONS: Record<string, string> = {
  "legacy-import": "匯入歷史{x}（Ecount 搬家用：不產生分錄、不動庫存；只限老闆與管理員）",
  "legacy": "列出歷史{x}（Ecount 搬來的，唯讀）",
  "batch-update": "批次更新多筆{x}", "batch-delete": "批次刪除多筆{x}", "batch": "批次處理{x}",
  "options": "{x}的表單選項（下拉選單要用的資料）", "summary": "{x}的彙總數字", "stats": "{x}的統計",
  "cancel": "取消／撤回{x}", "void": "作廢{x}", "submit": "送出{x}", "approve": "核准{x}", "reject": "駁回{x}",
  "pay": "付款", "convert": "把{x}轉成下一張單", "duplicate": "複製{x}", "pdf": "下載{x}的 PDF", "print": "列印{x}",
  "send": "寄出{x}", "export": "匯出{x}", "import": "匯入{x}", "upcoming": "即將到期的{x}", "renewal-alerts": "快到期、要續約的{x}",
  "financials": "{x}的損益（收入、支出、相關單據）", "transfer": "調撥{x}", "depreciate": "計提折舊", "batch-depreciate": "批次計提折舊",
  "adjust-value": "調整帳面價值", "lookup": "查詢對應的{x}", "status": "更新{x}的狀態", "configuration": "{x}的設定",
  "related-legacy-orders": "可能相關的歷史訂貨單", "legacy-invoices": "這張單對應的歷史發票", "open-orders": "還沒收完款的單",
  "import-from-teachers": "從老師名單匯入成員工", "calculate": "試算（不存檔）",
};

/** 需要特別講清楚的端點（"方法 路徑" → 說明） */
const OVERRIDES: Record<string, string> = {
  "GET /my-requests": "列出登入者自己送出的請款／付款申請與審批進度（員工自助帳號可用）",
  "POST /my-requests": "員工送出請款／付款申請：直接進「待審」，財務與管理員在審批請求看得到。必填 projectId、lines[{summary, amount}]；payTo=self（代墊）或 other（付給老師／廠商）",
  "POST /my-requests/:id/cancel": "撤回自己還在審批中的申請",
  "GET /hr-contracts": "列出人事合約（員工、老師、臨時人員）；可用 employeeId、teacherId、contractType、status 篩選。只限老闆、管理員、人事",
  "POST /hr-contracts": "新增人事合約。contractType：onboarding 新進人員合約／labor_service 勞務合約／labor_fee 勞務報酬單／labor_form 勞務表單／temporary 臨時工作合約；partyType：Employee（帶 employeeId）／Teacher（帶 teacherId）／Person（帶 personName）",
  "DELETE /hr-contracts/:id": "刪除人事合約（只有草稿可刪；生效過的請改成已取消或已到期）",
  "GET /tasks": "列出任務；每筆含 taskGroup（組別）、projectName、assigneeName",
  "PATCH /tasks/:id": "更新任務；taskGroup 是組別，projectId／assignedTo／dueDate 傳 null 可以清空",
  "POST /batch/:entity/update": "批次更新：{ ids, updates: { 欄位: 值 } }，每種資料可改的欄位不同；會連動帳或庫存的狀態不能批次改",
  "POST /batch/:entity/delete": "批次刪除：{ ids }；已入帳的流水紀錄不能批次刪",
  "GET /inventory-lookup": "查庫存：search、warehouseId、lowStockOnly、page、pageSize；回傳每個品項的現有數量與各倉庫數量",
  "GET /warehouses": "列出倉庫（預設只列啟用中的；includeInactive=1 連已停用的一起列）",
  "GET /invoices/legacy": "列出歷史銷項發票（Ecount 搬來的），含對應的銷貨單號",
  "GET /sales-orders/:id/legacy-invoices": "這張銷貨單對應的歷史發票",
  "GET /sales-orders/:id/related-legacy-orders": "跟這張銷貨單可能相關的歷史訂貨單（同客戶、相近日期）",
  "GET /receivables/customers/:id/open-orders": "這個客戶還沒收完款的銷貨單（含歷史單的未收金額）",
  "GET /approval-workflows/options": "審批流程的選項：可套用的單據類型、可以當審批人的角色",
  "GET /projects/:id/financials": "專案損益：總收入、總支出、淨損益、子專案各自的數字、相關單據與分錄",
  "GET /boms": "列出物料清單；每筆含 componentCount（原料幾項）與 materialCost（用目前成本估的一批材料成本）",
  "PATCH /boms/:id": "更新物料清單：status、quantity、remarks、items[{itemId, quantity, rate}]（給 items 會整批換掉原料）。沒有原料不能啟用",
  "GET /api-catalog": "這份 API 目錄（所有端點與中文說明）",
};

const labelOf = (resource: string): [string, string] => RESOURCES[resource] ?? ["其他", resource];

export function describeEndpoint(method: string, path: string): DescribedEndpoint {
  const verb = method.toUpperCase();
  const segments = path.split("/").filter(Boolean);
  const resource = segments[0] || "";
  const [module, label] = labelOf(resource);
  const base = { method: verb, path, resource, module, label };
  const override = OVERRIDES[`${verb} ${path}`];
  if (override) return { ...base, description: override };

  const rest = segments.slice(1);
  const isParam = (s: string | undefined) => !!s && s.startsWith(":");
  let description: string;
  if (rest.length === 0) {
    description = verb === "GET" ? `列出${label}` : verb === "POST" ? `新增${label}` : verb === "DELETE" ? `刪除${label}` : `更新${label}`;
  } else if (rest.length === 1 && isParam(rest[0])) {
    description = verb === "GET" ? `取得單筆${label}` : verb === "DELETE" ? `刪除${label}` : verb === "POST" ? `對單筆${label}執行動作` : `更新${label}`;
  } else {
    const action = [...rest].reverse().find(s => !isParam(s)) || "";
    const template = ACTIONS[action];
    const target = rest.some(isParam) ? `單筆${label}` : label;
    description = template ? template.replace("{x}", template.startsWith("{x}") || template.includes("多筆") || template.includes("歷史") ? label : target)
      : resource === "reports" || resource === "bi" ? `${label}：${rest.join("/")}`
        : `${label}：${rest.filter(s => !isParam(s)).join("/")}${verb === "GET" ? "（查詢）" : ""}`;
  }
  return { ...base, description };
}

export interface CatalogModule { module: string; resources: { resource: string; label: string; endpoints: { method: string; path: string; description: string }[] }[]; endpointCount: number }

/** 把端點清單整理成「模組 → 資源 → 端點」 */
export function buildCatalog(endpoints: CatalogEndpoint[]): { total: number; modules: CatalogModule[] } {
  const byModule = new Map<string, Map<string, { label: string; endpoints: { method: string; path: string; description: string }[] }>>();
  for (const e of endpoints) {
    const d = describeEndpoint(e.method, e.path);
    if (!byModule.has(d.module)) byModule.set(d.module, new Map());
    const resources = byModule.get(d.module)!;
    if (!resources.has(d.resource)) resources.set(d.resource, { label: d.label, endpoints: [] });
    resources.get(d.resource)!.endpoints.push({ method: d.method, path: d.path, description: d.description });
  }
  const order = (m: string) => { const i = MODULE_ORDER.indexOf(m); return i < 0 ? MODULE_ORDER.length : i; };
  const modules = [...byModule.entries()].sort((a, b) => order(a[0]) - order(b[0])).map(([module, resources]) => {
    const list = [...resources.entries()].map(([resource, r]) => ({ resource, label: r.label, endpoints: r.endpoints })).sort((a, b) => a.label.localeCompare(b.label, "zh-Hant"));
    return { module, resources: list, endpointCount: list.reduce((n, r) => n + r.endpoints.length, 0) };
  });
  return { total: endpoints.length, modules };
}
