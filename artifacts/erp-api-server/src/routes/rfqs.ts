import { Router, type IRouter } from "express";
import { randomUUID } from "node:crypto";
import { desc, eq, inArray } from "drizzle-orm";
import {
  db, rfqsTable, suppliersTable, itemsTable, projectsTable, purchaseOrdersTable, activitiesTable, notificationsTable,
  type Rfq, type RfqItem, type RfqQuote,
} from "@workspace/erp-db";
import { requireAuth } from "../middleware/require-auth";
import { nextDocNumber } from "../lib/doc-number";
import { todayTaipei } from "../lib/inventory-journal";
import { isRealDate } from "../lib/cash-accounts";
import { friendlyCaughtError } from "../lib/friendly-errors";
import { createApprovalRequest } from "../utils/approval-helper";
import { compareQuotes } from "../lib/rfq";

/**
 * 詢價單：同一批東西問幾家供應商，各家報價放在一起比，選定後直接轉成採購單。
 * Open 詢價中 → Awarded 已選定（已轉採購單）；或 Cancelled 取消。
 */
const router: IRouter = Router();
router.use("/rfqs", requireAuth);

class InputError extends Error {}
const fail = (message: string): never => { throw new InputError(message); };
const actor = (req: any): string => String(req.session?.user?.username || "API");
const idOf = (raw: unknown): number => { const id = Number(raw); return Number.isInteger(id) && id > 0 ? id : fail("編號格式不正確"); };

function withComparison(rfq: Rfq) {
  return { ...rfq, comparison: compareQuotes(rfq.items, rfq.quotes, todayTaipei()) };
}

async function readItems(raw: unknown): Promise<RfqItem[]> {
  if (!Array.isArray(raw) || raw.length === 0) fail("至少要有一個要詢價的品項");
  const rows = (raw as any[]).map(row => ({ itemId: Number(row?.itemId), quantity: Number(row?.quantity) }));
  for (const row of rows) {
    if (!Number.isInteger(row.itemId) || row.itemId <= 0) fail("請從品項清單選擇要詢價的品項");
    if (!Number.isFinite(row.quantity) || row.quantity <= 0) fail("品項數量必須大於 0");
  }
  if (new Set(rows.map(row => row.itemId)).size !== rows.length) fail("同一個品項請不要重複列，數量合在一起填");
  const found = await db.select({ id: itemsTable.id, itemName: itemsTable.itemName, unit: itemsTable.unit }).from(itemsTable).where(inArray(itemsTable.id, rows.map(row => row.itemId)));
  const byId = new Map(found.map(item => [item.id, item]));
  return rows.map(row => {
    const item = byId.get(row.itemId) ?? fail(`品項 ${row.itemId} 不存在`);
    return { itemId: row.itemId, itemName: item.itemName, quantity: row.quantity, unit: item.unit ?? null };
  });
}

function readHeader(body: any): { rfqDate: string; dueDate: string | null; title: string | null; notes: string | null; projectId: number; departmentId: number | null } {
  const rfqDate = String(body?.rfqDate || todayTaipei());
  if (!isRealDate(rfqDate)) fail("請填寫正確的詢價日期");
  const dueDate = body?.dueDate ? String(body.dueDate) : null;
  if (dueDate && !isRealDate(dueDate)) fail("回覆期限的日期格式不正確");
  const projectId = Number(body?.projectId);
  if (!Number.isInteger(projectId) || projectId <= 0) fail("請選擇專案：每一筆支出都要歸屬到專案");
  return {
    rfqDate, dueDate, projectId,
    title: typeof body?.title === "string" && body.title.trim() ? body.title.trim().slice(0, 100) : null,
    notes: typeof body?.notes === "string" && body.notes.trim() ? body.notes.trim().slice(0, 500) : null,
    departmentId: body?.departmentId ? Number(body.departmentId) || null : null,
  };
}

const handle = (fallback: string, fn: (req: any, res: any) => Promise<void>) => async (req: any, res: any): Promise<void> => {
  try { await fn(req, res); }
  catch (err: any) {
    if (err instanceof InputError) { res.status(400).json({ error: err.message }); return; }
    res.status(Number(err?.status) || 400).json({ error: friendlyCaughtError(err, fallback) });
  }
};

