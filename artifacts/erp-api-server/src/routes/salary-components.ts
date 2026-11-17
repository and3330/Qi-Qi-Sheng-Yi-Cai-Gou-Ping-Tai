import { Router, type IRouter } from "express";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db, salaryComponentsTable, employeeSalaryComponentsTable, employeesTable } from "@workspace/erp-db";
import { requireAuth, requireRole } from "../middleware/require-auth";
import { assignmentProblem, componentProblem } from "../lib/salary-components";

const router: IRouter = Router();
// 薪資項目牽涉每個人的薪水，只開放給薪資相關角色
router.use("/salary-components", requireAuth, requireRole("owner", "admin", "hr_admin", "finance_admin"));

const parseId = (value: unknown): number | null => {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
};

router.get("/salary-components", async (_req, res): Promise<void> => {
  const [components, counts] = await Promise.all([
    db.select().from(salaryComponentsTable).orderBy(salaryComponentsTable.sortOrder, salaryComponentsTable.id),
    db.select({ componentId: employeeSalaryComponentsTable.componentId, count: sql<number>`count(*)::int` })
      .from(employeeSalaryComponentsTable).groupBy(employeeSalaryComponentsTable.componentId),
  ]);
  const countById = new Map(counts.map(c => [c.componentId, c.count]));
  res.json(components.map(c => ({ ...c, employeeCount: countById.get(c.id) || 0 })));
});

/** 每位在職員工目前的薪資結構 */
router.get("/salary-components/employees", async (_req, res): Promise<void> => {
  const [employees, assignments, components] = await Promise.all([
    db.select({
      id: employeesTable.id, employeeId: employeesTable.employeeId, firstName: employeesTable.firstName,
      lastName: employeesTable.lastName, salary: employeesTable.salary, status: employeesTable.status,
    }).from(employeesTable).where(eq(employeesTable.status, "Active")).orderBy(employeesTable.employeeId),
    db.select().from(employeeSalaryComponentsTable),
    db.select().from(salaryComponentsTable),
  ]);
  const componentById = new Map(components.map(c => [c.id, c]));
  res.json(employees.map(emp => {
    const items = assignments.filter(a => a.employeeId === emp.id).flatMap(a => {
      const component = componentById.get(a.componentId);
      return component ? [{ componentId: a.componentId, name: component.name, kind: component.kind, amount: a.amount, isActive: component.isActive }] : [];
    });
    const active = items.filter(i => i.isActive);
    return {
      id: emp.id, employeeCode: emp.employeeId, name: `${emp.firstName}${emp.lastName}`, baseSalary: Number(emp.salary) || 0,
      items,
      earnings: active.filter(i => i.kind === "earning").reduce((s, i) => s + i.amount, 0),
      deductions: active.filter(i => i.kind === "deduction").reduce((s, i) => s + i.amount, 0),
    };
  }));
});

router.post("/salary-components", async (req, res): Promise<void> => {
  const body = req.body || {};
  const problem = componentProblem(body);
  if (problem) { res.status(400).json({ error: problem }); return; }
  const name = String(body.name).trim();
  const [dup] = await db.select({ id: salaryComponentsTable.id }).from(salaryComponentsTable).where(eq(salaryComponentsTable.name, name));
  if (dup) { res.status(409).json({ error: `已經有「${name}」這個薪資項目` }); return; }
  const [row] = await db.insert(salaryComponentsTable).values({
    name, kind: String(body.kind), defaultAmount: Number(body.defaultAmount ?? 0),
    insurable: body.kind === "deduction" ? false : body.insurable !== false,
    isActive: body.isActive !== false,
    sortOrder: Number.isInteger(Number(body.sortOrder)) ? Number(body.sortOrder) : 0,
    note: typeof body.note === "string" ? body.note.trim().slice(0, 200) || null : null,
  }).returning();
  res.status(201).json(row);
});

router.put("/salary-components/:id", async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  if (!id) { res.status(400).json({ error: "格式不正確" }); return; }
  const [existing] = await db.select().from(salaryComponentsTable).where(eq(salaryComponentsTable.id, id));
  if (!existing) { res.status(404).json({ error: "找不到這個薪資項目" }); return; }
  const body = req.body || {};
  const merged = { name: body.name ?? existing.name, kind: body.kind ?? existing.kind, defaultAmount: body.defaultAmount ?? existing.defaultAmount };
  const problem = componentProblem(merged);
  if (problem) { res.status(400).json({ error: problem }); return; }
  const name = String(merged.name).trim();
  if (name !== existing.name) {
    const [dup] = await db.select({ id: salaryComponentsTable.id }).from(salaryComponentsTable).where(eq(salaryComponentsTable.name, name));
    if (dup) { res.status(409).json({ error: `已經有「${name}」這個薪資項目` }); return; }
  }
  if (merged.kind !== existing.kind) {
    const [used] = await db.select({ id: employeeSalaryComponentsTable.id }).from(employeeSalaryComponentsTable).where(eq(employeeSalaryComponentsTable.componentId, id)).limit(1);
    if (used) { res.status(400).json({ error: "已經有員工使用這個項目，不能把加項改成減項（或反過來）。請另外新增一個項目" }); return; }
  }
  const [row] = await db.update(salaryComponentsTable).set({
    name, kind: String(merged.kind), defaultAmount: Number(merged.defaultAmount),
    insurable: merged.kind === "deduction" ? false : (body.insurable === undefined ? existing.insurable : body.insurable !== false),
    isActive: body.isActive === undefined ? existing.isActive : body.isActive !== false,
    sortOrder: body.sortOrder === undefined || !Number.isInteger(Number(body.sortOrder)) ? existing.sortOrder : Number(body.sortOrder),
    note: body.note === undefined ? existing.note : (typeof body.note === "string" ? body.note.trim().slice(0, 200) || null : null),
  }).where(eq(salaryComponentsTable.id, id)).returning();
  res.json(row);
});

