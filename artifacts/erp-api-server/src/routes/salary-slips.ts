import { Router, type IRouter } from "express";
import { summarizeMonth, taipeiToday } from "../lib/hr-rules";
import { loadHolidays } from "../lib/hr-data";
import { cashLineAccount, payrollJournalAmounts } from "../lib/cash-accounts";
import { assertPeriodOpen } from "../lib/auto-journal";
import { todayTaipei } from "../lib/inventory-journal";
import { isMissingProject, PROJECT_REQUIRED_MESSAGE } from "../middleware/project-required";
import { eq, and, sql, gte, lte } from "drizzle-orm";
import { db, salarySlipsTable, employeesTable, insuranceBracketsTable, journalEntriesTable, payrollSettingsTable, attendanceTable, leavesTable, salaryComponentsTable, employeeSalaryComponentsTable } from "@workspace/erp-db";
import { summarizeComponents, type ComponentLine } from "../lib/salary-components";
import { requireRole, sessionEmployeeScope } from "../middleware/require-auth";
import { resolveJournalLinesStrict } from "../lib/auto-journal";
import { finitePayrollAmount, positiveBaseSalary, validatePayrollIdentity } from "./payroll-guards";
import { assertDeletableDraft } from "../lib/document-rules";
import { partyLineText } from "../lib/voucher-entry-text";

const PAYROLL_ROLES = ["owner", "admin", "hr_admin", "finance_admin"] as const;

const router: IRouter = Router();
// GET 開放給員工自助帳號查自己的薪資單（handler 內強制範圍），其他操作僅限薪資相關角色
router.use("/salary-slips", (req, res, next) => {
  if (req.method === "GET" && sessionEmployeeScope(req).isEmployee) { next(); return; }
  requireRole(...PAYROLL_ROLES)(req, res, next);
});
router.use("/payroll-settings", requireRole(...PAYROLL_ROLES));

// ---- 薪資計算設定（單例）----
async function getSettings() {
  const [row] = await db.select().from(payrollSettingsTable).orderBy(payrollSettingsTable.id).limit(1);
  if (row) return row;
  const [created] = await db.insert(payrollSettingsTable).values({}).returning();
  return created;
}

router.get("/payroll-settings", async (_req, res): Promise<void> => {
  res.json(await getSettings());
});

router.put("/payroll-settings", async (req, res): Promise<void> => {
  const current = await getSettings();
  const { monthlyDivisor, otRate1, otRate2, otThresholdHours, lateDeductionEnabled, absenceDeductionEnabled } = req.body;
  const patch: Record<string, unknown> = {};
  if (monthlyDivisor !== undefined) {
    const d = Number(monthlyDivisor);
    if (!Number.isFinite(d) || d <= 0) { res.status(400).json({ error: "monthlyDivisor 必須為正數" }); return; }
    patch.monthlyDivisor = Math.round(d);
  }
  if (otRate1 !== undefined) {
    const r = Number(otRate1);
    if (!Number.isFinite(r) || r <= 0) { res.status(400).json({ error: "otRate1 必須為正數" }); return; }
    patch.otRate1 = String(r);
  }
  if (otRate2 !== undefined) {
    const r = Number(otRate2);
    if (!Number.isFinite(r) || r <= 0) { res.status(400).json({ error: "otRate2 必須為正數" }); return; }
    patch.otRate2 = String(r);
  }
  if (otThresholdHours !== undefined) {
    const t = Number(otThresholdHours);
    if (!Number.isFinite(t) || t < 0) { res.status(400).json({ error: "otThresholdHours 不可為負" }); return; }
    patch.otThresholdHours = String(t);
  }
  if (lateDeductionEnabled !== undefined) patch.lateDeductionEnabled = Boolean(lateDeductionEnabled);
  if (absenceDeductionEnabled !== undefined) patch.absenceDeductionEnabled = Boolean(absenceDeductionEnabled);
  const [updated] = await db.update(payrollSettingsTable).set(patch).where(eq(payrollSettingsTable.id, current.id)).returning();
  res.json(updated);
});

// ---- 出勤薪資基礎：彙總當月出勤，算出建議加班費/扣款（可重用於單筆與批次）----
type EmployeeRow = typeof employeesTable.$inferSelect;
type PayrollSettingsRow = Awaited<ReturnType<typeof getSettings>>;

