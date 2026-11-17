import { Router, type IRouter } from "express";
import { eq, and, sql, ilike, desc } from "drizzle-orm";
import { db, supportTicketsTable, ticketCategoriesTable, slaDefinitionsTable } from "@workspace/erp-db";
import { requireAuth } from "../middleware/require-auth";

const router: IRouter = Router();
router.use("/support-tickets", requireAuth);
router.use("/ticket-categories", requireAuth);
router.use("/sla-definitions", requireAuth);

router.get("/ticket-categories", async (_req, res): Promise<void> => {
  const rows = await db.select().from(ticketCategoriesTable).orderBy(ticketCategoriesTable.name);
  res.json(rows);
});

router.post("/ticket-categories", async (req, res): Promise<void> => {
  const { name, description, parentId } = req.body;
  if (!name) { res.status(400).json({ error: "名稱必填" }); return; }
  const [row] = await db.insert(ticketCategoriesTable).values({ name, description, parentId }).returning();
  res.status(201).json(row);
});

router.patch("/ticket-categories/:id", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  const [row] = await db.update(ticketCategoriesTable).set(req.body).where(eq(ticketCategoriesTable.id, id)).returning();
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  res.json(row);
});

router.delete("/ticket-categories/:id", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  const [row] = await db.delete(ticketCategoriesTable).where(eq(ticketCategoriesTable.id, id)).returning();
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  res.sendStatus(204);
});

router.get("/sla-definitions", async (_req, res): Promise<void> => {
  const rows = await db.select().from(slaDefinitionsTable).orderBy(slaDefinitionsTable.priority);
  res.json(rows);
});

router.post("/sla-definitions", async (req, res): Promise<void> => {
  const { name, priority, responseTimeHours, resolutionTimeHours, description } = req.body;
  if (!name) { res.status(400).json({ error: "名稱必填" }); return; }
  const [row] = await db.insert(slaDefinitionsTable).values({ name, priority, responseTimeHours, resolutionTimeHours, description }).returning();
  res.status(201).json(row);
});

router.patch("/sla-definitions/:id", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  const [row] = await db.update(slaDefinitionsTable).set(req.body).where(eq(slaDefinitionsTable.id, id)).returning();
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  res.json(row);
});

router.delete("/sla-definitions/:id", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  const [row] = await db.delete(slaDefinitionsTable).where(eq(slaDefinitionsTable.id, id)).returning();
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  res.sendStatus(204);
});

router.get("/support-tickets", async (req, res): Promise<void> => {
  const { status, priority, categoryId, customerId } = req.query;
  const conditions: any[] = [];
  if (status) conditions.push(eq(supportTicketsTable.status, String(status)));
  if (priority) conditions.push(eq(supportTicketsTable.priority, String(priority)));
  if (categoryId) conditions.push(eq(supportTicketsTable.categoryId, Number(categoryId)));
  if (customerId) conditions.push(eq(supportTicketsTable.customerId, Number(customerId)));

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const rows = await db.select({
    id: supportTicketsTable.id,
    ticketNumber: supportTicketsTable.ticketNumber,
    subject: supportTicketsTable.subject,
    description: supportTicketsTable.description,
    status: supportTicketsTable.status,
    priority: supportTicketsTable.priority,
    categoryId: supportTicketsTable.categoryId,
    customerId: supportTicketsTable.customerId,
    assignedTo: supportTicketsTable.assignedTo,
    slaId: supportTicketsTable.slaId,
    responseDeadline: supportTicketsTable.responseDeadline,
    resolutionDeadline: supportTicketsTable.resolutionDeadline,
    firstResponseAt: supportTicketsTable.firstResponseAt,
    resolvedAt: supportTicketsTable.resolvedAt,
    closedAt: supportTicketsTable.closedAt,
    resolution: supportTicketsTable.resolution,
    createdAt: supportTicketsTable.createdAt,
    categoryName: sql<string | null>`(SELECT name FROM ticket_categories WHERE id = "support_tickets"."category_id")`,
    customerName: sql<string | null>`(SELECT name FROM customers WHERE id = "support_tickets"."customer_id")`,
    assigneeName: sql<string | null>`(SELECT first_name || ' ' || last_name FROM employees WHERE id = "support_tickets"."assigned_to")`,
  }).from(supportTicketsTable).where(where).orderBy(desc(supportTicketsTable.createdAt));

  res.json(rows);
});

