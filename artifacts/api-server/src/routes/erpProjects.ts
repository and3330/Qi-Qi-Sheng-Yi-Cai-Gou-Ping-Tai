import { Router, type IRouter } from "express";
import { and, asc, desc, eq, isNotNull, sql } from "drizzle-orm";
import {
  db, erpJobCardsTable, erpProjectsTable, erpProjectTasksTable, membersTable,
} from "@workspace/db";
import { effectiveErpRole, requireErpMenu } from "../middlewares/requireErp";
import { createErpNotification } from "../lib/erpNotifications";

const router: IRouter = Router();
const num = (value: string | string[]) => Number(Array.isArray(value) ? value[0] : value);
const clean = (body: any, fields: string[]) =>
  Object.fromEntries(fields.filter((field) => body[field] !== undefined).map((field) => [field, body[field]]));
const unique = (err: unknown) => (err as { cause?: { code?: string } })?.cause?.code === "23505";
const date = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei" }).format(new Date()).replaceAll("-", "");
const PROJECT_STATUSES = ["planning", "active", "on_hold", "completed", "cancelled"];
const TASK_STATUSES = ["todo", "in_progress", "review", "done", "cancelled"];
const PRIORITIES = ["low", "medium", "high", "urgent"];
const projectFields = ["name", "customerId", "managerId", "startDate", "endDate", "budget", "description"];
const taskFields = ["projectId", "title", "description", "assigneeId", "priority", "dueDate", "sortOrder", "estimatedHours"];
const cardFields = ["taskId", "projectId", "workDate", "hours", "description"];
const isManager = (req: any) => ["super_admin", "admin", "manager"].includes(effectiveErpRole(req.member) || "");

async function createProject(values: Record<string, unknown>) {
  const prefix = `PJ-${date()}`;
  for (let attempt = 0; attempt < 5; attempt++) {
    const result = await db.execute(sql`SELECT COUNT(*)::int n FROM ${erpProjectsTable} WHERE ${erpProjectsTable.projectNo} LIKE ${prefix + "-%"}`);
    const projectNo = `${prefix}-${String(Number((result.rows ?? result)[0]?.n || 0) + 1 + attempt).padStart(4, "0")}`;
    try {
      const [row] = await db.insert(erpProjectsTable).values({ ...values, projectNo } as any).returning();
      return row;
    } catch (err) {
      if (!unique(err) || attempt === 4) throw err;
    }
  }
  throw new Error("PROJECT_NUMBER_RETRY_EXHAUSTED");
}

router.get("/erp/projects/members", requireErpMenu("/projects/list"), async (_req, res) => {
  res.json(await db.select({ id: membersTable.id, name: membersTable.name, username: membersTable.username })
    .from(membersTable).where(isNotNull(membersTable.erpRole)).orderBy(membersTable.name));
});

