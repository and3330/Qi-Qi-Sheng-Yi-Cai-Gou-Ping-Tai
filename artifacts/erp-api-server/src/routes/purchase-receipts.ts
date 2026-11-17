import { Router, type IRouter } from "express";
import { logStockMovement } from "../lib/stock-ledger";
import { nextDocNumber } from "../lib/doc-number";
import { randomUUID } from "node:crypto";
import { desc, eq, sql, and, inArray } from "drizzle-orm";
import { db, purchaseReceiptsTable, purchaseOrdersTable, suppliersTable, itemsTable, activitiesTable, invoicesTable, paymentRequestsTable, purchaseReturnsTable, invoiceSettlementsTable } from "@workspace/erp-db";
import { requireAuth, requireRole } from "../middleware/require-auth";
import { isLegacyDoc, LEGACY_DOC_READONLY_MESSAGE, LEGACY_EDIT_LIMIT_MESSAGE, readLegacyHeader, legacyStockLines, legacyImportError } from "../lib/legacy";
import { assertIncomingInspectionPassed } from "../lib/quality-gate";
import { createInvoiceJournalEntry, deleteInvoiceJournalEntry } from "../lib/auto-journal";
import { recomputeInvoices } from "../lib/invoice-sync";
import { pgErrorCode, pgErrorConstraint } from "../lib/pg-error";
import { netOfVat, nextMovingAvgCost, postAutoJournal, round2, todayTaipei } from "../lib/inventory-journal";
import { cashLineAccount, isRealDate } from "../lib/cash-accounts";
import { landedCostShares } from "../lib/landed-cost";

const router: IRouter = Router();
router.use("/purchase-receipts", requireAuth);

function generatePRNumber(): string {
  return `PR-${String(Date.now()).slice(-8)}-${randomUUID().slice(0, 6).toUpperCase()}`;
}

interface PRItem { itemId: number; itemName: string; quantity: number; rate: number; amount: number; /** 建單當下的虛擬服務快照；舊單據無此欄位時回查品項主檔 */ isVirtual?: boolean }
interface POItem { itemId: number; itemName: string; quantity: number; rate: number; amount: number }

const VALID_TRANSITIONS: Record<string, string[]> = {
  Draft: ["Submitted", "Cancelled"],
  Submitted: ["Completed", "Cancelled"],
  Completed: [],
  Cancelled: [],
};

/** 在交易內調整品項庫存（direction: 1 增加 / -1 扣減），扣減時檢查庫存足夠；虛擬服務不動庫存與移動平均成本 */
async function adjustStock(tx: any, items: PRItem[], direction: 1 | -1, exchangeRate = 1, ledger?: { warehouseId: number | null; remarks: string }, taxInclusive = true) {
  for (const item of items) {
    const [row] = await tx.select({
      id: itemsTable.id,
      itemName: itemsTable.itemName,
      currentStock: itemsTable.currentStock,
      movingAvgCost: itemsTable.movingAvgCost,
      isVirtual: itemsTable.isVirtual,
    })
      .from(itemsTable).where(eq(itemsTable.id, item.itemId)).for("update");
    if (!row) throw new Error(`品項 ID ${item.itemId} 不存在`);
    if (item.isVirtual ?? row.isVirtual) continue; // 虛擬服務：不追蹤庫存、不影響移動平均成本（優先用建單快照）
    const currentStock = Number(row.currentStock || 0);
    const newStock = currentStock + direction * item.quantity;
    if (newStock < 0) throw new Error(`品項「${row.itemName}」庫存不足以回沖（現有 ${Number(row.currentStock || 0)}，需扣回 ${item.quantity}）`);
    const values: Record<string, string> = { currentStock: String(newStock) };
    // 台幣進貨的單價是含稅價，存貨成本要用未稅（稅額在開發票時記到進項稅額）。
    // 外幣進貨（淘寶、國外廠商）沒有台灣的營業稅，直接用匯率換成台幣就是成本。
    const unitCostTWD = taxInclusive ? netOfVat(item.rate * exchangeRate) : item.rate * exchangeRate;
    const currentAvg = Number(row.movingAvgCost || 0);
    if (direction === 1) {
      values.movingAvgCost = nextMovingAvgCost(currentStock, currentAvg, item.quantity, item.quantity * unitCostTWD).toFixed(4);
    }
    // 移動平均成本只在收貨時更新。作廢僅回沖數量，不反算歷史平均；
    // 否則後續出貨/收貨已改變庫存組成時，反算會製造失真的成本。
    await tx.update(itemsTable).set(values).where(eq(itemsTable.id, item.itemId));
    // 記到倉庫的進出紀錄，分倉數量才會對
    if (ledger) await logStockMovement(tx, { direction, itemId: item.itemId, warehouseId: ledger.warehouseId, quantity: item.quantity, rate: unitCostTWD, remarks: ledger.remarks, source: "receipt" });
  }
}

/**
 * 這張進貨單的採購發票（應付帳款）：已經有就回傳，沒有就建立並入帳。
 * 借 存貨（未稅）、進項稅額／貸 應付帳款。先付給採購單的訂金會自動算進已付金額。
 * 收貨當下就呼叫，貨一進來帳上就有存貨與應付；原本要等人按「付款申請」才入帳，忘了按帳上存貨就會少。
 */
/** 這張進貨單所屬採購單的幣別：外幣要換成台幣入帳，而且沒有台灣的營業稅 */
async function receiptCurrency(tx: any, purchaseOrderId: number | null): Promise<{ rate: number; foreign: boolean; currency: string }> {
  if (!purchaseOrderId) return { rate: 1, foreign: false, currency: "TWD" };
  const [order] = await tx.select({ currency: purchaseOrdersTable.currency, exchangeRate: purchaseOrdersTable.exchangeRate })
    .from(purchaseOrdersTable).where(eq(purchaseOrdersTable.id, purchaseOrderId));
  if (!order || !order.currency || order.currency === "TWD") return { rate: 1, foreign: false, currency: "TWD" };
  const rate = Number(order.exchangeRate);
  if (!Number.isFinite(rate) || rate <= 0) throw new Error("採購訂單匯率無效");
  return { rate, foreign: true, currency: order.currency };
}

