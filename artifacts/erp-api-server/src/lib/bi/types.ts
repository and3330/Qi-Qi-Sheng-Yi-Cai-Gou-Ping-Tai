/**
 * BI 決策中心 API 契約（手寫型別；前端 artifacts/erp/src/lib/bi-api.ts 保持同形）。
 * 原則：所有數字皆由目前租戶資料即時計算；缺少計算所需資料時 value 為 null 並附原因，絕不以 0 或假值代替。
 */
export interface Metric {
  value: number | null;
  /** value 為 null 時的原因（繁體中文，直接顯示給使用者） */
  reason?: string;
}

export interface BiPeriod {
  startDate: string;
  endDate: string;
  days: number;
  computedAt: string;
}

export interface BiNote {
  /** 計算口徑或限制說明 */
  text: string;
}

// ---------- 營運總覽 ----------
export interface ExecutiveMonth {
  month: string;
  revenue: number;
  expense: number;
  netProfit: number;
  cashIn: number;
  cashOut: number;
}

export interface BuContribution {
  departmentId: number | null;
  name: string;
  revenue: number;
  expense: number;
  netProfit: number;
  adjustedNet: number;
  margin: number | null;
}

export interface ExecutiveResponse {
  period: BiPeriod;
  summary: {
    revenue: Metric;
    expense: Metric;
    netProfit: Metric;
    profitMargin: Metric;
    cashIn: Metric;
    cashOut: Metric;
    netCash: Metric;
  };
  monthly: ExecutiveMonth[];
  waterfall: Array<{ label: string; amount: number; kind: "start" | "minus" | "total" }>;
  buContributions: BuContribution[];
  workingCapital: { dso: Metric; dio: Metric; dpo: Metric; ccc: Metric };
  notes: BiNote[];
}

// ---------- 銷售 ----------
export interface RfmCustomer {
  customerId: number;
  name: string;
  lastInvoiceDate: string;
  recencyDays: number;
  frequency: number;
  monetary: number;
  segment: "核心客戶" | "成長客戶" | "沉睡風險" | "一般客戶";
}

export interface SalesResponse {
  period: BiPeriod;
  summary: {
    invoicedRevenue: Metric;
    invoiceCount: Metric;
    returnsAmount: Metric;
    returnRate: Metric;
    collected: Metric;
    quotationConversion: Metric;
    top5Concentration: Metric;
  };
  monthly: Array<{ month: string; invoiced: number; returns: number; collected: number }>;
  funnel: Array<{ step: string; amount: number; count: number }>;
  topItems: Array<{ name: string; qty: number; revenue: number; estCost: number | null; margin: number | null }>;
  rfm: RfmCustomer[];
  notes: BiNote[];
}

// ---------- 庫存 ----------
export interface InventoryResponse {
  period: BiPeriod;
  summary: {
    inventoryValue: Metric;
    itemCount: Metric;
    belowReorder: Metric;
    negativeStock: Metric;
    zeroCostWithStock: Metric;
    supplierOnTimeRate: Metric;
  };
  aging: Array<{ bucket: string; value: number; items: number }>;
  health: Array<{ itemId: number; code: string; name: string; stock: number; value: number; outboundQty: number; daysOfSupply: number | null; reorderLevel: number | null; status: "缺貨風險" | "低於安全量" | "滯銷" | "正常" | "無出庫紀錄" }>;
  suppliers: Array<{ supplierId: number; name: string; spend: number; receipts: number; onTimeRate: number | null; returns: number; returnAmount: number }>;
  notes: BiNote[];
}

// ---------- 人力 ----------
export interface HrResponse {
  period: BiPeriod;
  summary: {
    activeHeadcount: Metric;
    payrollGross: Metric;
    employerCost: Metric;
    revenuePerHead: Metric;
    overtimeHours: Metric;
    lateCount: Metric;
  };
  monthly: Array<{ month: string; gross: number; employerCost: number; paidHeadcount: number; revenue: number | null; revenuePerHead: number | null }>;
  departments: Array<{ departmentId: number | null; name: string; headcount: number; gross: number; employerCost: number; overtimeHours: number }>;
  attendanceDaily: Array<{ date: string; records: number; late: number; overtimeHours: number }>;
  salespeople: Array<{ employeeId: number; name: string; orderRevenue: number; employerCost: number | null }>;
  notes: BiNote[];
}

// ---------- 數據健康 ----------
export interface HealthCheck {
  id: string;
  title: string;
  domain: "會計" | "應收應付" | "庫存" | "銷售" | "人資";
  severity: "error" | "warning" | "info";
  status: "pass" | "fail" | "not_applicable";
  observed: number;
  scanned: number;
  detail: string;
  samples: string[];
}

export interface HealthResponse {
  computedAt: string;
  durationMs: number;
  checks: HealthCheck[];
  tableCounts: Array<{ table: string; label: string; rows: number; latest: string | null }>;
  accountBaseline: { profile: string; expected: number; present: number; missingCodes: string[] };
}

export type BiPage = "executive" | "sales" | "inventory" | "hr";

export interface AiConsultResponse {
  reply: string;
  model: string;
  contextPage: BiPage;
  period: { startDate: string; endDate: string };
}
