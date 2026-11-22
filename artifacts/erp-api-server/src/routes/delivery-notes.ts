import { Router, type IRouter } from "express";
import { todayTaipei } from "../lib/inventory-journal";
import { logStockMovement } from "../lib/stock-ledger";
import { nextDocNumber } from "../lib/doc-number";
import { randomUUID } from "node:crypto";
import { desc, eq, sql, and, inArray } from "drizzle-orm";
import { db, deliveryNotesTable, salesOrdersTable, customersTable, itemsTable, activitiesTable, invoicesTable, journalEntriesTable, salesReturnsTable, employeesTable, warehousesTable } from "@workspace/erp-db";
import { requireAuth } from "../middleware/require-auth";
import { assertLinkedInspectionsAccepted } from "../lib/quality-gate";
import { resolveJournalLinesStrict, assertPeriodOpen, syncSalesOrderJournalEntry } from "../lib/auto-journal";
import { partyLineText, itemsSummary } from "../lib/voucher-entry-text";

/** 出貨的銷貨成本摘要：「銷貨成本 第一個品名 等 N 項」 */
const deliverySummary = (items: Array<{ itemName?: string }>) => `銷貨成本 ${itemsSummary(items.map(i => i.itemName))}`.trim();

const router: IRouter = Router();
router.use("/delivery-notes", requireAuth);

function generateDNNumber(): string {
  return `DN-${String(Date.now()).slice(-8)}-${randomUUID().slice(0, 6).toUpperCase()}`;
}

interface DNItem {
  itemId: number;
  itemName: string;
  quantity: number;
  rate: number;
  amount: number;
  /** 建單當下的虛擬服務快照；舊單據無此欄位時回查品項主檔 */
  isVirtual?: boolean;
  /** 建單當下的單位成本快照（移動平均成本，虛擬服務為 0）；舊單據無此欄位時 fallback 現行成本 */
  unitCost?: number;
  /** 規格、摘要：照 Ecount 的明細欄位，只是說明文字，不影響庫存與帳 */
  specification?: string;
  note?: string;
}

/** 明細上的說明文字（規格、摘要）：有填才存 */
function lineTexts(item: any): { specification?: string; note?: string } {
  const text = (value: unknown, max: number) => (typeof value === "string" && value.trim() ? value.trim().slice(0, max) : undefined);
  const specification = text(item?.specification, 200);
  const note = text(item?.note, 500);
  return { ...(specification ? { specification } : {}), ...(note ? { note } : {}) };
}
/** 選填的主檔編號（承辦人、倉庫）：沒填回 null，格式不對回 undefined */
function optionalId(value: unknown): number | null | undefined {
  if (value === undefined || value === null || value === "") return null;
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : undefined;
}
const optionalText = (value: unknown, max: number): string | null => (typeof value === "string" && value.trim() ? value.trim().slice(0, max) : null);

interface SOItem {
  itemId: number;
  itemName: string;
  quantity: number;
  rate: number;
  amount: number;
  isVirtual?: boolean;
  specification?: string | null;
  summary?: string | null;
}

const VALID_TRANSITIONS: Record<string, string[]> = {
  Draft: ["Submitted", "Cancelled"],
  Submitted: ["Completed", "Cancelled"],
  Completed: [],
  Cancelled: [],
};

/** 在交易內調整品項庫存（負數為扣減），扣減時檢查庫存足夠；虛擬服務不動庫存 */
async function adjustStock(tx: any, items: DNItem[], direction: 1 | -1, ledger?: { warehouseId: number | null; remarks: string }) {
  for (const item of items) {
    const [row] = await tx.select({ id: itemsTable.id, itemName: itemsTable.itemName, currentStock: itemsTable.currentStock, isVirtual: itemsTable.isVirtual })
      .from(itemsTable).where(eq(itemsTable.id, item.itemId)).for("update");
    if (!row) throw new Error(`品項 ID ${item.itemId} 不存在`);
    if (item.isVirtual ?? row.isVirtual) continue; // 虛擬服務：不需出貨、不追蹤庫存（優先用建單快照）
    const newStock = Number(row.currentStock || 0) + direction * item.quantity;
    if (newStock < 0) throw new Error(`品項「${row.itemName}」庫存不足（現有 ${Number(row.currentStock || 0)}，需出貨 ${item.quantity}）`);
    await tx.update(itemsTable).set({ currentStock: String(newStock) }).where(eq(itemsTable.id, item.itemId));
    // 記到倉庫的進出紀錄，分倉數量才會對
    if (ledger) await logStockMovement(tx, { direction, itemId: item.itemId, warehouseId: ledger.warehouseId, quantity: item.quantity, remarks: ledger.remarks, source: "delivery" });
  }
}

