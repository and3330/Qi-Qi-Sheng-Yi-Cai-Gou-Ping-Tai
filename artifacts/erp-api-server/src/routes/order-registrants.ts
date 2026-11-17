import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, orderRegistrantsTable } from "@workspace/erp-db";
import { requireAuth } from "../middleware/require-auth";

const router: IRouter = Router();
router.use("/registrants", requireAuth);
router.use("/sales-orders", requireAuth);

router.get("/sales-orders/:orderId/registrants", async (req, res): Promise<void> => {
  const orderId = parseInt(req.params.orderId);
  if (isNaN(orderId)) { res.status(400).json({ error: "Invalid orderId" }); return; }
  const registrants = await db
    .select()
    .from(orderRegistrantsTable)
    .where(eq(orderRegistrantsTable.salesOrderId, orderId));
  res.json(registrants);
});

router.post("/sales-orders/:orderId/registrants", async (req, res): Promise<void> => {
  const orderId = parseInt(req.params.orderId);
  if (isNaN(orderId)) { res.status(400).json({ error: "Invalid orderId" }); return; }
  const { name, contactInfo, age, grade, notes } = req.body;
  if (!name) { res.status(400).json({ error: "name is required" }); return; }
  const [registrant] = await db.insert(orderRegistrantsTable).values({
    salesOrderId: orderId,
    name,
    contactInfo: contactInfo || null,
    age: age || null,
    grade: grade || null,
    notes: notes || null,
  }).returning();
  res.status(201).json(registrant);
});

router.patch("/registrants/:id", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const { name, contactInfo, age, grade, notes } = req.body;
  const updateData: any = {};
  if (name !== undefined) updateData.name = name;
  if (contactInfo !== undefined) updateData.contactInfo = contactInfo;
  if (age !== undefined) updateData.age = age;
  if (grade !== undefined) updateData.grade = grade;
  if (notes !== undefined) updateData.notes = notes;

  const [registrant] = await db.update(orderRegistrantsTable).set(updateData).where(eq(orderRegistrantsTable.id, id)).returning();
  if (!registrant) { res.status(404).json({ error: "Registrant not found" }); return; }
  res.json(registrant);
});

router.delete("/registrants/:id", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const [deleted] = await db.delete(orderRegistrantsTable).where(eq(orderRegistrantsTable.id, id)).returning();
  if (!deleted) { res.status(404).json({ error: "Registrant not found" }); return; }
  res.status(204).send();
});

export default router;
