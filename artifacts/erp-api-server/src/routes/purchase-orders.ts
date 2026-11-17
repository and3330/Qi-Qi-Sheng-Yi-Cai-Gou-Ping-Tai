import { Router, type IRouter } from "express";
import { nextDocNumber } from "../lib/doc-number";
import { randomUUID } from "node:crypto";
import { eq, and, sql } from "drizzle-orm";
import { db, purchaseOrdersTable, suppliersTable, itemsTable, activitiesTable, notificationsTable, purchaseReceiptsTable, invoicesTable } from "@workspace/erp-db";
import { desc } from "drizzle-orm";
import { createApprovalRequest, approvalBlockReason } from "../utils/approval-helper";
import {
  ListPurchaseOrdersQueryParams, CreatePurchaseOrderBody,
  GetPurchaseOrderParams, UpdatePurchaseOrderParams, UpdatePurchaseOrderBody,
} from "@workspace/erp-api-zod";

import { validateTemplateForProject } from "../lib/template-check";
import { friendlyValidationError } from "../lib/friendly-errors";
import { requireAuth, requireRole } from "../middleware/require-auth";
import { orderOutstanding, orderPaymentSummaries } from "../lib/order-payments";
import { isLegacyDoc, LEGACY_EDIT_LIMIT_MESSAGE, readLegacyHeader, legacyStockLines, legacyImportError } from "../lib/legacy";
const router: IRouter = Router();
router.use("/purchase-orders", requireAuth);

/** 品項明細的附加欄位：交付日期、摘要（格式不對就不存） */
function lineExtras(raw: any): { deliveryDate?: string; note?: string } {
  const out: { deliveryDate?: string; note?: string } = {};
  const d = typeof raw?.deliveryDate === "string" ? raw.deliveryDate.trim() : "";
  if (/^d{4}-d{2}-d{2}$/.test(d)) out.deliveryDate = d;
  const note = typeof raw?.note === "string" ? raw.note.trim().slice(0, 200) : "";
  if (note) out.note = note;
  return out;
}

function generatePONumber(): string {
  return `PO-${String(Date.now()).slice(-8)}-${randomUUID().slice(0, 6).toUpperCase()}`;
}

const PURCHASE_ORDER_STATUSES = new Set(["Draft", "To Receive", "Completed", "Cancelled"]);
const PURCHASE_ORDER_TRANSITIONS: Record<string, Set<string>> = {
  Draft: new Set(["To Receive", "Completed", "Cancelled"]),
  "To Receive": new Set(["Completed", "Cancelled"]),
  Completed: new Set(),
  Cancelled: new Set(),
};

async function assertPurchaseOrderStatusChange(tx: any, order: any, nextStatus: string): Promise<void> {
  if (!PURCHASE_ORDER_STATUSES.has(nextStatus)) throw new Error(`未知的採購訂單狀態「${nextStatus}」`);
  if (nextStatus === order.status) return;
  if (!PURCHASE_ORDER_TRANSITIONS[order.status]?.has(nextStatus)) {
    throw new Error(`無法從「${order.status}」轉換為「${nextStatus}」`);
  }
  // 有設定審批流程的採購訂單，核准前不能確認下單
  if (order.status === "Draft" && nextStatus !== "Cancelled") {
    const blocked = await approvalBlockReason(tx, "PurchaseOrder", order.id);
    if (blocked) throw new Error(blocked);
  }
  if (nextStatus === "Cancelled") {
    const [receipt] = await tx.select({ id: purchaseReceiptsTable.id }).from(purchaseReceiptsTable)
      .where(and(eq(purchaseReceiptsTable.purchaseOrderId, order.id), sql`${purchaseReceiptsTable.status} != 'Cancelled'`));
    const [invoice] = await tx.select({ id: invoicesTable.id }).from(invoicesTable)
      .where(and(eq(invoicesTable.purchaseOrderId, order.id), sql`${invoicesTable.status} != 'Cancelled'`));
    if (receipt || invoice) throw new Error("此採購訂單已有未取消的進貨單或發票，請先處理下游單據後再取消");
  }
  if (nextStatus !== "Completed") return;
  const receipts = await tx.select({ items: purchaseReceiptsTable.items }).from(purchaseReceiptsTable)
    .where(and(eq(purchaseReceiptsTable.purchaseOrderId, order.id), sql`${purchaseReceiptsTable.status} IN ('Submitted','Completed')`));
  const received = new Map<number, number>();
  for (const doc of receipts) for (const item of (doc.items as any[]) || []) {
    received.set(Number(item.itemId), (received.get(Number(item.itemId)) || 0) + Number(item.quantity || 0));
  }
  const orderItems = Array.isArray(order.items) ? order.items as any[] : [];
  const required = new Map<number, number>();
  for (const item of orderItems) required.set(Number(item.itemId), (required.get(Number(item.itemId)) || 0) + Number(item.quantity || 0));
  if (required.size === 0 || [...required].some(([itemId, quantity]) => (received.get(itemId) || 0) < quantity)) {
    throw new Error("採購品項尚未全部收貨，不能直接將採購訂單標記完成");
  }
}

