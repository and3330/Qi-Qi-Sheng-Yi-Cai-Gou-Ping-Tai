import { Router, type IRouter } from "express";
import { todayTaipei } from "../lib/inventory-journal";
import { eq, desc } from "drizzle-orm";
import { db, nonConformanceReportsTable, itemsTable } from "@workspace/erp-db";
import { requireAuth } from "../middleware/require-auth";

const router: IRouter = Router();
router.use("/non-conformance-reports", requireAuth);

function generateNcrNumber(): string {
  return "NCR-" + String(Date.now()).slice(-8);
}

router.get("/non-conformance-reports", async (_req, res): Promise<void> => {
  const rows = await db.select({
    ncr: nonConformanceReportsTable,
    itemName: itemsTable.itemName,
  })
    .from(nonConformanceReportsTable)
    .leftJoin(itemsTable, eq(nonConformanceReportsTable.itemId, itemsTable.id))
    .orderBy(desc(nonConformanceReportsTable.createdAt));

  res.json(rows.map(r => ({ ...r.ncr, itemName: r.itemName || "" })));
});

router.get("/non-conformance-reports/:id", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }
  const [row] = await db.select({
    ncr: nonConformanceReportsTable,
    itemName: itemsTable.itemName,
  })
    .from(nonConformanceReportsTable)
    .leftJoin(itemsTable, eq(nonConformanceReportsTable.itemId, itemsTable.id))
    .where(eq(nonConformanceReportsTable.id, id));
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  res.json({ ...row.ncr, itemName: row.itemName || "" });
});

router.post("/non-conformance-reports", async (req, res): Promise<void> => {
  const { title, itemId, referenceType, referenceId, severity, description, rootCause, correctiveAction, reportedBy, reportDate, remarks } = req.body;
  if (!title || !description || !reportDate) { res.status(400).json({ error: "必填：標題、描述、報告日期" }); return; }
  const [row] = await db.insert(nonConformanceReportsTable).values({
    reportNumber: generateNcrNumber(),
    title, itemId: itemId ? Number(itemId) : null,
    referenceType: referenceType || null,
    referenceId: referenceId ? Number(referenceId) : null,
    severity: severity || "Minor",
    description, rootCause: rootCause || null,
    correctiveAction: correctiveAction || null,
    reportedBy: reportedBy || null, reportDate,
    remarks: remarks || null,
  }).returning();
  res.status(201).json(row);
});

router.patch("/non-conformance-reports/:id", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }

  const updates: Record<string, unknown> = {};
  const fields = ["title", "severity", "status", "description", "rootCause", "correctiveAction", "closedDate", "remarks"];
  for (const f of fields) {
    if (req.body[f] !== undefined) updates[f] = req.body[f];
  }

  if (req.body.status === "Closed" && !req.body.closedDate) {
    updates.closedDate = todayTaipei();
  }

  if (Object.keys(updates).length === 0) { res.status(400).json({ error: "No updates" }); return; }
  const [row] = await db.update(nonConformanceReportsTable).set(updates).where(eq(nonConformanceReportsTable.id, id)).returning();
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  res.json(row);
});

router.delete("/non-conformance-reports/:id", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }
  const [row] = await db.delete(nonConformanceReportsTable).where(eq(nonConformanceReportsTable.id, id)).returning();
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  res.json({ success: true });
});

export default router;