async function computeAttendanceBasis(emp: EmployeeRow, year: number, month: number, settings: PayrollSettingsRow) {
  const employeeId = emp.id;
  const startDate = `${year}-${String(month).padStart(2, "0")}-01`;
  const endDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const endDate = `${year}-${String(month).padStart(2, "0")}-${String(endDay).padStart(2, "0")}`;

  const [records, approvedLeaves] = await Promise.all([
    db.select().from(attendanceTable).where(and(
      eq(attendanceTable.employeeId, employeeId),
      gte(attendanceTable.date, startDate),
      lte(attendanceTable.date, endDate),
    )),
    db.select().from(leavesTable).where(and(
      eq(leavesTable.employeeId, employeeId),
      eq(leavesTable.status, "Approved"),
      lte(leavesTable.fromDate, endDate),
      gte(leavesTable.toDate, startDate),
    )),
  ]);

  const holidays = await loadHolidays(startDate, endDate);
  const summary = summarizeMonth({
    year, month, today: taipeiToday(),
    joinDate: emp.dateOfJoining, resignationDate: emp.resignationDate, holidays,
    records, approvedLeaves,
  });
  const { absentDays, totalLateMinutes } = summary;

  // 加班費：每日加班時數依門檻分段計算（前 N 小時 rate1，其後 rate2）
  const monthlySalary = Number(emp.salary) || 0;
  const divisor = settings.monthlyDivisor || 240;
  const hourlyRate = monthlySalary / divisor;
  const rate1 = Number(settings.otRate1) || 1.34;
  const rate2 = Number(settings.otRate2) || 1.67;
  const threshold = Number(settings.otThresholdHours);
  const thresholdHours = Number.isFinite(threshold) ? threshold : 2;

  let otPayRaw = 0;
  let otHoursAtRate1 = 0;
  let otHoursAtRate2 = 0;
  for (const r of records) {
    const ot = Number(r.overtimeHours || 0);
    if (ot <= 0) continue;
    const h1 = Math.min(ot, thresholdHours);
    const h2 = Math.max(ot - thresholdHours, 0);
    otHoursAtRate1 += h1;
    otHoursAtRate2 += h2;
    otPayRaw += h1 * hourlyRate * rate1 + h2 * hourlyRate * rate2;
  }
  const suggestedOvertimePay = Math.round(otPayRaw);

  // 扣款（依設定開關）
  const lateDeduction = settings.lateDeductionEnabled ? Math.round(totalLateMinutes * hourlyRate / 60) : 0;
  const dailyRate = monthlySalary / 30;
  const absenceDeduction = settings.absenceDeductionEnabled ? Math.round(absentDays * dailyRate) : 0;
  // 請假扣薪（勞工請假規則）：事假、家庭照顧假不給工資；病假、生理假工資折半
  const leaveDeduction = Math.round(summary.unpaidLeaveDays * dailyRate);

  return {
    employeeId, year, month,
    summary,
    hourlyRate: Math.round(hourlyRate * 100) / 100,
    settings: {
      monthlyDivisor: divisor,
      otRate1: rate1,
      otRate2: rate2,
      otThresholdHours: thresholdHours,
      lateDeductionEnabled: settings.lateDeductionEnabled,
      absenceDeductionEnabled: settings.absenceDeductionEnabled,
    },
    overtime: {
      hoursAtRate1: Math.round(otHoursAtRate1 * 10) / 10,
      hoursAtRate2: Math.round(otHoursAtRate2 * 10) / 10,
      suggestedOvertimePay,
    },
    deductions: {
      lateDeduction,
      absenceDeduction,
      leaveDeduction,
      suggestedAttendanceDeduction: lateDeduction + absenceDeduction + leaveDeduction,
    },
  };
}

router.get("/salary-slips/attendance-basis", async (req, res): Promise<void> => {
  const employeeId = Number(req.query.employeeId);
  const year = Number(req.query.year);
  const month = Number(req.query.month);
  if (!Number.isInteger(employeeId) || !Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    res.status(400).json({ error: "employeeId、year、month 格式不正確" }); return;
  }
  const [emp] = await db.select().from(employeesTable).where(eq(employeesTable.id, employeeId));
  if (!emp) { res.status(404).json({ error: "employee not found" }); return; }
  const settings = await getSettings();
  res.json(await computeAttendanceBasis(emp, year, month, settings));
});