router.get("/purchase-orders", async (req, res): Promise<void> => {
  const query = ListPurchaseOrdersQueryParams.safeParse(req.query);
  const conditions = [];
  if (query.success && query.data.status) conditions.push(eq(purchaseOrdersTable.status, query.data.status));
  if (query.success && query.data.supplierId) conditions.push(eq(purchaseOrdersTable.supplierId, query.data.supplierId));

  const orders = await db
    .select({
      id: purchaseOrdersTable.id, orderNumber: purchaseOrdersTable.orderNumber,
      supplierId: purchaseOrdersTable.supplierId, supplierName: suppliersTable.name,
      orderDate: purchaseOrdersTable.orderDate, expectedDate: purchaseOrdersTable.expectedDate,
      status: purchaseOrdersTable.status, totalAmount: purchaseOrdersTable.totalAmount,
      currency: purchaseOrdersTable.currency, exchangeRate: purchaseOrdersTable.exchangeRate,
      items: purchaseOrdersTable.items,
      templateId: purchaseOrdersTable.templateId,
      extraFields: purchaseOrdersTable.extraFields,
      departmentId: purchaseOrdersTable.departmentId,
      projectId: purchaseOrdersTable.projectId,
      createdAt: purchaseOrdersTable.createdAt,
    })
    .from(purchaseOrdersTable)
    .innerJoin(suppliersTable, eq(purchaseOrdersTable.supplierId, suppliersTable.id))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(purchaseOrdersTable.orderDate), desc(purchaseOrdersTable.id));

  // 已付金額＝直接核對這張採購單的付款＋它底下發票被沖銷的金額（本位幣）
  const payments = await orderPaymentSummaries(db, "purchase", orders.map(o => o.id));
  res.json(orders.map(o => {
    const exRate = Number(o.exchangeRate) || 1;
    const total = Number(o.totalAmount);
    const totalTWD = Math.round(total * exRate * 100) / 100;
    return {
      ...o, totalAmount: total, exchangeRate: exRate, totalAmountTWD: totalTWD,
      paidAmount: payments.get(o.id)?.paid || 0,
      outstandingAmount: o.status === "Cancelled" ? 0 : orderOutstanding(totalTWD, payments.get(o.id)),
    };
  }));
});

