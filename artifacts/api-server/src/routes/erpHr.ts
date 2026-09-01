import { Router, type IRouter } from "express";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import {
  db,
  erpAttendanceRecordsTable,
  erpEmployeesTable,
  erpInsuranceBracketsTable,
  erpJobGradesTable,
  erpLeaveRequestsTable,
  erpLeaveTypesTable,
  erpPayrollItemsTable,
  erpPayrollRunsTable,
  erpShiftsTable,
  membersTable,
} from "@workspace/db";
import { effectiveErpRole, requireErp, requireErpMenu } from "../middlewares/requireErp";
import { createErpNotification } from "../lib/erpNotifications";

const router: IRouter = Router();
export const PAYROLL_ROLES = ["super_admin", "admin", "hr_admin"];
const HR_ROLES = ["super_admin", "admin", "hr_admin", "manager"];
const sensitiveEmployeeFields = [
  "baseSalary",
  "bankAccount",
  "idNumber",
  "laborInsuranceGrade",
  "healthInsuranceGrade",
] as const;

const roleOf = (req: { member?: { role: string; erpRole: string | null } }) =>
  effectiveErpRole(req.member!);
const isHr = (req: Parameters<typeof roleOf>[0]) => HR_ROLES.includes(roleOf(req) || "");
const isPayroll = (req: Parameters<typeof roleOf>[0]) => PAYROLL_ROLES.includes(roleOf(req) || "");
const idParam = (value: string | string[]) => Number.parseInt(Array.isArray(value) ? value[0] : value, 10);
const uniqueError = (err: unknown) =>
  (err as { cause?: { code?: string } })?.cause?.code === "23505";
const taiwanDate = () =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei" }).format(new Date());

function employeeResponse<T extends Record<string, unknown>>(row: T, payroll: boolean) {
  if (payroll) return row;
  const result = { ...row };
  for (const field of sensitiveEmployeeFields) delete result[field];
  return result;
}

async function ownEmployee(memberId: number) {
  const [employee] = await db
    .select()
    .from(erpEmployeesTable)
    .where(eq(erpEmployeesTable.memberId, memberId))
    .limit(1);
  return employee;
}

/* ---------- 員工主檔 ---------- */
router.get("/erp/hr/employees", requireErpMenu("/hr/employees"), async (req, res) => {
  const rows = await db.select().from(erpEmployeesTable).orderBy(asc(erpEmployeesTable.employeeNo));
  res.json(rows.map((row) => employeeResponse(row, isPayroll(req))));
});

router.post("/erp/hr/employees", requireErpMenu("/hr/employees"), async (req, res) => {
  const body = { ...req.body };
  if (!isPayroll(req)) for (const field of sensitiveEmployeeFields) delete body[field];
  if (!body.employeeNo?.trim() || !body.name?.trim()) {
    res.status(400).json({ error: "員工編號與姓名為必填" });
    return;
  }
  try {
    const [row] = await db.insert(erpEmployeesTable).values(body).returning();
    res.status(201).json(employeeResponse(row, isPayroll(req)));
  } catch (err) {
    res.status(uniqueError(err) ? 409 : 400).json({ error: uniqueError(err) ? "員工編號或會員已被使用" : "員工資料格式錯誤" });
  }
});

router.patch("/erp/hr/employees/:id", requireErpMenu("/hr/employees"), async (req, res) => {
  const body = { ...req.body };
  if (!isPayroll(req)) for (const field of sensitiveEmployeeFields) delete body[field];
  delete body.id;
  delete body.createdAt;
  try {
    const [row] = await db.update(erpEmployeesTable).set(body).where(eq(erpEmployeesTable.id, idParam(req.params.id))).returning();
    if (!row) return void res.status(404).json({ error: "找不到員工" });
    res.json(employeeResponse(row, isPayroll(req)));
  } catch (err) {
    res.status(uniqueError(err) ? 409 : 400).json({ error: uniqueError(err) ? "員工編號或會員已被使用" : "員工資料格式錯誤" });
  }
});