async function ensureReceiptInvoice(tx: any, receipt: typeof purchaseReceiptsTable.$inferSelect): Promise<typeof invoicesTable.$inferSelect | null> {
  const [existing] = await tx.select().from(invoicesTable)
    .where(and(eq(invoicesTable.purchaseReceiptId, receipt.id), sql`${invoicesTable.status} != 'Cancelled'`)).for("update");
  if (existing) return existing;
  // 發票一律用台幣記：外幣進貨依採購單的匯率換算（原本把外幣金額直接當台幣，人民幣 1000 會變成台幣 1000）
  const fx = await receiptCurrency(tx, receipt.purchaseOrderId);
  const totalTwd = Math.round(Number(receipt.totalAmount) * fx.rate * 100) / 100;
  if (!receipt.supplierId || !(totalTwd > 0)) return null;
  const today = todayTaipei();
  // 發票日期用收貨日；收貨日填在未來或格式不對時用今天
  const invoiceDate = /^\d{4}-\d{2}-\d{2}$/.test(String(receipt.receiptDate || "")) && String(receipt.receiptDate) <= today ? String(receipt.receiptDate) : today;
  // 境外採購沒有台灣的統一發票，不能拆出進項稅額來扣抵
  const netAmount = fx.foreign ? totalTwd : Math.round((totalTwd / 1.05) * 100) / 100;
  const taxAmount = Math.round((totalTwd - netAmount) * 100) / 100;
  const [created] = await tx.insert(invoicesTable).values({
    invoiceNumber: `PINV-${receipt.receiptNumber}-${String(Date.now()).slice(-6)}`,
    invoiceType: "Purchase",
    supplierId: receipt.supplierId,
    purchaseOrderId: receipt.purchaseOrderId,
    purchaseReceiptId: receipt.id,
    invoiceDate,
    status: "Unpaid",
    totalAmount: String(totalTwd),
    outstandingAmount: String(totalTwd),
    taxType: fx.foreign ? "exempt" : "taxable",
    taxRate: fx.foreign ? "0" : "5",
    netAmount: String(netAmount),
    taxAmount: String(taxAmount),
    // 明細換成台幣金額，分錄與成本才對得起來；原幣金額留在採購單上
    items: fx.foreign
      ? (receipt.items as PRItem[]).map(item => ({ ...item, rate: Math.round(item.rate * fx.rate * 10000) / 10000, amount: Math.round(item.quantity * item.rate * fx.rate * 100) / 100, originalCurrency: fx.currency, originalRate: item.rate }))
      : receipt.items,
  }).returning();
  await createInvoiceJournalEntry(tx, created);
  await recomputeInvoices(tx, [created.id]);
  const [fresh] = await tx.select().from(invoicesTable).where(eq(invoicesTable.id, created.id));
  return fresh ?? created;
}

async function recalcPOStatus(tx: any, purchaseOrderId: number) {
  const [order] = await tx.select({ items: purchaseOrdersTable.items })
    .from(purchaseOrdersTable).where(eq(purchaseOrdersTable.id, purchaseOrderId)).for("update");
  if (!order) return;

  const orderItems = order.items as POItem[];
  const allPRs = await tx.select({ items: purchaseReceiptsTable.items })
    .from(purchaseReceiptsTable)
    .where(and(eq(purchaseReceiptsTable.purchaseOrderId, purchaseOrderId), sql`${purchaseReceiptsTable.status} IN ('Submitted','Completed')`));

  const received: Record<number, number> = {};
  for (const pr of allPRs) {
    for (const item of pr.items as PRItem[]) {
      received[item.itemId] = (received[item.itemId] || 0) + item.quantity;
    }
  }

  let allFulfilled = true;
  let anyFulfilled = false;
  for (const oi of orderItems) {
    const qty = received[oi.itemId] || 0;
    if (qty >= oi.quantity) anyFulfilled = true;
    else allFulfilled = false;
    if (qty > 0) anyFulfilled = true;
  }

  const newStatus = allFulfilled ? "Completed" : anyFulfilled ? "To Receive" : "Draft";
  await tx.update(purchaseOrdersTable).set({ status: newStatus }).where(eq(purchaseOrdersTable.id, purchaseOrderId));
}

router.get("/purchase-receipts", async (_req, res): Promise<void> => {
  const receipts = await db
    .select({
      id: purchaseReceiptsTable.id, receiptNumber: purchaseReceiptsTable.receiptNumber,
      purchaseOrderId: purchaseReceiptsTable.purchaseOrderId, supplierId: purchaseReceiptsTable.supplierId,
      supplierName: suppliersTable.name, warehouseId: purchaseReceiptsTable.warehouseId,
      receiptDate: purchaseReceiptsTable.receiptDate, status: purchaseReceiptsTable.status,
      totalAmount: purchaseReceiptsTable.totalAmount, items: purchaseReceiptsTable.items,
      remarks: purchaseReceiptsTable.remarks, createdAt: purchaseReceiptsTable.createdAt,
      departmentId: purchaseReceiptsTable.departmentId, projectId: purchaseReceiptsTable.projectId,
      extraFields: purchaseReceiptsTable.extraFields,
    })
    .from(purchaseReceiptsTable)
    .innerJoin(suppliersTable, eq(purchaseReceiptsTable.supplierId, suppliersTable.id))
    .orderBy(desc(purchaseReceiptsTable.receiptDate), desc(purchaseReceiptsTable.id));
  res.json(receipts.map(r => ({ ...r, totalAmount: Number(r.totalAmount) })));
});

