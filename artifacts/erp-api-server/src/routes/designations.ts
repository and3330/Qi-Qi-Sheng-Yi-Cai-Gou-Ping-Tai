import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, designationsTable, departmentsTable } from "@workspace/erp-db";
import { requireAuth, requireRole } from "../middleware/require-auth";

const router: IRouter = Router();
router.use("/designations", requireAuth);
// 公司層級的設定：只有老闆與系統管理員可以新增、修改、刪除（查詢仍開放給所有登入者）
const adminOnly = requireRole("owner", "admin");


router.get("/designations", async (_req, res): Promise<void> => {
  const designations = await db
    .select({
      id: designationsTable.id,
      title: designationsTable.title,
      departmentId: designationsTable.departmentId,
      departmentName: departmentsTable.name,
      description: designationsTable.description,
      isActive: designationsTable.isActive,
      createdAt: designationsTable.createdAt,
    })
    .from(designationsTable)
    .leftJoin(departmentsTable, eq(designationsTable.departmentId, departmentsTable.id))
    .orderBy(designationsTable.title);

  res.json(designations);
});

router.post("/designations", adminOnly, async (req, res): Promise<void> => {
  const { title, departmentId, description, isActive } = req.body;
  if (!title) { res.status(400).json({ error: "title is required" }); return; }
  const [row] = await db.insert(designationsTable).values({
    title,
    departmentId: departmentId || null,
    description: description || null,
    isActive: isActive !== false,
  }).returning();
  res.status(201).json(row);
});

router.patch("/designations/:id", adminOnly, async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const updates: Record<string, unknown> = {};
  if (req.body.title !== undefined) updates.title = req.body.title;
  if (req.body.departmentId !== undefined) updates.departmentId = req.body.departmentId || null;
  if (req.body.description !== undefined) updates.description = req.body.description;
  if (req.body.isActive !== undefined) updates.isActive = req.body.isActive;
  const [row] = await db.update(designationsTable).set(updates).where(eq(designationsTable.id, id)).returning();
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  res.json(row);
});

router.delete("/designations/:id", adminOnly, async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const [row] = await db.delete(designationsTable).where(eq(designationsTable.id, id)).returning();
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  res.sendStatus(204);
});

export default router;