/* ---------- 出勤 ---------- */
router.get("/erp/hr/attendance", requireErpMenu("/hr/attendance"), async (req, res) => {
  const own = await ownEmployee(req.member!.id);
  if (!own) return void res.status(400).json({ error: "尚未建立員工檔案" });
  const rows = await db
    .select({ record: erpAttendanceRecordsTable, employeeName: erpEmployeesTable.name })
    .from(erpAttendanceRecordsTable)
    .innerJoin(erpEmployeesTable, eq(erpAttendanceRecordsTable.employeeId, erpEmployeesTable.id))
    .where(isHr(req) ? undefined : eq(erpAttendanceRecordsTable.employeeId, own.id))
    .orderBy(desc(erpAttendanceRecordsTable.workDate))
    .limit(500);
  res.json(rows.map(({ record, employeeName }) => ({ ...record, employeeName })));
});

router.post("/erp/hr/attendance/clock", requireErpMenu("/hr/attendance"), async (req, res) => {
  const employee = await ownEmployee(req.member!.id);
  if (!employee) return void res.status(400).json({ error: "尚未建立員工檔案" });
  const workDate = taiwanDate();
  const [existing] = await db.select().from(erpAttendanceRecordsTable)
    .where(and(eq(erpAttendanceRecordsTable.employeeId, employee.id), eq(erpAttendanceRecordsTable.workDate, workDate))).limit(1);
  if (!existing) {
    try {
      const [row] = await db.insert(erpAttendanceRecordsTable).values({
        employeeId: employee.id, workDate, clockIn: new Date(), notes: req.body?.notes || null,
      }).returning();
      res.json({ ...row, employeeName: employee.name });
    } catch (err) {
      res.status(uniqueError(err) ? 409 : 400).json({ error: uniqueError(err) ? "今日已完成上班打卡，請重試" : "打卡失敗" });
    }
    return;
  }
  if (existing.clockOut) return void res.status(409).json({ error: "今日上下班皆已完成打卡" });
  const [row] = await db.update(erpAttendanceRecordsTable).set({ clockOut: new Date(), notes: req.body?.notes ?? existing.notes })
    .where(and(eq(erpAttendanceRecordsTable.id, existing.id), eq(erpAttendanceRecordsTable.employeeId, employee.id))).returning();
  res.json({ ...row, employeeName: employee.name });
});

router.post("/erp/hr/attendance", requireErpMenu("/hr/attendance"), async (req, res) => {
  if (!isHr(req)) return void res.status(403).json({ error: "僅人資可補登出勤" });
  try {
    const values = { ...req.body, clockIn: req.body.clockIn ? new Date(req.body.clockIn) : null, clockOut: req.body.clockOut ? new Date(req.body.clockOut) : null };
    const [row] = await db.insert(erpAttendanceRecordsTable).values(values).onConflictDoUpdate({
      target: [erpAttendanceRecordsTable.employeeId, erpAttendanceRecordsTable.workDate],
      set: values,
    }).returning();
    const [employee] = await db.select().from(erpEmployeesTable).where(eq(erpEmployeesTable.id, row.employeeId)).limit(1);
    res.status(201).json({ ...row, employeeName: employee?.name || "" });
  } catch {
    res.status(400).json({ error: "補登資料格式錯誤" });
  }
});

/* ---------- 請假 ---------- */
router.get("/erp/hr/leaves", requireErpMenu("/hr/leaves"), async (req, res) => {
  const own = await ownEmployee(req.member!.id);
  if (!own) return void res.status(400).json({ error: "尚未建立員工檔案" });
  const rows = await db.select({
    request: erpLeaveRequestsTable, employeeName: erpEmployeesTable.name, leaveTypeName: erpLeaveTypesTable.name,
  }).from(erpLeaveRequestsTable)
    .innerJoin(erpEmployeesTable, eq(erpLeaveRequestsTable.employeeId, erpEmployeesTable.id))
    .innerJoin(erpLeaveTypesTable, eq(erpLeaveRequestsTable.leaveTypeId, erpLeaveTypesTable.id))
    .where(isHr(req) ? undefined : eq(erpLeaveRequestsTable.employeeId, own.id))
    .orderBy(desc(erpLeaveRequestsTable.startAt));
  res.json(rows.map((row) => ({ ...row.request, employeeName: row.employeeName, leaveTypeName: row.leaveTypeName })));
});