const LABOR_INS_RATE = 0.125;
// 12.5% 之中有 1% 是就業保險
const EMPLOYMENT_INS_RATE = 0.01;
const LABOR_INS_EMPLOYEE_SHARE = 0.20;
const LABOR_INS_EMPLOYER_SHARE = 0.70;
const HEALTH_INS_RATE = 0.0517;
const HEALTH_INS_EMPLOYEE_SHARE = 0.30;
const HEALTH_INS_EMPLOYER_SHARE = 0.60;
// 雇主的健保費要再乘上（1 + 平均眷口數）；115 年公告的平均眷口數是 0.56
const HEALTH_INS_AVG_DEPENDENTS = 0.56;
const PENSION_EMPLOYER_RATE = 0.06;

async function lookupBracket(type: string, salary: number): Promise<number> {
  const rows = await db.select().from(insuranceBracketsTable)
    .where(eq(insuranceBracketsTable.type, type))
    .orderBy(insuranceBracketsTable.level);
  if (rows.length === 0) return salary;
  let matched = rows[rows.length - 1].insuredAmount;
  for (const row of rows) {
    if (salary <= row.insuredAmount) {
      matched = row.insuredAmount;
      break;
    }
  }
  return matched;
}

router.get("/salary-slips", async (req, res): Promise<void> => {
  let employeeId = req.query.employeeId ? Number(req.query.employeeId) : undefined;
  const scope = sessionEmployeeScope(req);
  if (scope.isEmployee) {
    if (!scope.employeeId) { res.status(403).json({ error: "帳號尚未綁定員工，請聯絡管理員" }); return; }
    if (employeeId !== undefined && employeeId !== scope.employeeId) { res.status(403).json({ error: "只能查詢自己的薪資單" }); return; }
    employeeId = scope.employeeId;
  }
  const year = req.query.year ? Number(req.query.year) : undefined;
  const month = req.query.month ? Number(req.query.month) : undefined;

  const conditions = [];
  if (employeeId) conditions.push(eq(salarySlipsTable.employeeId, employeeId));
  if (year) conditions.push(eq(salarySlipsTable.year, year));
  if (month) conditions.push(eq(salarySlipsTable.month, month));

  const rows = await db
    .select({
      id: salarySlipsTable.id,
      employeeId: salarySlipsTable.employeeId,
      employeeName: sql<string>`${employeesTable.firstName} || ${employeesTable.lastName}`,
      employeeCode: employeesTable.employeeId,
      year: salarySlipsTable.year,
      month: salarySlipsTable.month,
      baseSalary: salarySlipsTable.baseSalary,
      overtimePay: salarySlipsTable.overtimePay,
      otherAllowances: salarySlipsTable.otherAllowances,
      components: salarySlipsTable.components,
      otherDeductions: salarySlipsTable.otherDeductions,
      attendanceDeduction: salarySlipsTable.attendanceDeduction,
      attendanceSummary: salarySlipsTable.attendanceSummary,
      grossSalary: salarySlipsTable.grossSalary,
      laborInsuranceBracket: salarySlipsTable.laborInsuranceBracket,
      laborInsuranceEmployee: salarySlipsTable.laborInsuranceEmployee,
      laborInsuranceEmployer: salarySlipsTable.laborInsuranceEmployer,
      healthInsuranceBracket: salarySlipsTable.healthInsuranceBracket,
      healthInsuranceDependents: salarySlipsTable.healthInsuranceDependents,
      healthInsuranceEmployee: salarySlipsTable.healthInsuranceEmployee,
      healthInsuranceEmployer: salarySlipsTable.healthInsuranceEmployer,
      pensionBracket: salarySlipsTable.pensionBracket,
      pensionEmployer: salarySlipsTable.pensionEmployer,
      pensionEmployeeSelfRate: salarySlipsTable.pensionEmployeeSelfRate,
      pensionEmployeeSelf: salarySlipsTable.pensionEmployeeSelf,
      totalDeductions: salarySlipsTable.totalDeductions,
      netSalary: salarySlipsTable.netSalary,
      status: salarySlipsTable.status,
      note: salarySlipsTable.note,
      createdAt: salarySlipsTable.createdAt,
    })
    .from(salarySlipsTable)
    .innerJoin(employeesTable, eq(salarySlipsTable.employeeId, employeesTable.id))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(salarySlipsTable.year, salarySlipsTable.month);

  res.json(rows);
});