router.post("/purchase-receipts", async (req, res): Promise<void> => {
  const { purchaseOrderId, supplierId, warehouseId, receiptDate, items, remarks, departmentId, projectId } = req.body;
  if (!supplierId || !receiptDate || !items?.length) {
    res.status(400).json({ error: "缺少必填欄位" }); return;
  }

  if (purchaseOrderId) {
    const [po] = await db.select().from(purchaseOrdersTable).where(eq(purchaseOrdersTable.id, purchaseOrderId));
    if (!po) { res.status(400).json({ error: "採購訂單不存在" }); return; }
    if (po.supplierId !== supplierId) { res.status(400).json({ error: "供應商與採購訂單不符" }); return; }
  }

  const orderItems: PRItem[] = [];
  let totalAmount = 0;
  for (const item of items) {
    if (!item.itemId || !Number.isFinite(item.quantity) || item.quantity <= 0) {
      res.status(400).json({ error: "品項數量必須為正數" }); return;
    }
    if (!Number.isFinite(item.rate) || item.rate < 0) {
      res.status(400).json({ error: "單價不能為負數" }); return;
    }
    const [dbItem] = await db.select({ itemName: itemsTable.itemName, isVirtual: itemsTable.isVirtual }).from(itemsTable).where(eq(itemsTable.id, item.itemId));
    if (!dbItem) { res.status(400).json({ error: `品項 ID ${item.itemId} 不存在` }); return; }
    const amount = item.quantity * item.rate;
    totalAmount += amount;
    orderItems.push({ itemId: item.itemId, itemName: dbItem.itemName, quantity: item.quantity, rate: item.rate, amount, isVirtual: dbItem.isVirtual });
  }

  try {
    const result = await db.transaction(async (tx) => {
      if (purchaseOrderId) {
        const [order] = await tx.select({ supplierId: purchaseOrdersTable.supplierId, status: purchaseOrdersTable.status, items: purchaseOrdersTable.items })
          .from(purchaseOrdersTable).where(eq(purchaseOrdersTable.id, purchaseOrderId)).for("update");
        if (!order) throw new Error("採購訂單不存在");
        if (order.supplierId !== supplierId) throw new Error("供應商與採購訂單不符");
        if (order.status === "Completed" || order.status === "Cancelled") throw new Error(`訂單狀態為「${order.status}」，無法建立進貨單`);
        const active = await tx.select({ items: purchaseReceiptsTable.items }).from(purchaseReceiptsTable)
          .where(and(eq(purchaseReceiptsTable.purchaseOrderId, purchaseOrderId), sql`${purchaseReceiptsTable.status} IN ('Draft','Submitted','Completed')`));
        const allowed = new Map<number, number>();
        for (const item of order.items as POItem[]) allowed.set(item.itemId, (allowed.get(item.itemId) || 0) + Number(item.quantity));
        const allocated = new Map<number, number>();
        for (const doc of active) for (const item of doc.items as PRItem[]) allocated.set(item.itemId, (allocated.get(item.itemId) || 0) + Number(item.quantity));
        for (const item of orderItems) {
          const next = (allocated.get(item.itemId) || 0) + item.quantity;
          if (!allowed.has(item.itemId) || next > (allowed.get(item.itemId) || 0)) throw new Error(`品項「${item.itemName}」收貨數量超過訂單剩餘數量`);
          allocated.set(item.itemId, next);
        }
      }
      const [receipt] = await tx.insert(purchaseReceiptsTable).values({
        receiptNumber: await nextDocNumber(tx, "purchase_receipts", "receipt_number", "PR", generatePRNumber), purchaseOrderId: purchaseOrderId || null, supplierId,
        warehouseId: warehouseId || null, receiptDate, totalAmount: String(totalAmount),
        items: orderItems, remarks: remarks || null,
        departmentId: departmentId ? Number(departmentId) : null,
        projectId: projectId ? Number(projectId) : null,
      }).returning();
      const [sup] = await tx.select({ name: suppliersTable.name }).from(suppliersTable).where(eq(suppliersTable.id, supplierId));
      await tx.insert(activitiesTable).values({
        type: "create", title: "進貨單已建立",
        description: `${receipt.receiptNumber} - ${sup?.name || "供應商"} - $${totalAmount.toFixed(2)}`, module: "Purchasing",
      });
      return { receipt, supplierName: sup?.name || "Unknown" };
    });
    res.status(201).json({ ...result.receipt, supplierName: result.supplierName, totalAmount });
  } catch (err: any) {
    res.status(400).json({ error: err?.message || "建立進貨單失敗" });
  }
});

/**
 * 把舊系統（Ecount）的進貨單併進進貨單。歷史單狀態是已完成、只能查看：
 * 不動庫存、不開採購發票、不入帳（存貨與應付已經由舊系統的傳票搬進來，再做一次會重複）。
 * 搬進來時還沒付給廠商的金額記在 extraFields.legacyUnpaid，只供查看。
 */
