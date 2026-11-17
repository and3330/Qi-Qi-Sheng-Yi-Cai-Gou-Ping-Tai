import { Router, type IRouter } from "express";
import { todayTaipei } from "../lib/inventory-journal";
import { eq, desc, and, lte, gte } from "drizzle-orm";
import { db, assetMaintenanceTable, assetsTable } from "@workspace/erp-db";
import { requireAuth } from "../middleware/require-auth";

const router: IRouter = Router();
router.use("/asset-maintenance", requireAuth);

router.get("/asset-maintenance", async (req, res): Promise<void> => {
  const rows = await db.select({
    maintenance: assetMaintenanceTable,
    assetName: assetsTable.name,
    assetNumber: assetsTable.assetNumber,
  })
    .from(assetMaintenanceTable)
    .leftJoin(assetsTable, eq(assetMaintenanceTable.assetId, assetsTable.id))
    .orderBy(desc(assetMaintenanceTable.scheduledDate));

  res.json(rows.map(r => ({
    ...r.maintenance,
    cost: Number(r.maintenance.cost),
    assetName: r.assetName || "",
    assetNumber: r.assetNumber || "",
  })));
});

router.get("/asset-maintenance/upcoming", async (_req, res): Promise<void> => {
  const today = todayTaipei();
  const thirtyDaysLater = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);

  const rows = await db.select({
    maintenance: assetMaintenanceTable,
    assetName: assetsTable.name,
    assetNumber: assetsTable.assetNumber,
  })
    .from(assetMaintenanceTable)
    .leftJoin(assetsTable, eq(assetMaintenanceTable.assetId, assetsTable.id))
    .where(and(
      eq(assetMaintenanceTable.status, "Scheduled"),
      gte(assetMaintenanceTable.scheduledDate, today),
      lte(assetMaintenanceTable.scheduledDate, thirtyDaysLater),
    ))
    .orderBy(assetMaintenanceTable.scheduledDate);

  res.json(rows.map(r => ({
    ...r.maintenance,
    cost: Number(r.maintenance.cost),
    assetName: r.assetName || "",
    assetNumber: r.assetNumber || "",
  })));
});

router.post("/asset-maintenance", async (req, res): Promise<void> => {
  const { assetId, maintenanceType, description, scheduledDate, cost, vendor, remarks } = req.body;
  if (!assetId || !maintenanceType || !scheduledDate) {
    res.status(400).json({ error: "必填：資產、維護類型、排程日期" }); return;
  }

  const [record] = await db.insert(assetMaintenanceTable).values({
    assetId: Number(assetId), maintenanceType, description: description || null,
    scheduledDate, cost: String(Number(cost) || 0), vendor: vendor || null, remarks: remarks || null,
  }).returning();

  res.status(201).json({ ...record, cost: Number(record.cost) });
});

router.patch("/asset-maintenance/:id", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }

  const updates: Record<string, unknown> = {};
  if (req.body.status !== undefined) updates.status = req.body.status;
  if (req.body.completedDate !== undefined) updates.completedDate = req.body.completedDate;
  if (req.body.cost !== undefined) updates.cost = String(Number(req.body.cost));
  if (req.body.vendor !== undefined) updates.vendor = req.body.vendor;
  if (req.body.remarks !== undefined) updates.remarks = req.body.remarks;
  if (req.body.description !== undefined) updates.description = req.body.description;
  if (req.body.scheduledDate !== undefined) updates.scheduledDate = req.body.scheduledDate;
  if (req.body.maintenanceType !== undefined) updates.maintenanceType = req.body.maintenanceType;

  if (req.body.status === "Completed" && !req.body.completedDate) {
    updates.completedDate = todayTaipei();
  }

  const [record] = await db.update(assetMaintenanceTable).set(updates).where(eq(assetMaintenanceTable.id, id)).returning();
  if (!record) { res.status(404).json({ error: "Not found" }); return; }
  res.json({ ...record, cost: Number(record.cost) });
});

router.delete("/asset-maintenance/:id", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }
  await db.delete(assetMaintenanceTable).where(eq(assetMaintenanceTable.id, id));
  res.json({ success: true });
});

export default router;