/** 計算出貨單的銷貨成本總額：優先用建單成本快照，舊單據無快照時 fallback 現行成本（虛擬服務為 0） */
async function computeCogsAmount(tx: any, items: DNItem[]): Promise<number> {
  let total = 0;
  for (const item of items) {
    let unitCost = item.unitCost;
    if (unitCost === undefined || unitCost === null) {
      // 舊資料 fallback：回查品項現行移動平均成本
      const [row] = await tx.select({ isVirtual: itemsTable.isVirtual, movingAvgCost: itemsTable.movingAvgCost, buyingPrice: itemsTable.buyingPrice })
        .from(itemsTable).where(eq(itemsTable.id, item.itemId));
      unitCost = !row || row.isVirtual ? 0 : (Number(row.movingAvgCost) || Number(row.buyingPrice) || 0);
    }
    total += (Number(unitCost) || 0) * item.quantity;
  }
  return Math.round(total * 100) / 100;
}

export async function recalcOrderStatus(
  salesOrderId: number,
  opts?: { extraReturnItems?: Array<{ itemId: number; quantity: number }> },
  transaction?: any,
): Promise<void> {
  if (!transaction) {
    await db.transaction(async (tx) => recalcOrderStatus(salesOrderId, opts, tx));
    return;
  }
  const tx = transaction;
  const [order] = await tx.select({ items: salesOrdersTable.items, status: salesOrdersTable.status })
    .from(salesOrdersTable).where(eq(salesOrdersTable.id, salesOrderId)).for("update");
  if (!order) return;
  if (order.status === "Cancelled") return; // 已取消的訂單不因出貨/退貨重算而復活

  let orderItems = order.items as SOItem[];
  // 虛擬服務品項不需出貨，不列入出貨完成度計算
  const itemIds = orderItems.filter(oi => oi.isVirtual === undefined).map(oi => oi.itemId).filter(Boolean);
  const virtualIds = new Set<number>();
  if (itemIds.length > 0) {
    const virtualRows = await tx.select({ id: itemsTable.id }).from(itemsTable)
      .where(and(inArray(itemsTable.id, itemIds), eq(itemsTable.isVirtual, true)));
    for (const row of virtualRows as Array<{ id: number }>) virtualIds.add(row.id);
  }
  orderItems = orderItems.filter(oi => oi.isVirtual === false || (oi.isVirtual === undefined && !virtualIds.has(oi.itemId)));
  if (orderItems.length === 0) return; // 全部是虛擬服務，訂單狀態不由出貨決定

  const allDNs = await tx.select({ items: deliveryNotesTable.items, status: deliveryNotesTable.status })
    .from(deliveryNotesTable)
    .where(and(eq(deliveryNotesTable.salesOrderId, salesOrderId), sql`${deliveryNotesTable.status} IN ('Submitted','Completed')`));

  const delivered: Record<number, number> = {};
  for (const dn of allDNs) {
    for (const item of dn.items as DNItem[]) {
      delivered[item.itemId] = (delivered[item.itemId] || 0) + item.quantity;
    }
  }

  // 扣除退貨數量（已確認的銷貨退回，透過訂單的出貨單關聯）
  const dnIds = await tx.select({ id: deliveryNotesTable.id }).from(deliveryNotesTable)
    .where(eq(deliveryNotesTable.salesOrderId, salesOrderId));
  if (dnIds.length > 0) {
    const returns = await tx.select({ items: salesReturnsTable.items }).from(salesReturnsTable)
      .where(and(
        inArray(salesReturnsTable.deliveryNoteId, dnIds.map((d: { id: number }) => d.id)),
        sql`${salesReturnsTable.status} NOT IN ('Cancelled', 'Draft')`,
      ));
    for (const ret of returns) {
      for (const item of (ret.items as DNItem[]) || []) {
        delivered[item.itemId] = (delivered[item.itemId] || 0) - item.quantity;
      }
    }
  }
  // 同一請求內剛確認、狀態尚未寫入的退貨數量（避免讀不到新狀態）
  for (const item of opts?.extraReturnItems || []) {
    delivered[item.itemId] = (delivered[item.itemId] || 0) - item.quantity;
  }

  let allFulfilled = true;
  let anyFulfilled = false;
  for (const oi of orderItems) {
    const qty = delivered[oi.itemId] || 0;
    if (qty >= oi.quantity) anyFulfilled = true;
    else allFulfilled = false;
    if (qty > 0) anyFulfilled = true;
  }

  const newStatus = allFulfilled ? "Completed" : anyFulfilled ? "To Deliver" : "Draft";
  await tx.update(salesOrdersTable).set({ status: newStatus }).where(eq(salesOrdersTable.id, salesOrderId));
  // 狀態變動後同步營收分錄（退回 Draft 會移除分錄；成立狀態間互轉不動分錄）
  await syncSalesOrderJournalEntry(tx, salesOrderId);
}