router.get("/rfqs", handle("讀取詢價單失敗", async (_req, res) => {
  const rows = await db.select().from(rfqsTable).orderBy(desc(rfqsTable.id));
  const today = todayTaipei();
  res.json(rows.map(rfq => {
    const comparison = compareQuotes(rfq.items, rfq.quotes, today);
    const cheapest = comparison.quotes.find(quote => quote.supplierId === comparison.cheapestSupplierId);
    return {
      id: rfq.id, rfqNumber: rfq.rfqNumber, rfqDate: rfq.rfqDate, dueDate: rfq.dueDate, title: rfq.title, status: rfq.status,
      projectId: rfq.projectId, itemCount: rfq.items.length, quoteCount: rfq.quotes.length,
      itemSummary: rfq.items.slice(0, 3).map(item => item.itemName).join("、") + (rfq.items.length > 3 ? ` 等 ${rfq.items.length} 項` : ""),
      cheapestSupplierName: cheapest?.supplierName ?? null, cheapestTotalTwd: cheapest?.totalTwd ?? null,
      awardedSupplierId: rfq.awardedSupplierId, purchaseOrderId: rfq.purchaseOrderId,
    };
  }));
}));

router.get("/rfqs/:id", handle("讀取詢價單失敗", async (req, res) => {
  const [rfq] = await db.select().from(rfqsTable).where(eq(rfqsTable.id, idOf(req.params.id)));
  if (!rfq) { res.status(404).json({ error: "找不到詢價單" }); return; }
  const [order] = rfq.purchaseOrderId
    ? await db.select({ orderNumber: purchaseOrdersTable.orderNumber }).from(purchaseOrdersTable).where(eq(purchaseOrdersTable.id, rfq.purchaseOrderId))
    : [];
  res.json({ ...withComparison(rfq), purchaseOrderNumber: order?.orderNumber ?? null });
}));

router.post("/rfqs", handle("建立詢價單失敗", async (req, res) => {
  const header = readHeader(req.body);
  const items = await readItems(req.body?.items);
  const [project] = await db.select({ id: projectsTable.id }).from(projectsTable).where(eq(projectsTable.id, header.projectId));
  if (!project) fail("專案不存在");
  const [rfq] = await db.insert(rfqsTable).values({
    ...header, items, quotes: [], createdBy: actor(req),
    rfqNumber: await nextDocNumber(db, "rfqs", "rfq_number", "RFQ", () => `RFQ-${String(Date.now()).slice(-8)}`, header.rfqDate),
  }).returning();
  await db.insert(activitiesTable).values({ type: "create", title: "詢價單已建立", description: `${rfq.rfqNumber} ${rfq.title || ""}`.trim(), module: "Purchasing" });
  res.status(201).json(withComparison(rfq));
}));

/** 改表頭或品項。已經有報價之後就不能改品項（報價是照品項順序記的，改了會對不上） */
router.patch("/rfqs/:id", handle("更新詢價單失敗", async (req, res) => {
  const id = idOf(req.params.id);
  const updated = await db.transaction(async tx => {
    const [rfq] = await tx.select().from(rfqsTable).where(eq(rfqsTable.id, id)).for("update");
    if (!rfq) throw Object.assign(new Error("找不到詢價單"), { status: 404 });
    if (rfq.status !== "Open") fail("只有詢價中的詢價單可以修改");
    const header = readHeader({ ...rfq, ...req.body });
    const changes: Record<string, unknown> = { ...header };
    if (req.body?.items !== undefined) {
      if (rfq.quotes.length > 0) fail("已經有供應商報價，不能再改品項；要改請先刪掉報價，或另開一張詢價單");
      changes.items = await readItems(req.body.items);
    }
    const [row] = await tx.update(rfqsTable).set(changes).where(eq(rfqsTable.id, id)).returning();
    return row;
  });
  res.json(withComparison(updated));
}));

