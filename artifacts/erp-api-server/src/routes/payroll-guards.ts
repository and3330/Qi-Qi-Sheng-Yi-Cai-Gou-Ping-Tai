export function validatePayrollIdentity(employeeId: unknown, year: unknown, month: unknown): string | null {
  const parsedEmployeeId = Number(employeeId);
  const parsedYear = Number(year);
  const parsedMonth = Number(month);
  if (!Number.isInteger(parsedEmployeeId) || parsedEmployeeId <= 0) return "employeeId 格式不正確";
  if (!Number.isInteger(parsedYear) || parsedYear < 1900 || parsedYear > 2200) return "year 格式不正確";
  if (!Number.isInteger(parsedMonth) || parsedMonth < 1 || parsedMonth > 12) return "month must be 1-12";
  return null;
}

export function finitePayrollAmount(value: unknown, field: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) throw new Error(`${field} 必須為非負有限數字`);
  return parsed;
}

export function positiveBaseSalary(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) throw new Error("員工尚未設定有效底薪");
  return Math.round(parsed);
}