router.get("/delivery-notes", async (_req, res): Promise<void> => {
  const notes = await db
    .select({
      id: deliveryNotesTable.id, noteNumber: deliveryNotesTable.noteNumber,
      salesOrderId: deliveryNotesTable.salesOrderId, customerId: deliveryNotesTable.customerId,
      customerName: customersTable.name, warehouseId: deliveryNotesTable.warehouseId,
      deliveryDate: deliveryNotesTable.deliveryDate, status: deliveryNotesTable.status,
      totalAmount: deliveryNotesTable.totalAmount, items: deliveryNotesTable.items,
      remarks: deliveryNotesTable.remarks, createdAt: deliveryNotesTable.createdAt,
      departmentId: deliveryNotesTable.departmentId, projectId: deliveryNotesTable.projectId,
      handlerId: deliveryNotesTable.handlerId, contactInfo: deliveryNotesTable.contactInfo, shippingAddress: deliveryNotesTable.shippingAddress,
    })
    .from(deliveryNotesTable)
    .innerJoin(customersTable, eq(deliveryNotesTable.customerId, customersTable.id))
    .orderBy(desc(deliveryNotesTable.deliveryDate), desc(deliveryNotesTable.id));
  res.json(notes.map(n => ({ ...n, totalAmount: Number(n.totalAmount) })));
});

router.post("/delivery-notes", async (req, res): Promise<void> => {
  const { salesOrderId, customerId, warehouseId, deliveryDate, items, remarks, departmentId, projectId } = req.body;
  if (!customerId || !deliveryDate || !items?.length) {
    res.status(400).json({ error: "缺少必填欄位" }); return;
  }
  const handlerId = optionalId(req.body.handlerId);
  if (handlerId === undefined) { res.status(400).json({ error: "承辦人格式不正確" }); return; }

  if (salesOrderId) {
    const [so] = await db.select().from(salesOrdersTable).where(eq(salesOrdersTable.id, salesOrderId));
    if (!so) { res.status(400).json({ error: "銷售訂單不存在" }); return; }
    // 舊系統搬來的歷史單：貨早就出了，再建出貨單會重複扣庫存
    if (so.orderSource === "ecount") { res.status(400).json({ error: "這是從舊系統（Ecount）搬過來的歷史單據，不能再建立出貨單" }); return; }
    if (so.customerId !== customerId) { res.status(400).json({ error: "客戶與銷售訂單不符" }); return; }
  }

  const orderItems: DNItem[] = [];
  let totalAmount = 0;
  for (const item of items) {
    if (!item.itemId || !Number.isFinite(item.quantity) || item.quantity <= 0) {
      res.status(400).json({ error: "品項數量必須為正數" }); return;
    }
    if (!Number.isFinite(item.rate) || item.rate < 0) {
      res.status(400).json({ error: "單價不能為負數" }); return;
    }
    const [dbItem] = await db.select({ itemName: itemsTable.itemName, isVirtual: itemsTable.isVirtual, movingAvgCost: itemsTable.movingAvgCost, buyingPrice: itemsTable.buyingPrice }).from(itemsTable).where(eq(itemsTable.id, item.itemId));
    if (!dbItem) { res.status(400).json({ error: `品項 ID ${item.itemId} 不存在` }); return; }
    const amount = item.quantity * item.rate;
    totalAmount += amount;
    const unitCost = dbItem.isVirtual ? 0 : (Number(dbItem.movingAvgCost) || Number(dbItem.buyingPrice) || 0);
    orderItems.push({ itemId: item.itemId, itemName: dbItem.itemName, quantity: item.quantity, rate: item.rate, amount, isVirtual: dbItem.isVirtual, unitCost, ...lineTexts(item) });
  }

  try {
    const result = await db.transaction(async (tx) => {
      if (salesOrderId) {
        const [order] = await tx.select({ customerId: salesOrdersTable.customerId, status: salesOrdersTable.status, items: salesOrdersTable.items })
          .from(salesOrdersTable).where(eq(salesOrdersTable.id, salesOrderId)).for("update");
        if (!order) throw new Error("銷售訂單不存在");
        if (order.customerId !== customerId) throw new Error("客戶與銷售訂單不符");
        if (order.status === "Completed" || order.status === "Cancelled") throw new Error(`訂單狀態為「${order.status}」，無法建立出貨單`);
        const active = await tx.select({ items: deliveryNotesTable.items }).from(deliveryNotesTable)
          .where(and(eq(deliveryNotesTable.salesOrderId, salesOrderId), sql`${deliveryNotesTable.status} IN ('Draft','Submitted','Completed')`));
        const allowed = new Map<number, number>();
        for (const item of order.items as SOItem[]) allowed.set(item.itemId, (allowed.get(item.itemId) || 0) + Number(item.quantity));
        const allocated = new Map<number, number>();
        for (const doc of active) for (const item of doc.items as DNItem[]) allocated.set(item.itemId, (allocated.get(item.itemId) || 0) + Number(item.quantity));
        for (const item of orderItems) {
          const next = (allocated.get(item.itemId) || 0) + item.quantity;
          if (!allowed.has(item.itemId) || next > (allowed.get(item.itemId) || 0)) throw new Error(`品項「${item.itemName}」出貨數量超過訂單剩餘數量`);
          allocated.set(item.itemId, next);
        }
      }
      const [note] = await tx.insert(deliveryNotesTable).values({
        noteNumber: await nextDocNumber(tx, "delivery_notes", "note_number", "DN", generateDNNumber), salesOrderId: salesOrderId || null, customerId,
        warehouseId: warehouseId || null, deliveryDate, totalAmount: String(totalAmount),
        items: orderItems, remarks: remarks || null,
        departmentId: departmentId ? Number(departmentId) : null,
        projectId: projectId ? Number(projectId) : null,
        handlerId, contactInfo: optionalText(req.body.contactInfo, 200), shippingAddress: optionalText(req.body.shippingAddress, 500),
      }).returning();
      const [cust] = await tx.select({ name: customersTable.name }).from(customersTable).where(eq(customersTable.id, customerId));
      await tx.insert(activitiesTable).values({
        type: "create", title: "出貨單已建立",
        description: `${note.noteNumber} - ${cust?.name || "客戶"} - $${totalAmount.toFixed(2)}`, module: "Sales",
      });
      return { note, customerName: cust?.name || "Unknown" };
    });
    res.status(201).json({ ...result.note, customerName: result.customerName, totalAmount });
  } catch (err: any) {
    res.status(400).json({ error: err?.message || "建立出貨單失敗" });
  }
});

