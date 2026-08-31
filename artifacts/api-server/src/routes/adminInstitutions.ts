import { Router, type IRouter } from "express";
import { asc, eq } from "drizzle-orm";
import { db, institutionsTable } from "@workspace/db";
import { UpdateAdminInstitutionBody } from "@workspace/api-zod";
import { requireOps } from "../middlewares/requireMember";
import { serializeInstitution } from "../lib/serialize";
import { reindex } from "../lib/aiIndex";

const router: IRouter = Router();

router.get("/admin/institutions", requireOps, async (_req, res) => {
  const rows = await db
    .select()
    .from(institutionsTable)
    .orderBy(asc(institutionsTable.id));
  res.json(rows.map(serializeInstitution));
});

/** 更新機構分級（A/B/C；null = 未分級） */
router.patch("/admin/institutions/:id", requireOps, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const parsed = UpdateAdminInstitutionBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "資料格式不正確（分級須為 A / B / C）" });
    return;
  }
  const [updated] = await db
    .update(institutionsTable)
    .set({ grade: parsed.data.grade ?? null })
    .where(eq(institutionsTable.id, id))
    .returning();
  if (!updated) {
    res.status(404).json({ error: "找不到此機構" });
    return;
  }
  reindex("institution", updated.id);
  res.json(serializeInstitution(updated));
});

export default router;
