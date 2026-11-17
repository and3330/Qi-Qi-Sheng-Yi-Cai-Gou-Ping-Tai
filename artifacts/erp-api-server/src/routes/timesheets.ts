import { Router, type IRouter } from "express";
import { and, desc, eq, gte, inArray, lte, ne, sql } from "drizzle-orm";
import { db, timesheetsTable, employeesTable, projectsTable, tasksTable, workOrdersTable, payrollSettingsTable } from "@workspace/erp-db";
import { requireAuth, requireRole, sessionEmployeeScope } from "../middleware/require-auth";
import { isRealDate } from "../lib/cash-accounts";
import { todayTaipei } from "../lib/inventory-journal";
import { hourlyCostOf, summarizeLabor, timesheetProblem } from "../lib/timesheets";

const router: IRouter = Router();
router.use("/timesheets", requireAuth);
// 核准工時等於認定人工成本，只給主管與人資、財務
const APPROVER_ROLES = ["owner", "admin", "hr_admin", "finance_admin", "manager"] as const;
const isApprover = (req: any): boolean => APPROVER_ROLES.includes(req.session?.user?.role);

const parseId = (value: unknown): number | null => {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
};

const shape = (row: typeof timesheetsTable.$inferSelect, showCost: boolean) => ({
  ...row,
  hours: Number(row.hours),
  // 時薪等於薪水，員工自助帳號只看得到自己的；其他沒有核准權限的人不顯示金額
  hourlyCost: showCost ? Number(row.hourlyCost) : null,
  costAmount: showCost ? Number(row.costAmount) : null,
});

function listConditions(req: any): { conditions: any[]; error?: string } {
  const conditions: any[] = [];
  const scope = sessionEmployeeScope(req);
  if (scope.isEmployee) {
    if (!scope.employeeId) return { conditions, error: "帳號尚未綁定員工，請聯絡管理員" };
    conditions.push(eq(timesheetsTable.employeeId, scope.employeeId));
  } else if (req.query.employeeId) {
    conditions.push(eq(timesheetsTable.employeeId, Number(req.query.employeeId)));
  }
  if (isRealDate(req.query.from)) conditions.push(gte(timesheetsTable.workDate, req.query.from));
  if (isRealDate(req.query.to)) conditions.push(lte(timesheetsTable.workDate, req.query.to));
  if (req.query.projectId) conditions.push(eq(timesheetsTable.projectId, Number(req.query.projectId)));
  if (req.query.workOrderId) conditions.push(eq(timesheetsTable.workOrderId, Number(req.query.workOrderId)));
  if (req.query.status) conditions.push(eq(timesheetsTable.status, String(req.query.status)));
  return { conditions };
}

router.get("/timesheets", async (req, res): Promise<void> => {
  const { conditions, error } = listConditions(req);
  if (error) { res.status(403).json({ error }); return; }
  const rows = await db.select({
    sheet: timesheetsTable,
    firstName: employeesTable.firstName, lastName: employeesTable.lastName,
    projectName: projectsTable.name, taskTitle: tasksTable.title, workOrderNumber: workOrdersTable.workOrderNumber,
  }).from(timesheetsTable)
    .leftJoin(employeesTable, eq(employeesTable.id, timesheetsTable.employeeId))
    .leftJoin(projectsTable, eq(projectsTable.id, timesheetsTable.projectId))
    .leftJoin(tasksTable, eq(tasksTable.id, timesheetsTable.taskId))
    .leftJoin(workOrdersTable, eq(workOrdersTable.id, timesheetsTable.workOrderId))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(timesheetsTable.workDate), desc(timesheetsTable.id))
    .limit(2000);
  const showCost = isApprover(req);
  res.json(rows.map(r => ({
    ...shape(r.sheet, showCost),
    employeeName: `${r.firstName || ""}${r.lastName || ""}` || `員工 #${r.sheet.employeeId}`,
    projectName: r.projectName, taskTitle: r.taskTitle, workOrderNumber: r.workOrderNumber,
  })));
});

