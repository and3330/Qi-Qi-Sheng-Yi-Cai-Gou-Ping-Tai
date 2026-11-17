import { Router, type IRouter } from "express";
import { eq, desc } from "drizzle-orm";
import { db, qualityInspectionTemplatesTable, qualityInspectionsTable, itemsTable, purchaseReceiptsTable, deliveryNotesTable, workOrdersTable } from "@workspace/erp-db";
import { INSPECTION_REFERENCE_TYPES } from "../lib/quality-gate";
import { requireAuth } from "../middleware/require-auth";

const router: IRouter = Router();
router.use("/quality-inspections", requireAuth);
router.use("/quality-inspection-templates", requireAuth);

/** 參考單據的單號；找不到回傳 null */
async function referenceNumber(referenceType: string | null, referenceId: number | null): Promise<string | null> {
  if (!referenceType || !referenceId) return null;
  if (referenceType === "Purchase Receipt") {
    const [r] = await db.select({ n: purchaseReceiptsTable.receiptNumber }).from(purchaseReceiptsTable).where(eq(purchaseReceiptsTable.id, referenceId));
    return r?.n ?? null;
  }
  if (referenceType === "Delivery Note") {
    const [r] = await db.select({ n: deliveryNotesTable.noteNumber }).from(deliveryNotesTable).where(eq(deliveryNotesTable.id, referenceId));
    return r?.n ?? null;
  }
  if (referenceType === "Work Order") {
    const [r] = await db.select({ n: workOrdersTable.workOrderNumber }).from(workOrdersTable).where(eq(workOrdersTable.id, referenceId));
    return r?.n ?? null;
  }
  return null;
}

function generateInspNumber(): string {
  return "QI-" + String(Date.now()).slice(-8);
}

router.get("/quality-inspection-templates", async (_req, res): Promise<void> => {
  const rows = await db.select({
    tpl: qualityInspectionTemplatesTable,
    itemName: itemsTable.itemName,
  })
    .from(qualityInspectionTemplatesTable)
    .leftJoin(itemsTable, eq(qualityInspectionTemplatesTable.itemId, itemsTable.id))
    .orderBy(desc(qualityInspectionTemplatesTable.createdAt));

  res.json(rows.map(r => ({ ...r.tpl, itemName: r.itemName || "" })));
});

router.get("/quality-inspection-templates/:id", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }
  const [row] = await db.select().from(qualityInspectionTemplatesTable).where(eq(qualityInspectionTemplatesTable.id, id));
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  res.json(row);
});

router.post("/quality-inspection-templates", async (req, res): Promise<void> => {
  const { name, inspectionType, itemId, criteria, remarks } = req.body;
  if (!name) { res.status(400).json({ error: "名稱為必填" }); return; }
  const [row] = await db.insert(qualityInspectionTemplatesTable).values({
    name, inspectionType: inspectionType || "Incoming",
    itemId: itemId ? Number(itemId) : null,
    criteria: criteria || [],
    remarks: remarks || null,
  }).returning();
  res.status(201).json(row);
});

router.patch("/quality-inspection-templates/:id", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }
  const updates: Record<string, unknown> = {};
  if (req.body.name !== undefined) updates.name = req.body.name;
  if (req.body.inspectionType !== undefined) updates.inspectionType = req.body.inspectionType;
  if (req.body.itemId !== undefined) updates.itemId = req.body.itemId ? Number(req.body.itemId) : null;
  if (req.body.criteria !== undefined) updates.criteria = req.body.criteria;
  if (req.body.remarks !== undefined) updates.remarks = req.body.remarks;
  if (Object.keys(updates).length === 0) { res.status(400).json({ error: "No updates" }); return; }
  const [row] = await db.update(qualityInspectionTemplatesTable).set(updates).where(eq(qualityInspectionTemplatesTable.id, id)).returning();
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  res.json(row);
});

router.delete("/quality-inspection-templates/:id", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }
  const [row] = await db.delete(qualityInspectionTemplatesTable).where(eq(qualityInspectionTemplatesTable.id, id)).returning();
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  res.json({ success: true });
});

