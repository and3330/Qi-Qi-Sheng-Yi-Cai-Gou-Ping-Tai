import { Router, type IRouter } from "express";
import { and, eq, inArray, ne, sql } from "drizzle-orm";
import { db, projectsTable, tasksTable, activitiesTable, journalEntriesTable, vouchersTable, departmentsTable } from "@workspace/erp-db";
import { requireAuth, requireRole } from "../middleware/require-auth";
import { getDimensionPnl } from "../lib/dimension-pnl";
import {
  ListProjectsQueryParams, CreateProjectBody, GetProjectParams,
  UpdateProjectParams, UpdateProjectBody, DeleteProjectParams,
  GetProjectFinancialsParams,
} from "@workspace/erp-api-zod";

const router: IRouter = Router();
router.use("/projects", requireAuth);

/**
 * 主專案的檢查。只有兩層：主專案底下是子專案，子專案底下不能再掛。
 * 回傳 { parentId }（null＝獨立專案或主專案）或 { error }。沒傳 parentId 回傳 {}（不動）。
 */
async function readParent(body: any, selfId?: number): Promise<{ parentId?: number | null; error?: string }> {
  if (!Object.prototype.hasOwnProperty.call(body ?? {}, "parentId")) return {};
  if (body.parentId === null || body.parentId === "" || body.parentId === undefined) return { parentId: null };
  const parentId = Number(body.parentId);
  if (!Number.isInteger(parentId) || parentId <= 0) return { error: "主專案格式不正確" };
  if (selfId !== undefined && parentId === selfId) return { error: "主專案不能選自己" };
  const [parent] = await db.select({ id: projectsTable.id, name: projectsTable.name, parentId: projectsTable.parentId }).from(projectsTable).where(eq(projectsTable.id, parentId));
  if (!parent) return { error: "主專案不存在" };
  if (parent.parentId) return { error: `「${parent.name}」本身是子專案，不能再當主專案（專案只分主、子兩層）` };
  if (selfId !== undefined) {
    const [child] = await db.select({ id: projectsTable.id }).from(projectsTable).where(eq(projectsTable.parentId, selfId)).limit(1);
    if (child) return { error: "這個專案底下已經有子專案，不能再掛到別的主專案底下" };
  }
  return { parentId };
}

router.get("/projects", async (req, res): Promise<void> => {
  const query = ListProjectsQueryParams.safeParse(req.query);
  const condition = query.success && query.data.status ? eq(projectsTable.status, query.data.status) : undefined;

  const projects = await db
    .select({
      id: projectsTable.id, name: projectsTable.name, description: projectsTable.description,
      status: projectsTable.status, priority: projectsTable.priority,
      startDate: projectsTable.startDate, endDate: projectsTable.endDate,
      progress: projectsTable.progress, isActive: projectsTable.isActive, createdAt: projectsTable.createdAt,
      departmentId: projectsTable.departmentId,
      parentId: projectsTable.parentId,
      departmentName: departmentsTable.name,
      totalTasks: sql<number>`(SELECT COUNT(*) FROM tasks WHERE project_id = ${projectsTable.id})::int`,
      completedTasks: sql<number>`(SELECT COUNT(*) FROM tasks WHERE project_id = ${projectsTable.id} AND status = 'Completed')::int`,
    })
    .from(projectsTable)
    .leftJoin(departmentsTable, eq(projectsTable.departmentId, departmentsTable.id))
    .where(condition)
    .orderBy(projectsTable.createdAt);

  res.json(projects.map(p => ({ ...p, progress: Number(p.progress) })));
});

router.post("/projects", async (req, res): Promise<void> => {
  const parsed = CreateProjectBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const departmentId = req.body.departmentId == null || req.body.departmentId === "" ? null : Number(req.body.departmentId);
  if (departmentId !== null && (!Number.isInteger(departmentId) || departmentId <= 0)) {
    res.status(400).json({ error: "所屬部門格式不正確" }); return;
  }
  const status = typeof req.body.status === "string" && req.body.status.trim() ? req.body.status.trim() : undefined;
  const progressRaw = req.body.progress;
  let progress: string | undefined;
  if (progressRaw !== undefined && progressRaw !== null && progressRaw !== "") {
    const n = Number(progressRaw);
    if (!Number.isFinite(n) || n < 0 || n > 100) { res.status(400).json({ error: "進度必須介於 0 到 100" }); return; }
    progress = String(n);
  }
  const parent = await readParent(req.body);
  if (parent.error) { res.status(400).json({ error: parent.error }); return; }
  const [proj] = await db.insert(projectsTable).values({
    ...parsed.data, departmentId,
    ...(parent.parentId !== undefined ? { parentId: parent.parentId } : {}),
    ...(status ? { status } : {}),
    ...(progress !== undefined ? { progress } : {}),
  }).returning();
  await db.insert(activitiesTable).values({ type: "create", title: "New Project", description: `${parsed.data.name} created`, module: "Projects" });
  res.status(201).json({ ...proj, progress: Number(proj.progress), totalTasks: 0, completedTasks: 0 });
});