/** 這位員工薪資結構裡啟用中的項目 */
async function loadEmployeeComponents(employeeId: number): Promise<ComponentLine[]> {
  const rows = await db.select({
    componentId: salaryComponentsTable.id, name: salaryComponentsTable.name, kind: salaryComponentsTable.kind,
    insurable: salaryComponentsTable.insurable, amount: employeeSalaryComponentsTable.amount,
  }).from(employeeSalaryComponentsTable)
    .innerJoin(salaryComponentsTable, eq(salaryComponentsTable.id, employeeSalaryComponentsTable.componentId))
    .where(and(eq(employeeSalaryComponentsTable.employeeId, employeeId), eq(salaryComponentsTable.isActive, true)))
    .orderBy(salaryComponentsTable.sortOrder, salaryComponentsTable.id);
  return rows;
}

// 依員工與參數計算完整薪資明細（可重用於單筆與批次）
async function computeSalarySlip(emp: EmployeeRow, params: { year: number; month: number; overtimePay?: number; otherAllowances?: number; attendanceDeduction?: number }) {
  const { year, month, overtimePay = 0, otherAllowances = 0, attendanceDeduction = 0 } = params;
  const baseSalary = positiveBaseSalary(emp.salary);
  const safeOvertimePay = finitePayrollAmount(overtimePay, "overtimePay");
  const safeOtherAllowances = finitePayrollAmount(otherAllowances, "otherAllowances");
  const safeAttendanceDeduction = finitePayrollAmount(attendanceDeduction, "attendanceDeduction");
  // 薪資結構的固定項目：加項併入其他津貼，減項另外列在扣繳；手動輸入的其他津貼列成一行「其他津貼」
  const structure = summarizeComponents(await loadEmployeeComponents(emp.id));
  const manualAllowance = Math.round(safeOtherAllowances);
  const componentLines: ComponentLine[] = [
    ...structure.lines,
    ...(manualAllowance > 0 ? [{ componentId: null, name: "其他津貼", kind: "earning", amount: manualAllowance, insurable: true }] : []),
  ];
  const totalAllowances = structure.earnings + manualAllowance;
  const grossSalary = baseSalary + safeOvertimePay + totalAllowances;

  // 投保薪資不含伙食津貼這類不列入投保的項目
  const insuredBase = Math.max(0, grossSalary - structure.nonInsurableEarnings);
  const laborBracket = await lookupBracket("labor", insuredBase);
  const healthBracket = await lookupBracket("health", insuredBase);
  const pensionBracket = await lookupBracket("pension", insuredBase);

  // 勞保費＝普通事故保險＋就業保險，官方表是兩項各自四捨五入後再相加（合併計算會差 1 元）
  const laborShare = (share: number) => Math.round(laborBracket * (LABOR_INS_RATE - EMPLOYMENT_INS_RATE) * share) + Math.round(laborBracket * EMPLOYMENT_INS_RATE * share);
  const laborInsEmployee = laborShare(LABOR_INS_EMPLOYEE_SHARE);
  const laborInsEmployer = laborShare(LABOR_INS_EMPLOYER_SHARE);

  const dependents = emp.healthInsuranceDependents || 0;
  const healthInsEmployee = Math.round(healthBracket * HEALTH_INS_RATE * HEALTH_INS_EMPLOYEE_SHARE * (1 + Math.min(dependents, 3)));
  const healthInsEmployer = Math.round(healthBracket * HEALTH_INS_RATE * HEALTH_INS_EMPLOYER_SHARE * (1 + HEALTH_INS_AVG_DEPENDENTS));

  const pensionEmployer = Math.round(pensionBracket * PENSION_EMPLOYER_RATE);
  const selfRate = (emp.pensionSelfRate || 0) / 100;
  const pensionSelf = Math.round(pensionBracket * selfRate);

  const attDeduction = Math.round(safeAttendanceDeduction);
  const otherDeductions = structure.deductions;
  const totalDeductions = laborInsEmployee + healthInsEmployee + pensionSelf + attDeduction + otherDeductions;
  const netSalary = grossSalary - totalDeductions;

  return {
    employeeId: emp.id,
    employeeName: `${emp.firstName}${emp.lastName}`,
    year, month, baseSalary, overtimePay: safeOvertimePay, otherAllowances: totalAllowances,
    components: componentLines, otherDeductions,
    attendanceDeduction: attDeduction,
    grossSalary,
    laborInsuranceBracket: laborBracket, laborInsuranceEmployee: laborInsEmployee, laborInsuranceEmployer: laborInsEmployer,
    healthInsuranceBracket: healthBracket, healthInsuranceDependents: dependents,
    healthInsuranceEmployee: healthInsEmployee, healthInsuranceEmployer: healthInsEmployer,
    pensionBracket, pensionEmployer, pensionEmployeeSelfRate: emp.pensionSelfRate || 0, pensionEmployeeSelf: pensionSelf,
    totalDeductions, netSalary,
  };
}