/** 填工時要用的選單（員工自助帳號沒有讀專案、工單清單的權限，所以由這裡給精簡版） */
router.get("/timesheets/options", async (req, res): Promise<void> => {
  const scope = sessionEmployeeScope(req);
  const approver = isApprover(req);
  const [projects, tasks, workOrders, employees] = await Promise.all([
    db.select({ id: projectsTable.id, name: projectsTable.name }).from(projectsTable).orderBy(projectsTable.name),
    db.select({ id: tasksTable.id, title: tasksTable.title, projectId: tasksTable.projectId }).from(tasksTable).orderBy(desc(tasksTable.id)).limit(500),
    db.select({ id: workOrdersTable.id, workOrderNumber: workOrdersTable.workOrderNumber }).from(workOrdersTable)
      .where(sql`${workOrdersTable.status} NOT IN ('Completed', 'Cancelled')`).orderBy(desc(workOrdersTable.id)).limit(200),
    approver
      ? db.select({ id: employeesTable.id, firstName: employeesTable.firstName, lastName: employeesTable.lastName }).from(employeesTable).where(eq(employeesTable.status, "Active")).orderBy(employeesTable.employeeId)
      : Promise.resolve([] as Array<{ id: number; firstName: string; lastName: string }>),
  ]);
  res.json({
    canApprove: approver,
    ownEmployeeId: scope.isEmployee ? scope.employeeId : parseId(req.session?.user?.employeeId),
    projects, tasks, workOrders,
    employees: employees.map(e => ({ id: e.id, name: `${e.firstName}${e.lastName}` })),
  });
});

/** 各專案投入的工時與人工成本 */
router.get("/timesheets/summary", requireRole(...APPROVER_ROLES, "accountant"), async (req, res): Promise<void> => {
  const conditions = [];
  if (isRealDate(req.query.from)) conditions.push(gte(timesheetsTable.workDate, req.query.from));
  if (isRealDate(req.query.to)) conditions.push(lte(timesheetsTable.workDate, req.query.to));
  const rows = await db.select({
    projectId: timesheetsTable.projectId, projectName: projectsTable.name, employeeId: timesheetsTable.employeeId,
    hours: timesheetsTable.hours, costAmount: timesheetsTable.costAmount, status: timesheetsTable.status,
  }).from(timesheetsTable)
    .leftJoin(projectsTable, eq(projectsTable.id, timesheetsTable.projectId))
    .where(conditions.length > 0 ? and(...conditions) : undefined);
  const projects = summarizeLabor(rows.map(r => ({ ...r, hours: Number(r.hours), costAmount: Number(r.costAmount) })));
  res.json({
    projects,
    totals: {
      approvedHours: Math.round(projects.reduce((s, p) => s + p.approvedHours, 0) * 100) / 100,
      approvedCost: Math.round(projects.reduce((s, p) => s + p.approvedCost, 0) * 100) / 100,
      pendingHours: Math.round(projects.reduce((s, p) => s + p.pendingHours, 0) * 100) / 100,
    },
  });
});

