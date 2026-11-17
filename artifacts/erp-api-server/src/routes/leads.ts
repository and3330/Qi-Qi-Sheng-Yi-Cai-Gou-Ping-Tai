import { Router, type IRouter } from "express";
import { eq, ilike, and } from "drizzle-orm";
import { db, leadsTable, opportunitiesTable, activitiesTable } from "@workspace/erp-db";
import { requireAuth } from "../middleware/require-auth";
import {
  ListLeadsQueryParams, CreateLeadBody, GetLeadParams,
  UpdateLeadParams, UpdateLeadBody, DeleteLeadParams,
} from "@workspace/erp-api-zod";

const router: IRouter = Router();
router.use("/leads", requireAuth);

function numericLead(lead: any) {
  return { ...lead, estimatedValue: lead.estimatedValue ? Number(lead.estimatedValue) : null };
}

router.get("/leads", async (req, res): Promise<void> => {
  const query = ListLeadsQueryParams.safeParse(req.query);
  const conditions = [];
  if (query.success && query.data.status) conditions.push(eq(leadsTable.status, query.data.status));
  if (query.success && query.data.search) conditions.push(ilike(leadsTable.name, `%${query.data.search}%`));

  const leads = await db.select().from(leadsTable)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(leadsTable.createdAt);

  res.json(leads.map(numericLead));
});

router.post("/leads", async (req, res): Promise<void> => {
  const parsed = CreateLeadBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const [lead] = await db.insert(leadsTable).values({
    ...parsed.data,
    estimatedValue: parsed.data.estimatedValue != null ? String(parsed.data.estimatedValue) : undefined,
  }).returning();
  await db.insert(activitiesTable).values({ type: "create", title: "New Lead", description: `${parsed.data.name} added as lead`, module: "CRM" });
  res.status(201).json(numericLead(lead));
});

router.get("/leads/:id", async (req, res): Promise<void> => {
  const params = GetLeadParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const [lead] = await db.select().from(leadsTable).where(eq(leadsTable.id, params.data.id));
  if (!lead) { res.status(404).json({ error: "Lead not found" }); return; }
  res.json(numericLead(lead));
});

router.patch("/leads/:id", async (req, res): Promise<void> => {
  const params = UpdateLeadParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const parsed = UpdateLeadBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const updateData: Record<string, unknown> = { ...parsed.data };
  if (parsed.data.estimatedValue != null) updateData.estimatedValue = String(parsed.data.estimatedValue);
  const [lead] = await db.update(leadsTable).set(updateData).where(eq(leadsTable.id, params.data.id)).returning();
  if (!lead) { res.status(404).json({ error: "Lead not found" }); return; }
  res.json(numericLead(lead));
});

router.delete("/leads/:id", async (req, res): Promise<void> => {
  const params = DeleteLeadParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const [lead] = await db.delete(leadsTable).where(eq(leadsTable.id, params.data.id)).returning();
  if (!lead) { res.status(404).json({ error: "Lead not found" }); return; }
  res.sendStatus(204);
});

router.post("/leads/:id/convert", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }

  const [lead] = await db.select().from(leadsTable).where(eq(leadsTable.id, id));
  if (!lead) { res.status(404).json({ error: "Lead not found" }); return; }

  const [opp] = await db.insert(opportunitiesTable).values({
    name: lead.name,
    stage: "Prospecting",
    expectedValue: lead.estimatedValue || "0",
    probability: "25",
  }).returning();

  await db.update(leadsTable).set({ status: "Converted" }).where(eq(leadsTable.id, id));

  await db.insert(activitiesTable).values({
    type: "update", title: "Lead Converted",
    description: `${lead.name} converted to opportunity`,
    module: "CRM",
  });

  res.status(201).json({
    ...opp,
    expectedValue: Number(opp.expectedValue),
    probability: Number(opp.probability),
    customerName: null,
  });
});

export default router;