router.get("/erp/projects", requireErpMenu("/projects/list"), async (_req, res) => {
  res.json(await db.select().from(erpProjectsTable).orderBy(desc(erpProjectsTable.createdAt)));
});
router.post("/erp/projects", requireErpMenu("/projects/list"), async (req, res) => {
  if (!req.body.name?.trim() || (req.body.budget != null && (!Number.isInteger(req.body.budget) || req.body.budget < 0)))
    return void res.status(400).json({ error: "專案名稱必填，預算須為非負整數" });
  try { res.status(201).json(await createProject(clean(req.body, projectFields))); }
  catch (err) { req.log.error({ err }, "create project failed"); res.status(409).json({ error: "專案編號產生失敗，請重試" }); }
});
router.get("/erp/projects/:id", requireErpMenu("/projects/list"), async (req, res) => {
  const projectId = num(req.params.id);
  const [project] = await db.select().from(erpProjectsTable).where(eq(erpProjectsTable.id, projectId)).limit(1);
  if (!project) return void res.status(404).json({ error: "找不到專案" });
  const tasks = await db.select().from(erpProjectTasksTable).where(eq(erpProjectTasksTable.projectId, projectId))
    .orderBy(asc(erpProjectTasksTable.sortOrder), asc(erpProjectTasksTable.id));
  const [hours] = await db.select({ total: sql<number>`coalesce(sum(${erpJobCardsTable.hours}), 0)::float` })
    .from(erpJobCardsTable).where(eq(erpJobCardsTable.projectId, projectId));
  const taskStats = Object.fromEntries(TASK_STATUSES.map((status) => [status, tasks.filter((task) => task.status === status).length]));
  res.json({ ...project, tasks, taskStats, totalHours: Number(hours?.total || 0) });
});
router.patch("/erp/projects/:id", requireErpMenu("/projects/list"), async (req, res) => {
  if (req.body.budget != null && (!Number.isInteger(req.body.budget) || req.body.budget < 0))
    return void res.status(400).json({ error: "預算須為非負整數" });
  const [row] = await db.update(erpProjectsTable).set(clean(req.body, projectFields))
    .where(eq(erpProjectsTable.id, num(req.params.id))).returning();
  if (!row) return void res.status(404).json({ error: "找不到專案" });
  res.json(row);
});
router.patch("/erp/projects/:id/status", requireErpMenu("/projects/list"), async (req, res) => {
  if (!PROJECT_STATUSES.includes(req.body.status)) return void res.status(400).json({ error: "狀態錯誤" });
  const projectId = num(req.params.id);
  const [before] = await db.select().from(erpProjectsTable).where(eq(erpProjectsTable.id, projectId)).limit(1);
  if (!before) return void res.status(404).json({ error: "找不到專案" });
  const [row] = await db.update(erpProjectsTable).set({ status: req.body.status })
    .where(and(eq(erpProjectsTable.id, projectId), eq(erpProjectsTable.status, before.status))).returning();
  if (!row) return void res.status(409).json({ error: "專案狀態已變更，請重新整理" });
  res.json(row);
});
router.delete("/erp/projects/:id", requireErpMenu("/projects/list"), async (req, res) => {
  const [row] = await db.delete(erpProjectsTable).where(eq(erpProjectsTable.id, num(req.params.id))).returning({ id: erpProjectsTable.id });
  if (!row) return void res.status(404).json({ error: "找不到專案" });
  res.status(204).end();
});

router.get("/erp/project-tasks", requireErpMenu("/projects/tasks"), async (req, res) => {
  const mine = String(req.query.mine || "") === "true";
  const projectId = req.query.projectId ? Number(req.query.projectId) : 0;
  const where = and(mine ? eq(erpProjectTasksTable.assigneeId, req.member!.id) : undefined,
    projectId ? eq(erpProjectTasksTable.projectId, projectId) : undefined);
  res.json(await db.select({
    id: erpProjectTasksTable.id, projectId: erpProjectTasksTable.projectId, projectName: erpProjectsTable.name,
    title: erpProjectTasksTable.title, description: erpProjectTasksTable.description, assigneeId: erpProjectTasksTable.assigneeId,
    status: erpProjectTasksTable.status, priority: erpProjectTasksTable.priority, dueDate: erpProjectTasksTable.dueDate,
    sortOrder: erpProjectTasksTable.sortOrder, estimatedHours: erpProjectTasksTable.estimatedHours,
    createdAt: erpProjectTasksTable.createdAt, completedAt: erpProjectTasksTable.completedAt,
  }).from(erpProjectTasksTable).innerJoin(erpProjectsTable, eq(erpProjectTasksTable.projectId, erpProjectsTable.id))
    .where(where).orderBy(asc(erpProjectTasksTable.sortOrder), desc(erpProjectTasksTable.createdAt)));
});
router.post("/erp/project-tasks", requireErpMenu("/projects/list"), async (req, res) => {
  if (!req.body.title?.trim() || !Number(req.body.projectId) || (req.body.priority && !PRIORITIES.includes(req.body.priority)))
    return void res.status(400).json({ error: "任務資料格式錯誤" });
  const [row] = await db.insert(erpProjectTasksTable).values(clean(req.body, taskFields) as any).returning();
  if (row.assigneeId) void createErpNotification({
    memberId: row.assigneeId, type: "task_assigned", title: `新任務：${row.title}`,
    linkPath: "/projects/tasks",
  }).catch((err) => req.log.warn({ err }, "task notification failed"));
  res.status(201).json(row);
});
router.patch("/erp/project-tasks/:id", requireErpMenu("/projects/list"), async (req, res) => {
  if (req.body.priority && !PRIORITIES.includes(req.body.priority)) return void res.status(400).json({ error: "優先度錯誤" });
  const [row] = await db.update(erpProjectTasksTable).set(clean(req.body, taskFields))
    .where(eq(erpProjectTasksTable.id, num(req.params.id))).returning();
  if (!row) return void res.status(404).json({ error: "找不到任務" });
  if (row.assigneeId && req.body.assigneeId !== undefined) void createErpNotification({
    memberId: row.assigneeId, type: "task_assigned", title: `任務已指派：${row.title}`,
    linkPath: "/projects/tasks",
  }).catch((err) => req.log.warn({ err }, "task notification failed"));
  res.json(row);
});
router.patch("/erp/project-tasks/:id/status", requireErpMenu("/projects/tasks"), async (req, res) => {
  if (!TASK_STATUSES.includes(req.body.status)) return void res.status(400).json({ error: "狀態錯誤" });
  const taskId = num(req.params.id);
  const [before] = await db.select().from(erpProjectTasksTable).where(eq(erpProjectTasksTable.id, taskId)).limit(1);
  if (!before) return void res.status(404).json({ error: "找不到任務" });
  if (!isManager(req) && before.assigneeId !== req.member!.id) return void res.status(403).json({ error: "只能更新自己的任務" });
  const [row] = await db.update(erpProjectTasksTable)
    .set({ status: req.body.status, completedAt: req.body.status === "done" ? new Date() : null })
    .where(and(eq(erpProjectTasksTable.id, taskId), eq(erpProjectTasksTable.status, before.status))).returning();
  if (!row) return void res.status(409).json({ error: "任務狀態已變更，請重新整理" });
  res.json(row);
});
router.delete("/erp/project-tasks/:id", requireErpMenu("/projects/list"), async (req, res) => {
  const [row] = await db.delete(erpProjectTasksTable).where(eq(erpProjectTasksTable.id, num(req.params.id))).returning({ id: erpProjectTasksTable.id });
  if (!row) return void res.status(404).json({ error: "找不到任務" });
  res.status(204).end();
});