router.post("/timesheets", async (req, res): Promise<void> => {
  const body = req.body || {};
  const scope = sessionEmployeeScope(req);
  // 員工自助帳號只能填自己的工時；主管與人資可以替別人填
  const employeeId = scope.isEmployee ? scope.employeeId : (parseId(body.employeeId) ?? parseId(req.session?.user?.employeeId));
  if (!employeeId) { res.status(400).json({ error: scope.isEmployee ? "帳號尚未綁定員工，請聯絡管理員" : "請選擇員工" }); return; }
  if (!scope.isEmployee && !isApprover(req) && employeeId !== parseId(req.session?.user?.employeeId)) {
    res.status(403).json({ error: "只能填自己的工時" }); return;
  }
  const projectId = parseId(body.projectId);
  if (!projectId) { res.status(400).json({ error: "請選擇專案：工時要歸到專案才算得出人工成本" }); return; }
  const taskId = body.taskId ? parseId(body.taskId) : null;
  const workOrderId = body.workOrderId ? parseId(body.workOrderId) : null;
  const hours = Number(body.hours);
  try {
    const created = await db.transaction(async (tx) => {
      const [employee] = await tx.select().from(employeesTable).where(eq(employeesTable.id, employeeId)).for("update");
      if (!employee) throw new Error("找不到這位員工");
      const [project] = await tx.select({ id: projectsTable.id }).from(projectsTable).where(eq(projectsTable.id, projectId));
      if (!project) throw new Error("找不到這個專案");
      if (taskId) {
        const [task] = await tx.select({ id: tasksTable.id }).from(tasksTable).where(eq(tasksTable.id, taskId));
        if (!task) throw new Error("找不到這個任務");
      }
      if (workOrderId) {
        const [wo] = await tx.select({ status: workOrdersTable.status }).from(workOrdersTable).where(eq(workOrdersTable.id, workOrderId));
        if (!wo) throw new Error("找不到這張工單");
        if (["Completed", "Cancelled"].includes(wo.status)) throw new Error("這張工單已經結案，不能再填工時");
      }
      const [sameDay] = await tx.select({ total: sql<string>`COALESCE(SUM(${timesheetsTable.hours}), 0)` }).from(timesheetsTable)
        .where(and(eq(timesheetsTable.employeeId, employeeId), eq(timesheetsTable.workDate, String(body.workDate)), ne(timesheetsTable.status, "Rejected")));
      const problem = timesheetProblem({ hours, workDate: body.workDate, today: todayTaipei(), hoursAlreadyThatDay: Number(sameDay?.total) || 0 });
      if (problem) throw new Error(problem);
      const [settings] = await tx.select({ monthlyDivisor: payrollSettingsTable.monthlyDivisor }).from(payrollSettingsTable).orderBy(payrollSettingsTable.id).limit(1);
      const hourlyCost = hourlyCostOf(employee.salary, settings?.monthlyDivisor);
      const approver = isApprover(req);
      const [row] = await tx.insert(timesheetsTable).values({
        employeeId, workDate: body.workDate, projectId, taskId, workOrderId,
        hours: String(hours), hourlyCost: String(hourlyCost), costAmount: String(Math.round(hours * hourlyCost * 100) / 100),
        description: typeof body.description === "string" ? body.description.trim().slice(0, 300) || null : null,
        // 主管自己登錄的直接算核准，不用再核一次
        status: approver ? "Approved" : "Submitted",
        approvedBy: approver ? (req.session?.user?.username || "api") : null,
        createdBy: req.session?.user?.username || "api",
      }).returning();
      return row;
    });
    res.status(201).json(shape(created, isApprover(req)));
  } catch (err: any) {
    res.status(400).json({ error: err?.message || "登錄失敗" });
  }
});

/** 核准或退回（可一次多筆）。已經計入成品成本的工時不能再改。 */
router.post("/timesheets/review", requireRole(...APPROVER_ROLES), async (req, res): Promise<void> => {
  const ids: number[] = Array.isArray(req.body?.ids) ? req.body.ids.map(Number).filter((n: number) => Number.isInteger(n) && n > 0) : [];
  const decision = req.body?.decision === "reject" ? "Rejected" : req.body?.decision === "approve" ? "Approved" : null;
  if (ids.length === 0 || !decision) { res.status(400).json({ error: "請選擇要核准或退回的工時" }); return; }
  const updated = await db.update(timesheetsTable)
    .set({ status: decision, approvedBy: req.session?.user?.username || "api" })
    .where(and(inArray(timesheetsTable.id, ids), eq(timesheetsTable.costApplied, false), ne(timesheetsTable.status, decision)))
    .returning({ id: timesheetsTable.id });
  res.json({ decision, count: updated.length, skipped: ids.length - updated.length });
});

router.delete("/timesheets/:id", async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  if (!id) { res.status(400).json({ error: "格式不正確" }); return; }
  const [row] = await db.select().from(timesheetsTable).where(eq(timesheetsTable.id, id));
  if (!row) { res.status(404).json({ error: "找不到這筆工時" }); return; }
  const scope = sessionEmployeeScope(req);
  const ownId = scope.isEmployee ? scope.employeeId : parseId(req.session?.user?.employeeId);
  if (!isApprover(req)) {
    if (row.employeeId !== ownId) { res.status(403).json({ error: "只能刪除自己的工時" }); return; }
    if (row.status === "Approved") { res.status(400).json({ error: "已核准的工時不能自己刪除，請找主管退回" }); return; }
  }
  if (row.costApplied) { res.status(400).json({ error: "這筆工時已經計入成品成本，不能刪除" }); return; }
  await db.delete(timesheetsTable).where(eq(timesheetsTable.id, id));
  res.status(204).end();
});

export default router;
