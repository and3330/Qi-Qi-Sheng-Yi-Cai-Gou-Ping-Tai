import { Router, type IRouter } from "express";
import { and, asc, desc, eq, gte, lte, sql } from "drizzle-orm";
import { db, erpContractsTable } from "@workspace/db";
import { requireErpMenu } from "../middlewares/requireErp";

const router: IRouter = Router();
const MENU = "/contracts/list";
const PARTY_TYPES = ["customer", "supplier", "other"];
const STATUSES = ["draft", "active", "expired", "terminated"];
const fields = ["title", "partyType", "customerId", "supplierId", "amount", "signedDate", "startDate", "endDate", "status", "renewalNotice", "notes"];
const clean = (body: any) => Object.fromEntries(fields.filter((field) => body[field] !== undefined).map((field) => [field, body[field]]));
const unique = (err: unknown) => (err as { cause?: { code?: string } })?.cause?.code === "23505";
const date = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei" }).format(new Date());

async function createContract(values: Record<string, unknown>) {
  const prefix = `CT-${date().replaceAll("-", "")}`;
  for (let attempt = 0; attempt < 5; attempt++) {
    const result = await db.execute(sql`SELECT COUNT(*)::int n FROM ${erpContractsTable} WHERE ${erpContractsTable.contractNo} LIKE ${prefix + "-%"}`);
    const contractNo = `${prefix}-${String(Number((result.rows ?? result)[0]?.n || 0) + 1 + attempt).padStart(4, "0")}`;
    try {
      const [row] = await db.insert(erpContractsTable).values({ ...values, contractNo } as any).returning();
      return row;
    } catch (err) {
      if (!unique(err) || attempt === 4) throw err;
    }
  }
  throw new Error("CONTRACT_NUMBER_RETRY_EXHAUSTED");
}

router.get("/erp/contracts", requireErpMenu(MENU), async (req, res) => {
  const expiring = String(req.query.expiring || "") === "true";
  const today = date();
  const inThirtyDays = new Date(`${today}T00:00:00+08:00`);
  inThirtyDays.setDate(inThirtyDays.getDate() + 30);
  const end = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei" }).format(inThirtyDays);
  const where = expiring
    ? and(eq(erpContractsTable.status, "active"), gte(erpContractsTable.endDate, today), lte(erpContractsTable.endDate, end))
    : undefined;
  res.json(await db.select().from(erpContractsTable).where(where).orderBy(asc(erpContractsTable.endDate), desc(erpContractsTable.createdAt)));
});

router.post("/erp/contracts", requireErpMenu(MENU), async (req, res) => {
  if (!req.body.title?.trim() || !PARTY_TYPES.includes(req.body.partyType || "other") ||
      !STATUSES.includes(req.body.status || "draft") ||
      (req.body.amount != null && (!Number.isInteger(req.body.amount) || req.body.amount < 0)))
    return void res.status(400).json({ error: "合約資料格式錯誤，金額須為非負整數" });
  try { res.status(201).json(await createContract(clean(req.body))); }
  catch (err) {
    req.log.error({ err }, "create contract failed");
    res.status(unique(err) ? 409 : 500).json({ error: unique(err) ? "合約編號重複" : "建立合約失敗" });
  }
});

router.patch("/erp/contracts/:id", requireErpMenu(MENU), async (req, res) => {
  if ((req.body.partyType && !PARTY_TYPES.includes(req.body.partyType)) ||
      (req.body.status && !STATUSES.includes(req.body.status)) ||
      (req.body.amount != null && (!Number.isInteger(req.body.amount) || req.body.amount < 0)))
    return void res.status(400).json({ error: "合約資料格式錯誤，金額須為非負整數" });
  const [row] = await db.update(erpContractsTable).set(clean(req.body))
    .where(eq(erpContractsTable.id, Number(req.params.id))).returning();
  if (!row) return void res.status(404).json({ error: "找不到合約" });
  res.json(row);
});

router.delete("/erp/contracts/:id", requireErpMenu(MENU), async (req, res) => {
  const [row] = await db.delete(erpContractsTable).where(eq(erpContractsTable.id, Number(req.params.id)))
    .returning({ id: erpContractsTable.id });
  if (!row) return void res.status(404).json({ error: "找不到合約" });
  res.status(204).end();
});

export default router;