router.post("/purchase-orders", async (req, res): Promise<void> => {
  const parsed = CreatePurchaseOrderBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: friendlyValidationError(parsed.error) }); return; }

  // 幣別/匯率驗證：幣別限 3 碼英文，匯率須為正的有限數
  const currencyRaw = req.body.currency;
  if (currencyRaw != null && !/^[A-Za-z]{3}$/.test(String(currencyRaw))) {
    res.status(400).json({ error: "幣別格式無效（須為 3 碼英文，如 TWD/USD）" }); return;
  }
  const currency = currencyRaw ? String(currencyRaw).toUpperCase() : "TWD";
  const rateRaw = req.body.exchangeRate;

  const orderItems = [];
  let totalAmount = 0;
  for (const [index, item] of parsed.data.items.entries()) {
    const [dbItem] = await db.select({ itemName: itemsTable.itemName, itemCode: itemsTable.itemCode, specification: itemsTable.specification }).from(itemsTable).where(eq(itemsTable.id, item.itemId));
    const amount = item.quantity * item.rate;
    totalAmount += amount;
    orderItems.push({ itemId: item.itemId, itemCode: dbItem?.itemCode, itemName: dbItem?.itemName || "Unknown", specification: dbItem?.specification || undefined, quantity: item.quantity, rate: item.rate, amount, ...lineExtras(req.body.items?.[index]) });
  }

  // 外幣採購一定要給匯率：直接填匯率，或填「實際換這筆外幣花了多少台幣」由系統換算。
  // 原本沒填就當成 1，人民幣 1000 會被記成台幣 1000。
  let exchangeRate = 1;
  if (currency !== "TWD") {
    const twdTotal = Number(req.body.twdTotal);
    if (Number.isFinite(twdTotal) && twdTotal > 0 && totalAmount > 0) exchangeRate = Math.round((twdTotal / totalAmount) * 1_000_000) / 1_000_000;
    else if (rateRaw != null && rateRaw !== "") exchangeRate = Number(rateRaw);
    else { res.status(400).json({ error: `用 ${currency} 採購請輸入匯率，或輸入實際換匯花的台幣金額` }); return; }
    if (!Number.isFinite(exchangeRate) || exchangeRate <= 0) { res.status(400).json({ error: "匯率必須為正數" }); return; }
  }

  const departmentId = req.body.departmentId ? Number(req.body.departmentId) : null;
  const projectId = req.body.projectId ? Number(req.body.projectId) : null;

  const tplErr = await validateTemplateForProject(req.body.templateId, projectId, req.body.extraFields ?? {});
  if (tplErr) { res.status(400).json({ error: tplErr }); return; }

  const [order] = await db.insert(purchaseOrdersTable).values({
    orderNumber: await nextDocNumber(db, "purchase_orders", "order_number", "PO", generatePONumber),
    supplierId: parsed.data.supplierId,
    orderDate: parsed.data.orderDate,
    expectedDate: parsed.data.expectedDate,
    totalAmount: String(totalAmount),
    currency,
    exchangeRate: String(exchangeRate),
    items: orderItems,
    templateId: req.body.templateId ? Number(req.body.templateId) : null,
    extraFields: req.body.extraFields || {},
    departmentId,
    projectId,
  }).returning();

  const [sup] = await db.select({ name: suppliersTable.name }).from(suppliersTable).where(eq(suppliersTable.id, parsed.data.supplierId));

  await db.insert(activitiesTable).values({
    type: "create", title: "Purchase Order Created",
    description: `${order.orderNumber} from ${sup?.name || "supplier"} - $${totalAmount.toFixed(2)}`,
    module: "Purchasing",
  });

  await createApprovalRequest({
    module: "Purchasing",
    documentType: "PurchaseOrder",
    documentId: order.id,
    documentNumber: order.orderNumber,
    requestedBy: (req as any).session?.user?.username || "API",
  });
  await db.insert(notificationsTable).values({
    title: "新採購訂單",
    message: `${order.orderNumber} - ${sup?.name || "supplier"} - $${totalAmount.toFixed(2)}`,
    type: "approval",
    module: "Purchasing",
    documentType: "PurchaseOrder",
    documentId: order.id,
  });

  res.status(201).json({ ...order, supplierName: sup?.name || "Unknown", totalAmount });
});

/**
 * 把舊系統（Ecount）的採購單併進採購單。歷史單狀態是已完成、只能查看，不會動庫存也不會入帳。
 * 金額一律存台幣（外幣採購已經用當時的匯率換算，原幣金額留在明細上）。
 * Ecount 的應付帳款是跟著進貨單走的，所以歷史採購單都當作沒有未付金額。
 */