router.post("/support-tickets", async (req, res): Promise<void> => {
  const { subject, description, priority, categoryId, customerId, assignedTo, slaId } = req.body;
  if (!subject) { res.status(400).json({ error: "主題必填" }); return; }

  const count = await db.select({ count: sql<number>`COUNT(*)::int` }).from(supportTicketsTable);
  const num = (count[0]?.count || 0) + 1;
  const ticketNumber = `TK-${String(num).padStart(5, "0")}`;

  let responseDeadline: Date | undefined;
  let resolutionDeadline: Date | undefined;

  if (slaId) {
    const [sla] = await db.select().from(slaDefinitionsTable).where(eq(slaDefinitionsTable.id, slaId));
    if (sla) {
      const now = new Date();
      responseDeadline = new Date(now.getTime() + sla.responseTimeHours * 3600000);
      resolutionDeadline = new Date(now.getTime() + sla.resolutionTimeHours * 3600000);
    }
  }

  const [row] = await db.insert(supportTicketsTable).values({
    ticketNumber, subject, description, priority: priority || "Medium",
    categoryId, customerId, assignedTo, slaId,
    responseDeadline, resolutionDeadline,
  }).returning();

  res.status(201).json(row);
});

router.get("/support-tickets/:id", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  const [row] = await db.select({
    id: supportTicketsTable.id,
    ticketNumber: supportTicketsTable.ticketNumber,
    subject: supportTicketsTable.subject,
    description: supportTicketsTable.description,
    status: supportTicketsTable.status,
    priority: supportTicketsTable.priority,
    categoryId: supportTicketsTable.categoryId,
    customerId: supportTicketsTable.customerId,
    assignedTo: supportTicketsTable.assignedTo,
    slaId: supportTicketsTable.slaId,
    responseDeadline: supportTicketsTable.responseDeadline,
    resolutionDeadline: supportTicketsTable.resolutionDeadline,
    firstResponseAt: supportTicketsTable.firstResponseAt,
    resolvedAt: supportTicketsTable.resolvedAt,
    closedAt: supportTicketsTable.closedAt,
    resolution: supportTicketsTable.resolution,
    createdAt: supportTicketsTable.createdAt,
    categoryName: sql<string | null>`(SELECT name FROM ticket_categories WHERE id = "support_tickets"."category_id")`,
    customerName: sql<string | null>`(SELECT name FROM customers WHERE id = "support_tickets"."customer_id")`,
    assigneeName: sql<string | null>`(SELECT first_name || ' ' || last_name FROM employees WHERE id = "support_tickets"."assigned_to")`,
  }).from(supportTicketsTable).where(eq(supportTicketsTable.id, id));
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  res.json(row);
});

const allowedTransitions: Record<string, string[]> = {
  "Open": ["In Progress", "Closed"],
  "In Progress": ["Waiting for Customer", "Resolved", "Closed"],
  "Waiting for Customer": ["In Progress", "Resolved", "Closed"],
  "Resolved": ["Closed", "In Progress"],
  "Closed": [],
};

router.patch("/support-tickets/:id", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  const updates: any = { ...req.body };

  if (updates.status) {
    const [current] = await db.select({ status: supportTicketsTable.status }).from(supportTicketsTable).where(eq(supportTicketsTable.id, id));
    if (!current) { res.status(404).json({ error: "Not found" }); return; }

    const allowed = allowedTransitions[current.status] || [];
    if (updates.status !== current.status && !allowed.includes(updates.status)) {
      res.status(400).json({ error: `無法從「${current.status}」轉換至「${updates.status}」` }); return;
    }
  }

  if (updates.status === "Resolved" && !updates.resolvedAt) {
    updates.resolvedAt = new Date();
  }
  if (updates.status === "Closed" && !updates.closedAt) {
    updates.closedAt = new Date();
  }

  const [row] = await db.update(supportTicketsTable).set(updates).where(eq(supportTicketsTable.id, id)).returning();
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  res.json(row);
});

router.delete("/support-tickets/:id", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  const [row] = await db.delete(supportTicketsTable).where(eq(supportTicketsTable.id, id)).returning();
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  res.sendStatus(204);
});

export default router;
