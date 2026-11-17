import { pgErrorCode } from "../lib/pg-error";
import { Router, type IRouter } from "express";
import { eq, sql } from "drizzle-orm";
import { db, itemTypesTable, itemsTable } from "@workspace/erp-db";
import { requireAuth } from "../middleware/require-auth";

const router: IRouter = Router();
router.use("/item-types", requireAuth);

router.get("/item-types", async (_req, res): Promise<void> => {
  const rows = await db.select().from(itemTypesTable).orderBy(itemTypesTable.name);
  res.json(rows);
});

router.post("/item-types", async (req, res): Promise<void> => {
  const name = (req.body?.name || "").trim();
  if (!name) { res.status(400).json({ error: "名稱為必填" }); return; }
  const payload = {
    name,
    label: req.body?.label?.trim() || null,
    colorClass: req.body?.colorClass?.trim() || null,
    description: req.body?.description?.trim() || null,
  };
  try {
    const [row] = await db.insert(itemTypesTable).values(payload).returning();
    res.status(201).json(row);
  } catch (e: unknown) {
    if (pgErrorCode(e) === "23505") { res.status(409).json({ error: "此類型名稱已存在" }); return; }
    throw e;
  }
});

router.patch("/item-types/:id", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }
  const updates: Record<string, unknown> = {};
  if (req.body.name !== undefined) updates.name = String(req.body.name).trim();
  if (req.body.label !== undefined) updates.label = req.body.label?.trim() || null;
  if (req.body.colorClass !== undefined) updates.colorClass = req.body.colorClass?.trim() || null;
  if (req.body.description !== undefined) updates.description = req.body.description?.trim() || null;
  if (!Object.keys(updates).length) { res.status(400).json({ error: "沒有要更新的欄位" }); return; }

  try {
    const [old] = await db.select().from(itemTypesTable).where(eq(itemTypesTable.id, id));
    if (!old) { res.status(404).json({ error: "Not found" }); return; }
    const [row] = await db.update(itemTypesTable).set(updates).where(eq(itemTypesTable.id, id)).returning();
    if (updates.name && updates.name !== old.name) {
      await db.update(itemsTable).set({ itemType: updates.name as string }).where(eq(itemsTable.itemType, old.name));
    }
    res.json(row);
  } catch (e: unknown) {
    if (pgErrorCode(e) === "23505") { res.status(409).json({ error: "此類型名稱已存在" }); return; }
    throw e;
  }
});

router.delete("/item-types/:id", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }
  const [row] = await db.select().from(itemTypesTable).where(eq(itemTypesTable.id, id));
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  const [{ count }] = await db.select({ count: sql<number>`count(*)::int` }).from(itemsTable).where(eq(itemsTable.itemType, row.name));
  if (count > 0) {
    res.status(409).json({ error: `此類型仍有 ${count} 個品項在使用，請先改用其他類型後再刪除` });
    return;
  }
  await db.delete(itemTypesTable).where(eq(itemTypesTable.id, id));
  res.json({ success: true });
});

export default router;