/** 「從銷貨單帶入」的選單：還沒出完、也不是舊系統搬來的銷貨單 */
router.get("/delivery-notes/open-orders", async (_req, res): Promise<void> => {
  const orders = await db.select({
    id: salesOrdersTable.id, orderNumber: salesOrdersTable.orderNumber, customerId: salesOrdersTable.customerId,
    customerName: customersTable.name, orderDate: salesOrdersTable.orderDate, label: salesOrdersTable.label, status: salesOrdersTable.status,
  }).from(salesOrdersTable)
    .innerJoin(customersTable, eq(salesOrdersTable.customerId, customersTable.id))
    .where(and(sql`${salesOrdersTable.status} NOT IN ('Completed','Cancelled')`, sql`COALESCE(${salesOrdersTable.orderSource}, '') <> 'ecount'`))
    .orderBy(desc(salesOrdersTable.orderDate), desc(salesOrdersTable.id)).limit(300);
  res.json(orders);
});

/** 一張銷貨單還剩哪些品項、各多少沒出貨（草稿出貨單也算已佔用），給出貨單表單帶入用 */
router.get("/delivery-notes/order-remaining/:orderId", async (req, res): Promise<void> => {
  const orderId = Number(req.params.orderId);
  if (!Number.isInteger(orderId) || orderId <= 0) { res.status(400).json({ error: "銷貨單編號格式不正確" }); return; }
  const [order] = await db.select().from(salesOrdersTable).where(eq(salesOrdersTable.id, orderId));
  if (!order) { res.status(404).json({ error: "銷售訂單不存在" }); return; }
  if (order.orderSource === "ecount") { res.status(400).json({ error: "這是從舊系統（Ecount）搬過來的歷史單據，不能再建立出貨單" }); return; }
  if (order.status === "Completed" || order.status === "Cancelled") { res.status(400).json({ error: `訂單狀態為「${order.status}」，無法建立出貨單` }); return; }
  const active = await db.select({ items: deliveryNotesTable.items }).from(deliveryNotesTable)
    .where(and(eq(deliveryNotesTable.salesOrderId, orderId), sql`${deliveryNotesTable.status} IN ('Draft','Submitted','Completed')`));
  const used = new Map<number, number>();
  for (const doc of active) for (const item of doc.items as DNItem[]) used.set(item.itemId, (used.get(item.itemId) || 0) + Number(item.quantity));
  const lines: Array<{ itemId: number; itemName: string; quantity: number; orderQuantity: number; rate: number; specification: string | null; note: string | null }> = [];
  for (const item of (order.items as SOItem[]) || []) {
    if (!item.itemId) continue; // 沒有對到品項主檔的文字行不能出貨
    const taken = Math.min(used.get(item.itemId) || 0, Number(item.quantity));
    used.set(item.itemId, (used.get(item.itemId) || 0) - taken);
    const remaining = Number(item.quantity) - taken;
    if (remaining > 0) lines.push({ itemId: item.itemId, itemName: item.itemName, quantity: remaining, orderQuantity: Number(item.quantity), rate: Number(item.rate) || 0, specification: item.specification || null, note: item.summary || null });
  }
  const [customer] = await db.select({ name: customersTable.name, phone: customersTable.phone, contactPerson: customersTable.contactPerson, address: customersTable.address })
    .from(customersTable).where(eq(customersTable.id, order.customerId));
  let warehouseId: number | null = null;
  if (order.warehouseCode) {
    const [wh] = await db.select({ id: warehousesTable.id }).from(warehousesTable)
      .where(eq(warehousesTable.name, order.warehouseCode)).limit(1);
    warehouseId = wh?.id ?? null;
  }
  res.json({
    order: {
      id: order.id, orderNumber: order.orderNumber, customerId: order.customerId, customerName: customer?.name || "",
      deliveryDate: order.deliveryDate, departmentId: order.departmentId, projectId: order.projectId, handlerId: order.handlerId, warehouseId,
      contactInfo: [customer?.contactPerson, customer?.phone].filter(Boolean).join(" ") || null, shippingAddress: customer?.address || null,
    },
    lines,
  });
});

