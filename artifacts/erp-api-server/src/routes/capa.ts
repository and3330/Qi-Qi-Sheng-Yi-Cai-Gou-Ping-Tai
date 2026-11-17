import { Router, type IRouter } from "express";
import { todayTaipei } from "../lib/inventory-journal";
import { eq, desc } from "drizzle-orm";
import { db, capaActionsTable, nonConformanceReportsTable } from "@workspace/erp-db";
import { requireAuth } from "../middleware/require-auth";

const router: IRouter = Router();
router.use("/capa-actions", requireAuth);

function generateCapaNumber(): string {
  return "CAPA-" + String(Date.now()).slice(-8);
}

router.get("/capa-actions", async (_req, res): Promise<void> => {
  const rows = await db.select({
    capa: capaActionsTable,
    ncrNumber: nonConformanceReportsTable.reportNumber,
    ncrTitle: nonConformanceReportsTable.title,
  })
    .from(capaActionsTable)
    .leftJoin(nonConformanceReportsTable, eq(capaActionsTable.nonConformanceId, nonConformanceReportsTable.id))
    .orderBy(desc(capaActionsTable.createdAt));

  res.json(rows.map(r => ({ ...r.capa, ncrNumber: r.ncrNumber || "", ncrTitle: r.ncrTitle || "" })));
});

router.get("/capa-actions/:id", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }
  const [row] = await db.select({
    capa: capaActionsTable,
    ncrNumber: nonConformanceReportsTable.reportNumber,
    ncrTitle: nonConformanceReportsTable.title,
  })
    .from(capaActionsTable)
    .leftJoin(nonConformanceReportsTable, eq(capaActionsTable.nonConformanceId, nonConformanceReportsTable.id))
    .where(eq(capaActionsTable.id, id));
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  res.json({ ...row.capa, ncrNumber: row.ncrNumber || "", ncrTitle: row.ncrTitle || "" });
});

router.post("/capa-actions", async (req, res): Promise<void> => {
  const { title, type, nonConformanceId, priority, description, assignedTo, dueDate, remarks } = req.body;
  if (!title || !description) { res.status(400).json({ error: "必填：標題、描述" }); return; }
  const [row] = await db.insert(capaActionsTable).values({
    capaNumber: generateCapaNumber(),
    title, type: type || "Corrective",
    nonConformanceId: nonConformanceId ? Number(nonConformanceId) : null,
    priority: priority || "Medium",
    description,
    assignedTo: assignedTo || null,
    dueDate: dueDate || null,
    remarks: remarks || null,
  }).returning();
  res.status(201).json(row);
});

router.patch("/capa-actions/:id", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }

  const updates: Record<string, unknown> = {};
  const fields = ["title", "type", "status", "priority", "description", "assignedTo", "dueDate", "completedDate", "verificationResult", "remarks"];
  for (const f of fields) {
    if (req.body[f] !== undefined) updates[f] = req.body[f];
  }

  if (req.body.status === "Completed" && !req.body.completedDate) {
    updates.completedDate = todayTaipei();
  }

  if (Object.keys(updates).length === 0) { res.status(400).json({ error: "No updates" }); return; }
  const [row] = await db.update(capaActionsTable).set(updates).where(eq(capaActionsTable.id, id)).returning();
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  res.json(row);
});

router.delete("/capa-actions/:id", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }
  const [row] = await db.delete(capaActionsTable).where(eq(capaActionsTable.id, id)).returning();
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  res.json({ success: true });
});

export default router;