/** 登錄（或更新）一家供應商的報價：同一家再登一次就是覆蓋 */
router.put("/rfqs/:id/quotes", handle("登錄報價失敗", async (req, res) => {
  const id = idOf(req.params.id);
  const supplierId = Number(req.body?.supplierId);
  if (!Number.isInteger(supplierId) || supplierId <= 0) fail("請選擇供應商");
  const currency = String(req.body?.currency || "TWD").toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) fail("幣別格式不正確（3 碼英文，例如 TWD、CNY、USD）");
  const exchangeRate = currency === "TWD" ? 1 : Number(req.body?.exchangeRate);
  if (!Number.isFinite(exchangeRate) || exchangeRate <= 0) fail(`用 ${currency} 報價請輸入匯率（1 ${currency} 等於多少台幣），才能和其他家比`);
  const validUntil = req.body?.validUntil ? String(req.body.validUntil) : null;
  if (validUntil && !isRealDate(validUntil)) fail("報價有效期限的日期格式不正確");
  const leadDays = req.body?.leadDays === undefined || req.body?.leadDays === null || req.body?.leadDays === "" ? null : Number(req.body.leadDays);
  if (leadDays !== null && (!Number.isInteger(leadDays) || leadDays < 0 || leadDays > 3650)) fail("交期天數請填 0 以上的整數");

  const updated = await db.transaction(async tx => {
    const [rfq] = await tx.select().from(rfqsTable).where(eq(rfqsTable.id, id)).for("update");
    if (!rfq) throw Object.assign(new Error("找不到詢價單"), { status: 404 });
    if (rfq.status !== "Open") fail("只有詢價中的詢價單可以登錄報價");
    const [supplier] = await tx.select({ id: suppliersTable.id, name: suppliersTable.name }).from(suppliersTable).where(eq(suppliersTable.id, supplierId));
    if (!supplier) fail("供應商不存在");
    const rawPrices: unknown[] = Array.isArray(req.body?.prices) ? req.body.prices : [];
    const prices = rfq.items.map((_, index) => {
      const raw = rawPrices[index];
      if (raw === undefined || raw === null || raw === "") return null;
      const price = Number(raw);
      if (!Number.isFinite(price) || price < 0) fail("單價不能是負數");
      return Math.round(price * 10000) / 10000;
    });
    if (prices.every(price => price === null)) fail("至少要填一個品項的報價");
    const quote: RfqQuote = {
      supplierId, supplierName: supplier.name, quotedAt: todayTaipei(), currency, exchangeRate, leadDays, validUntil,
      note: typeof req.body?.note === "string" && req.body.note.trim() ? req.body.note.trim().slice(0, 200) : null,
      prices,
    };
    const quotes = [...rfq.quotes.filter(existing => existing.supplierId !== supplierId), quote];
    const [row] = await tx.update(rfqsTable).set({ quotes }).where(eq(rfqsTable.id, id)).returning();
    return row;
  });
  res.json(withComparison(updated));
}));

router.delete("/rfqs/:id/quotes/:supplierId", handle("刪除報價失敗", async (req, res) => {
  const id = idOf(req.params.id), supplierId = idOf(req.params.supplierId);
  const updated = await db.transaction(async tx => {
    const [rfq] = await tx.select().from(rfqsTable).where(eq(rfqsTable.id, id)).for("update");
    if (!rfq) throw Object.assign(new Error("找不到詢價單"), { status: 404 });
    if (rfq.status !== "Open") fail("只有詢價中的詢價單可以刪除報價");
    const [row] = await tx.update(rfqsTable).set({ quotes: rfq.quotes.filter(quote => quote.supplierId !== supplierId) }).where(eq(rfqsTable.id, id)).returning();
    return row;
  });
  res.json(withComparison(updated));
}));

