import { pgErrorCode } from "../lib/pg-error";
import { Router, type IRouter } from "express";
import { eq, sql } from "drizzle-orm";
import { db, itemCategoriesTable, itemsTable } from "@workspace/erp-db";
import { requireAuth } from "../middleware/require-auth";

const router: IRouter = Router();
router.use("/item-categories", requireAuth);

router.get("/item-categories", async (_req, res): Promise<void> => {
  const categories = await db.select().from(itemCategoriesTable).orderBy(itemCategoriesTable.name);
  res.json(categories);
});

router.post("/item-categories", async (req, res): Promise<void> => {
  const name = (req.body?.name || "").trim();
  const description = req.body?.description?.trim() || null;
  if (!name) { res.status(400).json({ error: "名稱為必填" }); return; }
  try {
    const [cat] = await db.insert(itemCategoriesTable).values({ name, description }).returning();
    res.status(201).json(cat);
  } catch (e: unknown) {
    const code = pgErrorCode(e);
    if (code === "23505") { res.status(409).json({ error: "此分類名稱已存在" }); return; }
    throw e;
  }
});

router.patch("/item-categories/:id", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }
  const updates: Record<string, unknown> = {};
  if (req.body.name !== undefined) updates.name = String(req.body.name).trim();
  if (req.body.description !== undefined) updates.description = req.body.description?.trim() || null;
  if (!Object.keys(updates).length) { res.status(400).json({ error: "沒有要更新的欄位" }); return; }

  try {
    // 取舊名以便連動更新 items.itemGroup
    const [old] = await db.select().from(itemCategoriesTable).where(eq(itemCategoriesTable.id, id));
    if (!old) { res.status(404).json({ error: "Not found" }); return; }
    const [cat] = await db.update(itemCategoriesTable).set(updates).where(eq(itemCategoriesTable.id, id)).returning();
    if (updates.name && updates.name !== old.name) {
      await db.update(itemsTable).set({ itemGroup: updates.name as string }).where(eq(itemsTable.itemGroup, old.name));
    }
    res.json(cat);
  } catch (e: unknown) {
    const code = pgErrorCode(e);
    if (code === "23505") { res.status(409).json({ error: "此分類名稱已存在" }); return; }
    throw e;
  }
});

router.delete("/item-categories/:id", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }
  const [cat] = await db.select().from(itemCategoriesTable).where(eq(itemCategoriesTable.id, id));
  if (!cat) { res.status(404).json({ error: "Not found" }); return; }
  // 檢查是否有品項在用
  const [{ count }] = await db.select({ count: sql<number>`count(*)::int` }).from(itemsTable).where(eq(itemsTable.itemGroup, cat.name));
  if (count > 0) {
    res.status(409).json({ error: `此分類仍有 ${count} 個品項在使用，請先改用其他分類後再刪除` });
    return;
  }
  await db.delete(itemCategoriesTable).where(eq(itemCategoriesTable.id, id));
  res.json({ success: true });
});

export default router;
