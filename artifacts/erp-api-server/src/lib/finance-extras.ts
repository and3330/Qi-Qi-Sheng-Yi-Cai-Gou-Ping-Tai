/**
 * 催款、定期發票、預算的純計算。
 */

const round2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;

export function daysBetween(from: string, to: string): number {
  return Math.round((new Date(`${to}T00:00:00Z`).getTime() - new Date(`${from}T00:00:00Z`).getTime()) / 86_400_000);
}

/** 建議的催款階段：逾期 30 天內提醒、31–60 天催告、超過 60 天最後通知 */
export function dunningLevel(daysOverdue: number): { level: number; label: string } {
  if (daysOverdue > 60) return { level: 3, label: "最後通知" };
  if (daysOverdue > 30) return { level: 2, label: "催告" };
  return { level: 1, label: "提醒" };
}

export const FREQUENCIES: Record<string, { label: string; months: number }> = {
  monthly: { label: "每月", months: 1 },
  quarterly: { label: "每季", months: 3 },
  yearly: { label: "每年", months: 12 },
};

/**
 * 下一次開立日。月底的日期遇到小月會退到該月最後一天（1/31 → 2/28），
 * anchorDay 是範本原本設定的日，之後遇到大月會回到原本的日（2/28 → 3/31）。
 */
export function nextRunAfter(date: string, frequency: string, anchorDay?: number): string {
  const months = FREQUENCIES[frequency]?.months ?? 1;
  const [y, m, d] = date.split("-").map(Number);
  const day = anchorDay && anchorDay >= 1 && anchorDay <= 31 ? anchorDay : d;
  const total = (y * 12 + (m - 1)) + months;
  const year = Math.floor(total / 12);
  const month = (total % 12) + 1;
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${year}-${String(month).padStart(2, "0")}-${String(Math.min(day, lastDay)).padStart(2, "0")}`;
}

export function recurringProblem(input: { name?: unknown; invoiceType?: unknown; customerId?: unknown; supplierId?: unknown; projectId?: unknown; frequency?: unknown; nextRunDate?: unknown; endDate?: unknown; items?: unknown }): string | null {
  if (typeof input.name !== "string" || !input.name.trim()) return "請填寫名稱";
  if (input.invoiceType !== "Sales" && input.invoiceType !== "Purchase") return "請選擇銷項或進項";
  const partyId = Number(input.invoiceType === "Sales" ? input.customerId : input.supplierId);
  if (!Number.isInteger(partyId) || partyId <= 0) return input.invoiceType === "Sales" ? "請選擇客戶" : "請選擇供應商";
  if (!Number.isInteger(Number(input.projectId)) || Number(input.projectId) <= 0) return "請選擇專案：每一筆收入支出都必須歸屬到專案";
  if (!FREQUENCIES[String(input.frequency)]) return "請選擇週期";
  if (typeof input.nextRunDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(input.nextRunDate)) return "請填寫下次開立日";
  if (input.endDate && (typeof input.endDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(input.endDate))) return "結束日期格式不正確";
  if (typeof input.endDate === "string" && input.endDate && input.endDate < input.nextRunDate) return "結束日期不能早於下次開立日";
  if (!Array.isArray(input.items) || input.items.length === 0) return "至少要有一個品項";
  for (const item of input.items) {
    if (!Number.isInteger(Number(item?.itemId)) || Number(item.itemId) <= 0) return "品項無效";
    if (!(Number(item?.quantity) > 0)) return "數量必須大於 0";
    if (!(Number(item?.rate) >= 0)) return "單價不能是負數";
  }
  return null;
}

/** 預算與實際的比較：費用類超支是壞事，收入類未達標是壞事 */
export function budgetVariance(accountType: string, budget: number, actual: number) {
  const variance = round2(actual - budget);
  const usedPercent = budget > 0 ? Math.round((actual / budget) * 1000) / 10 : null;
  const isIncome = accountType === "Income";
  const over = isIncome ? false : budget > 0 && actual > budget + 0.005;
  const short = isIncome ? budget > 0 && actual < budget - 0.005 : false;
  return { variance, usedPercent, over, short };
}

/** 把年度預算平均分到 12 個月；除不盡的尾差放在 12 月，加總一定等於年度預算 */
export function spreadAnnual(annual: number): number[] {
  const total = round2(annual);
  const each = Math.floor((total / 12) * 100) / 100;
  const months = Array.from({ length: 12 }, () => each);
  months[11] = round2(total - each * 11);
  return months;
}
