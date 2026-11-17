import { Router, type IRouter } from "express";
import { eq, desc } from "drizzle-orm";
import { db, jobCardsTable, workOrdersTable, workstationsTable, type JobCard } from "@workspace/erp-db";
import { requireAuth } from "../middleware/require-auth";

const router: IRouter = Router();
router.use("/job-cards", requireAuth);

function numericJc(j: JobCard) {
  return { ...j, plannedQuantity: Number(j.plannedQuantity), completedQuantity: Number(j.completedQuantity), totalHours: Number(j.totalHours) };
}

function generateJcNumber(): string {
  return "JC-" + String(Date.now()).slice(-8);
}

const VALID_TRANSITIONS: Record<string, string[]> = {
  Open: ["Work In Progress"],
  "Work In Progress": ["Completed", "Cancelled"],
  Completed: [],
  Cancelled: [],
};

router.get("/job-cards", async (_req, res): Promise<void> => {
  const rows = await db.select({
    jc: jobCardsTable,
    woNumber: workOrdersTable.workOrderNumber,
    wsName: workstationsTable.name,
  })
    .from(jobCardsTable)
    .leftJoin(workOrdersTable, eq(jobCardsTable.workOrderId, workOrdersTable.id))
    .leftJoin(workstationsTable, eq(jobCardsTable.workstationId, workstationsTable.id))
    .orderBy(desc(jobCardsTable.createdAt));

  res.json(rows.map(r => ({
    ...numericJc(r.jc),
    workOrderNumber: r.woNumber || "",
    workstationName: r.wsName || "",
  })));
});

router.get("/job-cards/:id", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }

  const [row] = await db.select({
    jc: jobCardsTable,
    woNumber: workOrdersTable.workOrderNumber,
    wsName: workstationsTable.name,
  })
    .from(jobCardsTable)
    .leftJoin(workOrdersTable, eq(jobCardsTable.workOrderId, workOrdersTable.id))
    .leftJoin(workstationsTable, eq(jobCardsTable.workstationId, workstationsTable.id))
    .where(eq(jobCardsTable.id, id));

  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  res.json({ ...numericJc(row.jc), workOrderNumber: row.woNumber || "", workstationName: row.wsName || "" });
});

router.post("/job-cards", async (req, res): Promise<void> => {
  const { workOrderId, workstationId, operationName, sequenceNo, plannedQuantity, remarks } = req.body;
  if (!workOrderId || !operationName) { res.status(400).json({ error: "必填：工單、作業名稱" }); return; }

  const [row] = await db.insert(jobCardsTable).values({
    jobCardNumber: generateJcNumber(),
    workOrderId: Number(workOrderId),
    workstationId: workstationId ? Number(workstationId) : null,
    operationName,
    sequenceNo: Number(sequenceNo) || 1,
    plannedQuantity: String(Number(plannedQuantity) || 1),
    remarks: remarks || null,
  }).returning();

  res.status(201).json(numericJc(row));
});

router.patch("/job-cards/:id", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }

  const [existing] = await db.select().from(jobCardsTable).where(eq(jobCardsTable.id, id));
  if (!existing) { res.status(404).json({ error: "Not found" }); return; }

  if (req.body.status) {
    const newStatus = req.body.status as string;
    const allowed = VALID_TRANSITIONS[existing.status];
    if (!allowed || !allowed.includes(newStatus)) {
      res.status(400).json({ error: `無法從 ${existing.status} 轉為 ${newStatus}` }); return;
    }

    const updates: Record<string, unknown> = { status: newStatus };
    if (newStatus === "Work In Progress" && !existing.startTime) {
      updates.startTime = new Date().toISOString();
    }
    if (newStatus === "Completed") {
      updates.endTime = new Date().toISOString();
      if (existing.startTime) {
        const hours = (Date.now() - new Date(existing.startTime).getTime()) / 3600000;
        updates.totalHours = String(Math.round(hours * 100) / 100);
      }
      if (req.body.completedQuantity !== undefined) {
        updates.completedQuantity = String(Number(req.body.completedQuantity));
      }
    }

    const [updated] = await db.update(jobCardsTable).set(updates).where(eq(jobCardsTable.id, id)).returning();
    res.json(numericJc(updated));
    return;
  }

  const updates: Record<string, unknown> = {};
  if (req.body.operationName !== undefined) updates.operationName = req.body.operationName;
  if (req.body.workstationId !== undefined) updates.workstationId = req.body.workstationId ? Number(req.body.workstationId) : null;
  if (req.body.sequenceNo !== undefined) updates.sequenceNo = Number(req.body.sequenceNo);
  if (req.body.completedQuantity !== undefined) updates.completedQuantity = String(Number(req.body.completedQuantity));
  if (req.body.remarks !== undefined) updates.remarks = req.body.remarks;

  if (Object.keys(updates).length === 0) { res.status(400).json({ error: "No updates" }); return; }
  const [updated] = await db.update(jobCardsTable).set(updates).where(eq(jobCardsTable.id, id)).returning();
  res.json(numericJc(updated));
});

router.delete("/job-cards/:id", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }
  const [existing] = await db.select().from(jobCardsTable).where(eq(jobCardsTable.id, id));
  if (!existing) { res.status(404).json({ error: "Not found" }); return; }
  if (existing.status !== "Open") { res.status(400).json({ error: "只能刪除開放狀態的作業卡" }); return; }
  await db.delete(jobCardsTable).where(eq(jobCardsTable.id, id));
  res.json({ success: true });
});

export default router;
