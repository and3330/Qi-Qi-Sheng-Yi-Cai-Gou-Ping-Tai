import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, opportunitiesTable, customersTable, activitiesTable } from "@workspace/erp-db";
import { requireAuth } from "../middleware/require-auth";
import {
  ListOpportunitiesQueryParams, CreateOpportunityBody,
  UpdateOpportunityParams, UpdateOpportunityBody,
} from "@workspace/erp-api-zod";

const router: IRouter = Router();
router.use("/opportunities", requireAuth);

function numericOpp(opp: any) {
  return {
    ...opp,
    expectedValue: Number(opp.expectedValue),
    probability: Number(opp.probability),
  };
}

router.get("/opportunities", async (req, res): Promise<void> => {
  const query = ListOpportunitiesQueryParams.safeParse(req.query);
  const condition = query.success && query.data.status ? eq(opportunitiesTable.status, query.data.status) : undefined;

  const opps = await db
    .select({
      id: opportunitiesTable.id, name: opportunitiesTable.name,
      customerId: opportunitiesTable.customerId, customerName: customersTable.name,
      status: opportunitiesTable.status, stage: opportunitiesTable.stage,
      expectedValue: opportunitiesTable.expectedValue, probability: opportunitiesTable.probability,
      expectedCloseDate: opportunitiesTable.expectedCloseDate, notes: opportunitiesTable.notes,
      createdAt: opportunitiesTable.createdAt,
    })
    .from(opportunitiesTable)
    .leftJoin(customersTable, eq(opportunitiesTable.customerId, customersTable.id))
    .where(condition)
    .orderBy(opportunitiesTable.createdAt);

  res.json(opps.map(numericOpp));
});

router.post("/opportunities", async (req, res): Promise<void> => {
  const parsed = CreateOpportunityBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const [opp] = await db.insert(opportunitiesTable).values({
    ...parsed.data,
    expectedValue: String(parsed.data.expectedValue),
    probability: parsed.data.probability != null ? String(parsed.data.probability) : undefined,
  }).returning();
  await db.insert(activitiesTable).values({ type: "create", title: "New Opportunity", description: `${parsed.data.name} created`, module: "CRM" });
  res.status(201).json({ ...numericOpp(opp), customerName: null });
});

router.patch("/opportunities/:id", async (req, res): Promise<void> => {
  const params = UpdateOpportunityParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const parsed = UpdateOpportunityBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const updateData: Record<string, unknown> = { ...parsed.data };
  if (parsed.data.expectedValue != null) updateData.expectedValue = String(parsed.data.expectedValue);
  if (parsed.data.probability != null) updateData.probability = String(parsed.data.probability);
  const [opp] = await db.update(opportunitiesTable).set(updateData).where(eq(opportunitiesTable.id, params.data.id)).returning();
  if (!opp) { res.status(404).json({ error: "Opportunity not found" }); return; }
  res.json({ ...numericOpp(opp), customerName: null });
});

export default router;
