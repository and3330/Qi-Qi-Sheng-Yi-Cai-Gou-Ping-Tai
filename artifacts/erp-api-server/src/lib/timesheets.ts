/**
 * 工時表的純計算：時薪、填寫檢查、依專案彙總。
 */

const round2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;

/** 時薪＝月薪 ÷ 時薪除數（薪資設定，預設 240） */
export function hourlyCostOf(monthlySalary: unknown, divisor: unknown): number {
  const salary = Number(monthlySalary) || 0;
  const d = Number(divisor) > 0 ? Number(divisor) : 240;
  return salary > 0 ? round2(salary / d) : 0;
}

export function timesheetProblem(input: { hours: unknown; workDate: unknown; today: string; hoursAlreadyThatDay: number }): string | null {
  const hours = Number(input.hours);
  if (!Number.isFinite(hours) || hours <= 0) return "工時必須大於 0";
  if (hours > 24) return "一天最多 24 小時";
  if (Math.round(hours * 4) !== hours * 4) return "工時請以 0.25 小時（15 分鐘）為單位";
  if (typeof input.workDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(input.workDate)) return "請填寫日期";
  if (input.workDate > input.today) return "不能填未來的工時";
  if (round2(input.hoursAlreadyThatDay + hours) > 24) return `這一天已經填了 ${input.hoursAlreadyThatDay} 小時，加上這筆會超過 24 小時`;
  return null;
}

export interface LaborRow { projectId: number; projectName?: string | null; employeeId: number; hours: number; costAmount: number; status: string }

/** 依專案彙總工時與人工成本；只有已核准的算成本，待核准的另外列出時數 */
export function summarizeLabor(rows: LaborRow[]) {
  const byProject = new Map<number, { projectId: number; projectName: string; approvedHours: number; approvedCost: number; pendingHours: number; people: Set<number> }>();
  for (const row of rows) {
    if (row.status === "Rejected") continue;
    const entry = byProject.get(row.projectId) || { projectId: row.projectId, projectName: row.projectName || `專案 #${row.projectId}`, approvedHours: 0, approvedCost: 0, pendingHours: 0, people: new Set<number>() };
    if (row.status === "Approved") { entry.approvedHours += row.hours; entry.approvedCost += row.costAmount; entry.people.add(row.employeeId); }
    else entry.pendingHours += row.hours;
    byProject.set(row.projectId, entry);
  }
  return [...byProject.values()]
    .map(e => ({ projectId: e.projectId, projectName: e.projectName, approvedHours: round2(e.approvedHours), approvedCost: round2(e.approvedCost), pendingHours: round2(e.pendingHours), people: e.people.size }))
    .sort((a, b) => b.approvedCost - a.approvedCost || b.pendingHours - a.pendingHours);
}

/** 工單這次要計入成品成本的人工（工時表）與製造費用（工作站時數 × 每小時費用） */
export function conversionCost(input: { timesheetCosts: number[]; jobCards: Array<{ totalHours: number; hourRate: number }> }) {
  const labor = round2(input.timesheetCosts.reduce((s, n) => s + (Number(n) || 0), 0));
  const overhead = round2(input.jobCards.reduce((s, c) => s + (Number(c.totalHours) || 0) * (Number(c.hourRate) || 0), 0));
  return { labor, overhead, total: round2(labor + overhead) };
}
