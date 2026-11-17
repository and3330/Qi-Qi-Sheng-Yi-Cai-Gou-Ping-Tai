import { tenantPool } from "../tenant-db";
import { computePnL, employerCost } from "./compute";
import { loadJournal } from "./executive";
import { metric, monthsBetween, num, period, ratio } from "./range";
import type { HrResponse } from "./types";

type Range = { startDate: string; endDate: string; days: number };

async function loadHrFacts(r: Range) {
  const p = [r.startDate, r.endDate];
  const startYm = Number(r.startDate.slice(0, 4)) * 100 + Number(r.startDate.slice(5, 7));
  const endYm = Number(r.endDate.slice(0, 4)) * 100 + Number(r.endDate.slice(5, 7));
  const [slips, emps, att, depts, sales] = await Promise.all([
    tenantPool.query(`SELECT s.year, s.month, s.employee_id AS "employeeId", e.department_id AS "departmentId",
                             s.gross_salary AS gross, s.labor_insurance_employer AS "laborEmployer",
                             s.health_insurance_employer AS "healthEmployer", s.pension_employer AS "pensionEmployer"
                        FROM salary_slips s LEFT JOIN employees e ON e.id = s.employee_id
                       WHERE s.status IN ('confirmed','paid') AND (s.year * 100 + s.month) BETWEEN $1 AND $2`, [startYm, endYm]),
    tenantPool.query(`SELECT id, department_id AS "departmentId", TRIM(COALESCE(last_name,'') || COALESCE(first_name,'')) AS name
                        FROM employees WHERE status = 'Active'`),
    tenantPool.query(`SELECT a.date, e.department_id AS "departmentId", COUNT(*)::int AS records,
                             COUNT(*) FILTER (WHERE COALESCE(a.late_minutes,0) > 0 OR a.status = 'Late')::int AS late,
                             COALESCE(SUM(a.overtime_hours),0)::float AS overtime
                        FROM attendance a LEFT JOIN employees e ON e.id = a.employee_id
                       WHERE a.date >= $1 AND a.date <= $2 GROUP BY 1, 2`, p),
    tenantPool.query(`SELECT id, name FROM departments ORDER BY name`),
    tenantPool.query(`SELECT so.salesperson_id AS "employeeId", TRIM(COALESCE(e.last_name,'') || COALESCE(e.first_name,'')) AS name,
                             SUM(so.total_amount)::float AS revenue
                        FROM sales_orders so JOIN employees e ON e.id = so.salesperson_id
                       WHERE so.status NOT IN ('Cancelled','Draft') AND so.order_date >= $1 AND so.order_date <= $2
                       GROUP BY 1, 2 ORDER BY 3 DESC LIMIT 20`, p),
  ]);
  return { slips: slips.rows, emps: emps.rows, att: att.rows, depts: depts.rows, sales: sales.rows };
}

