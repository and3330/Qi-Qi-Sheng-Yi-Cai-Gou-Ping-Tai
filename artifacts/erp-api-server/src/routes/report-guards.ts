export interface SafeJournalLine {
  accountId: number;
  debit: number;
  credit: number;
  description?: string;
}

export class ReportDataIntegrityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReportDataIntegrityError";
  }
}

export function finiteReportNumber(value: unknown, field = "數值"): number {
  const parsed = Number(value ?? 0);
  if (!Number.isFinite(parsed)) {
    throw new ReportDataIntegrityError(`歷史財務資料異常：${field} 不是有限數字`);
  }
  return parsed;
}

export function safeJournalLines(value: unknown): SafeJournalLine[] {
  if (value === null || value === undefined) return [];
  if (!Array.isArray(value)) {
    throw new ReportDataIntegrityError("歷史分錄資料異常：lines 必須為陣列");
  }
  return value.map((line, index) => {
    if (!line || typeof line !== "object") {
      throw new ReportDataIntegrityError(`歷史分錄資料異常：第 ${index + 1} 筆明細格式錯誤`);
    }
    const raw = line as Record<string, unknown>;
    const accountId = Number(raw.accountId);
    if (!Number.isInteger(accountId) || accountId <= 0) {
      throw new ReportDataIntegrityError(`歷史分錄資料異常：第 ${index + 1} 筆明細科目 ID 無效`);
    }
    return {
      accountId,
      debit: finiteReportNumber(raw.debit, `第 ${index + 1} 筆借方金額`),
      credit: finiteReportNumber(raw.credit, `第 ${index + 1} 筆貸方金額`),
      ...(typeof raw.description === "string" ? { description: raw.description } : {}),
    };
  });
}

export function isValidIsoDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day;
}

export function validateReportQuery(query: Record<string, unknown>): string | null {
  for (const key of ["startDate", "endDate"] as const) {
    const value = query[key];
    if (value !== undefined && value !== "" && !isValidIsoDate(value)) {
      return `${key} 日期格式不正確`;
    }
  }
  if (typeof query.startDate === "string" && typeof query.endDate === "string"
      && query.startDate && query.endDate && query.startDate > query.endDate) {
    return "起始日期不可晚於結束日期";
  }
  for (const key of ["accountId", "projectId", "departmentId"] as const) {
    const value = query[key];
    if (value === undefined || value === "") continue;
    const id = Number(value);
    if (!Number.isInteger(id) || id <= 0) return `${key} 格式不正確`;
  }
  return null;
}