router.get("/quality-inspections", async (_req, res): Promise<void> => {
  const rows = await db.select({
    insp: qualityInspectionsTable,
    itemName: itemsTable.itemName,
  })
    .from(qualityInspectionsTable)
    .leftJoin(itemsTable, eq(qualityInspectionsTable.itemId, itemsTable.id))
    .orderBy(desc(qualityInspectionsTable.createdAt));

  const numbers = await Promise.all(rows.map(r => referenceNumber(r.insp.referenceType, r.insp.referenceId)));
  res.json(rows.map((r, i) => ({ ...r.insp, itemName: r.itemName || "", referenceNumber: numbers[i] })));
});

router.get("/quality-inspections/:id", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }
  const [row] = await db.select({
    insp: qualityInspectionsTable,
    itemName: itemsTable.itemName,
  })
    .from(qualityInspectionsTable)
    .leftJoin(itemsTable, eq(qualityInspectionsTable.itemId, itemsTable.id))
    .where(eq(qualityInspectionsTable.id, id));
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  res.json({ ...row.insp, itemName: row.itemName || "", referenceNumber: await referenceNumber(row.insp.referenceType, row.insp.referenceId) });
});

router.post("/quality-inspections", async (req, res): Promise<void> => {
  const { templateId, inspectionType, itemId, referenceType, referenceId,
    inspectedQuantity, acceptedQuantity, rejectedQuantity,
    result, inspectorName, inspectionDate, results, remarks } = req.body;

  if (!inspectionDate) { res.status(400).json({ error: "檢驗日期為必填" }); return; }
  if (referenceType || referenceId) {
    if (!(INSPECTION_REFERENCE_TYPES as readonly string[]).includes(referenceType)) { res.status(400).json({ error: "參考類型不正確" }); return; }
    if (!referenceId) { res.status(400).json({ error: "請選擇參考單據" }); return; }
    if (!(await referenceNumber(referenceType, Number(referenceId)))) { res.status(400).json({ error: "參考單據不存在" }); return; }
  }

  let criteriaResults = results || [];
  if (templateId && (!results || results.length === 0)) {
    const [tpl] = await db.select().from(qualityInspectionTemplatesTable).where(eq(qualityInspectionTemplatesTable.id, Number(templateId)));
    if (tpl) {
      criteriaResults = (tpl.criteria as Array<{ name: string }>).map(c => ({ ...c, result: "", status: "Pending" }));
    }
  }

  const [row] = await db.insert(qualityInspectionsTable).values({
    inspectionNumber: generateInspNumber(),
    templateId: templateId ? Number(templateId) : null,
    inspectionType: inspectionType || "Incoming",
    itemId: itemId ? Number(itemId) : null,
    referenceType: referenceType || null,
    referenceId: referenceId ? Number(referenceId) : null,
    inspectedQuantity: Number(inspectedQuantity) || 0,
    acceptedQuantity: Number(acceptedQuantity) || 0,
    rejectedQuantity: Number(rejectedQuantity) || 0,
    result: result || null,
    inspectorName: inspectorName || null,
    inspectionDate,
    results: criteriaResults,
    remarks: remarks || null,
  }).returning();

  res.status(201).json(row);
});

router.patch("/quality-inspections/:id", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }

  const updates: Record<string, unknown> = {};
  const fields = ["status", "result", "inspectorName", "inspectionDate", "results", "remarks",
    "inspectedQuantity", "acceptedQuantity", "rejectedQuantity"];
  for (const f of fields) {
    if (req.body[f] !== undefined) updates[f] = req.body[f];
  }

  if (Object.keys(updates).length === 0) { res.status(400).json({ error: "No updates" }); return; }
  const [row] = await db.update(qualityInspectionsTable).set(updates).where(eq(qualityInspectionsTable.id, id)).returning();
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  res.json(row);
});

router.delete("/quality-inspections/:id", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }
  const [row] = await db.delete(qualityInspectionsTable).where(eq(qualityInspectionsTable.id, id)).returning();
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  res.json({ success: true });
});

export default router;
