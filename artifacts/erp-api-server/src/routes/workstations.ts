import { Router, type IRouter } from "express";
import { eq, desc } from "drizzle-orm";
import { db, workstationsTable, type Workstation } from "@workspace/erp-db";
import { requireAuth } from "../middleware/require-auth";

const router: IRouter = Router();
router.use("/workstations", requireAuth);

function numericWs(w: Workstation) {
  return { ...w, hourRate: Number(w.hourRate) };
}

router.get("/workstations", async (_req, res): Promise<void> => {
  const rows = await db.select().from(workstationsTable).orderBy(workstationsTable.name);
  res.json(rows.map(numericWs));
});

router.get("/workstations/:id", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }
  const [row] = await db.select().from(workstationsTable).where(eq(workstationsTable.id, id));
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  res.json(numericWs(row));
});

router.post("/workstations", async (req, res): Promise<void> => {
  const { name, description, productionCapacity, hourRate, status } = req.body;
  if (!name) { res.status(400).json({ error: "名稱為必填" }); return; }
  const [row] = await db.insert(workstationsTable).values({
    name, description: description || null,
    productionCapacity: Number(productionCapacity) || 1,
    hourRate: String(Number(hourRate) || 0),
    status: status || "Active",
  }).returning();
  res.status(201).json(numericWs(row));
});

router.patch("/workstations/:id", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }
  const updates: Record<string, unknown> = {};
  if (req.body.name !== undefined) updates.name = req.body.name;
  if (req.body.description !== undefined) updates.description = req.body.description;
  if (req.body.productionCapacity !== undefined) updates.productionCapacity = Number(req.body.productionCapacity);
  if (req.body.hourRate !== undefined) updates.hourRate = String(Number(req.body.hourRate));
  if (req.body.status !== undefined) updates.status = req.body.status;
  if (Object.keys(updates).length === 0) { res.status(400).json({ error: "No updates" }); return; }
  const [row] = await db.update(workstationsTable).set(updates).where(eq(workstationsTable.id, id)).returning();
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  res.json(numericWs(row));
});

router.delete("/workstations/:id", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }
  try {
    const [row] = await db.delete(workstationsTable).where(eq(workstationsTable.id, id)).returning();
    if (!row) { res.status(404).json({ error: "Not found" }); return; }
    res.json({ success: true });
  } catch (err: any) {
    // 已經有工作卡用過的工作站不能刪（紀錄要留著），請改成停用
    if (err?.code === "23503" || err?.cause?.code === "23503") { res.status(400).json({ error: "這個工作站已經有工作卡在用，不能刪除；不再使用的話請改成「停用」" }); return; }
    throw err;
  }
});

export default router;
