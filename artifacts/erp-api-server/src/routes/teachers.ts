import { Router, type IRouter } from "express";
import { eq, or, ilike } from "drizzle-orm";
import { db, teachersTable } from "@workspace/erp-db";
import { requireAuth } from "../middleware/require-auth";

const router: IRouter = Router();
router.use("/teachers", requireAuth);

router.get("/teachers", async (req, res): Promise<void> => {
  const search = req.query.search as string | undefined;
  const status = req.query.status as string | undefined;

  let query = db.select().from(teachersTable);

  if (status) {
    query = query.where(eq(teachersTable.status, status)) as any;
  }

  if (search) {
    const term = `%${search}%`;
    query = query.where(
      or(
        ilike(teachersTable.name, term),
        ilike(teachersTable.teacherId, term),
        ilike(teachersTable.skills, term),
        ilike(teachersTable.position, term),
        ilike(teachersTable.phone, term),
        ilike(teachersTable.email, term),
      )
    ) as any;
  }

  const teachers = await query.orderBy(teachersTable.teacherId);
  res.json(teachers);
});

router.get("/teachers/:id", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const [teacher] = await db.select().from(teachersTable).where(eq(teachersTable.id, id));
  if (!teacher) { res.status(404).json({ error: "Teacher not found" }); return; }
  res.json(teacher);
});

router.post("/teachers", async (req, res): Promise<void> => {
  try {
    const [teacher] = await db.insert(teachersTable).values(req.body).returning();
    res.status(201).json(teacher);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

router.patch("/teachers/:id", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  try {
    const [teacher] = await db.update(teachersTable).set(req.body).where(eq(teachersTable.id, id)).returning();
    if (!teacher) { res.status(404).json({ error: "Teacher not found" }); return; }
    res.json(teacher);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

router.delete("/teachers/:id", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const [deleted] = await db.delete(teachersTable).where(eq(teachersTable.id, id)).returning();
  if (!deleted) { res.status(404).json({ error: "Teacher not found" }); return; }
  res.status(204).send();
});

router.post("/teachers/batch", async (req, res): Promise<void> => {
  const { teachers } = req.body;
  if (!Array.isArray(teachers) || teachers.length === 0) {
    res.status(400).json({ error: "teachers array is required" }); return;
  }
  try {
    const inserted = await db.insert(teachersTable).values(teachers).onConflictDoNothing({ target: [teachersTable.tenantId, teachersTable.teacherId] }).returning();
    res.status(201).json({ inserted: inserted.length, total: teachers.length });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

export default router;