router.post("/erp/hr/leaves", requireErpMenu("/hr/leaves"), async (req, res) => {
  const employee = await ownEmployee(req.member!.id);
  if (!employee) return void res.status(400).json({ error: "尚未建立員工檔案" });
  const startAt = new Date(req.body.startAt);
  const endAt = new Date(req.body.endAt);
  if (!(startAt < endAt) || !Number.isInteger(req.body.hours) || req.body.hours < 1) {
    return void res.status(400).json({ error: "請假時間或時數不正確" });
  }
  const [type] = await db.select().from(erpLeaveTypesTable).where(eq(erpLeaveTypesTable.id, req.body.leaveTypeId)).limit(1);
  if (!type) return void res.status(400).json({ error: "假別不存在" });
  const [row] = await db.insert(erpLeaveRequestsTable).values({
    employeeId: employee.id, leaveTypeId: type.id, startAt, endAt, hours: req.body.hours, reason: req.body.reason || null,
  }).returning();
  void (async () => {
    try {
      const approvers = await db.select({ id: membersTable.id }).from(membersTable)
        .where(inArray(membersTable.erpRole, HR_ROLES));
      await Promise.all(approvers.map(({ id }) => createErpNotification({
        memberId: id, type: "leave_submitted", title: `${employee.name} 提交請假申請`,
        body: `${type.name}，共 ${row.hours} 小時`, linkPath: "/hr/leaves",
      })));
    } catch (err) { req.log.warn({ err }, "create leave notifications failed"); }
  })();
  res.status(201).json({ ...row, employeeName: employee.name, leaveTypeName: type.name });
});

router.post("/erp/hr/leaves/:id/action", requireErpMenu("/hr/leaves"), async (req, res) => {
  const action = req.body.action;
  const own = await ownEmployee(req.member!.id);
  if (!own) return void res.status(400).json({ error: "尚未建立員工檔案" });
  const target = action === "approve" ? "approved" : action === "reject" ? "rejected" : action === "cancel" ? "cancelled" : null;
  if (!target) return void res.status(400).json({ error: "無效的簽核動作" });
  const conditions = [eq(erpLeaveRequestsTable.id, idParam(req.params.id)), eq(erpLeaveRequestsTable.status, "pending")];
  if (action === "cancel") conditions.push(eq(erpLeaveRequestsTable.employeeId, own.id));
  else if (!isHr(req)) return void res.status(403).json({ error: "僅人資可簽核" });
  const [row] = await db.update(erpLeaveRequestsTable).set({
    status: target, approverId: action === "cancel" ? null : req.member!.id,
    approvedAt: action === "approve" ? new Date() : null,
    rejectReason: action === "reject" ? req.body.rejectReason || null : null,
  }).where(and(...conditions)).returning();
  if (!row) return void res.status(409).json({ error: "申請已處理或無權操作" });
  const [employee] = await db.select().from(erpEmployeesTable).where(eq(erpEmployeesTable.id, row.employeeId)).limit(1);
  const [type] = await db.select().from(erpLeaveTypesTable).where(eq(erpLeaveTypesTable.id, row.leaveTypeId)).limit(1);
  if (action !== "cancel" && employee?.memberId) void createErpNotification({
    memberId: employee.memberId, type: `leave_${target}`, title: `請假申請已${target === "approved" ? "核准" : "駁回"}`,
    body: target === "rejected" ? row.rejectReason : null, linkPath: "/hr/leaves",
  }).catch((err) => req.log.warn({ err }, "create leave result notification failed"));
  res.json({ ...row, employeeName: employee?.name || "", leaveTypeName: type?.name || "" });
});

