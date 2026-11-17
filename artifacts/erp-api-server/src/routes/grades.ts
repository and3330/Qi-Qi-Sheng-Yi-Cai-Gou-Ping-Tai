import { Router, type IRouter } from "express";
import { eq, sql } from "drizzle-orm";
import { db, gradesTable, employeesTable } from "@workspace/erp-db";
import { requireAuth, requireRole } from "../middleware/require-auth";

const router: IRouter = Router();
router.use("/grades", requireAuth);
// 公司層級的設定：只有老闆與系統管理員可以新增、修改、刪除（查詢仍開放給所有登入者）
const adminOnly = requireRole("owner", "admin");


router.get("/grades", async (_req, res): Promise<void> => {
  const [grades, counts] = await Promise.all([
    db.select().from(gradesTable).orderBy(gradesTable.level),
    db.select({ gradeId: employeesTable.gradeId, count: sql<number>`count(*)::int` })
      .from(employeesTable).where(eq(employeesTable.status, "Active")).groupBy(employeesTable.gradeId),
  ]);
  const countByGrade = new Map(counts.map(c => [c.gradeId, c.count]));

  res.json(grades.map((g) => ({
    ...g,
    employeeCount: countByGrade.get(g.id) ?? 0,
    minSalary: g.minSalary ? Number(g.minSalary) : null,
    maxSalary: g.maxSalary ? Number(g.maxSalary) : null,
  })));
});

router.post("/grades", adminOnly, async (req, res): Promise<void> => {
  const { name, level, minSalary, maxSalary, description, isActive } = req.body;
  if (!name || level === undefined) { res.status(400).json({ error: "name and level are required" }); return; }
  const [row] = await db.insert(gradesTable).values({
    name,
    level: Number(level),
    minSalary: minSalary ? String(minSalary) : null,
    maxSalary: maxSalary ? String(maxSalary) : null,
    description: description || null,
    isActive: isActive !== false,
  }).returning();
  res.status(201).json({
    ...row,
    minSalary: row.minSalary ? Number(row.minSalary) : null,
    maxSalary: row.maxSalary ? Number(row.maxSalary) : null,
  });
});

router.patch("/grades/:id", adminOnly, async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const updates: Record<string, unknown> = {};
  if (req.body.name !== undefined) updates.name = req.body.name;
  if (req.body.level !== undefined) updates.level = Number(req.body.level);
  if (req.body.minSalary !== undefined) updates.minSalary = req.body.minSalary ? String(req.body.minSalary) : null;
  if (req.body.maxSalary !== undefined) updates.maxSalary = req.body.maxSalary ? String(req.body.maxSalary) : null;
  if (req.body.description !== undefined) updates.description = req.body.description;
  if (req.body.isActive !== undefined) updates.isActive = req.body.isActive;
  const [row] = await db.update(gradesTable).set(updates).where(eq(gradesTable.id, id)).returning();
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  res.json({
    ...row,
    minSalary: row.minSalary ? Number(row.minSalary) : null,
    maxSalary: row.maxSalary ? Number(row.maxSalary) : null,
  });
});

router.delete("/grades/:id", adminOnly, async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const [inUse] = await db.select({ id: employeesTable.id }).from(employeesTable).where(eq(employeesTable.gradeId, id)).limit(1);
  if (inUse) { res.status(409).json({ error: "還有員工是這個職級，不能刪除。不再使用的話請改為停用" }); return; }
  const [row] = await db.delete(gradesTable).where(eq(gradesTable.id, id)).returning();
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  res.sendStatus(204);
});

export default router;