router.post("/salary-slips/calculate", async (req, res): Promise<void> => {
  const { employeeId, year, month, overtimePay = 0, otherAllowances = 0, attendanceDeduction = 0 } = req.body;
  const identityError = validatePayrollIdentity(employeeId, year, month);
  if (identityError) { res.status(400).json({ error: identityError }); return; }
  let amounts: { overtimePay: number; otherAllowances: number; attendanceDeduction: number };
  try {
    amounts = {
      overtimePay: finitePayrollAmount(overtimePay, "overtimePay"),
      otherAllowances: finitePayrollAmount(otherAllowances, "otherAllowances"),
      attendanceDeduction: finitePayrollAmount(attendanceDeduction, "attendanceDeduction"),
    };
  } catch (err: any) {
    res.status(400).json({ error: err.message }); return;
  }

  const [emp] = await db.select().from(employeesTable).where(eq(employeesTable.id, Number(employeeId)));
  if (!emp) { res.status(404).json({ error: "employee not found" }); return; }

  try {
    res.json(await computeSalarySlip(emp, { year: Number(year), month: Number(month), ...amounts }));
  } catch (err: any) {
    res.status(400).json({ error: err.message }); return;
  }
});

// ---- 批次產生：為所有在職員工套用出勤資料並產生草稿薪資單 ----
router.post("/salary-slips/batch-generate", async (req, res): Promise<void> => {
  const year = Number(req.body.year);
  const month = Number(req.body.month);
  const dryRun = Boolean(req.body.dryRun);
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    res.status(400).json({ error: "year、month 格式不正確" }); return;
  }
  // 預覽不用選專案；真的要產生薪資單時才要求
  if (!dryRun && isMissingProject(req.body.projectId)) { res.status(400).json({ error: PROJECT_REQUIRED_MESSAGE }); return; }
  const batchProjectId = dryRun ? null : Number(req.body.projectId);

  const [settings, activeEmployees, existingSlips] = await Promise.all([
    getSettings(),
    db.select().from(employeesTable).where(eq(employeesTable.status, "Active")),
    db.select({ employeeId: salarySlipsTable.employeeId }).from(salarySlipsTable).where(and(
      eq(salarySlipsTable.year, year),
      eq(salarySlipsTable.month, month),
    )),
  ]);
  const existingSet = new Set(existingSlips.map(r => r.employeeId));

  type BatchItem = {
    employeeId: number;
    employeeName: string;
    status: "preview" | "created" | "skipped" | "failed";
    reason?: string;
    overtimePay?: number;
    attendanceDeduction?: number;
    grossSalary?: number;
    netSalary?: number;
    slipId?: number;
  };
  const results: BatchItem[] = [];

  for (const emp of activeEmployees) {
    const employeeName = `${emp.firstName}${emp.lastName}`;
    if (existingSet.has(emp.id)) {
      results.push({ employeeId: emp.id, employeeName, status: "skipped", reason: `${year} 年 ${month} 月已有薪資單` });
      continue;
    }
    try {
      const basis = await computeAttendanceBasis(emp, year, month, settings);
      const calc = await computeSalarySlip(emp, {
        year, month,
        overtimePay: basis.overtime.suggestedOvertimePay,
        otherAllowances: 0,
        attendanceDeduction: basis.deductions.suggestedAttendanceDeduction,
      });
      if (dryRun) {
        results.push({
          employeeId: emp.id, employeeName, status: "preview",
          overtimePay: calc.overtimePay, attendanceDeduction: calc.attendanceDeduction,
          grossSalary: calc.grossSalary, netSalary: calc.netSalary,
        });
      } else {
        const [row] = await db.insert(salarySlipsTable).values({
          ...calc,
          projectId: batchProjectId,
          attendanceSummary: basis.summary,
          status: "draft",
          note: null,
        } as any).returning();
        results.push({
          employeeId: emp.id, employeeName, status: "created", slipId: row.id,
          overtimePay: calc.overtimePay, attendanceDeduction: calc.attendanceDeduction,
          grossSalary: calc.grossSalary, netSalary: calc.netSalary,
        });
      }
    } catch (err: any) {
      results.push({ employeeId: emp.id, employeeName, status: "failed", reason: err.message || "計算失敗" });
    }
  }

  const counts = {
    total: activeEmployees.length,
    success: results.filter(r => r.status === "created" || r.status === "preview").length,
    skipped: results.filter(r => r.status === "skipped").length,
    failed: results.filter(r => r.status === "failed").length,
  };
  res.json({ year, month, dryRun, counts, results });
});

