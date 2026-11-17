import { isValidIsoDate } from "../../routes/report-guards";
import type { BiPeriod, Metric } from "./types";

export const MAX_RANGE_DAYS = 1100;

export type RangeResult =
  | { ok: true; startDate: string; endDate: string; days: number }
  | { ok: false; error: string };

const DAY_MS = 86_400_000;

export function dayDiff(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);
}

/** 驗證 startDate/endDate（必填、合法日曆日、起日不晚於迄日、區間上限） */
export function parseRange(query: Record<string, unknown>): RangeResult {
  const { startDate, endDate } = query;
  if (typeof startDate !== "string" || typeof endDate !== "string") {
    return { ok: false, error: "請提供 startDate 與 endDate（YYYY-MM-DD）" };
  }
  if (!isValidIsoDate(startDate) || !isValidIsoDate(endDate)) {
    return { ok: false, error: "日期格式無效，需為實際存在的 YYYY-MM-DD 日期" };
  }
  if (startDate > endDate) return { ok: false, error: "起始日期不可晚於結束日期" };
  const days = dayDiff(startDate, endDate) + 1;
  if (days > MAX_RANGE_DAYS) return { ok: false, error: `查詢區間最長 ${MAX_RANGE_DAYS} 天` };
  return { ok: true, startDate, endDate, days };
}

export function period(r: { startDate: string; endDate: string; days: number }): BiPeriod {
  return { startDate: r.startDate, endDate: r.endDate, days: r.days, computedAt: new Date().toISOString() };
}

/** 區間內所有 YYYY-MM（含頭尾月） */
export function monthsBetween(startDate: string, endDate: string): string[] {
  const out: string[] = [];
  let y = Number(startDate.slice(0, 4));
  let m = Number(startDate.slice(5, 7));
  const endY = Number(endDate.slice(0, 4));
  const endM = Number(endDate.slice(5, 7));
  while (y < endY || (y === endY && m <= endM)) {
    out.push(`${y}-${String(m).padStart(2, "0")}`);
    m += 1;
    if (m > 12) { m = 1; y += 1; }
  }
  return out;
}

export function metric(value: number | null | undefined, reason: string): Metric {
  if (value == null || !Number.isFinite(value)) return { value: null, reason };
  return { value };
}

/** 比率：分母 <= 0 或無資料時回傳 null（顯示為無法計算，而非 0） */
export function ratio(numer: number, denom: number): number | null {
  if (!Number.isFinite(numer) || !Number.isFinite(denom) || denom <= 0) return null;
  return numer / denom;
}

export function num(v: unknown): number {
  const n = typeof v === "number" ? v : Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
}
