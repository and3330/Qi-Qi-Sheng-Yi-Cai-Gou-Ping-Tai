/**
 * BI 純計算函式（不碰資料庫，可直接以非正式測試資料驗證）。
 * 會計口徑沿用損益表 / BU 報表：非草稿分錄、Income 科目 貸-借、Expense 科目 借-貸；
 * BU 歸屬：表頭部門優先，否則取專案所屬部門；內部轉撥不計入營收費用（只影響 adjustedNet）。
 */
import { safeJournalLines } from "../../routes/report-guards";
import { dayDiff, num, ratio } from "./range";
import type { BuContribution, RfmCustomer } from "./types";

export interface JournalEntryRow {
  entryDate: string;
  lines: unknown;
  departmentId: number | null;
  projectId: number | null;
  isInternalTransfer: boolean | null;
  totalDebit: unknown;
  transferFromDepartmentId: number | null;
  transferToDepartmentId: number | null;
}

export interface AccountRow { id: number; accountType: string; accountNumber: string }

export interface PnL {
  revenue: number;
  expense: number;
  cogs: number;
  monthly: Map<string, { revenue: number; expense: number }>;
}

/** 營業成本科目：台灣會計科目 5 開頭（營業成本）且型別為 Expense */
export function isCogsAccount(a: AccountRow): boolean {
  return a.accountType === "Expense" && a.accountNumber.startsWith("5");
}

export function computePnL(entries: JournalEntryRow[], accounts: AccountRow[]): PnL {
  const byId = new Map(accounts.map((a) => [a.id, a]));
  const monthly = new Map<string, { revenue: number; expense: number }>();
  let revenue = 0;
  let expense = 0;
  let cogs = 0;
  for (const e of entries) {
    const month = e.entryDate.slice(0, 7);
    const bucket = monthly.get(month) ?? { revenue: 0, expense: 0 };
    for (const line of safeJournalLines(e.lines)) {
      const acc = byId.get(line.accountId);
      if (!acc) continue;
      if (acc.accountType === "Income") {
        const v = line.credit - line.debit;
        revenue += v; bucket.revenue += v;
      } else if (acc.accountType === "Expense") {
        const v = line.debit - line.credit;
        expense += v; bucket.expense += v;
        if (isCogsAccount(acc)) cogs += v;
      }
    }
    monthly.set(month, bucket);
  }
  return { revenue, expense, cogs, monthly };
}

export function computeBu(
  entries: JournalEntryRow[],
  accounts: AccountRow[],
  departments: Array<{ id: number; name: string }>,
  projects: Array<{ id: number; departmentId: number | null }>,
): BuContribution[] {
  const types = new Map(accounts.map((a) => [a.id, a.accountType]));
  const projectDept = new Map(projects.map((p) => [p.id, p.departmentId]));
  const totals = new Map<number | null, { revenue: number; expense: number }>();
  const tin = new Map<number, number>();
  const tout = new Map<number, number>();
  for (const e of entries) {
    if (e.isInternalTransfer) {
      const amt = num(e.totalDebit);
      if (e.transferFromDepartmentId != null) tout.set(e.transferFromDepartmentId, (tout.get(e.transferFromDepartmentId) ?? 0) + amt);
      if (e.transferToDepartmentId != null) tin.set(e.transferToDepartmentId, (tin.get(e.transferToDepartmentId) ?? 0) + amt);
      continue;
    }
    const dept = e.departmentId ?? (e.projectId != null ? projectDept.get(e.projectId) ?? null : null);
    const t = totals.get(dept) ?? { revenue: 0, expense: 0 };
    for (const line of safeJournalLines(e.lines)) {
      const type = types.get(line.accountId);
      if (type === "Income") t.revenue += line.credit - line.debit;
      if (type === "Expense") t.expense += line.debit - line.credit;
    }
    totals.set(dept, t);
  }
  const rows: BuContribution[] = departments.map((d) => {
    const t = totals.get(d.id) ?? { revenue: 0, expense: 0 };
    const net = t.revenue - t.expense;
    return {
      departmentId: d.id, name: d.name, revenue: t.revenue, expense: t.expense, netProfit: net,
      adjustedNet: net + (tin.get(d.id) ?? 0) - (tout.get(d.id) ?? 0),
      margin: ratio(net, t.revenue),
    };
  });
  const un = totals.get(null);
  if (un && (un.revenue !== 0 || un.expense !== 0)) {
    const net = un.revenue - un.expense;
    rows.push({ departmentId: null, name: "未分配", revenue: un.revenue, expense: un.expense, netProfit: net, adjustedNet: net, margin: ratio(net, un.revenue) });
  }
  return rows.filter((r) => r.revenue !== 0 || r.expense !== 0 || r.adjustedNet !== 0);
}