/* ---------- 薪資與勞健保（整組限薪資角色） ---------- */
const payrollOnly = requireErp("admin", "hr_admin");
router.get("/erp/hr/payroll", requireErpMenu("/hr/payroll"), payrollOnly, async (_req, res) => {
  res.json(await db.select().from(erpPayrollRunsTable).orderBy(desc(erpPayrollRunsTable.period)));
});
router.post("/erp/hr/payroll", requireErpMenu("/hr/payroll"), payrollOnly, async (req, res) => {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(req.body.period || "")) return void res.status(400).json({ error: "薪資期間格式須為 YYYY-MM" });
  try {
    const [row] = await db.insert(erpPayrollRunsTable).values(req.body).returning();
    res.status(201).json(row);
  } catch (err) {
    res.status(uniqueError(err) ? 409 : 400).json({ error: uniqueError(err) ? "此期間薪資批次已存在" : "資料格式錯誤" });
  }
});

async function payrollDetail(runId: number) {
  const [run] = await db.select().from(erpPayrollRunsTable).where(eq(erpPayrollRunsTable.id, runId)).limit(1);
  if (!run) return null;
  const items = await db.select({ item: erpPayrollItemsTable, employeeName: erpEmployeesTable.name })
    .from(erpPayrollItemsTable).innerJoin(erpEmployeesTable, eq(erpPayrollItemsTable.employeeId, erpEmployeesTable.id))
    .where(eq(erpPayrollItemsTable.runId, runId)).orderBy(asc(erpEmployeesTable.employeeNo));
  return { ...run, items: items.map(({ item, employeeName }) => ({ ...item, employeeName })) };
}
router.get("/erp/hr/payroll/:id", requireErpMenu("/hr/payroll"), payrollOnly, async (req, res) => {
  const detail = await payrollDetail(idParam(req.params.id));
  if (!detail) return void res.status(404).json({ error: "找不到薪資批次" });
  res.json(detail);
});
router.post("/erp/hr/payroll/:id/generate", requireErpMenu("/hr/payroll"), payrollOnly, async (req, res) => {
  const runId = idParam(req.params.id);
  const [run] = await db.select().from(erpPayrollRunsTable).where(eq(erpPayrollRunsTable.id, runId)).limit(1);
  if (!run) return void res.status(404).json({ error: "找不到薪資批次" });
  if (run.status !== "draft") return void res.status(409).json({ error: "僅草稿可產生薪資單" });
  const employees = await db.select().from(erpEmployeesTable).where(eq(erpEmployeesTable.status, "active"));
  const grades = [...new Set(employees.flatMap((e) => [e.laborInsuranceGrade, e.healthInsuranceGrade]).filter((x): x is number => x !== null))];
  const brackets = grades.length ? await db.select().from(erpInsuranceBracketsTable).where(inArray(erpInsuranceBracketsTable.grade, grades)) : [];
  await db.transaction(async (tx) => {
    if (req.body?.replace) await tx.delete(erpPayrollItemsTable).where(eq(erpPayrollItemsTable.runId, runId));
    for (const employee of employees) {
      const labor = brackets.find((b) => b.type === "labor" && b.grade === employee.laborInsuranceGrade)?.employeeAmount || 0;
      const health = brackets.find((b) => b.type === "health" && b.grade === employee.healthInsuranceGrade)?.employeeAmount || 0;
      await tx.insert(erpPayrollItemsTable).values({
        runId, employeeId: employee.id, baseSalary: employee.baseSalary,
        laborInsurance: labor, healthInsurance: health, netPay: employee.baseSalary - labor - health,
      }).onConflictDoNothing();
    }
  });
  res.json(await payrollDetail(runId));
});
router.patch("/erp/hr/payroll/:id", requireErpMenu("/hr/payroll"), payrollOnly, async (req, res) => {
  const id = idParam(req.params.id);
  const next = req.body.status;
  const expected = next === "confirmed" ? "draft" : next === "paid" ? "confirmed" : null;
  if (!expected) return void res.status(400).json({ error: "無效的薪資狀態" });
  const [row] = await db.update(erpPayrollRunsTable).set({ status: next, notes: req.body.notes })
    .where(and(eq(erpPayrollRunsTable.id, id), eq(erpPayrollRunsTable.status, expected))).returning();
  if (!row) return void res.status(409).json({ error: "薪資狀態已變更或流程順序錯誤" });
  res.json(row);
});