router.post("/purchase-receipts/legacy-import", requireRole("owner", "admin"), async (req, res): Promise<void> => {
  const documents: any[] = Array.isArray(req.body?.documents) ? req.body.documents : [];
  if (documents.length === 0 || documents.length > 500) { res.status(400).json({ error: "一次請送 1 到 500 張" }); return; }
  const values = [];
  for (const [index, d] of documents.entries()) {
    const h = readLegacyHeader(d, index, "supplierId");
    if (typeof h === "string") { res.status(400).json({ error: h }); return; }
    const unpaid = Math.round((Number(d.legacyUnpaid) || 0) * 100) / 100;
    if (unpaid < 0 || unpaid > Math.max(h.total, 0) + 0.005) { res.status(400).json({ error: `第 ${index + 1} 張（${h.number}）未付金額不正確` }); return; }
    values.push({
      receiptNumber: h.number, supplierId: h.partyId, warehouseId: h.warehouseId, receiptDate: h.date,
      status: "Completed", totalAmount: String(h.total), items: legacyStockLines(h.lines), remarks: h.remarks,
      projectId: h.projectId, departmentId: h.departmentId, createdAt: h.createdAt,
      extraFields: { ...h.extraFields, legacyUnpaid: unpaid },
    });
  }
  try {
    const inserted = await db.insert(purchaseReceiptsTable).values(values as any).onConflictDoNothing().returning({ id: purchaseReceiptsTable.id });
    res.status(201).json({ inserted: inserted.length, skipped: values.length - inserted.length });
  } catch (err: any) {
    res.status(400).json({ error: legacyImportError(err) });
  }
});

router.get("/purchase-receipts/:id", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "進貨單編號格式不正確" }); return; }
  const [receipt] = await db
    .select({
      id: purchaseReceiptsTable.id, receiptNumber: purchaseReceiptsTable.receiptNumber,
      purchaseOrderId: purchaseReceiptsTable.purchaseOrderId, supplierId: purchaseReceiptsTable.supplierId,
      supplierName: suppliersTable.name, warehouseId: purchaseReceiptsTable.warehouseId,
      receiptDate: purchaseReceiptsTable.receiptDate, status: purchaseReceiptsTable.status,
      totalAmount: purchaseReceiptsTable.totalAmount, items: purchaseReceiptsTable.items,
      remarks: purchaseReceiptsTable.remarks, createdAt: purchaseReceiptsTable.createdAt,
      departmentId: purchaseReceiptsTable.departmentId, projectId: purchaseReceiptsTable.projectId,
      extraFields: purchaseReceiptsTable.extraFields,
    })
    .from(purchaseReceiptsTable)
    .innerJoin(suppliersTable, eq(purchaseReceiptsTable.supplierId, suppliersTable.id))
    .where(eq(purchaseReceiptsTable.id, id));
  if (!receipt) { res.status(404).json({ error: "找不到進貨單" }); return; }
  res.json({ ...receipt, totalAmount: Number(receipt.totalAmount) });
});