router.post("/purchase-orders/legacy-import", requireRole("owner", "admin"), async (req, res): Promise<void> => {
  const documents: any[] = Array.isArray(req.body?.documents) ? req.body.documents : [];
  if (documents.length === 0 || documents.length > 500) { res.status(400).json({ error: "一次請送 1 到 500 張" }); return; }
  const values = [];
  for (const [index, d] of documents.entries()) {
    const h = readLegacyHeader(d, index, "supplierId");
    if (typeof h === "string") { res.status(400).json({ error: h }); return; }
    values.push({
      orderNumber: h.number, supplierId: h.partyId, orderDate: h.date,
      expectedDate: /^\d{4}-\d{2}-\d{2}$/.test(String(d.expectedDate || "")) ? String(d.expectedDate) : null,
      status: "Completed", totalAmount: String(h.total), currency: "TWD", exchangeRate: "1",
      items: legacyStockLines(h.lines), projectId: h.projectId, departmentId: h.departmentId, createdAt: h.createdAt,
      extraFields: { ...h.extraFields, legacyPaid: Math.max(0, h.total), ...(h.remarks ? { legacyRemarks: h.remarks } : {}), ...(h.title ? { legacyTitle: h.title } : {}) },
    });
  }
  try {
    const inserted = await db.insert(purchaseOrdersTable).values(values as any).onConflictDoNothing().returning({ id: purchaseOrdersTable.id });
    res.status(201).json({ inserted: inserted.length, skipped: values.length - inserted.length });
  } catch (err: any) {
    res.status(400).json({ error: legacyImportError(err) });
  }
});

router.get("/purchase-orders/:id", async (req, res): Promise<void> => {
  const params = GetPurchaseOrderParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: friendlyValidationError(params.error) }); return; }
  const [order] = await db
    .select({
      id: purchaseOrdersTable.id, orderNumber: purchaseOrdersTable.orderNumber,
      supplierId: purchaseOrdersTable.supplierId, supplierName: suppliersTable.name,
      supplierCode: suppliersTable.supplierCode,
      supplierContactPerson: suppliersTable.contactPerson,
      supplierPhone: suppliersTable.phone,
      supplierEmail: suppliersTable.email,
      supplierTaxId: suppliersTable.taxId,
      orderDate: purchaseOrdersTable.orderDate, expectedDate: purchaseOrdersTable.expectedDate,
      status: purchaseOrdersTable.status, totalAmount: purchaseOrdersTable.totalAmount,
      currency: purchaseOrdersTable.currency, exchangeRate: purchaseOrdersTable.exchangeRate,
      items: purchaseOrdersTable.items,
      templateId: purchaseOrdersTable.templateId,
      extraFields: purchaseOrdersTable.extraFields,
      departmentId: purchaseOrdersTable.departmentId,
      projectId: purchaseOrdersTable.projectId,
      createdAt: purchaseOrdersTable.createdAt,
    })
    .from(purchaseOrdersTable)
    .innerJoin(suppliersTable, eq(purchaseOrdersTable.supplierId, suppliersTable.id))
    .where(eq(purchaseOrdersTable.id, params.data.id));
  if (!order) { res.status(404).json({ error: "找不到採購訂單" }); return; }
  const exRate = Number(order.exchangeRate) || 1;
  const total = Number(order.totalAmount);
  res.json({ ...order, totalAmount: total, exchangeRate: exRate, totalAmountTWD: Math.round(total * exRate * 100) / 100 });
});

router.get("/purchase-orders/:id/receipts", async (req, res): Promise<void> => {
  const params = GetPurchaseOrderParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: friendlyValidationError(params.error) }); return; }
  const receipts = await db
    .select({
      id: purchaseReceiptsTable.id,
      receiptNumber: purchaseReceiptsTable.receiptNumber,
      receiptDate: purchaseReceiptsTable.receiptDate,
      status: purchaseReceiptsTable.status,
      totalAmount: purchaseReceiptsTable.totalAmount,
      items: purchaseReceiptsTable.items,
      remarks: purchaseReceiptsTable.remarks,
      createdAt: purchaseReceiptsTable.createdAt,
    })
    .from(purchaseReceiptsTable)
    .where(eq(purchaseReceiptsTable.purchaseOrderId, params.data.id))
    .orderBy(desc(purchaseReceiptsTable.id));
  res.json(receipts.map(r => ({ ...r, totalAmount: Number(r.totalAmount) })));
});