/** 週轉天數 = 餘額 / 期間流量 × 天數；流量 <= 0 時無法計算 */
export function turnoverDays(balance: number | null, flow: number, days: number): number | null {
  if (balance == null) return null;
  const r = ratio(balance, flow);
  return r == null ? null : r * days;
}

export interface CustomerInvoiceAgg { customerId: number; name: string; lastInvoiceDate: string; frequency: number; monetary: number }

function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

/**
 * RFM：Recency = 結束日 − 最近發票日（實際天數）；分群門檻取本期客戶自身的中位數，
 * 不使用任何固定百分比或寫死門檻。
 */
export function computeRfm(rows: CustomerInvoiceAgg[], endDate: string): RfmCustomer[] {
  const withR = rows.map((r) => ({ ...r, recencyDays: Math.max(0, dayDiff(r.lastInvoiceDate, endDate)) }));
  const medR = quantile(withR.map((r) => r.recencyDays).sort((a, b) => a - b), 0.5);
  const medM = quantile(withR.map((r) => r.monetary).sort((a, b) => a - b), 0.5);
  const medF = quantile(withR.map((r) => r.frequency).sort((a, b) => a - b), 0.5);
  return withR
    .map((r) => {
      const recent = r.recencyDays <= medR;
      const high = r.monetary >= medM && r.frequency >= medF;
      const segment: RfmCustomer["segment"] = recent && high ? "核心客戶" : recent ? "成長客戶" : high ? "沉睡風險" : "一般客戶";
      return { customerId: r.customerId, name: r.name, lastInvoiceDate: r.lastInvoiceDate, recencyDays: r.recencyDays, frequency: r.frequency, monetary: r.monetary, segment };
    })
    .sort((a, b) => b.monetary - a.monetary);
}

export const AGING_BUCKETS = ["0-30 天", "31-90 天", "91-180 天", "180 天以上", "無入庫紀錄"] as const;

export function agingBucket(lastReceipt: string | null, endDate: string): (typeof AGING_BUCKETS)[number] {
  if (!lastReceipt) return "無入庫紀錄";
  const d = dayDiff(lastReceipt.slice(0, 10), endDate);
  if (d <= 30) return "0-30 天";
  if (d <= 90) return "31-90 天";
  if (d <= 180) return "91-180 天";
  return "180 天以上";
}

/** 存貨單位成本：沿用庫存報表規則 movingAvgCost，為 0 時改用 buyingPrice；兩者皆無則 null */
export function unitCost(movingAvgCost: unknown, buyingPrice: unknown): number | null {
  const m = num(movingAvgCost);
  if (m > 0) return m;
  const b = num(buyingPrice);
  return b > 0 ? b : null;
}

export function classifyStock(stock: number, reorderLevel: number | null, outboundQty: number, days: number) {
  const daily = outboundQty > 0 ? outboundQty / days : 0;
  const daysOfSupply = daily > 0 ? stock / daily : null;
  let status: "缺貨風險" | "低於安全量" | "滯銷" | "正常" | "無出庫紀錄";
  if (stock <= 0 && outboundQty > 0) status = "缺貨風險";
  else if (reorderLevel != null && reorderLevel > 0 && stock <= reorderLevel) status = "低於安全量";
  else if (outboundQty <= 0) status = "無出庫紀錄";
  else if (daysOfSupply != null && daysOfSupply > days * 2) status = "滯銷";
  else status = "正常";
  return { daysOfSupply, status };
}

export interface SlipRow { year: number; month: number; employeeId: number; departmentId: number | null; gross: number; laborEmployer: number; healthEmployer: number; pensionEmployer: number }

/** 雇主人事成本 = 應發薪資 + 勞保雇主 + 健保雇主 + 勞退雇主提繳（皆取自薪資單實際欄位） */
export function employerCost(s: Pick<SlipRow, "gross" | "laborEmployer" | "healthEmployer" | "pensionEmployer">): number {
  return s.gross + s.laborEmployer + s.healthEmployer + s.pensionEmployer;
}
