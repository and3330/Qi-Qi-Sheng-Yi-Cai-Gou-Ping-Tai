import { Router, type IRouter } from "express";
import { eq, and, desc } from "drizzle-orm";
import { db, currenciesTable, exchangeRatesTable } from "@workspace/erp-db";
import { requireAuth, requireRole } from "../middleware/require-auth";

const router: IRouter = Router();
router.use("/currencies", requireAuth);
router.use("/exchange-rates", requireAuth);
const writeRoles = requireRole("owner", "admin", "finance_admin");

router.get("/currencies", async (_req, res): Promise<void> => {
  const rows = await db.select().from(currenciesTable).orderBy(currenciesTable.code);
  res.json(rows);
});

router.post("/currencies", writeRoles, async (req, res): Promise<void> => {
  const { code, name, symbol, isBase, isActive, decimalPlaces } = req.body;
  if (!code || !name || !symbol) { res.status(400).json({ error: "Missing required fields" }); return; }
  if (isBase === "Yes") {
    await db.update(currenciesTable).set({ isBase: "No" });
  }
  const [row] = await db.insert(currenciesTable).values({ code, name, symbol, isBase, isActive, decimalPlaces }).returning();
  res.status(201).json(row);
});

router.patch("/currencies/:id", writeRoles, async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) { res.status(400).json({ error: "幣別編號格式不正確" }); return; }
  // 只收可以改的欄位（原本把整包內容直接寫進資料庫）
  const set: Record<string, unknown> = {};
  for (const key of ["code", "name", "symbol"] as const) {
    if (req.body[key] === undefined) continue;
    const value = String(req.body[key] ?? "").trim();
    if (!value) { res.status(400).json({ error: "幣別代碼、名稱、符號都不能空白" }); return; }
    set[key] = key === "code" ? value.toUpperCase().slice(0, 10) : value.slice(0, 40);
  }
  if (req.body.isBase !== undefined) set.isBase = req.body.isBase === "Yes" ? "Yes" : "No";
  if (req.body.isActive !== undefined) set.isActive = req.body.isActive === "No" ? "No" : "Yes";
  if (req.body.decimalPlaces !== undefined) {
    const places = Number(req.body.decimalPlaces);
    if (!Number.isInteger(places) || places < 0 || places > 6) { res.status(400).json({ error: "小數位數請填 0 到 6" }); return; }
    set.decimalPlaces = String(places); // 這一欄在資料庫是文字
  }
  if (Object.keys(set).length === 0) { res.status(400).json({ error: "沒有可更新的欄位" }); return; }
  try {
    if (set.isBase === "Yes") await db.update(currenciesTable).set({ isBase: "No" });
    const [row] = await db.update(currenciesTable).set(set).where(eq(currenciesTable.id, id)).returning();
    if (!row) { res.status(404).json({ error: "找不到這個幣別" }); return; }
    res.json(row);
  } catch {
    res.status(400).json({ error: "更新失敗：幣別代碼可能跟別的幣別重複" });
  }
});

router.delete("/currencies/:id", writeRoles, async (req, res): Promise<void> => {
  const [row] = await db.delete(currenciesTable).where(eq(currenciesTable.id, Number(req.params.id))).returning();
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  res.sendStatus(204);
});

router.get("/exchange-rates", async (req, res): Promise<void> => {
  const conditions: any[] = [];
  if (req.query.fromCurrency) conditions.push(eq(exchangeRatesTable.fromCurrency, req.query.fromCurrency as string));
  if (req.query.toCurrency) conditions.push(eq(exchangeRatesTable.toCurrency, req.query.toCurrency as string));

  const rows = await db.select().from(exchangeRatesTable).where(conditions.length > 0 ? and(...conditions) : undefined).orderBy(desc(exchangeRatesTable.effectiveDate));
  res.json(rows.map(r => ({ ...r, rate: Number(r.rate) })));
});

router.post("/exchange-rates", writeRoles, async (req, res): Promise<void> => {
  const { fromCurrency, toCurrency, rate, effectiveDate, source } = req.body;
  if (!fromCurrency || !toCurrency || !rate || !effectiveDate) { res.status(400).json({ error: "Missing required fields" }); return; }
  const [row] = await db.insert(exchangeRatesTable).values({ fromCurrency, toCurrency, rate: String(rate), effectiveDate, source }).returning();
  res.status(201).json({ ...row, rate: Number(row.rate) });
});

router.delete("/exchange-rates/:id", writeRoles, async (req, res): Promise<void> => {
  const [row] = await db.delete(exchangeRatesTable).where(eq(exchangeRatesTable.id, Number(req.params.id))).returning();
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  res.sendStatus(204);
});

export default router;
