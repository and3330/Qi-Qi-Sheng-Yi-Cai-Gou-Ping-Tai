import { Router, type IRouter } from "express";
import { eq, desc, sql } from "drizzle-orm";
import { db, brandsTable, quotationsTable } from "@workspace/erp-db";
import { requireAuth, requireRole } from "../middleware/require-auth";

const router: IRouter = Router();
router.use("/brands", requireAuth);
// 公司層級的設定：只有老闆與系統管理員可以新增、修改、刪除（查詢仍開放給所有登入者）
const adminOnly = requireRole("owner", "admin");


router.get("/brands", async (_req, res): Promise<void> => {
  const rows = await db.select().from(brandsTable).orderBy(desc(brandsTable.id));
  res.json(rows);
});

router.post("/brands", adminOnly, async (req, res): Promise<void> => {
  const { name, taxId, address, contactPerson, tel, isActive } = req.body;
  if (!name || typeof name !== "string") {
    res.status(400).json({ error: "品牌名稱為必填" });
    return;
  }
  const [row] = await db.insert(brandsTable).values({
    name,
    taxId: taxId || null,
    address: address || null,
    contactPerson: contactPerson || null,
    tel: tel || null,
    isActive: isActive !== false,
  }).returning();
  res.status(201).json(row);
});

router.patch("/brands/:id", adminOnly, async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const updates: Record<string, unknown> = {};
  for (const f of ["name", "taxId", "address", "contactPerson", "tel", "isActive"]) {
    if (req.body[f] !== undefined) updates[f] = req.body[f];
  }
  const [row] = await db.update(brandsTable).set(updates).where(eq(brandsTable.id, id)).returning();
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  res.json(row);
});

router.delete("/brands/:id", adminOnly, async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const [{ count }] = await db.select({ count: sql<number>`count(*)::int` }).from(quotationsTable).where(eq(quotationsTable.brandId, id));
  if (count > 0) {
    res.status(409).json({ error: `此品牌已被 ${count} 筆報價單使用，無法刪除。若不再使用，請改為「停用」。` });
    return;
  }
  const [row] = await db.delete(brandsTable).where(eq(brandsTable.id, id)).returning();
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  res.sendStatus(204);
});

export default router;
