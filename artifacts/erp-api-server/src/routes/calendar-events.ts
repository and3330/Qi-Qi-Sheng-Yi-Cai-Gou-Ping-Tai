import { Router, type IRouter } from "express";
import { eq, and, desc, gte, lte, sql } from "drizzle-orm";
import { db, calendarEventsTable, tasksTable, leavesTable, contractsTable, assetMaintenanceTable, employeesTable } from "@workspace/erp-db";
import { requireAuth } from "../middleware/require-auth";

const HOLIDAY_ROLES = ["owner", "admin", "hr_admin"];
function canManageHolidays(req: any): boolean {
  if (req.apiKeyAuth) return req.apiKey?.permissions === "admin";
  const role = req.session?.user?.role;
  return role === "super_admin" || HOLIDAY_ROLES.includes(role);
}
const HOLIDAY_DENIED = "假日會影響出勤、請假天數與薪資，只有人資或管理員可以設定";
const EVENT_FIELDS = ["title", "description", "eventType", "startDate", "endDate", "startTime", "endTime", "allDay", "location", "module", "documentType", "documentId", "color", "assignedTo", "reminder", "status"] as const;
const isDate = (v: unknown) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v);

const router: IRouter = Router();
router.use("/calendar-events", requireAuth);

router.get("/calendar-events", async (req, res): Promise<void> => {
  const conditions: any[] = [];
  if (req.query.eventType) conditions.push(eq(calendarEventsTable.eventType, req.query.eventType as string));
  if (req.query.status) conditions.push(eq(calendarEventsTable.status, req.query.status as string));
  if (req.query.startDate && req.query.endDate) {
    conditions.push(lte(calendarEventsTable.startDate, req.query.endDate as string));
    conditions.push(sql`COALESCE(${calendarEventsTable.endDate}, ${calendarEventsTable.startDate}) >= ${req.query.startDate as string}`);
  } else if (req.query.startDate) {
    conditions.push(gte(calendarEventsTable.startDate, req.query.startDate as string));
  } else if (req.query.endDate) {
    conditions.push(lte(calendarEventsTable.startDate, req.query.endDate as string));
  }
  if (req.query.module) conditions.push(eq(calendarEventsTable.module, req.query.module as string));

  const rows = await db.select().from(calendarEventsTable).where(conditions.length > 0 ? and(...conditions) : undefined).orderBy(calendarEventsTable.startDate);
  res.json(rows);
});

router.post("/calendar-events", async (req, res): Promise<void> => {
  const { title, description, eventType, startDate, endDate, startTime, endTime, allDay, location, module, documentType, documentId, color, assignedTo, reminder } = req.body;
  if (!title || !startDate) { res.status(400).json({ error: "請填寫標題與開始日期" }); return; }
  if (!isDate(startDate) || (endDate && !isDate(endDate))) { res.status(400).json({ error: "日期格式不正確" }); return; }
  if (endDate && String(endDate).slice(0, 10) < String(startDate).slice(0, 10)) { res.status(400).json({ error: "結束日期不可早於開始日期" }); return; }
  if (eventType === "Holiday" && !canManageHolidays(req)) { res.status(403).json({ error: HOLIDAY_DENIED }); return; }
  const [row] = await db.insert(calendarEventsTable).values({ title, description, eventType, startDate, endDate: endDate || startDate, startTime, endTime, allDay, location, module, documentType, documentId, color, assignedTo, reminder }).returning();
  res.status(201).json(row);
});