export async function buildHr(r: Range): Promise<HrResponse> {
  const [f, journal] = await Promise.all([loadHrFacts(r), loadJournal(r)]);
  const pnl = computePnL(journal.entries.filter((e) => !e.isInternalTransfer), journal.accounts);
  const hasJournal = journal.entries.length > 0;
  const slips = f.slips.map((s: any) => ({ ...s, gross: num(s.gross), laborEmployer: num(s.laborEmployer), healthEmployer: num(s.healthEmployer), pensionEmployer: num(s.pensionEmployer) }));

  const monthly = monthsBetween(r.startDate, r.endDate).map((m) => {
    const [y, mo] = m.split("-").map(Number);
    const ms = slips.filter((s) => s.year === y && s.month === mo);
    const heads = new Set(ms.map((s) => s.employeeId)).size;
    const revenue = hasJournal ? (pnl.monthly.get(m)?.revenue ?? 0) : null;
    return {
      month: m,
      gross: ms.reduce((t, s) => t + s.gross, 0),
      employerCost: ms.reduce((t, s) => t + employerCost(s), 0),
      paidHeadcount: heads,
      revenue,
      revenuePerHead: revenue != null && heads > 0 ? revenue / heads : null,
    };
  });

  const deptName = new Map<number, string>(f.depts.map((d: any) => [d.id, d.name]));
  const deptAgg = new Map<number | null, { heads: Set<number>; gross: number; cost: number; ot: number }>();
  const getDept = (id: number | null) => {
    let v = deptAgg.get(id);
    if (!v) { v = { heads: new Set(), gross: 0, cost: 0, ot: 0 }; deptAgg.set(id, v); }
    return v;
  };
  for (const s of slips) { const d = getDept(s.departmentId ?? null); d.heads.add(s.employeeId); d.gross += s.gross; d.cost += employerCost(s); }
  for (const a of f.att) getDept(a.departmentId ?? null).ot += num(a.overtime);

  const daily = new Map<string, { records: number; late: number; overtimeHours: number }>();
  for (const a of f.att) {
    const d = daily.get(a.date) ?? { records: 0, late: 0, overtimeHours: 0 };
    d.records += a.records; d.late += a.late; d.overtimeHours += num(a.overtime);
    daily.set(a.date, d);
  }
  const costByEmp = new Map<number, number>();
  for (const s of slips) costByEmp.set(s.employeeId, (costByEmp.get(s.employeeId) ?? 0) + employerCost(s));

  const gross = slips.reduce((t, s) => t + s.gross, 0);
  const cost = slips.reduce((t, s) => t + employerCost(s), 0);
  const avgHeads = monthly.filter((m) => m.paidHeadcount > 0);
  const meanHeads = avgHeads.length ? avgHeads.reduce((t, m) => t + m.paidHeadcount, 0) / avgHeads.length : 0;
  const noSlip = "期間內沒有已確認或已發放的薪資單";
  const attRecords = f.att.reduce((t: number, a: any) => t + a.records, 0);

  return {
    period: period(r),
    summary: {
      activeHeadcount: { value: f.emps.length },
      payrollGross: metric(slips.length ? gross : null, noSlip),
      employerCost: metric(slips.length ? cost : null, noSlip),
      revenuePerHead: metric(hasJournal && meanHeads > 0 ? ratio(pnl.revenue, meanHeads) : null, !hasJournal ? "期間內沒有已過帳的會計分錄" : noSlip),
      overtimeHours: metric(attRecords ? f.att.reduce((t: number, a: any) => t + num(a.overtime), 0) : null, "期間內沒有出勤紀錄"),
      lateCount: metric(attRecords ? f.att.reduce((t: number, a: any) => t + a.late, 0) : null, "期間內沒有出勤紀錄"),
    },
    monthly,
    departments: [...deptAgg.entries()].map(([id, v]) => ({
      departmentId: id, name: id == null ? "未指定部門" : deptName.get(id) ?? `部門 #${id}`,
      headcount: v.heads.size, gross: v.gross, employerCost: v.cost, overtimeHours: v.ot,
    })).sort((a, b) => b.employerCost - a.employerCost),
    attendanceDaily: [...daily.entries()].map(([date, v]) => ({ date, ...v })).sort((a, b) => a.date.localeCompare(b.date)),
    salespeople: f.sales.map((s: any) => ({ employeeId: s.employeeId, name: s.name || `員工 #${s.employeeId}`, orderRevenue: num(s.revenue), employerCost: costByEmp.get(s.employeeId) ?? null })),
    notes: [
      { text: "薪資只計入狀態為已確認或已發放的薪資單，依薪資所屬年月歸期（區間頭尾月整月計入）。" },
      { text: "雇主人事成本 = 應發薪資 + 勞保雇主負擔 + 健保雇主負擔 + 勞退雇主提繳。" },
      { text: "人均產值 = 期間會計營業收入 ÷ 有薪資單月份的平均發薪人數。部門依員工目前所屬部門歸屬。" },
      { text: "業務產值為非草稿、非取消銷售訂單金額（依承辦業務）；系統未設定佣金規則，因此不計算提成。" },
    ],
  };
}