router.patch("/purchase-orders/:id", async (req, res): Promise<void> => {
  const params = UpdatePurchaseOrderParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: friendlyValidationError(params.error) }); return; }
  const parsed = UpdatePurchaseOrderBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: friendlyValidationError(parsed.error) }); return; }

  const [existing] = await db.select().from(purchaseOrdersTable).where(eq(purchaseOrdersTable.id, params.data.id));
  if (!existing) { res.status(404).json({ error: "找不到採購訂單" }); return; }
  if (isLegacyDoc(existing.extraFields)) {
    // 歷史採購單：可以改專案、部門、預計到貨日、標題、備註；其他不能改
    const allowed = new Set(["projectId", "departmentId", "expectedDate", "legacyTitle", "legacyRemarks"]);
    const keys = Object.keys(req.body || {});
    if (keys.length === 0 || keys.some(key => !allowed.has(key))) { res.status(400).json({ error: LEGACY_EDIT_LIMIT_MESSAGE }); return; }
    const positive = (value: unknown): number | null => (Number.isInteger(Number(value)) && Number(value) > 0 ? Number(value) : null);
    const set: Record<string, unknown> = {};
    if (req.body.projectId !== undefined) {
      if (!positive(req.body.projectId)) { res.status(400).json({ error: "請選擇專案：每一筆收入與支出都必須歸屬到專案" }); return; }
      set.projectId = positive(req.body.projectId);
    }
    if (req.body.departmentId !== undefined) set.departmentId = positive(req.body.departmentId);
    if (req.body.expectedDate !== undefined) set.expectedDate = /^\d{4}-\d{2}-\d{2}$/.test(String(req.body.expectedDate || "")) ? String(req.body.expectedDate) : null;
    if (req.body.legacyTitle !== undefined || req.body.legacyRemarks !== undefined) {
      const extra = { ...(existing.extraFields as Record<string, unknown>) };
      if (req.body.legacyTitle !== undefined) extra.legacyTitle = String(req.body.legacyTitle ?? "").trim().slice(0, 300);
      if (req.body.legacyRemarks !== undefined) extra.legacyRemarks = String(req.body.legacyRemarks ?? "").trim().slice(0, 2000);
      set.extraFields = extra;
    }
    try {
      const [updated] = await db.update(purchaseOrdersTable).set(set).where(eq(purchaseOrdersTable.id, params.data.id)).returning();
      res.json({ ...updated, totalAmount: Number(updated.totalAmount), supplierName: "Supplier" });
    } catch (err: any) {
      res.status(400).json({ error: "更新失敗，請確認專案與部門都存在" });
    }
    return;
  }

  if (req.body.templateId !== undefined || req.body.projectId !== undefined) {
    const finalTpl = req.body.templateId !== undefined ? req.body.templateId : existing.templateId;
    const finalProj = req.body.projectId !== undefined ? req.body.projectId : existing.projectId;
    const tplErr = await validateTemplateForProject(finalTpl, finalProj);
    if (tplErr) { res.status(400).json({ error: tplErr }); return; }
  }

  // 草稿限定的完整編輯欄位（品項與表頭）；已確認/已完成/已取消不可修改內容
  const draftOnlyFields = ["supplierId", "orderDate", "currency", "exchangeRate", "departmentId", "projectId", "templateId", "extraFields", "items"] as const;
  const wantsContentEdit = draftOnlyFields.some(f => req.body[f] !== undefined);
  if (wantsContentEdit && existing.status !== "Draft") {
    res.status(400).json({ error: `僅草稿狀態的採購訂單可編輯內容（目前狀態：${existing.status}）` }); return;
  }
  // 內容編輯與狀態轉換不可同一請求
  if (wantsContentEdit && req.body.status !== undefined) {
    res.status(400).json({ error: "請先儲存內容變更，再另行變更狀態" }); return;
  }

  const extra: Record<string, unknown> = {};
  if (wantsContentEdit) {
    if (req.body.supplierId !== undefined) {
      const supplierId = Number(req.body.supplierId);
      if (!Number.isInteger(supplierId) || supplierId <= 0) { res.status(400).json({ error: "供應商格式不正確" }); return; }
      const [sup] = await db.select({ id: suppliersTable.id }).from(suppliersTable).where(eq(suppliersTable.id, supplierId));
      if (!sup) { res.status(400).json({ error: "供應商不存在" }); return; }
      extra["supplierId"] = supplierId;
    }
    if (req.body.orderDate !== undefined) {
      if (typeof req.body.orderDate !== "string" || !req.body.orderDate) { res.status(400).json({ error: "訂單日期格式不正確" }); return; }
      extra["orderDate"] = req.body.orderDate;
    }
    if (req.body.currency !== undefined) {
      if (!/^[A-Za-z]{3}$/.test(String(req.body.currency))) { res.status(400).json({ error: "幣別格式無效（須為 3 碼英文，如 TWD/USD）" }); return; }
      extra["currency"] = String(req.body.currency).toUpperCase();
    }
    if (req.body.exchangeRate !== undefined) {
      const rate = Number(req.body.exchangeRate);
      if (!Number.isFinite(rate) || rate <= 0) { res.status(400).json({ error: "匯率必須為正數" }); return; }
      extra["exchangeRate"] = String(rate);
    }
    if (req.body.departmentId !== undefined) extra["departmentId"] = req.body.departmentId === null ? null : Number(req.body.departmentId);
    if (req.body.projectId !== undefined) extra["projectId"] = req.body.projectId === null ? null : Number(req.body.projectId);
    if (req.body.items !== undefined) {
      if (!Array.isArray(req.body.items) || req.body.items.length === 0) { res.status(400).json({ error: "至少需要一個品項" }); return; }
      const orderItems = [];
      let totalAmount = 0;
      for (const item of req.body.items) {
        const itemId = Number(item?.itemId);
        const quantity = Number(item?.quantity);
        const rate = Number(item?.rate);
        if (!Number.isInteger(itemId) || itemId <= 0 || !Number.isFinite(quantity) || quantity <= 0) {
          res.status(400).json({ error: "品項數量必須為正數" }); return;
        }
        if (!Number.isFinite(rate) || rate < 0) { res.status(400).json({ error: "單價不能為負數" }); return; }
        const [dbItem] = await db.select({ itemName: itemsTable.itemName, itemCode: itemsTable.itemCode, specification: itemsTable.specification }).from(itemsTable).where(eq(itemsTable.id, itemId));
        if (!dbItem) { res.status(400).json({ error: `品項 ID ${itemId} 不存在` }); return; }
        const amount = quantity * rate;
        totalAmount += amount;
        orderItems.push({ itemId, itemCode: dbItem.itemCode, itemName: dbItem.itemName, specification: dbItem.specification || undefined, quantity, rate, amount, ...lineExtras(item) });
      }
      extra["items"] = orderItems;
      extra["totalAmount"] = String(totalAmount);
    }
  }

  if (req.body.templateId !== undefined) extra["templateId"] = req.body.templateId === null ? null : Number(req.body.templateId);
  if (req.body.extraFields !== undefined) extra["extraFields"] = req.body.extraFields;
  try {
    const order = await db.transaction(async (tx) => {
      const [locked] = await tx.select().from(purchaseOrdersTable)
        .where(eq(purchaseOrdersTable.id, params.data.id)).for("update");
      if (!locked) return null;
      if (wantsContentEdit && locked.status !== "Draft") {
        throw new Error(`僅草稿狀態的採購訂單可編輯內容（目前狀態：${locked.status}）`);
      }
      if (req.body.status !== undefined) await assertPurchaseOrderStatusChange(tx, locked, req.body.status);
      const [updated] = await tx.update(purchaseOrdersTable).set({ ...parsed.data, ...extra })
        .where(eq(purchaseOrdersTable.id, params.data.id)).returning();
      return updated;
    });
    if (!order) { res.status(404).json({ error: "找不到採購訂單" }); return; }
    res.json({ ...order, totalAmount: Number(order.totalAmount), supplierName: "Supplier" });
  } catch (err: any) {
    res.status(400).json({ error: err?.message || "更新採購訂單失敗" });
  }
});

export default router;
