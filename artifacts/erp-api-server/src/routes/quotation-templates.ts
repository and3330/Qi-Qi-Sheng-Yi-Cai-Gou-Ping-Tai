import { Router, type IRouter } from "express";
import { eq, asc } from "drizzle-orm";
import { db, quotationTemplatesTable } from "@workspace/erp-db";
import { requireAuth, requireRole } from "../middleware/require-auth";

const router: IRouter = Router();
router.use("/quotation-templates", requireAuth);

const canManageTemplates = requireRole("owner", "admin", "manager");

/** 類別名稱由使用者自訂；只限制長度與不可空白 */
function categoryError(category: unknown): string | null {
  if (typeof category !== "string" || !category.trim()) return "請填寫類別名稱";
  if (category.trim().length > 20) return "類別名稱最多 20 個字";
  return null;
}

router.get("/quotation-templates", async (_req, res): Promise<void> => {
  const templates = await db
    .select()
    .from(quotationTemplatesTable)
    .orderBy(asc(quotationTemplatesTable.id));
  res.json(templates);
});

router.put("/quotation-templates/:category", canManageTemplates, async (req, res): Promise<void> => {
  const catErr = categoryError(req.params.category);
  if (catErr) { res.status(400).json({ error: catErr }); return; }
  const category = String(req.params.category).trim();
  const { terms, notes, items } = req.body;
  const values = {
    category,
    terms: terms ?? null,
    notes: notes ?? null,
    items: Array.isArray(items) ? items : [],
  };
  const [existing] = await db.select().from(quotationTemplatesTable).where(eq(quotationTemplatesTable.category, category));
  if (existing) {
    const [updated] = await db.update(quotationTemplatesTable).set(values).where(eq(quotationTemplatesTable.id, existing.id)).returning();
    res.json(updated);
  } else {
    const [created] = await db.insert(quotationTemplatesTable).values(values).returning();
    res.status(201).json(created);
  }
});

router.delete("/quotation-templates/:category", canManageTemplates, async (req, res): Promise<void> => {
  const category = String(req.params.category);
  const [deleted] = await db.delete(quotationTemplatesTable).where(eq(quotationTemplatesTable.category, category)).returning();
  if (!deleted) { res.status(404).json({ error: "Template not found" }); return; }
  res.status(204).send();
});

export default router;
