import { Router, type IRouter } from "express";
import { eq, and, sql } from "drizzle-orm";
import { db, tasksTable, projectsTable, employeesTable } from "@workspace/erp-db";
import { requireAuth } from "../middleware/require-auth";
import {
  ListTasksQueryParams, CreateTaskBody,
  UpdateTaskParams, UpdateTaskBody, DeleteTaskParams,
} from "@workspace/erp-api-zod";

const router: IRouter = Router();

// 產生的驗證格式沒有「組別」，也不接受把專案／負責人／到期日清空，這裡補上
function extraTaskFields(body: any): Record<string, any> {
  const out: Record<string, any> = {};
  if (!body || typeof body !== "object") return out;
  if ("taskGroup" in body) out.taskGroup = typeof body.taskGroup === "string" && body.taskGroup.trim() ? body.taskGroup.trim().slice(0, 80) : null;
  for (const key of ["projectId", "assignedTo", "dueDate"]) if (body[key] === null) out[key] = null;
  return out;
}
function withoutNulls(body: any): any {
  if (!body || typeof body !== "object") return body;
  return Object.fromEntries(Object.entries(body).filter(([, v]) => v !== null));
}
router.use("/tasks", requireAuth);

router.get("/tasks", async (req, res): Promise<void> => {
  const query = ListTasksQueryParams.safeParse(req.query);
  const conditions = [];
  if (query.success && query.data.projectId) conditions.push(eq(tasksTable.projectId, query.data.projectId));
  if (query.success && query.data.status) conditions.push(eq(tasksTable.status, query.data.status));
  if (query.success && query.data.assignedTo) conditions.push(eq(tasksTable.assignedTo, query.data.assignedTo));

  const tasks = await db
    .select({
      id: tasksTable.id, title: tasksTable.title, description: tasksTable.description,
      projectId: tasksTable.projectId, projectName: projectsTable.name,
      assignedTo: tasksTable.assignedTo,
      assigneeName: sql<string>`CASE WHEN ${employeesTable.id} IS NOT NULL THEN ${employeesTable.firstName} || ${employeesTable.lastName} ELSE NULL END`,
      status: tasksTable.status, priority: tasksTable.priority,
      dueDate: tasksTable.dueDate, taskGroup: tasksTable.taskGroup, createdAt: tasksTable.createdAt,
    })
    .from(tasksTable)
    .leftJoin(projectsTable, eq(tasksTable.projectId, projectsTable.id))
    .leftJoin(employeesTable, eq(tasksTable.assignedTo, employeesTable.id))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(tasksTable.createdAt);

  res.json(tasks);
});

router.post("/tasks", async (req, res): Promise<void> => {
  const parsed = CreateTaskBody.safeParse(withoutNulls(req.body));
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const status = typeof req.body.status === "string" && req.body.status.trim() ? req.body.status.trim() : undefined;
  const [task] = await db.insert(tasksTable).values({ ...parsed.data, ...extraTaskFields(req.body), ...(status ? { status } : {}) }).returning();
  res.status(201).json({ ...task, projectName: null, assigneeName: null });
});

router.patch("/tasks/:id", async (req, res): Promise<void> => {
  const params = UpdateTaskParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const parsed = UpdateTaskBody.safeParse(withoutNulls(req.body));
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const [task] = await db.update(tasksTable).set({ ...parsed.data, ...extraTaskFields(req.body) }).where(eq(tasksTable.id, params.data.id)).returning();
  if (!task) { res.status(404).json({ error: "Task not found" }); return; }
  res.json({ ...task, projectName: null, assigneeName: null });
});

router.delete("/tasks/:id", async (req, res): Promise<void> => {
  const params = DeleteTaskParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const [task] = await db.delete(tasksTable).where(eq(tasksTable.id, params.data.id)).returning();
  if (!task) { res.status(404).json({ error: "Task not found" }); return; }
  res.sendStatus(204);
});

export default router;