router.get("/erp/job-cards", requireErpMenu("/projects/timesheets"), async (req, res) => {
  const memberId = isManager(req) ? (req.query.memberId ? Number(req.query.memberId) : 0) : req.member!.id;
  res.json(await db.select({
    id: erpJobCardsTable.id, taskId: erpJobCardsTable.taskId, projectId: erpJobCardsTable.projectId,
    projectName: erpProjectsTable.name, memberId: erpJobCardsTable.memberId, memberName: membersTable.name,
    workDate: erpJobCardsTable.workDate, hours: erpJobCardsTable.hours, description: erpJobCardsTable.description,
    createdAt: erpJobCardsTable.createdAt,
  }).from(erpJobCardsTable).innerJoin(erpProjectsTable, eq(erpJobCardsTable.projectId, erpProjectsTable.id))
    .innerJoin(membersTable, eq(erpJobCardsTable.memberId, membersTable.id))
    .where(memberId ? eq(erpJobCardsTable.memberId, memberId) : undefined).orderBy(desc(erpJobCardsTable.workDate), desc(erpJobCardsTable.id)));
});
router.post("/erp/job-cards", requireErpMenu("/projects/timesheets"), async (req, res) => {
  if (!Number(req.body.projectId) || !req.body.workDate || !(Number(req.body.hours) > 0))
    return void res.status(400).json({ error: "專案、日期及正數工時為必填" });
  const [row] = await db.insert(erpJobCardsTable).values({ ...clean(req.body, cardFields), memberId: req.member!.id } as any).returning();
  res.status(201).json(row);
});
router.patch("/erp/job-cards/:id", requireErpMenu("/projects/timesheets"), async (req, res) => {
  if (req.body.hours !== undefined && !(Number(req.body.hours) > 0)) return void res.status(400).json({ error: "工時須大於零" });
  const cardId = num(req.params.id);
  const [before] = await db.select().from(erpJobCardsTable).where(eq(erpJobCardsTable.id, cardId)).limit(1);
  if (!before) return void res.status(404).json({ error: "找不到工時" });
  if (!isManager(req) && before.memberId !== req.member!.id) return void res.status(403).json({ error: "只能修改自己的工時" });
  const [row] = await db.update(erpJobCardsTable).set(clean(req.body, cardFields)).where(eq(erpJobCardsTable.id, cardId)).returning();
  res.json(row);
});
router.delete("/erp/job-cards/:id", requireErpMenu("/projects/timesheets"), async (req, res) => {
  const cardId = num(req.params.id);
  const [before] = await db.select().from(erpJobCardsTable).where(eq(erpJobCardsTable.id, cardId)).limit(1);
  if (!before) return void res.status(404).json({ error: "找不到工時" });
  if (!isManager(req) && before.memberId !== req.member!.id) return void res.status(403).json({ error: "只能刪除自己的工時" });
  await db.delete(erpJobCardsTable).where(eq(erpJobCardsTable.id, cardId));
  res.status(204).end();
});

export default router;