router.patch("/purchase-receipts/:id", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "進貨單編號格式不正確" }); return; }

  const [existing] = await db.select().from(purchaseReceiptsTable).where(eq(purchaseReceiptsTable.id, id));
  if (!existing) { res.status(404).json({ error: "找不到進貨單" }); return; }
  {
    // 只改備註（歷史單另外可以改專案、部門）：不動庫存、不動帳，任何狀態都可以
    const keys = Object.keys(req.body || {});
    const legacyDoc = isLegacyDoc(existing.extraFields);
    const allowed = new Set(legacyDoc ? ["remarks", "projectId", "departmentId"] : ["remarks"]);
    const noteOnly = keys.length > 0 && keys.every(key => allowed.has(key));
    if (legacyDoc && !noteOnly) { res.status(400).json({ error: LEGACY_EDIT_LIMIT_MESSAGE }); return; }
    if (noteOnly && (legacyDoc || existing.status !== "Draft")) {
      const positive = (value: unknown): number | null => (Number.isInteger(Number(value)) && Number(value) > 0 ? Number(value) : null);
      const set: Record<string, unknown> = {};
      if (req.body.remarks !== undefined) set.remarks = String(req.body.remarks ?? "").trim().slice(0, 2000) || null;
      if (req.body.projectId !== undefined) {
        if (!positive(req.body.projectId)) { res.status(400).json({ error: "請選擇專案：每一筆收入與支出都必須歸屬到專案" }); return; }
        set.projectId = positive(req.body.projectId);
      }
      if (req.body.departmentId !== undefined) set.departmentId = positive(req.body.departmentId);
      try {
        const [row] = await db.update(purchaseReceiptsTable).set(set).where(eq(purchaseReceiptsTable.id, id)).returning();
        res.json({ ...row, totalAmount: Number(row.totalAmount) });
      } catch { res.status(400).json({ error: "更新失敗，請確認專案與部門都存在" }); }
      return;
    }
  }

  const { status, receiptDate, remarks, supplierId, warehouseId, departmentId, projectId, items } = req.body;
  const updateData: Record<string, unknown> = {};

  if (status) {
    const allowed = VALID_TRANSITIONS[existing.status] || [];
    if (!allowed.includes(status)) {
      res.status(400).json({ error: `無法從「${existing.status}」轉換為「${status}」` }); return;
    }
    updateData.status = status;
  }

  // 草稿限定的內容編輯（表頭與品項，含日期與備註）；已確認/已完成/已取消不可修改內容
  const wantsContentEdit = [supplierId, warehouseId, departmentId, projectId, items, receiptDate, remarks].some(v => v !== undefined);
  if (wantsContentEdit && existing.status !== "Draft") {
    res.status(400).json({ error: `僅草稿狀態的進貨單可編輯內容（目前狀態：${existing.status}）` }); return;
  }
  // 內容編輯與狀態轉換不可同一請求：避免以鎖定前的舊品項調整庫存後又覆寫品項，造成庫存與單據不一致
  if (wantsContentEdit && status) {
    res.status(400).json({ error: "請先儲存內容變更，再另行變更狀態" }); return;
  }

  if (existing.status === "Draft") {
    if (receiptDate !== undefined) updateData.receiptDate = receiptDate;
    if (remarks !== undefined) updateData.remarks = remarks;
    if (supplierId !== undefined) {
      const sid = Number(supplierId);
      if (!Number.isInteger(sid) || sid <= 0) { res.status(400).json({ error: "供應商格式不正確" }); return; }
      if (existing.purchaseOrderId) {
        const [po] = await db.select({ supplierId: purchaseOrdersTable.supplierId }).from(purchaseOrdersTable).where(eq(purchaseOrdersTable.id, existing.purchaseOrderId));
        if (po && po.supplierId !== sid) { res.status(400).json({ error: "供應商與採購訂單不符" }); return; }
      }
      const [sup] = await db.select({ id: suppliersTable.id }).from(suppliersTable).where(eq(suppliersTable.id, sid));
      if (!sup) { res.status(400).json({ error: "供應商不存在" }); return; }
      updateData.supplierId = sid;
    }
    if (warehouseId !== undefined) updateData.warehouseId = warehouseId === null || warehouseId === "" ? null : Number(warehouseId);
    if (departmentId !== undefined) updateData.departmentId = departmentId === null ? null : Number(departmentId);
    if (projectId !== undefined) updateData.projectId = projectId === null ? null : Number(projectId);
    if (items !== undefined) {
      if (!Array.isArray(items) || items.length === 0) { res.status(400).json({ error: "至少需要一個品項" }); return; }
      const newItems: PRItem[] = [];
      let totalAmount = 0;
      for (const item of items) {
        const itemId = Number(item?.itemId);
        const quantity = Number(item?.quantity);
        const rate = Number(item?.rate);
        if (!Number.isInteger(itemId) || itemId <= 0 || !Number.isFinite(quantity) || quantity <= 0) {
          res.status(400).json({ error: "品項數量必須為正數" }); return;
        }
        if (!Number.isFinite(rate) || rate < 0) { res.status(400).json({ error: "單價不能為負數" }); return; }
        const [dbItem] = await db.select({ itemName: itemsTable.itemName, isVirtual: itemsTable.isVirtual }).from(itemsTable).where(eq(itemsTable.id, itemId));
        if (!dbItem) { res.status(400).json({ error: `品項 ID ${itemId} 不存在` }); return; }
        const amount = quantity * rate;
        totalAmount += amount;
        newItems.push({ itemId, itemName: dbItem.itemName, quantity, rate, amount, isVirtual: dbItem.isVirtual });
      }
      updateData.items = newItems;
      updateData.totalAmount = String(totalAmount);
    }
  }

  let updated;
  try {
    updated = await db.transaction(async (tx) => {
      // 鎖定單據列並以鎖內狀態重新驗證，防止並發重複提交/作廢
      const [locked] = await tx.select().from(purchaseReceiptsTable).where(eq(purchaseReceiptsTable.id, id)).for("update");
      if (!locked) throw new Error("Not found");
      if (status) {
        const allowedNow = VALID_TRANSITIONS[locked.status] || [];
        if (!allowedNow.includes(status)) throw new Error(`無法從「${locked.status}」轉換為「${status}」`);
      }
      if (wantsContentEdit && locked.status !== "Draft") throw new Error(`僅草稿狀態的進貨單可編輯內容（目前狀態：${locked.status}）`);
      const receiptItems = locked.items as PRItem[];
      // 進貨單品項單價沿用採購單幣別；沒有母單的直接進貨視為 TWD。
      const resolveExchangeRate = async (): Promise<number> => {
        if (!locked.purchaseOrderId) return 1;
        const [purchaseOrder] = await tx.select({
          currency: purchaseOrdersTable.currency,
          exchangeRate: purchaseOrdersTable.exchangeRate,
        }).from(purchaseOrdersTable).where(eq(purchaseOrdersTable.id, locked.purchaseOrderId));
        if (!purchaseOrder) throw new Error("採購訂單不存在");
        const rate = purchaseOrder.currency === "TWD" ? 1 : Number(purchaseOrder.exchangeRate);
        if (!Number.isFinite(rate) || rate <= 0) throw new Error("採購訂單匯率無效");
        return rate;
      };
      if (status === "Submitted" && locked.status === "Draft") {
        // 進料檢驗關卡：連結的檢驗單要全部合格，必檢品項要先有合格檢驗單
        await assertIncomingInspectionPassed(tx, { id, items: receiptItems });
        // 提交收貨：以 TWD 加權更新移動平均成本並增加庫存，與狀態更新同交易
        await adjustStock(tx, receiptItems, 1, await resolveExchangeRate(), { warehouseId: locked.warehouseId ?? null, remarks: `進貨單 ${locked.receiptNumber} 入庫` }, !(await receiptCurrency(tx, locked.purchaseOrderId)).foreign);
        // 貨進來的同時入帳：存貨增加、對供應商的應付成立
        await ensureReceiptInvoice(tx, locked);
      }
      if (status === "Cancelled" && locked.status === "Submitted") {
        // 鎖定並檢查下游退貨，再碰品項列；維持 parent → return → items 的鎖順序，
        // 避免來源進貨扣回一次、採購退回又扣一次而重複減少庫存。
        const [activeReturn] = await tx.select({ id: purchaseReturnsTable.id }).from(purchaseReturnsTable)
          .where(and(
            eq(purchaseReturnsTable.purchaseReceiptId, id),
            sql`${purchaseReturnsTable.status} IN ('Submitted','Completed')`,
          )).for("update");
        if (activeReturn) throw new Error("此進貨單已有已確認或已完成的採購退回，請先取消退貨再作廢進貨單");
        // 收貨時自動開的發票跟著一起作廢；已經付過款或申請付款的要先處理，不能讓錢付了卻沒有對應的進貨
        const [inv] = await tx.select().from(invoicesTable)
          .where(and(eq(invoicesTable.purchaseReceiptId, id), sql`${invoicesTable.status} != 'Cancelled'`)).for("update");
        if (inv) {
          // 已經付過錢（含先付的訂金已經沖到這張發票）的不能自動作廢，要先把付款處理掉
          if (Number(inv.paidAmount) > 0 || inv.status === "Paid" || inv.status === "Partially Paid") {
            throw new Error(`這張進貨單的發票 ${inv.invoiceNumber} 已經付過款，請先作廢付款單再作廢進貨單`);
          }
          const [settled] = await tx.select({ id: invoiceSettlementsTable.id }).from(invoiceSettlementsTable).where(eq(invoiceSettlementsTable.invoiceId, inv.id)).limit(1);
          const [requested] = await tx.select({ id: paymentRequestsTable.id }).from(paymentRequestsTable)
            .where(and(eq(paymentRequestsTable.invoiceId, inv.id), sql`status NOT IN ('Cancelled','Rejected')`)).limit(1);
          if (settled) throw new Error(`這張進貨單的發票 ${inv.invoiceNumber} 已經付過款，請先作廢付款單再作廢進貨單`);
          if (requested) throw new Error(`這張進貨單的發票 ${inv.invoiceNumber} 已經申請付款，請先取消付款申請再作廢進貨單`);
          await deleteInvoiceJournalEntry(tx, inv);
          await tx.update(invoicesTable).set({ status: "Cancelled" }).where(eq(invoicesTable.id, inv.id));
        }
        // 已提交後作廢：扣回庫存（不足則拒絕），並以同一匯率反向移除本單對移動平均成本的貢獻
        await adjustStock(tx, receiptItems, -1, await resolveExchangeRate(), { warehouseId: locked.warehouseId ?? null, remarks: `進貨單 ${locked.receiptNumber} 作廢沖回` }, !(await receiptCurrency(tx, locked.purchaseOrderId)).foreign);
      }
      const [row] = await tx.update(purchaseReceiptsTable).set(updateData).where(eq(purchaseReceiptsTable.id, id)).returning();
      if (status && locked.purchaseOrderId) {
        await recalcPOStatus(tx, locked.purchaseOrderId);
      }
      return row;
    });
  } catch (err: any) {
    res.status(400).json({ error: err.message || "更新失敗" }); return;
  }

  res.json({ ...updated, totalAmount: Number(updated.totalAmount) });
});