router.post("/salary-slips", async (req, res): Promise<void> => {
  const data = req.body;
  const identityError = validatePayrollIdentity(data.employeeId, data.year, data.month);
  if (identityError) { res.status(400).json({ error: identityError }); return; }
  if (isMissingProject(data.projectId)) { res.status(400).json({ error: PROJECT_REQUIRED_MESSAGE }); return; }
  data.projectId = Number(data.projectId);
  try {
    positiveBaseSalary(data.baseSalary);
    for (const field of ["overtimePay", "otherAllowances", "attendanceDeduction", "grossSalary", "totalDeductions", "netSalary"]) {
      finitePayrollAmount(data[field], field);
    }
    data.otherDeductions = finitePayrollAmount(data.otherDeductions ?? 0, "otherDeductions");
    data.components = Array.isArray(data.components) ? summarizeComponents(data.components).lines : null;
  } catch (err: any) {
    res.status(400).json({ error: err.message }); return;
  }
  const [employee] = await db.select({ id: employeesTable.id }).from(employeesTable)
    .where(eq(employeesTable.id, Number(data.employeeId))).limit(1);
  if (!employee) { res.status(404).json({ error: "employee not found" }); return; }
  // 同員工同年月不可重複
  const [dup] = await db.select({ id: salarySlipsTable.id }).from(salarySlipsTable).where(and(
    eq(salarySlipsTable.employeeId, Number(data.employeeId)),
    eq(salarySlipsTable.year, Number(data.year)),
    eq(salarySlipsTable.month, Number(data.month)),
  ));
  if (dup) { res.status(409).json({ error: `此員工 ${data.year} 年 ${data.month} 月已有薪資單` }); return; }
  // 只收薪資單本來就該有的欄位，而且一律從草稿開始。
  // 原本整包存進資料庫：可以直接送「已發放」的薪資單（不會入帳），或送對不起來的金額。
  const SLIP_NUMBER_FIELDS = [
    "baseSalary", "overtimePay", "otherAllowances", "otherDeductions", "attendanceDeduction", "grossSalary",
    "laborInsuranceBracket", "laborInsuranceEmployee", "laborInsuranceEmployer",
    "healthInsuranceBracket", "healthInsuranceDependents", "healthInsuranceEmployee", "healthInsuranceEmployer",
    "pensionBracket", "pensionEmployer", "pensionEmployeeSelfRate", "pensionEmployeeSelf", "totalDeductions", "netSalary",
  ] as const;
  const values: Record<string, unknown> = {
    employeeId: Number(data.employeeId), year: Number(data.year), month: Number(data.month), projectId: data.projectId,
    components: data.components, attendanceSummary: data.attendanceSummary ?? null,
    note: typeof data.note === "string" ? data.note.slice(0, 500) : null, status: "draft",
  };
  for (const field of SLIP_NUMBER_FIELDS) {
    const amount = Number(data[field] ?? 0);
    if (!Number.isFinite(amount) || amount < 0) { res.status(400).json({ error: "薪資單金額不能是負數" }); return; }
    values[field] = Math.round(amount);
  }
  if (values.grossSalary as number - (values.totalDeductions as number) !== values.netSalary) {
    res.status(400).json({ error: "應發、扣款與實發金額對不起來，請重新計算" }); return;
  }
  const [row] = await db.insert(salarySlipsTable).values(values as typeof salarySlipsTable.$inferInsert).returning();
  res.status(201).json(row);
});

const SLIP_TRANSITIONS: Record<string, string[]> = {
  draft: ["confirmed"],
  confirmed: ["paid", "draft"],
  paid: [],
};