router.get("/delivery-notes/:id", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "出貨單編號格式不正確" }); return; }
  const [note] = await db
    .select({
      id: deliveryNotesTable.id, noteNumber: deliveryNotesTable.noteNumber,
      salesOrderId: deliveryNotesTable.salesOrderId, customerId: deliveryNotesTable.customerId,
      customerName: customersTable.name, warehouseId: deliveryNotesTable.warehouseId,
      deliveryDate: deliveryNotesTable.deliveryDate, status: deliveryNotesTable.status,
      totalAmount: deliveryNotesTable.totalAmount, items: deliveryNotesTable.items,
      remarks: deliveryNotesTable.remarks, createdAt: deliveryNotesTable.createdAt,
      departmentId: deliveryNotesTable.departmentId, projectId: deliveryNotesTable.projectId,
      handlerId: deliveryNotesTable.handlerId, contactInfo: deliveryNotesTable.contactInfo, shippingAddress: deliveryNotesTable.shippingAddress,
    })
    .from(deliveryNotesTable)
    .innerJoin(customersTable, eq(deliveryNotesTable.customerId, customersTable.id))
    .where(eq(deliveryNotesTable.id, id));
  if (!note) { res.status(404).json({ error: "找不到出貨單" }); return; }
  // 明細畫面要顯示名稱：承辦人、倉庫、來源銷貨單
  const [handler] = note.handlerId ? await db.select({ firstName: employeesTable.firstName, lastName: employeesTable.lastName }).from(employeesTable).where(eq(employeesTable.id, note.handlerId)) : [];
  const [warehouse] = note.warehouseId ? await db.select({ name: warehousesTable.name }).from(warehousesTable).where(eq(warehousesTable.id, note.warehouseId)) : [];
  const [sourceOrder] = note.salesOrderId ? await db.select({ orderNumber: salesOrdersTable.orderNumber }).from(salesOrdersTable).where(eq(salesOrdersTable.id, note.salesOrderId)) : [];
  res.json({
    ...note, totalAmount: Number(note.totalAmount),
    handlerName: handler ? `${handler.firstName || ""}${/^[A-Za-z]/.test(handler.lastName || "") ? " " : ""}${handler.lastName || ""}`.trim() : null,
    warehouseName: warehouse?.name ?? null, salesOrderNumber: sourceOrder?.orderNumber ?? null,
  });
});