router.post("/purchase-receipts/from-order/:orderId", async (req, res): Promise<void> => {
  const orderId = Number(req.params.orderId);
  if (isNaN(orderId)) { res.status(400).json({ error: "採購訂單編號格式不正確" }); return; }

  try {
    const result = await db.transaction(async (tx) => {
      // 鎖定母單，序列化同一訂單的剩餘量計算與草稿建立。
      const [order] = await tx.select().from(purchaseOrdersTable)
        .where(eq(purchaseOrdersTable.id, orderId)).for("update");
      if (!order) throw Object.assign(new Error("採購訂單不存在"), { statusCode: 404 });
      if (order.status === "Completed" || order.status === "Cancelled") {
        throw new Error(`訂單狀態為「${order.status}」，無法建立進貨單`);
      }
      const [supplier] = await tx.select({ name: suppliersTable.name }).from(suppliersTable)
        .where(eq(suppliersTable.id, order.supplierId));
      const allPRs = await tx.select({ items: purchaseReceiptsTable.items })
        .from(purchaseReceiptsTable)
        .where(and(eq(purchaseReceiptsTable.purchaseOrderId, orderId), sql`${purchaseReceiptsTable.status} IN ('Draft','Submitted','Completed')`));
      const received: Record<number, number> = {};
      for (const pr of allPRs) for (const item of pr.items as PRItem[]) {
        received[item.itemId] = (received[item.itemId] || 0) + item.quantity;
      }
      const orderItems = order.items as POItem[];
      const poItemIds = orderItems.map(oi => oi.itemId).filter(Boolean);
      const virtualIds = new Set<number>();
      if (poItemIds.length > 0) {
        const rows = await tx.select({ id: itemsTable.id }).from(itemsTable)
          .where(and(inArray(itemsTable.id, poItemIds), eq(itemsTable.isVirtual, true)));
        for (const r of rows) virtualIds.add(r.id);
      }
      const remainingItems: PRItem[] = [];
      let totalAmount = 0;
      for (const oi of orderItems) {
        const remaining = oi.quantity - (received[oi.itemId] || 0);
        if (remaining > 0) {
          const amount = remaining * oi.rate;
          totalAmount += amount;
          remainingItems.push({ itemId: oi.itemId, itemName: oi.itemName, quantity: remaining, rate: oi.rate, amount, isVirtual: virtualIds.has(oi.itemId) });
        }
      }
      if (remainingItems.length === 0) throw new Error("所有品項已完成收貨");
      const [receipt] = await tx.insert(purchaseReceiptsTable).values({
        receiptNumber: await nextDocNumber(tx, "purchase_receipts", "receipt_number", "PR", generatePRNumber), purchaseOrderId: orderId, supplierId: order.supplierId,
        warehouseId: Number(req.body?.warehouseId) || null,
        receiptDate: order.expectedDate || todayTaipei(),
        totalAmount: String(totalAmount), items: remainingItems,
        departmentId: order.departmentId, projectId: order.projectId,
      }).returning();
      await tx.insert(activitiesTable).values({
        type: "create", title: "從採購訂單建立進貨單",
        description: `${receipt.receiptNumber} - ${supplier?.name || "供應商"}`, module: "Purchasing",
      });
      return { receipt, supplierName: supplier?.name || "Unknown" };
    });
    res.status(201).json({ ...result.receipt, supplierName: result.supplierName, totalAmount: Number(result.receipt.totalAmount) });
  } catch (err: any) {
    res.status(err?.statusCode === 404 ? 404 : 400).json({ error: err?.message || "建立進貨單失敗" });
  }
});

