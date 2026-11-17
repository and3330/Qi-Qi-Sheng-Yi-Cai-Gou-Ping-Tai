/**
 * 薪資項目的純計算：把一位員工的固定加項、減項整理成薪資單要用的數字。
 */

export interface ComponentLine {
  componentId: number | null;
  name: string;
  kind: string;
  amount: number;
  insurable?: boolean;
}

export const COMPONENT_KINDS: Record<string, string> = { earning: "加項", deduction: "減項" };

export function componentProblem(input: { name?: unknown; kind?: unknown; defaultAmount?: unknown }): string | null {
  const name = typeof input.name === "string" ? input.name.trim() : "";
  if (!name) return "請填寫項目名稱";
  if (name.length > 30) return "項目名稱最多 30 個字";
  if (!COMPONENT_KINDS[String(input.kind)]) return "請選擇加項或減項";
  const amount = Number(input.defaultAmount ?? 0);
  if (!Number.isFinite(amount) || amount < 0 || !Number.isInteger(amount)) return "預設金額必須是 0 以上的整數";
  if (amount > 10_000_000) return "預設金額過大";
  return null;
}

/**
 * 彙總薪資項目。
 * - earnings：加項合計，算進應發
 * - nonInsurableEarnings：不列入投保薪資的加項（例如伙食津貼），查級距時要先扣掉
 * - deductions：減項合計，算進扣繳
 * 金額為 0 或不合法的項目直接略過，不會出現在薪資單上。
 */
export function summarizeComponents(lines: ComponentLine[]) {
  const clean = lines
    .map(l => ({ ...l, amount: Math.round(Number(l.amount) || 0) }))
    .filter(l => l.amount > 0 && (l.kind === "earning" || l.kind === "deduction"));
  const sum = (rows: ComponentLine[]) => rows.reduce((s, r) => s + r.amount, 0);
  const earningRows = clean.filter(l => l.kind === "earning");
  return {
    lines: clean,
    earnings: sum(earningRows),
    nonInsurableEarnings: sum(earningRows.filter(l => l.insurable === false)),
    deductions: sum(clean.filter(l => l.kind === "deduction")),
  };
}

/** 檢查送進來的員工薪資結構：同一個項目不能重複、金額要是 0 以上的整數 */
export function assignmentProblem(items: unknown): string | null {
  if (!Array.isArray(items)) return "格式不正確";
  const seen = new Set<number>();
  for (const item of items) {
    const componentId = Number((item as any)?.componentId);
    const amount = Number((item as any)?.amount);
    if (!Number.isInteger(componentId) || componentId <= 0) return "薪資項目無效";
    if (seen.has(componentId)) return "同一個薪資項目不能重複設定";
    seen.add(componentId);
    if (!Number.isFinite(amount) || amount < 0 || !Number.isInteger(amount)) return "金額必須是 0 以上的整數";
    if (amount > 10_000_000) return "金額過大";
  }
  return null;
}
