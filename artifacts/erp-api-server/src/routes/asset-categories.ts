import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, assetCategoriesTable } from "@workspace/erp-db";
import { requireAuth } from "../middleware/require-auth";

const router: IRouter = Router();
router.use("/asset-categories", requireAuth);

router.get("/asset-categories", async (_req, res): Promise<void> => {
  const categories = await db.select().from(assetCategoriesTable).orderBy(assetCategoriesTable.name);
  res.json(categories);
});

router.post("/asset-categories", async (req, res): Promise<void> => {
  const { name, description, depreciationMethod, defaultUsefulLifeYears } = req.body;
  if (!name) { res.status(400).json({ error: "名稱為必填" }); return; }
  const [cat] = await db.insert(assetCategoriesTable).values({
    name, description: description || null,
    depreciationMethod: depreciationMethod || "straight-line",
    defaultUsefulLifeYears: defaultUsefulLifeYears || 5,
  }).returning();
  res.status(201).json(cat);
});

router.patch("/asset-categories/:id", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }
  const updates: Record<string, unknown> = {};
  if (req.body.name !== undefined) updates.name = req.body.name;
  if (req.body.description !== undefined) updates.description = req.body.description;
  if (req.body.depreciationMethod !== undefined) updates.depreciationMethod = req.body.depreciationMethod;
  if (req.body.defaultUsefulLifeYears !== undefined) updates.defaultUsefulLifeYears = req.body.defaultUsefulLifeYears;
  const [cat] = await db.update(assetCategoriesTable).set(updates).where(eq(assetCategoriesTable.id, id)).returning();
  if (!cat) { res.status(404).json({ error: "Not found" }); return; }
  res.json(cat);
});

router.delete("/asset-categories/:id", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }
  await db.delete(assetCategoriesTable).where(eq(assetCategoriesTable.id, id));
  res.json({ success: true });
});

export default router;