// 從進貨單一鍵產生「採購發票 + 付款申請」，金額自動帶入不需重複輸入
router.post("/purchase-receipts/:id/payment-request", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "進貨單編號格式不正確" }); return; }

  const [receipt] = await db.select().from(purchaseReceiptsTable).where(eq(purchaseReceiptsTable.id, id));
  if (!receipt) { res.status(404).json({ error: "進貨單不存在" }); return; }
  // 歷史進貨單的應付已經在舊系統的傳票裡，再開發票會重複入帳
  if (isLegacyDoc(receipt.extraFields)) { res.status(400).json({ error: LEGACY_DOC_READONLY_MESSAGE }); return; }
  if (receipt.status !== "Submitted" && receipt.status !== "Completed") {
    res.status(400).json({ error: `進貨單狀態為「${receipt.status}」，須先提交收貨` }); return;
  }
  if (!receipt.supplierId) { res.status(400).json({ error: "進貨單缺少供應商" }); return; }

  const total = Number(receipt.totalAmount);
  if (total <= 0) { res.status(400).json({ error: "進貨單金額為 0，無法產生付款申請" }); return; }

  try {
    const result = await db.transaction(async (tx) => {
      // 收貨時通常已經自動開好發票；舊的進貨單（還沒有發票的）在這裡補開
      const inv = await ensureReceiptInvoice(tx, receipt);
      if (!inv) throw new Error("進貨單缺少供應商或金額，無法產生應付帳款");

      // 防重複：檢查是否已有未取消的付款申請關聯此發票
      const existingReqs = await tx.select({ amount: paymentRequestsTable.amount })
        .from(paymentRequestsTable)
        .where(and(eq(paymentRequestsTable.invoiceId, inv.id), sql`status NOT IN ('Cancelled','Rejected')`));
      const requested = existingReqs.reduce((s, r) => s + Number(r.amount), 0);
      const available = Math.round((Number(inv.outstandingAmount) - requested) * 100) / 100;
      if (available <= 0) throw new Error("此進貨單的發票已全額申請付款");

      const [request] = await tx.insert(paymentRequestsTable).values({
        requestNumber: "PRQ-" + String(Date.now()).slice(-8),
        invoiceId: inv.id,
        partyType: "Supplier",
        supplierId: receipt.supplierId,
        requestDate: todayTaipei(),
        amount: String(available),
        remarks: `自進貨單 ${receipt.receiptNumber} 自動產生`,
      }).returning();

      await tx.insert(activitiesTable).values({
        type: "create", title: "進貨付款申請",
        description: `${request.requestNumber} - $${available.toFixed(2)} (來自 ${receipt.receiptNumber})`,
        module: "Accounting",
      });
      return { invoice: inv, paymentRequest: request };
    });
    res.status(201).json({
      invoice: { ...result.invoice, totalAmount: Number(result.invoice.totalAmount) },
      paymentRequest: { ...result.paymentRequest, amount: Number(result.paymentRequest.amount) },
    });
  } catch (err: any) {
    if (pgErrorCode(err) === "23505" && pgErrorConstraint(err) === "invoices_prcpt_active_uniq") {
      res.status(409).json({ error: "此進貨單已同時被開立發票，請重新整理後再試" }); return;
    }
    res.status(400).json({ error: err.message || "產生付款申請失敗" });
  }
});

/**
 * 進貨附加費用（集運費、運費、報關費、關稅…）：貨到之後才知道的費用，攤進這批貨的成本。
 * 依各品項的金額比例分攤。還在倉庫裡的部分加到存貨成本（單位成本跟著提高）；
 * 這批貨如果已經賣掉一部分，賣掉的那部分直接記成銷貨成本。
 * 付款方式：已經付了就選付款帳戶；還沒付就選廠商，記成應付帳款。
 */
