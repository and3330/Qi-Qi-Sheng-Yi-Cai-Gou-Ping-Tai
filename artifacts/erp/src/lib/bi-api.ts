/**
 * BI 決策中心手寫 API 客戶端。型別與 artifacts/api-server/src/lib/bi/types.ts 同形。
 * 所有數字皆由伺服器以目前租戶資料即時計算；value 為 null 代表資料不足（附 reason），不可當作 0。
 */
import { useQuery } from "@tanstack/react-query";

export interface Metric { value: number | null; reason?: string }
export interface BiPeriod { startDate: string; endDate: string; days: number; computedAt: string }
export interface BiNote { text: string }

export interface ExecutiveResponse {
  period: BiPeriod;
  summary: Record<"revenue" | "expense" | "netProfit" | "profitMargin" | "cashIn" | "cashOut" | "netCash", Metric>;
  monthly: Array<{ month: string; revenue: number; expense: number; netProfit: number; cashIn: number; cashOut: number }>;
  waterfall: Array<{ label: string; amount: number; kind: "start" | "minus" | "total" }>;
  buContributions: Array<{ departmentId: number | null; name: string; revenue: number; expense: number; netProfit: number; adjustedNet: number; margin: number | null }>;
  workingCapital: Record<"dso" | "dio" | "dpo" | "ccc", Metric>;
  notes: BiNote[];
}

export interface RfmCustomer {
  customerId: number; name: string; lastInvoiceDate: string; recencyDays: number; frequency: number; monetary: number;
  segment: "核心客戶" | "成長客戶" | "沉睡風險" | "一般客戶";
}

export interface SalesResponse {
  period: BiPeriod;
  summary: Record<"invoicedRevenue" | "invoiceCount" | "returnsAmount" | "returnRate" | "collected" | "quotationConversion" | "top5Concentration", Metric>;
  monthly: Array<{ month: string; invoiced: number; returns: number; collected: number }>;
  funnel: Array<{ step: string; amount: number; count: number }>;
  topItems: Array<{ name: string; qty: number; revenue: number; estCost: number | null; margin: number | null }>;
  rfm: RfmCustomer[];
  notes: BiNote[];
}

export type StockStatus = "缺貨風險" | "低於安全量" | "滯銷" | "正常" | "無出庫紀錄";
export interface InventoryResponse {
  period: BiPeriod;
  summary: Record<"inventoryValue" | "itemCount" | "belowReorder" | "negativeStock" | "zeroCostWithStock" | "supplierOnTimeRate", Metric>;
  aging: Array<{ bucket: string; value: number; items: number }>;
  health: Array<{ itemId: number; code: string; name: string; stock: number; value: number; outboundQty: number; daysOfSupply: number | null; reorderLevel: number | null; status: StockStatus }>;
  suppliers: Array<{ supplierId: number; name: string; spend: number; receipts: number; onTimeRate: number | null; returns: number; returnAmount: number }>;
  notes: BiNote[];
}

export interface HrResponse {
  period: BiPeriod;
  summary: Record<"activeHeadcount" | "payrollGross" | "employerCost" | "revenuePerHead" | "overtimeHours" | "lateCount", Metric>;
  monthly: Array<{ month: string; gross: number; employerCost: number; paidHeadcount: number; revenue: number | null; revenuePerHead: number | null }>;
  departments: Array<{ departmentId: number | null; name: string; headcount: number; gross: number; employerCost: number; overtimeHours: number }>;
  attendanceDaily: Array<{ date: string; records: number; late: number; overtimeHours: number }>;
  salespeople: Array<{ employeeId: number; name: string; orderRevenue: number; employerCost: number | null }>;
  notes: BiNote[];
}

export interface HealthCheck {
  id: string; title: string; domain: string; severity: "error" | "warning" | "info";
  status: "pass" | "fail" | "not_applicable"; observed: number; scanned: number; detail: string; samples: string[];
}
export interface HealthResponse {
  computedAt: string;
  durationMs: number;
  checks: HealthCheck[];
  tableCounts: Array<{ table: string; label: string; rows: number; latest: string | null }>;
  accountBaseline: { profile: string; expected: number; present: number; missingCodes: string[] };
}

export type BiPage = "executive" | "sales" | "inventory" | "hr";
export interface AiConsultResponse { reply: string; model: string; contextPage: BiPage; period: { startDate: string; endDate: string } }

export class BiApiError extends Error {
  constructor(message: string, public status: number, public code?: string) { super(message); }
}

const BASE = import.meta.env.BASE_URL.endsWith("/") ? import.meta.env.BASE_URL : import.meta.env.BASE_URL + "/";

async function biFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/erp-api${path}`, {
    credentials: "include",
    ...init,
    headers: init?.body ? { "Content-Type": "application/json" } : undefined,
  });
  if (res.status === 401 && !window.location.pathname.endsWith("/login")) {
    window.location.href = `${BASE}login`;
  }
  const body: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const b = (body ?? {}) as { error?: string; message?: string; code?: string };
    throw new BiApiError(b.error || b.message || `HTTP ${res.status}`, res.status, b.code);
  }
  return body as T;
}

export interface BiRange { startDate: string; endDate: string }

function rangeQs(r: BiRange) {
  return new URLSearchParams({ startDate: r.startDate, endDate: r.endDate }).toString();
}

type PageData = { executive: ExecutiveResponse; sales: SalesResponse; inventory: InventoryResponse; hr: HrResponse };

export function useBiPage<P extends BiPage>(page: P, range: BiRange, enabled = true) {
  return useQuery<PageData[P], BiApiError>({
    queryKey: ["bi", page, range.startDate, range.endDate],
    queryFn: () => biFetch<PageData[P]>(`/bi/${page}?${rangeQs(range)}`),
    enabled,
    staleTime: 60_000,
    retry: (count, err) => count < 1 && err.status >= 500,
  });
}

export function useBiHealth() {
  return useQuery<HealthResponse, BiApiError>({
    queryKey: ["bi", "observability"],
    queryFn: () => biFetch<HealthResponse>("/bi/observability"),
    staleTime: 30_000,
    retry: false,
  });
}

export function askBiConsultant(page: BiPage, range: BiRange, question: string) {
  return biFetch<AiConsultResponse>("/bi/ai-consultant", {
    method: "POST",
    body: JSON.stringify({ page, question, startDate: range.startDate, endDate: range.endDate }),
  });
}