router.get("/calendar-events/aggregated", async (req, res): Promise<void> => {
  const startDate = req.query.startDate as string || "2000-01-01";
  const endDate = req.query.endDate as string || "2099-12-31";

  const aggregated: any[] = [];

  try {
    const tasks = await db.select({ id: tasksTable.id, title: tasksTable.title, dueDate: tasksTable.dueDate, status: tasksTable.status }).from(tasksTable).where(and(gte(tasksTable.dueDate, startDate), lte(tasksTable.dueDate, endDate)));
    for (const t of tasks) {
      if (t.dueDate) aggregated.push({ id: `task-${t.id}`, title: `[任務] ${t.title}`, startDate: t.dueDate, endDate: t.dueDate, eventType: "Task", color: "#f59e0b", module: "Projects", source: "tasks" });
    }
  } catch {}

  try {
    const leaves = await db.select({ id: leavesTable.id, fromDate: leavesTable.fromDate, toDate: leavesTable.toDate, employeeId: leavesTable.employeeId, leaveType: leavesTable.leaveType, employeeName: sql<string>`(SELECT first_name || ' ' || last_name FROM employees WHERE id = leaves.employee_id)` }).from(leavesTable).where(and(lte(leavesTable.fromDate, endDate), gte(leavesTable.toDate, startDate), eq(leavesTable.status, "Approved")));
    for (const l of leaves) {
      aggregated.push({ id: `leave-${l.id}`, title: `[請假] ${l.employeeName} - ${l.leaveType}`, startDate: l.fromDate, endDate: l.toDate, eventType: "Holiday", color: "#ef4444", module: "HR", source: "leaves" });
    }
  } catch {}

  try {
    const contracts = await db.select({ id: contractsTable.id, title: contractsTable.title, endDate: contractsTable.endDate, renewalDate: contractsTable.renewalDate }).from(contractsTable).where(and(eq(contractsTable.status, "Active")));
    for (const c of contracts) {
      if (c.endDate && c.endDate >= startDate && c.endDate <= endDate) {
        aggregated.push({ id: `contract-${c.id}`, title: `[合約到期] ${c.title}`, startDate: c.endDate, endDate: c.endDate, eventType: "Deadline", color: "#ef4444", module: "Contracts", source: "contracts" });
      }
      if (c.renewalDate && c.renewalDate >= startDate && c.renewalDate <= endDate) {
        aggregated.push({ id: `contract-renew-${c.id}`, title: `[合約續約] ${c.title}`, startDate: c.renewalDate, endDate: c.renewalDate, eventType: "Reminder", color: "#8b5cf6", module: "Contracts", source: "contracts" });
      }
    }
  } catch {}

  try {
    const maintenance = await db.select({ id: assetMaintenanceTable.id, description: assetMaintenanceTable.description, scheduledDate: assetMaintenanceTable.scheduledDate, status: assetMaintenanceTable.status }).from(assetMaintenanceTable).where(and(gte(assetMaintenanceTable.scheduledDate, startDate), lte(assetMaintenanceTable.scheduledDate, endDate)));
    for (const m of maintenance) {
      if (m.scheduledDate) aggregated.push({ id: `maint-${m.id}`, title: `[資產維護] ${m.description || "維護排程"}`, startDate: m.scheduledDate, endDate: m.scheduledDate, eventType: "Reminder", color: "#06b6d4", module: "Assets", source: "maintenance" });
    }
  } catch {}

  res.json(aggregated);
});

router.get("/calendar-events/:id", async (req, res): Promise<void> => {
  const [row] = await db.select().from(calendarEventsTable).where(eq(calendarEventsTable.id, Number(req.params.id)));
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  res.json(row);
});

router.patch("/calendar-events/:id", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) { res.status(400).json({ error: "格式不正確" }); return; }
  const [existing] = await db.select().from(calendarEventsTable).where(eq(calendarEventsTable.id, id));
  if (!existing) { res.status(404).json({ error: "Not found" }); return; }
  if ((existing.eventType === "Holiday" || req.body?.eventType === "Holiday") && !canManageHolidays(req)) { res.status(403).json({ error: HOLIDAY_DENIED }); return; }
  // 只更新允許的欄位，不直接把整包送來的資料寫進資料庫
  const updates: Record<string, unknown> = {};
  for (const field of EVENT_FIELDS) if (req.body?.[field] !== undefined) updates[field] = req.body[field];
  if (Object.keys(updates).length === 0) { res.status(400).json({ error: "沒有要更新的內容" }); return; }
  const [row] = await db.update(calendarEventsTable).set(updates).where(eq(calendarEventsTable.id, id)).returning();
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  res.json(row);
});

router.delete("/calendar-events/:id", async (req, res): Promise<void> => {
  const [target] = await db.select({ eventType: calendarEventsTable.eventType }).from(calendarEventsTable).where(eq(calendarEventsTable.id, Number(req.params.id)));
  if (target?.eventType === "Holiday" && !canManageHolidays(req)) { res.status(403).json({ error: HOLIDAY_DENIED }); return; }
  const [row] = await db.delete(calendarEventsTable).where(eq(calendarEventsTable.id, Number(req.params.id))).returning();
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  res.sendStatus(204);
});

export default router;
