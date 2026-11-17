import { Router, type IRouter } from "express";
import { eq, and, sql, desc, lte, gte, notInArray } from "drizzle-orm";
import { db, contractsTable } from "@workspace/erp-db";
import { requireAuth } from "../middleware/require-auth";

const router: IRouter = Router();
// 人事合約（員工、老師、臨時人員）含報酬，只在人事管理的「人事合約」看得到，這裡一律排除
const HR_PARTY_TYPES = ["Employee", "Teacher", "Person"];
const notHr = notInArray(contractsTable.partyType, HR_PARTY_TYPES);
const EDITABLE = ["title", "partyType", "customerId", "supplierId", "status", "startDate", "endDate", "contractValue", "terms", "description", "renewalDate", "autoRenew", "contactPerson"] as const;
router.use("/contracts", requireAuth);

router.get("/contracts", async (req, res): Promise<void> => {
  const { status, partyType } = req.query;
  const conditions: any[] = [notHr];
  if (status) conditions.push(eq(contractsTable.status, String(status)));
  if (partyType) conditions.push(eq(contractsTable.partyType, String(partyType)));

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const rows = await db.select({
    id: contractsTable.id,
    contractNumber: contractsTable.contractNumber,
    title: contractsTable.title,
    partyType: contractsTable.partyType,
    customerId: contractsTable.customerId,
    supplierId: contractsTable.supplierId,
    status: contractsTable.status,
    startDate: contractsTable.startDate,
    endDate: contractsTable.endDate,
    contractValue: contractsTable.contractValue,
    terms: contractsTable.terms,
    description: contractsTable.description,
    renewalDate: contractsTable.renewalDate,
    autoRenew: contractsTable.autoRenew,
    contactPerson: contractsTable.contactPerson,
    createdAt: contractsTable.createdAt,
    customerName: sql<string | null>`(SELECT name FROM customers WHERE id = "contracts"."customer_id")`,
    supplierName: sql<string | null>`(SELECT name FROM suppliers WHERE id = "contracts"."supplier_id")`,
  }).from(contractsTable).where(where).orderBy(desc(contractsTable.createdAt));

  res.json(rows);
});

router.post("/contracts", async (req, res): Promise<void> => {
  const { title, partyType, customerId, supplierId, status, startDate, endDate, contractValue, terms, description, renewalDate, autoRenew, contactPerson } = req.body;
  if (!title) { res.status(400).json({ error: "合約名稱必填" }); return; }
  if (partyType && HR_PARTY_TYPES.includes(partyType)) { res.status(400).json({ error: "員工、老師的合約請到「人事管理 › 人事合約」建立" }); return; }

  const count = await db.select({ count: sql<number>`COUNT(*)::int` }).from(contractsTable);
  const num = (count[0]?.count || 0) + 1;
  const contractNumber = `CT-${String(num).padStart(5, "0")}`;

  const [row] = await db.insert(contractsTable).values({
    contractNumber, title, partyType, customerId, supplierId,
    status: status || "Draft", startDate, endDate, contractValue,
    terms, description, renewalDate, autoRenew, contactPerson,
  }).returning();

  res.status(201).json(row);
});

router.get("/contracts/renewal-alerts", async (_req, res): Promise<void> => {
  const today = new Date();
  const days90 = new Date(today.getTime() + 90 * 86400000);
  const todayStr = today.toISOString().split("T")[0];
  const days90Str = days90.toISOString().split("T")[0];

  const rows = await db.select({
    id: contractsTable.id,
    contractNumber: contractsTable.contractNumber,
    title: contractsTable.title,
    partyType: contractsTable.partyType,
    endDate: contractsTable.endDate,
    renewalDate: contractsTable.renewalDate,
    status: contractsTable.status,
    contractValue: contractsTable.contractValue,
    customerName: sql<string | null>`(SELECT name FROM customers WHERE id = "contracts"."customer_id")`,
    supplierName: sql<string | null>`(SELECT name FROM suppliers WHERE id = "contracts"."supplier_id")`,
  }).from(contractsTable)
    .where(and(
      eq(contractsTable.status, "Active"), notHr,
      lte(contractsTable.endDate, days90Str),
      gte(contractsTable.endDate, todayStr),
    ))
    .orderBy(contractsTable.endDate);

  res.json(rows);
});

router.get("/contracts/:id", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  const [row] = await db.select({
    id: contractsTable.id,
    contractNumber: contractsTable.contractNumber,
    title: contractsTable.title,
    partyType: contractsTable.partyType,
    customerId: contractsTable.customerId,
    supplierId: contractsTable.supplierId,
    status: contractsTable.status,
    startDate: contractsTable.startDate,
    endDate: contractsTable.endDate,
    contractValue: contractsTable.contractValue,
    terms: contractsTable.terms,
    description: contractsTable.description,
    renewalDate: contractsTable.renewalDate,
    autoRenew: contractsTable.autoRenew,
    contactPerson: contractsTable.contactPerson,
    createdAt: contractsTable.createdAt,
    customerName: sql<string | null>`(SELECT name FROM customers WHERE id = "contracts"."customer_id")`,
    supplierName: sql<string | null>`(SELECT name FROM suppliers WHERE id = "contracts"."supplier_id")`,
  }).from(contractsTable).where(and(eq(contractsTable.id, id), notHr));
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  res.json(row);
});

router.patch("/contracts/:id", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  // 只收可以改的欄位（不能改編號，也不能把合約改成人事合約）
  const body = req.body && typeof req.body === "object" ? req.body : {};
  const updates: Record<string, any> = {};
  for (const key of EDITABLE) if (key in body) updates[key] = body[key];
  if (updates.partyType && HR_PARTY_TYPES.includes(updates.partyType)) { res.status(400).json({ error: "對象類型不正確" }); return; }
  if (Object.keys(updates).length === 0) { res.status(400).json({ error: "沒有要更新的內容" }); return; }
  const [row] = await db.update(contractsTable).set(updates).where(and(eq(contractsTable.id, id), notHr)).returning();
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  res.json(row);
});

router.delete("/contracts/:id", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  const [row] = await db.delete(contractsTable).where(and(eq(contractsTable.id, id), notHr)).returning();
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  res.sendStatus(204);
});

export default router;