router.delete("/salary-components/:id", async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  if (!id) { res.status(400).json({ error: "格式不正確" }); return; }
  const [used] = await db.select({ count: sql<number>`count(*)::int` }).from(employeeSalaryComponentsTable).where(eq(employeeSalaryComponentsTable.componentId, id));
  if ((used?.count || 0) > 0) { res.status(400).json({ error: `還有 ${used.count} 位員工使用這個項目，不能刪除。可以改成停用` }); return; }
  await db.delete(salaryComponentsTable).where(eq(salaryComponentsTable.id, id));
  res.status(204).end();
});

/** 整份取代一位員工的薪資結構 */
router.put("/salary-components/employees/:employeeId", async (req, res): Promise<void> => {
  const employeeId = parseId(req.params.employeeId);
  if (!employeeId) { res.status(400).json({ error: "格式不正確" }); return; }
  const items = req.body?.items;
  const problem = assignmentProblem(items);
  if (problem) { res.status(400).json({ error: problem }); return; }
  const rows = (items as Array<{ componentId: number; amount: number }>).map(i => ({ componentId: Number(i.componentId), amount: Number(i.amount) }));
  const [employee] = await db.select({ id: employeesTable.id }).from(employeesTable).where(eq(employeesTable.id, employeeId));
  if (!employee) { res.status(404).json({ error: "找不到這位員工" }); return; }
  if (rows.length > 0) {
    const found = await db.select({ id: salaryComponentsTable.id }).from(salaryComponentsTable).where(inArray(salaryComponentsTable.id, rows.map(r => r.componentId)));
    if (found.length !== rows.length) { res.status(400).json({ error: "有薪資項目已經不存在，請重新整理後再試" }); return; }
  }
  await db.transaction(async (tx) => {
    await tx.delete(employeeSalaryComponentsTable).where(eq(employeeSalaryComponentsTable.employeeId, employeeId));
    if (rows.length > 0) await tx.insert(employeeSalaryComponentsTable).values(rows.map(r => ({ employeeId, ...r })));
  });
  res.json({ employeeId, count: rows.length });
});

/** 把一個項目套用到多位員工（沒指定就是全部在職員工）；已經有這個項目的員工會更新金額 */
router.post("/salary-components/:id/assign", async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  if (!id) { res.status(400).json({ error: "格式不正確" }); return; }
  const [component] = await db.select().from(salaryComponentsTable).where(eq(salaryComponentsTable.id, id));
  if (!component) { res.status(404).json({ error: "找不到這個薪資項目" }); return; }
  const amount = req.body?.amount === undefined || req.body.amount === "" ? component.defaultAmount : Number(req.body.amount);
  if (!Number.isInteger(amount) || amount < 0 || amount > 10_000_000) { res.status(400).json({ error: "金額必須是 0 以上的整數" }); return; }
  const wanted: number[] | null = Array.isArray(req.body?.employeeIds) ? req.body.employeeIds.map(Number).filter((n: number) => Number.isInteger(n) && n > 0) : null;
  const employees = await db.select({ id: employeesTable.id }).from(employeesTable)
    .where(wanted ? and(eq(employeesTable.status, "Active"), inArray(employeesTable.id, wanted.length > 0 ? wanted : [0])) : eq(employeesTable.status, "Active"));
  if (employees.length === 0) { res.status(400).json({ error: "沒有可以套用的在職員工" }); return; }
  await db.transaction(async (tx) => {
    const ids = employees.map(e => e.id);
    await tx.delete(employeeSalaryComponentsTable).where(and(eq(employeeSalaryComponentsTable.componentId, id), inArray(employeeSalaryComponentsTable.employeeId, ids)));
    await tx.insert(employeeSalaryComponentsTable).values(ids.map(employeeId => ({ employeeId, componentId: id, amount })));
  });
  res.json({ componentId: id, count: employees.length, amount });
});

export default router;