router.post("/purchase-receipts/:id/landed-cost", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) { res.status(400).json({ error: "進貨單編號格式不正確" }); return; }
  const amount = round2(Number(req.body?.amount)), taxAmount = round2(Number(req.body?.taxAmount ?? 0));
  const description = typeof req.body?.description === "string" && req.body.description.trim() ? req.body.description.trim().slice(0, 100) : "進貨附加費用";
  if (!(amount > 0)) { res.status(400).json({ error: "費用金額必須大於 0（請填換算成台幣的金額）" }); return; }
  if (taxAmount < 0 || taxAmount >= amount) { res.status(400).json({ error: "進項稅額不能是負數，也不能大於或等於費用金額" }); return; }
  const date = req.body?.date || todayTaipei();
  if (!isRealDate(date) || date > todayTaipei()) { res.status(400).json({ error: "日期格式不正確，或填在未來" }); return; }
  const payableSupplierId = Number(req.body?.supplierId) > 0 ? Number(req.body.supplierId) : null;
  if (!payableSupplierId && !req.body?.cashAccountId) { res.status(400).json({ error: "請選擇付款帳戶（已經付了），或選廠商（還沒付，記成應付帳款）" }); return; }
  try {
    const result = await db.transaction(async (tx) => {
      const [receipt] = await tx.select().from(purchaseReceiptsTable).where(eq(purchaseReceiptsTable.id, id)).for("update");
      if (!receipt) throw new Error("找不到這張進貨單");
      if (isLegacyDoc(receipt.extraFields)) throw new Error(LEGACY_DOC_READONLY_MESSAGE);
      if (receipt.status !== "Submitted" && receipt.status !== "Completed") throw new Error("進貨單要先收貨，才能加入附加費用");
      const [order] = receipt.purchaseOrderId
        ? await tx.select({ projectId: purchaseOrdersTable.projectId, departmentId: purchaseOrdersTable.departmentId }).from(purchaseOrdersTable).where(eq(purchaseOrdersTable.id, receipt.purchaseOrderId))
        : [];
      const lines = (receipt.items as PRItem[]).filter(item => !item.isVirtual);
      const itemRows = lines.length > 0
        ? await tx.select().from(itemsTable).where(inArray(itemsTable.id, [...new Set(lines.map(l => l.itemId))])).orderBy(itemsTable.id).for("update")
        : [];
      const physical = lines.filter(l => itemRows.some((row: { id: number; isVirtual: boolean }) => row.id === l.itemId && !row.isVirtual));
      if (physical.length === 0) throw new Error("這張進貨單沒有實體商品，附加費用沒有東西可以分攤；請改用請款單記成費用");
      const net = round2(amount - taxAmount);
      const shares = landedCostShares(net, physical.map(l => ({ itemId: l.itemId, quantity: l.quantity, amount: l.quantity * l.rate })),
        new Map(itemRows.map((row: { id: number; currentStock: string }) => [row.id, Number(row.currentStock || 0)])));
      for (const share of shares.items) {
        if (share.toInventory <= 0) continue;
        const row = itemRows.find((r: { id: number }) => r.id === share.itemId)!;
        const stock = Number(row.currentStock || 0);
        // 數量不變、總成本增加：單位成本 ＝（原本的庫存金額 ＋ 分攤到的費用）÷ 庫存數量
        const newAvg = (stock * Number(row.movingAvgCost || 0) + share.toInventory) / stock;
        await tx.update(itemsTable).set({ movingAvgCost: newAvg.toFixed(4) }).where(eq(itemsTable.id, share.itemId));
      }
      const credit = payableSupplierId
        ? { accountName: "應付帳款", debit: 0, credit: amount, description: `${receipt.receiptNumber} ${description} 應付` }
        : { ...(await cashLineAccount(tx, req.body.cashAccountId)), debit: 0, credit: amount, description: `${receipt.receiptNumber} ${description} 付款` };
      if (payableSupplierId) {
        const [supplier] = await tx.select({ id: suppliersTable.id }).from(suppliersTable).where(eq(suppliersTable.id, payableSupplierId));
        if (!supplier) throw new Error("找不到這家廠商");
      }
      const journal = await postAutoJournal(tx, {
        key: `PR${receipt.id}-LC`, entryDate: date, action: "加入進貨附加費用",
        projectId: order?.projectId ?? null, departmentId: order?.departmentId ?? null,
        description: `自動分錄 - 進貨單 ${receipt.receiptNumber} ${description}（攤進商品成本）`,
        lines: [
          { accountName: "存貨", debit: shares.toInventory, credit: 0, description: `${description} 攤入庫存成本` },
          ...(shares.toCogs > 0 ? [{ accountName: "銷貨成本", debit: shares.toCogs, credit: 0, description: `${description}（已售出的部分）` }] : []),
          ...(taxAmount > 0 ? [{ accountName: "進項稅額", debit: taxAmount, credit: 0, description: `${description} 進項稅額` }] : []),
          credit,
        ],
      });
      // 還沒付的費用另外開一張採購發票，之後才能用付款單沖掉、也會出現在應付帳齡表
      let invoiceNumber: string | null = null;
      if (payableSupplierId) {
        const [invoice] = await tx.insert(invoicesTable).values({
          invoiceNumber: `PINV-${receipt.receiptNumber}-LC${String(Date.now()).slice(-6)}`,
          invoiceType: "Purchase", supplierId: payableSupplierId, projectId: order?.projectId ?? null, invoiceDate: date, status: "Unpaid",
          totalAmount: String(amount), outstandingAmount: String(amount),
          taxType: taxAmount > 0 ? "taxable" : "exempt", taxRate: taxAmount > 0 ? "5" : "0", netAmount: String(net), taxAmount: String(taxAmount),
          govInvoiceNumber: typeof req.body?.govInvoiceNumber === "string" ? req.body.govInvoiceNumber.trim().slice(0, 20) || null : null,
          items: [{ itemName: `${description}（進貨單 ${receipt.receiptNumber}）`, quantity: 1, rate: net, amount: net }],
          journalEntryId: journal?.id ?? null,
        }).returning();
        invoiceNumber = invoice.invoiceNumber;
      }
      await tx.insert(activitiesTable).values({ type: "create", title: "進貨附加費用", description: `${receipt.receiptNumber} ${description} ${amount}`, module: "Purchasing" });
      return { ...shares, amount, taxAmount, journalEntryNumber: journal?.entryNumber ?? null, invoiceNumber };
    });
    res.status(201).json(result);
  } catch (err: any) {
    res.status(400).json({ error: err?.message || "加入附加費用失敗" });
  }
});

router.delete("/purchase-receipts/:id", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "進貨單編號格式不正確" }); return; }
  const [existing] = await db.select().from(purchaseReceiptsTable).where(eq(purchaseReceiptsTable.id, id));
  if (!existing) { res.status(404).json({ error: "找不到進貨單" }); return; }
  if (isLegacyDoc(existing.extraFields)) { res.status(400).json({ error: LEGACY_DOC_READONLY_MESSAGE }); return; }
  if (existing.status !== "Draft") {
    res.status(400).json({ error: "只能刪除草稿狀態的進貨單" }); return;
  }
  try {
    await db.transaction(async (tx) => {
      const [locked] = await tx.select().from(purchaseReceiptsTable)
        .where(eq(purchaseReceiptsTable.id, id)).for("update");
      if (!locked || locked.status !== "Draft") throw new Error("只能刪除草稿狀態的進貨單");
      await tx.delete(purchaseReceiptsTable).where(eq(purchaseReceiptsTable.id, id));
      if (locked.purchaseOrderId) await recalcPOStatus(tx, locked.purchaseOrderId);
    });
  } catch (err: any) {
    res.status(400).json({ error: err?.message || "刪除進貨單失敗" }); return;
  }
  res.json({ success: true });
});

export default router;