router.patch("/delivery-notes/:id", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "出貨單編號格式不正確" }); return; }

  const [existing] = await db.select().from(deliveryNotesTable).where(eq(deliveryNotesTable.id, id));
  if (!existing) { res.status(404).json({ error: "找不到出貨單" }); return; }

  // 只改備註：不動庫存、不動帳，已出貨的出貨單也可以補備註
  if (existing.status !== "Draft" && Object.keys(req.body || {}).length === 1 && req.body.remarks !== undefined) {
    const [row] = await db.update(deliveryNotesTable).set({ remarks: String(req.body.remarks ?? "").trim().slice(0, 2000) || null }).where(eq(deliveryNotesTable.id, id)).returning();
    res.json({ ...row, totalAmount: Number(row.totalAmount) });
    return;
  }

  const { status, deliveryDate, remarks, customerId, warehouseId, departmentId, projectId, items } = req.body;
  const updateData: Record<string, unknown> = {};

  if (status) {
    const allowed = VALID_TRANSITIONS[existing.status] || [];
    if (!allowed.includes(status)) {
      res.status(400).json({ error: `無法從「${existing.status}」轉換為「${status}」` }); return;
    }
    updateData.status = status;
  }

  // 草稿限定的內容編輯（表頭與品項，含日期與備註）；已確認/已完成/已取消不可修改內容
  const wantsContentEdit = [customerId, warehouseId, departmentId, projectId, items, deliveryDate, remarks, req.body.handlerId, req.body.contactInfo, req.body.shippingAddress].some(v => v !== undefined);
  if (wantsContentEdit && existing.status !== "Draft") {
    res.status(400).json({ error: `僅草稿狀態的出貨單可編輯內容（目前狀態：${existing.status}）` }); return;
  }
  // 內容編輯與狀態轉換不可同一請求：避免以鎖定前的舊品項調整庫存後又覆寫品項，造成庫存與單據不一致
  if (wantsContentEdit && status) {
    res.status(400).json({ error: "請先儲存內容變更，再另行變更狀態" }); return;
  }

  if (existing.status === "Draft") {
    if (deliveryDate !== undefined) updateData.deliveryDate = deliveryDate;
    if (remarks !== undefined) updateData.remarks = remarks;
    if (customerId !== undefined) {
      const cid = Number(customerId);
      if (!Number.isInteger(cid) || cid <= 0) { res.status(400).json({ error: "客戶格式不正確" }); return; }
      if (existing.salesOrderId) {
        const [so] = await db.select({ customerId: salesOrdersTable.customerId }).from(salesOrdersTable).where(eq(salesOrdersTable.id, existing.salesOrderId));
        if (so && so.customerId !== cid) { res.status(400).json({ error: "客戶與銷售訂單不符" }); return; }
      }
      const [cust] = await db.select({ id: customersTable.id }).from(customersTable).where(eq(customersTable.id, cid));
      if (!cust) { res.status(400).json({ error: "客戶不存在" }); return; }
      updateData.customerId = cid;
    }
    if (warehouseId !== undefined) updateData.warehouseId = warehouseId === null || warehouseId === "" ? null : Number(warehouseId);
    if (departmentId !== undefined) updateData.departmentId = departmentId === null ? null : Number(departmentId);
    if (projectId !== undefined) updateData.projectId = projectId === null ? null : Number(projectId);
    if (req.body.handlerId !== undefined) {
      const hid = optionalId(req.body.handlerId);
      if (hid === undefined) { res.status(400).json({ error: "承辦人格式不正確" }); return; }
      updateData.handlerId = hid;
    }
    if (req.body.contactInfo !== undefined) updateData.contactInfo = optionalText(req.body.contactInfo, 200);
    if (req.body.shippingAddress !== undefined) updateData.shippingAddress = optionalText(req.body.shippingAddress, 500);
    if (items !== undefined) {
      if (!Array.isArray(items) || items.length === 0) { res.status(400).json({ error: "至少需要一個品項" }); return; }
      const newItems: DNItem[] = [];
      let totalAmount = 0;
      for (const item of items) {
        const itemId = Number(item?.itemId);
        const quantity = Number(item?.quantity);
        const rate = Number(item?.rate);
        if (!Number.isInteger(itemId) || itemId <= 0 || !Number.isFinite(quantity) || quantity <= 0) {
          res.status(400).json({ error: "品項數量必須為正數" }); return;
        }
        if (!Number.isFinite(rate) || rate < 0) { res.status(400).json({ error: "單價不能為負數" }); return; }
        const [dbItem] = await db.select({ itemName: itemsTable.itemName, isVirtual: itemsTable.isVirtual, movingAvgCost: itemsTable.movingAvgCost, buyingPrice: itemsTable.buyingPrice }).from(itemsTable).where(eq(itemsTable.id, itemId));
        if (!dbItem) { res.status(400).json({ error: `品項 ID ${itemId} 不存在` }); return; }
        const amount = quantity * rate;
        totalAmount += amount;
        const unitCost = dbItem.isVirtual ? 0 : (Number(dbItem.movingAvgCost) || Number(dbItem.buyingPrice) || 0);
        newItems.push({ itemId, itemName: dbItem.itemName, quantity, rate, amount, isVirtual: dbItem.isVirtual, unitCost, ...lineTexts(item) });
      }
      updateData.items = newItems;
      updateData.totalAmount = String(totalAmount);
    }
  }

  let updated;
  try {
    updated = await db.transaction(async (tx) => {
      // 鎖定單據列並以鎖內狀態重新驗證，防止並發重複提交/作廢
      const [locked] = await tx.select().from(deliveryNotesTable).where(eq(deliveryNotesTable.id, id)).for("update");
      if (!locked) throw new Error("Not found");
      if (status) {
        const allowedNow = VALID_TRANSITIONS[locked.status] || [];
        if (!allowedNow.includes(status)) throw new Error(`無法從「${locked.status}」轉換為「${status}」`);
      }
      if (wantsContentEdit && locked.status !== "Draft") throw new Error(`僅草稿狀態的出貨單可編輯內容（目前狀態：${locked.status}）`);
      const noteItems = locked.items as DNItem[];
      if (status === "Submitted" && locked.status === "Draft") {
        // 連結的出貨檢驗必須全部合格才能出貨
        await assertLinkedInspectionsAccepted(tx, "Delivery Note", id, "出貨");
        // 提交出貨：扣庫存（含庫存足夠檢查），與狀態更新同交易
        // 出貨當下重新取得各品項的平均成本：出貨單開好放了幾天才出貨時，
        // 中間若又進了不同價格的貨，成本要用出貨這一刻的，不是開單那一刻的
        const costIds = Array.from(new Set(noteItems.map(i => i.itemId)));
        const costRows = costIds.length > 0
          ? await tx.select({ id: itemsTable.id, isVirtual: itemsTable.isVirtual, movingAvgCost: itemsTable.movingAvgCost, buyingPrice: itemsTable.buyingPrice })
            .from(itemsTable).where(inArray(itemsTable.id, costIds))
          : [];
        const costNow = new Map<number, number>(costRows.map((r: any) => [r.id, r.isVirtual ? 0 : (Number(r.movingAvgCost) || Number(r.buyingPrice) || 0)]));
        for (const item of noteItems) {
          if (!(item.isVirtual ?? false) && costNow.has(item.itemId)) item.unitCost = costNow.get(item.itemId)!;
        }
        updateData.items = noteItems;
        await adjustStock(tx, noteItems, -1, { warehouseId: locked.warehouseId ?? null, remarks: `出貨單 ${locked.noteNumber} 出庫` });
        // 依成本快照產生銷貨成本分錄（銷貨成本 / 存貨）
        const cogs = await computeCogsAmount(tx, noteItems);
        if (cogs > 0) {
          await assertPeriodOpen(tx, locked.deliveryDate, "提交出貨（產生銷貨成本分錄）");
          // 摘要跟收付款單一樣寫「客戶｜摘要」，單號放在分錄編號尾巴（-DN），總分類帳會顯示成來源單號
          const [cust] = await tx.select({ name: customersTable.name }).from(customersTable).where(eq(customersTable.id, locked.customerId));
          const summary = deliverySummary(noteItems);
          const lines = await resolveJournalLinesStrict(tx, [
            { accountName: "銷貨成本", debit: cogs, credit: 0, description: partyLineText(cust?.name, summary, "銷貨成本") },
            { accountName: "存貨", debit: 0, credit: cogs, description: partyLineText(cust?.name, summary, "銷貨成本") },
          ]);
          const [je] = await tx.insert(journalEntriesTable).values({
            entryNumber: `JE-${Date.now().toString().slice(-8)}-DN${locked.id}`,
            entryDate: locked.deliveryDate,
            description: summary,
            totalDebit: String(cogs), totalCredit: String(cogs),
            status: "Posted", lines,
            projectId: locked.projectId, departmentId: locked.departmentId,
          }).returning();
          updateData.cogsJournalEntryId = je.id;
        }
      }
      if (status === "Cancelled" && locked.status === "Submitted") {
        // 鎖定並檢查下游退貨，再碰品項列；維持 parent → return → items 的鎖順序，
        // 並避免來源出貨與退貨各自回補一次而造成庫存重複增加。
        const [activeReturn] = await tx.select({ id: salesReturnsTable.id }).from(salesReturnsTable)
          .where(and(
            eq(salesReturnsTable.deliveryNoteId, id),
            sql`${salesReturnsTable.status} IN ('Submitted','Completed')`,
          )).for("update");
        if (activeReturn) throw new Error("此出貨單已有已確認或已完成的銷貨退回，請先取消退貨再作廢出貨單");
        // 有未取消的下游發票時禁止作廢
        const [inv] = await tx.select({ id: invoicesTable.id, invoiceNumber: invoicesTable.invoiceNumber })
          .from(invoicesTable)
          .where(and(eq(invoicesTable.deliveryNoteId, id), sql`${invoicesTable.status} != 'Cancelled'`));
        if (inv) throw new Error(`此出貨單已開立發票 ${inv.invoiceNumber}，請先作廢發票再作廢出貨單`);
        // 已提交後作廢：回沖庫存
        await adjustStock(tx, noteItems, 1, { warehouseId: locked.warehouseId ?? null, remarks: `出貨單 ${locked.noteNumber} 作廢沖回` });
        // 沖回銷貨成本分錄
        if (locked.cogsJournalEntryId) {
          const [origJe] = await tx.select().from(journalEntriesTable).where(eq(journalEntriesTable.id, locked.cogsJournalEntryId));
          if (origJe) {
            const today = todayTaipei();
            await assertPeriodOpen(tx, today, "作廢出貨單（沖回銷貨成本分錄）");
            const [cust] = await tx.select({ name: customersTable.name }).from(customersTable).where(eq(customersTable.id, locked.customerId));
            const summary = `作廢出貨 ${deliverySummary(noteItems)}`;
            const reversedLines = (origJe.lines as any[]).map(l => ({
              ...l, debit: Number(l.credit) || 0, credit: Number(l.debit) || 0,
              description: partyLineText(cust?.name, summary, "作廢出貨"),
            }));
            await tx.insert(journalEntriesTable).values({
              entryNumber: `JE-${Date.now().toString().slice(-8)}-DN${locked.id}-V`,
              entryDate: today,
              description: summary,
              totalDebit: origJe.totalCredit, totalCredit: origJe.totalDebit,
              status: "Posted", lines: reversedLines,
              projectId: origJe.projectId, departmentId: origJe.departmentId,
            });
          }
          updateData.cogsJournalEntryId = null;
        }
      }
      const [row] = await tx.update(deliveryNotesTable).set(updateData).where(eq(deliveryNotesTable.id, id)).returning();
      if (status && locked.salesOrderId) {
        await recalcOrderStatus(locked.salesOrderId, undefined, tx);
      }
      return row;
    });
  } catch (err: any) {
    res.status(400).json({ error: err.message || "更新失敗" }); return;
  }

  res.json({ ...updated, totalAmount: Number(updated.totalAmount) });
});

