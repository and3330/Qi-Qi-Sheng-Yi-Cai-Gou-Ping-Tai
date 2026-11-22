import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, warehousesTable } from "@workspace/erp-db";
import { CreateWarehouseBody } from "@workspace/erp-api-zod";
import { requireAuth, requireRole } from "../middleware/require-auth";

const router: IRouter = Router();
router.use("/warehouses", requireAuth);

/**
 * 倉庫清單。預設只回啟用中的（開單時的倉庫選單不會出現已停用的）；
 * 帶 ?includeInactive=1 才連停用的一起回（倉庫管理頁、歷史單據用）。
 */
router.get("/warehouses", async (req, res): Promise<void> => {
  const includeInactive = req.query.includeInactive === "1" || req.query.includeInactive === "true";
  const rows = await db.select().from(warehousesTable)
    .where(includeInactive ? undefined : eq(warehousesTable.isActive, true))
    .orderBy(warehousesTable.name);
  res.json(rows);
});

router.post("/warehouses", async (req, res): Promise<void> => {
  const parsed = CreateWarehouseBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "請填寫倉庫名稱" }); return; }
  const [wh] = await db.insert(warehousesTable).values(parsed.data).returning();
  res.status(201).json(wh);
});

/** 編輯倉庫：名稱、地點、啟用／停用。停用只是開單時不再出現，原本的庫存紀錄與單據都還在 */
router.patch("/warehouses/:id", requireRole("owner", "admin", "manager", "finance_admin", "warehouse"), async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) { res.status(400).json({ error: "倉庫編號格式不正確" }); return; }
  const set: Record<string, unknown> = {};
  if (req.body?.name !== undefined) {
    const name = String(req.body.name ?? "").trim();
    if (!name) { res.status(400).json({ error: "倉庫名稱不能空白" }); return; }
    set.name = name.slice(0, 100);
  }
  if (req.body?.location !== undefined) set.location = String(req.body.location ?? "").trim().slice(0, 300) || null;
  if (req.body?.isActive !== undefined) set.isActive = req.body.isActive === true || req.body.isActive === "true";
  if (Object.keys(set).length === 0) { res.status(400).json({ error: "沒有可更新的欄位" }); return; }
  const [row] = await db.update(warehousesTable).set(set).where(eq(warehousesTable.id, id)).returning();
  if (!row) { res.status(404).json({ error: "找不到這個倉庫" }); return; }
  res.json(row);
});

export default router;