/** 選定供應商：把這家的報價轉成一張採購單草稿（之後照一般採購流程：送審、收貨、付款） */
router.post("/rfqs/:id/award", handle("轉採購單失敗", async (req, res) => {
  const id = idOf(req.params.id);
  const supplierId = Number(req.body?.supplierId);
  if (!Number.isInteger(supplierId) || supplierId <= 0) fail("請選擇要下單的供應商");
  const result = await db.transaction(async tx => {
    const [rfq] = await tx.select().from(rfqsTable).where(eq(rfqsTable.id, id)).for("update");
    if (!rfq) throw Object.assign(new Error("找不到詢價單"), { status: 404 });
    if (rfq.status !== "Open") fail(rfq.status === "Awarded" ? "這張詢價單已經轉過採購單了" : "已取消的詢價單不能轉採購單");
    const quote = rfq.quotes.find(existing => existing.supplierId === supplierId) ?? fail("這家供應商還沒有報價");
    const [supplier] = await tx.select({ id: suppliersTable.id, name: suppliersTable.name }).from(suppliersTable).where(eq(suppliersTable.id, supplierId));
    if (!supplier) fail("供應商不存在");
    // 只下有報價的品項；沒報的品項留給使用者另外處理
    const orderItems = rfq.items.flatMap((item, index) => {
      const rate = quote.prices[index];
      if (rate === null || rate === undefined || item.itemId === null) return [];
      return [{ itemId: item.itemId, itemName: item.itemName, quantity: item.quantity, rate, amount: Math.round(item.quantity * rate * 100) / 100 }];
    });
    if (orderItems.length === 0) fail("這家供應商沒有可以下單的報價");
    const totalAmount = Math.round(orderItems.reduce((sum, item) => sum + item.amount, 0) * 100) / 100;
    const today = todayTaipei();
    const expected = quote.leadDays != null ? new Date(Date.parse(today) + quote.leadDays * 86400000).toISOString().slice(0, 10) : null;
    const [order] = await tx.insert(purchaseOrdersTable).values({
      orderNumber: await nextDocNumber(tx, "purchase_orders", "order_number", "PO", () => `PO-${String(Date.now()).slice(-8)}-${randomUUID().slice(0, 6).toUpperCase()}`),
      supplierId, orderDate: today, expectedDate: expected, totalAmount: String(totalAmount),
      currency: quote.currency, exchangeRate: String(quote.currency === "TWD" ? 1 : quote.exchangeRate),
      items: orderItems, extraFields: { rfqNumber: rfq.rfqNumber },
      departmentId: rfq.departmentId, projectId: rfq.projectId,
    }).returning();
    const [row] = await tx.update(rfqsTable).set({ status: "Awarded", awardedSupplierId: supplierId, purchaseOrderId: order.id }).where(eq(rfqsTable.id, id)).returning();
    await createApprovalRequest({ module: "Purchasing", documentType: "PurchaseOrder", documentId: order.id, documentNumber: order.orderNumber, requestedBy: actor(req) }, tx);
    await tx.insert(notificationsTable).values({
      title: "新採購訂單", message: `${order.orderNumber} - ${supplier.name}（由詢價單 ${rfq.rfqNumber} 轉入）`,
      type: "approval", module: "Purchasing", documentType: "PurchaseOrder", documentId: order.id,
    });
    await tx.insert(activitiesTable).values({ type: "create", title: "詢價單轉採購單", description: `${rfq.rfqNumber} → ${order.orderNumber}（${supplier.name}）`, module: "Purchasing" });
    return { rfq: row, order, skipped: rfq.items.length - orderItems.length };
  });
  res.status(201).json({ ...withComparison(result.rfq), purchaseOrderId: result.order.id, purchaseOrderNumber: result.order.orderNumber, skippedItems: result.skipped });
}));

router.post("/rfqs/:id/cancel", handle("取消詢價單失敗", async (req, res) => {
  const id = idOf(req.params.id);
  const updated = await db.transaction(async tx => {
    const [rfq] = await tx.select().from(rfqsTable).where(eq(rfqsTable.id, id)).for("update");
    if (!rfq) throw Object.assign(new Error("找不到詢價單"), { status: 404 });
    if (rfq.status !== "Open") fail("只有詢價中的詢價單可以取消；已經轉採購單的請到採購單處理");
    const [row] = await tx.update(rfqsTable).set({ status: "Cancelled" }).where(eq(rfqsTable.id, id)).returning();
    return row;
  });
  res.json(withComparison(updated));
}));

export default router;