/* ---------- 人資設定 ---------- */
type SettingTable = typeof erpJobGradesTable | typeof erpShiftsTable | typeof erpLeaveTypesTable;
function settingCrud(path: string, table: SettingTable, readMenu = "/hr/settings") {
  router.get(path, requireErpMenu(readMenu), async (_req, res) => {
    res.json(await db.select().from(table as typeof erpJobGradesTable).orderBy(asc((table as typeof erpJobGradesTable).id)));
  });
  router.post(path, requireErpMenu("/hr/settings"), async (req, res) => {
    try {
      const [row] = await db.insert(table as typeof erpJobGradesTable).values(req.body).returning();
      res.status(201).json(row);
    } catch { res.status(400).json({ error: "設定資料格式錯誤" }); }
  });
  router.patch(`${path}/:id`, requireErpMenu("/hr/settings"), async (req, res) => {
    try {
      const [row] = await db.update(table as typeof erpJobGradesTable).set(req.body).where(eq((table as typeof erpJobGradesTable).id, idParam(req.params.id))).returning();
      if (!row) return void res.status(404).json({ error: "找不到設定" });
      res.json(row);
    } catch { res.status(400).json({ error: "設定資料格式錯誤" }); }
  });
  router.delete(`${path}/:id`, requireErpMenu("/hr/settings"), async (req, res) => {
    try {
      await db.delete(table as typeof erpJobGradesTable).where(eq((table as typeof erpJobGradesTable).id, idParam(req.params.id)));
      res.status(204).end();
    } catch { res.status(409).json({ error: "此設定仍被使用，無法刪除" }); }
  });
}
settingCrud("/erp/hr/job-grades", erpJobGradesTable);
settingCrud("/erp/hr/shifts", erpShiftsTable);
settingCrud("/erp/hr/leave-types", erpLeaveTypesTable, "/hr/leaves");

router.get("/erp/hr/insurance-brackets", requireErpMenu("/hr/settings"), payrollOnly, async (_req, res) => {
  res.json(await db.select().from(erpInsuranceBracketsTable).orderBy(asc(erpInsuranceBracketsTable.type), asc(erpInsuranceBracketsTable.grade)));
});
router.post("/erp/hr/insurance-brackets", requireErpMenu("/hr/settings"), payrollOnly, async (req, res) => {
  try {
    const [row] = await db.insert(erpInsuranceBracketsTable).values(req.body).returning();
    res.status(201).json(row);
  } catch (err) { res.status(uniqueError(err) ? 409 : 400).json({ error: uniqueError(err) ? "同類型級距不可重複" : "級距資料格式錯誤" }); }
});
router.patch("/erp/hr/insurance-brackets/:id", requireErpMenu("/hr/settings"), payrollOnly, async (req, res) => {
  try {
    const [row] = await db.update(erpInsuranceBracketsTable).set(req.body).where(eq(erpInsuranceBracketsTable.id, idParam(req.params.id))).returning();
    if (!row) return void res.status(404).json({ error: "找不到級距" });
    res.json(row);
  } catch (err) { res.status(uniqueError(err) ? 409 : 400).json({ error: uniqueError(err) ? "同類型級距不可重複" : "級距資料格式錯誤" }); }
});
router.delete("/erp/hr/insurance-brackets/:id", requireErpMenu("/hr/settings"), payrollOnly, async (req, res) => {
  await db.delete(erpInsuranceBracketsTable).where(eq(erpInsuranceBracketsTable.id, idParam(req.params.id)));
  res.status(204).end();
});

export default router;