router.get("/projects/:id", async (req, res): Promise<void> => {
  const params = GetProjectParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const [proj] = await db
    .select({
      id: projectsTable.id, name: projectsTable.name, description: projectsTable.description,
      status: projectsTable.status, priority: projectsTable.priority,
      startDate: projectsTable.startDate, endDate: projectsTable.endDate,
      progress: projectsTable.progress, isActive: projectsTable.isActive, createdAt: projectsTable.createdAt,
      departmentId: projectsTable.departmentId,
      departmentName: departmentsTable.name,
      totalTasks: sql<number>`(SELECT COUNT(*) FROM tasks WHERE project_id = ${projectsTable.id})::int`,
      completedTasks: sql<number>`(SELECT COUNT(*) FROM tasks WHERE project_id = ${projectsTable.id} AND status = 'Completed')::int`,
    })
    .from(projectsTable)
    .leftJoin(departmentsTable, eq(projectsTable.departmentId, departmentsTable.id))
    .where(eq(projectsTable.id, params.data.id));
  if (!proj) { res.status(404).json({ error: "Project not found" }); return; }
  res.json({ ...proj, progress: Number(proj.progress) });
});

router.patch("/projects/:id", async (req, res): Promise<void> => {
  const params = UpdateProjectParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const parsed = UpdateProjectBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const updateData: Record<string, unknown> = { ...parsed.data };
  if (Object.prototype.hasOwnProperty.call(req.body, "departmentId")) {
    const departmentId = req.body.departmentId == null || req.body.departmentId === "" ? null : Number(req.body.departmentId);
    if (departmentId !== null && (!Number.isInteger(departmentId) || departmentId <= 0)) {
      res.status(400).json({ error: "所屬部門格式不正確" }); return;
    }
    updateData.departmentId = departmentId;
  }
  if (parsed.data.progress != null) updateData.progress = String(parsed.data.progress);
  const parent = await readParent(req.body, params.data.id);
  if (parent.error) { res.status(400).json({ error: parent.error }); return; }
  if (parent.parentId !== undefined) updateData.parentId = parent.parentId;
  const [proj] = await db.update(projectsTable).set(updateData).where(eq(projectsTable.id, params.data.id)).returning();
  if (!proj) { res.status(404).json({ error: "Project not found" }); return; }
  res.json({ ...proj, progress: Number(proj.progress), totalTasks: 0, completedTasks: 0 });
});

router.delete("/projects/:id", async (req, res): Promise<void> => {
  const params = DeleteProjectParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const [child] = await db.select({ id: projectsTable.id }).from(projectsTable).where(eq(projectsTable.parentId, params.data.id)).limit(1);
  if (child) { res.status(409).json({ error: "這個專案底下還有子專案，請先把子專案移走或刪除" }); return; }
  const [proj] = await db.delete(projectsTable).where(eq(projectsTable.id, params.data.id)).returning();
  if (!proj) { res.status(404).json({ error: "Project not found" }); return; }
  res.sendStatus(204);
});

router.get("/projects/:id/financials", requireRole("owner", "admin", "finance_admin", "accountant"), async (req, res): Promise<void> => {
  const params = GetProjectFinancialsParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }

  const [project] = await db.select().from(projectsTable).where(eq(projectsTable.id, params.data.id));
  if (!project) { res.status(404).json({ error: "Project not found" }); return; }

  // 主專案看到的是自己加上所有子專案的合計
  const children = await db.select({ id: projectsTable.id, name: projectsTable.name }).from(projectsTable).where(eq(projectsTable.parentId, params.data.id)).orderBy(projectsTable.name);
  const ids = [params.data.id, ...children.map(c => c.id)];

  const entries = await db
    .select()
    .from(journalEntriesTable)
    .where(and(ne(journalEntriesTable.status, "Draft"), inArray(journalEntriesTable.projectId, ids)));

  const vouchers = await db
    .select({
      id: vouchersTable.id,
      voucherNumber: vouchersTable.voucherNumber,
      voucherType: vouchersTable.voucherType,
      voucherDate: vouchersTable.voucherDate,
      description: vouchersTable.description,
      totalAmount: vouchersTable.totalAmount,
      status: vouchersTable.status,
      items: vouchersTable.items,
    })
    .from(vouchersTable)
    .where(inArray(vouchersTable.projectId, ids));

  const breakdown = [];
  let totalIncome = 0, totalExpense = 0;
  for (const id of ids) {
    const pnl = await getDimensionPnl({ projectId: id });
    totalIncome += pnl.totalIncome; totalExpense += pnl.totalExpense;
    breakdown.push({ projectId: id, projectName: id === project.id ? project.name : children.find(c => c.id === id)?.name ?? "", totalIncome: pnl.totalIncome, totalExpense: pnl.totalExpense, netProfit: pnl.totalIncome - pnl.totalExpense });
  }
  // 工時表：已核准的工時與換算的人工成本（薪資已經在費用裡，這裡是看這個專案用了多少人力，不重複計入損益）
  const laborResult: any = await db.execute(sql`SELECT COALESCE(SUM(hours), 0)::float AS hours, COALESCE(SUM(cost_amount), 0)::float AS cost FROM timesheets WHERE project_id IN (${sql.join(ids.map(id => sql`${id}`), sql`, `)}) AND status = 'Approved'`);
  const labor = (laborResult.rows ?? laborResult)[0] || { hours: 0, cost: 0 };

  res.json({
    projectId: project.id,
    projectName: project.name,
    totalIncome,
    totalExpense,
    netProfit: totalIncome - totalExpense,
    laborHours: Number(labor.hours) || 0,
    laborCost: Number(labor.cost) || 0,
    // 有子專案時列出每一個的數字（第一筆是主專案自己）
    children: children.length > 0 ? breakdown : [],
    entries,
    vouchers,
  });
});

export default router;