router.put("/salary-slips/:id/status", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) { res.status(400).json({ error: "薪資單 ID 無效" }); return; }
  const { status } = req.body;
  const [existing] = await db.select().from(salarySlipsTable).where(eq(salarySlipsTable.id, id));
  if (!existing) { res.status(404).json({ error: "not found" }); return; }
  const allowed = SLIP_TRANSITIONS[String(existing.status).toLowerCase()] || [];
  if (!allowed.includes(String(status).toLowerCase())) {
    res.status(400).json({ error: `薪資單無法從「${existing.status}」轉換為「${status}」` }); return;
  }

  try {
    const row = await db.transaction(async (tx) => {
      const [updated] = await tx.update(salarySlipsTable).set({ status }).where(eq(salarySlipsTable.id, id)).returning();
      // 發放時自動產生薪資分錄
      if (String(status).toLowerCase() === "paid") {
        const payDate = todayTaipei();
        await assertPeriodOpen(tx, payDate, "發放薪資");
        const amounts = payrollJournalAmounts({
          grossSalary: Number(updated.grossSalary) || 0,
          totalDeductions: Number(updated.totalDeductions) || 0,
          attendanceDeduction: Number(updated.attendanceDeduction) || 0,
          netSalary: Number(updated.netSalary) || 0,
          employerCost: (Number(updated.laborInsuranceEmployer) || 0) + (Number(updated.healthInsuranceEmployer) || 0) + (Number(updated.pensionEmployer) || 0),
        });
        if (!amounts.balanced) throw new Error("薪資單的應發、扣款與實發金額對不起來，請重新計算後再發放");
        const cashAccount = await cashLineAccount(tx, req.body?.cashAccountId);
        const [emp] = await tx.select({ departmentId: employeesTable.departmentId, name: sql<string>`${employeesTable.firstName} || ${employeesTable.lastName}` }).from(employeesTable).where(eq(employeesTable.id, updated.employeeId));
        const totalDebit = amounts.salaryExpense + amounts.employerCost;
        // 摘要跟 Ecount 一樣：「員工｜2026年10月份薪資」
        const period = `${updated.year}年${updated.month}月份薪資`;
        const t = (what: string) => partyLineText(emp?.name, `${period} ${what}`, period);
        const salaryLines = await resolveJournalLinesStrict(tx, [
          { accountName: "薪資費用", debit: amounts.salaryExpense, credit: 0, description: t("薪資（已扣出勤與請假）") },
          { accountName: "勞健保/退休金費用（雇主）", debit: amounts.employerCost, credit: 0, description: t("雇主負擔") },
          { accountName: "代扣款項", debit: 0, credit: amounts.withheld, description: t("員工自付勞健保/自提") },
          { accountName: "應付勞健保/退休金", debit: 0, credit: amounts.employerCost, description: t("雇主應付") },
          { ...cashAccount, debit: 0, credit: amounts.net, description: t("實發") },
        ].filter(line => line.debit !== 0 || line.credit !== 0));
        await tx.insert(journalEntriesTable).values({
          entryNumber: `JE-SAL-${updated.year}${String(updated.month).padStart(2, "0")}-${updated.id}`,
          entryDate: payDate,
          description: emp?.name ? `${period}-${emp.name}` : period,
          totalDebit: String(totalDebit),
          totalCredit: String(totalDebit),
          status: "Posted",
          lines: salaryLines,
          // 薪資是費用，要歸到專案與部門，專案損益才看得到人事成本
          projectId: updated.projectId ?? null,
          departmentId: emp?.departmentId ?? null,
        });
      }
      return updated;
    });
    res.json(row);
  } catch (err: any) {
    res.status(400).json({ error: err.message || "更新失敗" });
  }
});

router.delete("/salary-slips/:id", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) { res.status(400).json({ error: "薪資單 ID 無效" }); return; }
  const [existing] = await db.select({ status: salarySlipsTable.status }).from(salarySlipsTable).where(eq(salarySlipsTable.id, id));
  if (!existing) { res.status(404).json({ error: "not found" }); return; }
  if (String(existing.status).toLowerCase() === "paid") {
    res.status(400).json({ error: "已發放的薪資單已入帳，不可刪除" }); return;
  }
  try {
    assertDeletableDraft("薪資單", existing.status, "退回草稿");
  } catch (err: any) {
    res.status(400).json({ error: err.message }); return;
  }
  await db.delete(salarySlipsTable).where(eq(salarySlipsTable.id, id));
  res.status(204).end();
});

export default router;