router.post("/delivery-notes/from-order/:orderId", async (req, res): Promise<void> => {
  const orderId = Number(req.params.orderId);
  if (isNaN(orderId)) { res.status(400).json({ error: "銷貨單編號格式不正確" }); return; }

  try {
    const result = await db.transaction(async (tx) => {
      // 鎖定母單，讓同一訂單的並發「建立剩餘出貨」依序計算，避免重複超額建立。
      const [order] = await tx.select().from(salesOrdersTable)
        .where(eq(salesOrdersTable.id, orderId)).for("update");
      if (!order) throw Object.assign(new Error("銷售訂單不存在"), { statusCode: 404 });
      if (order.status === "Completed" || order.status === "Cancelled") {
        throw new Error(`訂單狀態為「${order.status}」，無法建立出貨單`);
      }
      const [customer] = await tx.select({ name: customersTable.name }).from(customersTable)
        .where(eq(customersTable.id, order.customerId));
      const allDNs = await tx.select({ items: deliveryNotesTable.items })
        .from(deliveryNotesTable)
        .where(and(eq(deliveryNotesTable.salesOrderId, orderId), sql`${deliveryNotesTable.status} IN ('Draft','Submitted','Completed')`));
      const delivered: Record<number, number> = {};
      for (const dn of allDNs) for (const item of dn.items as DNItem[]) {
        delivered[item.itemId] = (delivered[item.itemId] || 0) + item.quantity;
      }
      const orderItems = order.items as SOItem[];
      const soItemIds = orderItems.map(oi => oi.itemId).filter(Boolean);
      const virtualIds = new Set<number>();
      const costById = new Map<number, number>();
      if (soItemIds.length > 0) {
        const rows = await tx.select({ id: itemsTable.id, isVirtual: itemsTable.isVirtual, movingAvgCost: itemsTable.movingAvgCost, buyingPrice: itemsTable.buyingPrice })
          .from(itemsTable).where(inArray(itemsTable.id, soItemIds));
        for (const r of rows) {
          if (r.isVirtual) virtualIds.add(r.id);
          costById.set(r.id, r.isVirtual ? 0 : (Number(r.movingAvgCost) || Number(r.buyingPrice) || 0));
        }
      }
      const remainingItems: DNItem[] = [];
      let totalAmount = 0;
      for (const oi of orderItems) {
        const remaining = oi.quantity - (delivered[oi.itemId] || 0);
        if (remaining > 0) {
          const amount = remaining * oi.rate;
          totalAmount += amount;
          remainingItems.push({ itemId: oi.itemId, itemName: oi.itemName, quantity: remaining, rate: oi.rate, amount, isVirtual: virtualIds.has(oi.itemId), unitCost: costById.get(oi.itemId) ?? 0, ...lineTexts({ specification: oi.specification, note: oi.summary }) });
        }
      }
      if (remainingItems.length === 0) throw new Error("所有品項已完成出貨");
      const [note] = await tx.insert(deliveryNotesTable).values({
        noteNumber: await nextDocNumber(tx, "delivery_notes", "note_number", "DN", generateDNNumber), salesOrderId: orderId, customerId: order.customerId,
        warehouseId: Number(req.body?.warehouseId) || null,
        deliveryDate: order.deliveryDate || todayTaipei(),
        totalAmount: String(totalAmount), items: remainingItems,
        departmentId: order.departmentId, projectId: order.projectId, handlerId: order.handlerId,
      }).returning();
      await tx.insert(activitiesTable).values({
        type: "create", title: "從銷售訂單建立出貨單",
        description: `${note.noteNumber} - ${customer?.name || "客戶"}`, module: "Sales",
      });
      return { note, customerName: customer?.name || "Unknown" };
    });
    res.status(201).json({ ...result.note, customerName: result.customerName, totalAmount: Number(result.note.totalAmount) });
  } catch (err: any) {
    res.status(err?.statusCode === 404 ? 404 : 400).json({ error: err?.message || "建立出貨單失敗" });
  }
});

router.delete("/delivery-notes/:id", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "出貨單編號格式不正確" }); return; }
  const [existing] = await db.select().from(deliveryNotesTable).where(eq(deliveryNotesTable.id, id));
  if (!existing) { res.status(404).json({ error: "找不到出貨單" }); return; }
  if (existing.status !== "Draft") {
    res.status(400).json({ error: "只能刪除草稿狀態的出貨單" }); return;
  }
  try {
    await db.transaction(async (tx) => {
      const [locked] = await tx.select().from(deliveryNotesTable)
        .where(eq(deliveryNotesTable.id, id)).for("update");
      if (!locked || locked.status !== "Draft") throw new Error("只能刪除草稿狀態的出貨單");
      await tx.delete(deliveryNotesTable).where(eq(deliveryNotesTable.id, id));
      if (locked.salesOrderId) await recalcOrderStatus(locked.salesOrderId, undefined, tx);
    });
  } catch (err: any) {
    res.status(400).json({ error: err?.message || "刪除出貨單失敗" }); return;
  }
  res.json({ success: true });
});

export default router;
