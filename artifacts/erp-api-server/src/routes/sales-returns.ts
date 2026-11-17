import { Router, type IRouter } from "express";
import { logStockMovement } from "../lib/stock-ledger";
import { nextDocNumber } from "../lib/doc-number";
import { desc, eq, sql, and, inArray } from "drizzle-orm";
import { db, salesReturnsTable, deliveryNotesTable, customersTable, itemsTable, invoicesTable, invoiceSettlementsTable, activitiesTable } from "@workspace/erp-db";
import { requireAuth } from "../middleware/require-auth";
import { createInvoiceJournalEntry, deleteInvoiceJournalEntry, assertPeriodOpen } from "../lib/auto-journal";
import { itemUnitCost, nextMovingAvgCost, postAutoJournal, round2, todayTaipei, vatSplit } from "../lib/inventory-journal";
import { recalcOrderStatus } from "./delivery-notes";

function generateReverseDNNumber(): string {
  return "RDN-" + String(Date.now()).slice(-8);
}

/**
 * 折讓單的稅別跟著原本那張發票：原發票是應稅就拆出 5% 營業稅，免稅或零稅率就不拆。
 * 還沒開發票就退貨的，比照出貨轉發票的預設（應稅）。
 */
async function noteTaxFields(tx: any, sourceInvoiceFilter: any, total: number) {
  const [source] = await tx.select({ taxType: invoicesTable.taxType }).from(invoicesTable)
    .where(and(sourceInvoiceFilter, sql`${invoicesTable.status} != 'Cancelled'`, eq(invoicesTable.invoiceType, "Sales"))).limit(1);
  const taxType = source?.taxType && source.taxType !== "unclassified" ? source.taxType : "taxable";
  if (taxType !== "taxable") return { taxType, taxRate: "0", netAmount: String(round2(total)), taxAmount: "0" };
  const { net, tax } = vatSplit(total);
  return { taxType, taxRate: "5", netAmount: String(net), taxAmount: String(tax) };
}

const router: IRouter = Router();
router.use("/sales-returns", requireAuth);

function generateSRNumber(): string {
  return "SR-" + String(Date.now()).slice(-8);
}
function generateCreditNoteNumber(): string {
  return "CN-" + String(Date.now()).slice(-8);
}

interface ReturnItem { itemId: number; itemName: string; quantity: number; rate: number; amount: number; /** 建單當下的虛擬服務快照；舊單據無此欄位時回查品項主檔 */ isVirtual?: boolean }

function assertReturnCapacity(sourceItems: ReturnItem[], candidateItems: ReturnItem[], siblings: Array<{ items: unknown }>): void {
  const sourceQty = new Map<number, number>();
  const usedQty = new Map<number, number>();
  for (const item of sourceItems) sourceQty.set(item.itemId, (sourceQty.get(item.itemId) || 0) + Number(item.quantity));
  for (const sibling of siblings) {
    for (const item of (sibling.items as ReturnItem[]) || []) {
      usedQty.set(item.itemId, (usedQty.get(item.itemId) || 0) + Number(item.quantity));
    }
  }
  for (const item of candidateItems) {
    usedQty.set(item.itemId, (usedQty.get(item.itemId) || 0) + Number(item.quantity));
  }
  for (const [itemId, quantity] of usedQty) {
    const max = sourceQty.get(itemId) || 0;
    if (quantity > max) throw new Error(`品項 ID ${itemId} 累計退貨 ${quantity} 超過原送貨數量 ${max}`);
  }
}

const VALID_TRANSITIONS: Record<string, string[]> = {
  Draft: ["Submitted", "Cancelled"],
  Submitted: ["Completed", "Cancelled"],
  Completed: [],
  Cancelled: [],
};

router.get("/sales-returns", async (_req, res): Promise<void> => {
  const returns = await db
    .select({
      id: salesReturnsTable.id, returnNumber: salesReturnsTable.returnNumber,
      deliveryNoteId: salesReturnsTable.deliveryNoteId, customerId: salesReturnsTable.customerId,
      customerName: customersTable.name, warehouseId: salesReturnsTable.warehouseId,
      returnDate: salesReturnsTable.returnDate, reason: salesReturnsTable.reason,
      status: salesReturnsTable.status, totalAmount: salesReturnsTable.totalAmount,
      items: salesReturnsTable.items, remarks: salesReturnsTable.remarks, createdAt: salesReturnsTable.createdAt,
    })
    .from(salesReturnsTable)
    .innerJoin(customersTable, eq(salesReturnsTable.customerId, customersTable.id))
    .orderBy(desc(salesReturnsTable.returnDate), desc(salesReturnsTable.id));
  res.json(returns.map(r => ({ ...r, totalAmount: Number(r.totalAmount) })));
});

router.post("/sales-returns", async (req, res): Promise<void> => {
  const { deliveryNoteId, customerId, warehouseId, returnDate, reason, items, remarks, departmentId, projectId } = req.body;
  if (!deliveryNoteId || !customerId || !returnDate || !items?.length) {
    res.status(400).json({ error: "缺少必填欄位（需指定送貨單）" }); return;
  }

  const [dn] = await db.select().from(deliveryNotesTable).where(eq(deliveryNotesTable.id, deliveryNoteId));
  if (!dn) { res.status(400).json({ error: "送貨單不存在" }); return; }
  if (dn.status !== "Submitted" && dn.status !== "Completed") {
    res.status(400).json({ error: "送貨單必須為已確認或已完成狀態" }); return;
  }
  if (dn.customerId !== customerId) { res.status(400).json({ error: "客戶與送貨單不符" }); return; }

  const dnItems = dn.items as ReturnItem[];
  const deliveredQty: Record<number, number> = {};
  for (const di of dnItems) { deliveredQty[di.itemId] = di.quantity; }

  const existingReturns = await db.select({ items: salesReturnsTable.items })
    .from(salesReturnsTable)
    .where(and(eq(salesReturnsTable.deliveryNoteId, deliveryNoteId), sql`${salesReturnsTable.status} IN ('Submitted','Completed')`));
  const alreadyReturned: Record<number, number> = {};
  for (const er of existingReturns) {
    for (const ri of er.items as ReturnItem[]) {
      alreadyReturned[ri.itemId] = (alreadyReturned[ri.itemId] || 0) + ri.quantity;
    }
  }

  const returnItems: ReturnItem[] = [];
  let totalAmount = 0;
  for (const item of items) {
    if (!item.itemId || !Number.isFinite(item.quantity) || item.quantity <= 0) {
      res.status(400).json({ error: "品項數量必須為正數" }); return;
    }
    if (!Number.isFinite(item.rate) || item.rate < 0) {
      res.status(400).json({ error: "單價不能為負數" }); return;
    }
    const maxReturnable = (deliveredQty[item.itemId] || 0) - (alreadyReturned[item.itemId] || 0);
    if (item.quantity > maxReturnable) {
      res.status(400).json({ error: `品項 ID ${item.itemId} 最多可退 ${maxReturnable} 個` }); return;
    }
    const [dbItem] = await db.select({ itemName: itemsTable.itemName, isVirtual: itemsTable.isVirtual }).from(itemsTable).where(eq(itemsTable.id, item.itemId));
    if (!dbItem) { res.status(400).json({ error: `品項 ID ${item.itemId} 不存在` }); return; }
    const amount = item.quantity * item.rate;
    totalAmount += amount;
    returnItems.push({ itemId: item.itemId, itemName: dbItem.itemName, quantity: item.quantity, rate: item.rate, amount, isVirtual: dbItem.isVirtual });
  }

  try {
    const result = await db.transaction(async tx => {
      // Common-parent lock serializes create/submit/cancel capacity decisions.
      const [lockedDn] = await tx.select().from(deliveryNotesTable)
        .where(eq(deliveryNotesTable.id, deliveryNoteId)).for("update");
      if (!lockedDn || !["Submitted", "Completed"].includes(lockedDn.status) || lockedDn.customerId !== customerId) {
        throw new Error("送貨單狀態或客戶已變更，請重新整理後再試");
      }
      const siblings = await tx.select({ items: salesReturnsTable.items }).from(salesReturnsTable)
        .where(and(eq(salesReturnsTable.deliveryNoteId, deliveryNoteId), sql`${salesReturnsTable.status} IN ('Submitted','Completed')`));
      assertReturnCapacity(lockedDn.items as ReturnItem[], returnItems, siblings);
      const [ret] = await tx.insert(salesReturnsTable).values({
        returnNumber: await nextDocNumber(tx, "sales_returns", "return_number", "SR", generateSRNumber), deliveryNoteId, customerId,
        warehouseId: warehouseId || null, returnDate, reason: reason || null,
        totalAmount: String(totalAmount), items: returnItems, remarks: remarks || null,
        departmentId: departmentId ? Number(departmentId) : null,
        projectId: projectId ? Number(projectId) : null,
      }).returning();
      const [cust] = await tx.select({ name: customersTable.name }).from(customersTable).where(eq(customersTable.id, customerId));
      await tx.insert(activitiesTable).values({
        type: "create", title: "銷售退貨單已建立",
        description: `${ret.returnNumber} - ${cust?.name || "客戶"} - $${totalAmount.toFixed(2)}`, module: "Sales",
      });
      return { ret, customerName: cust?.name || "Unknown" };
    });
    res.status(201).json({ ...result.ret, customerName: result.customerName, totalAmount });
  } catch (err: any) {
    res.status(400).json({ error: err?.message || "建立銷貨退回單失敗" });
  }
});

router.get("/sales-returns/:id", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "銷貨退回單編號格式不正確" }); return; }
  const [ret] = await db
    .select({
      id: salesReturnsTable.id, returnNumber: salesReturnsTable.returnNumber,
      deliveryNoteId: salesReturnsTable.deliveryNoteId, customerId: salesReturnsTable.customerId,
      customerName: customersTable.name, warehouseId: salesReturnsTable.warehouseId,
      returnDate: salesReturnsTable.returnDate, reason: salesReturnsTable.reason,
      status: salesReturnsTable.status, totalAmount: salesReturnsTable.totalAmount,
      items: salesReturnsTable.items, remarks: salesReturnsTable.remarks, createdAt: salesReturnsTable.createdAt,
    })
    .from(salesReturnsTable)
    .innerJoin(customersTable, eq(salesReturnsTable.customerId, customersTable.id))
    .where(eq(salesReturnsTable.id, id));
  if (!ret) { res.status(404).json({ error: "找不到銷貨退回單" }); return; }
  res.json({ ...ret, totalAmount: Number(ret.totalAmount) });
});

router.patch("/sales-returns/:id", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "銷貨退回單編號格式不正確" }); return; }

  const [existing] = await db.select().from(salesReturnsTable).where(eq(salesReturnsTable.id, id));
  if (!existing) { res.status(404).json({ error: "找不到銷貨退回單" }); return; }

  const { status, remarks } = req.body;
  const updateData: Record<string, unknown> = {};

  if (status) {
    const allowed = VALID_TRANSITIONS[existing.status] || [];
    if (!allowed.includes(status)) {
      res.status(400).json({ error: `無法從「${existing.status}」轉換為「${status}」` }); return;
    }

    if (status === "Submitted" && existing.status === "Draft") {
      const sourceId = existing.deliveryNoteId;
      if (!sourceId) { res.status(400).json({ error: "退貨單未連結來源送貨單，無法確認" }); return; }
      // 單一交易 + 鎖定退貨列：庫存、反轉送貨單、折讓單、分錄與狀態一起提交，避免部分生效與併發重複確認
      let updatedRow: typeof salesReturnsTable.$inferSelect;
      try {
        updatedRow = await db.transaction(async (tx) => {
          const [lockedDn] = await tx.select().from(deliveryNotesTable)
            .where(eq(deliveryNotesTable.id, sourceId)).for("update");
          if (!lockedDn) throw new Error("來源送貨單不存在，無法確認退貨");
          const [locked] = await tx.select().from(salesReturnsTable)
            .where(eq(salesReturnsTable.id, id)).for("update");
          if (!locked || locked.status !== "Draft") {
            throw new Error("退貨單狀態已變更，請重新整理後再試");
          }
          const returnItems = locked.items as ReturnItem[];
          const siblings = await tx.select({ items: salesReturnsTable.items }).from(salesReturnsTable)
            .where(and(
              eq(salesReturnsTable.deliveryNoteId, sourceId),
              sql`${salesReturnsTable.id} != ${locked.id}`,
              sql`${salesReturnsTable.status} IN ('Submitted','Completed')`,
            ));
          assertReturnCapacity(lockedDn.items as ReturnItem[], returnItems, siblings);
          // 虛擬服務品項不動庫存：優先用建單快照，舊單據回查品項主檔
          const legacyIds = returnItems.filter(i => i.isVirtual === undefined).map(i => i.itemId);
          const liveVirtualIds = new Set<number>();
          if (legacyIds.length > 0) {
            const rows = await tx.select({ id: itemsTable.id }).from(itemsTable)
              .where(and(inArray(itemsTable.id, legacyIds), eq(itemsTable.isVirtual, true)));
            for (const r of rows) liveVirtualIds.add(r.id);
          }
          const physicalQty = new Map<number, number>();
          for (const item of returnItems) {
            if (item.isVirtual ?? liveVirtualIds.has(item.itemId)) continue;
            physicalQty.set(item.itemId, (physicalQty.get(item.itemId) || 0) + item.quantity);
          }
          // 退回的貨用當初出貨時的成本入庫，同時把那筆銷貨成本轉回存貨（原本只加數量、不動帳，存貨與成本都會錯）
          const shippedCost = new Map<number, number>();
          for (const dnItem of lockedDn.items as Array<{ itemId: number; unitCost?: number | null }>) {
            if (dnItem.unitCost !== undefined && dnItem.unitCost !== null) shippedCost.set(dnItem.itemId, Number(dnItem.unitCost) || 0);
          }
          let returnedCost = 0;
          for (const [itemId, quantity] of [...physicalQty].sort(([a], [b]) => a - b)) {
            const [stockItem] = await tx.select({ id: itemsTable.id, currentStock: itemsTable.currentStock, movingAvgCost: itemsTable.movingAvgCost, buyingPrice: itemsTable.buyingPrice })
              .from(itemsTable).where(eq(itemsTable.id, itemId)).for("update");
            if (!stockItem) throw new Error(`品項 ID ${itemId} 不存在，無法確認退貨`);
            const unitCost = shippedCost.get(itemId) ?? itemUnitCost(stockItem);
            const cost = round2(quantity * unitCost);
            returnedCost = round2(returnedCost + cost);
            const stockBefore = Number(stockItem.currentStock);
            await tx.update(itemsTable).set({
              currentStock: String(stockBefore + quantity),
              ...(cost > 0 ? { movingAvgCost: nextMovingAvgCost(stockBefore, Number(stockItem.movingAvgCost || 0), quantity, cost).toFixed(4) } : {}),
            }).where(eq(itemsTable.id, itemId));
            await logStockMovement(tx, { direction: 1, itemId, warehouseId: locked.warehouseId ?? null, quantity, rate: unitCost, remarks: `銷貨退回 ${locked.returnNumber} 入庫`, source: "return" });
          }
          await postAutoJournal(tx, {
            key: `SR${locked.id}`, entryDate: locked.returnDate, action: "確認銷貨退回", projectId: locked.projectId ?? null,
            description: `自動分錄 - 銷貨退回 ${locked.returnNumber} 成本轉回存貨`,
            lines: [
              { accountName: "存貨", debit: returnedCost, credit: 0, description: `${locked.returnNumber} 退貨入庫` },
              { accountName: "銷貨成本", debit: 0, credit: returnedCost, description: `${locked.returnNumber} 沖回銷貨成本` },
            ],
          });

          const [reverseDN] = await tx.insert(deliveryNotesTable).values({
            noteNumber: generateReverseDNNumber(),
            salesOrderId: null,
            customerId: locked.customerId,
            deliveryDate: locked.returnDate,
            totalAmount: "-" + locked.totalAmount,
            items: returnItems,
            remarks: `退貨反轉送貨單 - 來自 ${locked.returnNumber}`,
            status: "Submitted",
          }).returning();

          await tx.insert(activitiesTable).values({
            type: "create", title: "反轉送貨單已自動建立",
            description: `${reverseDN.noteNumber} - 來自退貨 ${locked.returnNumber}`, module: "Sales",
          });

          const creditItems = returnItems.map(i => ({
            itemId: i.itemId, itemName: i.itemName, quantity: i.quantity, rate: i.rate, amount: i.amount,
          }));
          const [creditNote] = await tx.insert(invoicesTable).values({
            invoiceNumber: generateCreditNoteNumber(),
            invoiceType: "Credit Note",
            customerId: locked.customerId,
            projectId: locked.projectId ?? null,
            invoiceDate: locked.returnDate,
            totalAmount: locked.totalAmount,
            outstandingAmount: locked.totalAmount,
            ...(await noteTaxFields(tx, eq(invoicesTable.deliveryNoteId, sourceId), Number(locked.totalAmount))),
            items: creditItems,
            status: "Submitted",
          }).returning();

          // 自動沖回營收分錄：借 銷貨收入 / 貸 應收帳款（回寫 invoices.journalEntryId）
          await createInvoiceJournalEntry(tx, creditNote);

          await tx.insert(activitiesTable).values({
            type: "create", title: "折讓單已自動建立",
            description: `${creditNote.invoiceNumber} - 來自退貨 ${locked.returnNumber}`, module: "Accounting",
          });

          const [row] = await tx.update(salesReturnsTable).set({
            status: "Submitted",
            creditNoteInvoiceId: creditNote.id,
            reverseDeliveryNoteId: reverseDN.id,
            ...(remarks !== undefined ? { remarks } : {}),
          }).where(eq(salesReturnsTable.id, id)).returning();
          return row;
        });
      } catch (err: any) {
        res.status(400).json({ error: err?.message || "確認退貨失敗" }); return;
      }

      // 退貨確認後重算來源銷貨單出貨狀態（狀態已寫入，直接重算）
      if (existing.deliveryNoteId) {
        const [srcDN] = await db.select({ salesOrderId: deliveryNotesTable.salesOrderId })
          .from(deliveryNotesTable).where(eq(deliveryNotesTable.id, existing.deliveryNoteId));
        if (srcDN?.salesOrderId) await recalcOrderStatus(srcDN.salesOrderId);
      }
      res.json({ ...updatedRow, totalAmount: Number(updatedRow.totalAmount) });
      return;
    }

    if (status === "Cancelled" && existing.status === "Submitted") {
      const sourceId = existing.deliveryNoteId;
      if (!sourceId) { res.status(400).json({ error: "退貨單未連結來源送貨單，無法取消" }); return; }
      // 取消已確認的退貨：同步作廢自動建立的折讓單、分錄與反轉送貨單，並回沖庫存
      // 找到折讓單（新資料有連結；舊資料透過活動紀錄回查）
      let creditNote = null as (typeof invoicesTable.$inferSelect) | null;
      if (existing.creditNoteInvoiceId) {
        const [inv] = await db.select().from(invoicesTable).where(eq(invoicesTable.id, existing.creditNoteInvoiceId));
        creditNote = inv || null;
      } else {
        const [act] = await db.select({ description: activitiesTable.description }).from(activitiesTable)
          .where(and(eq(activitiesTable.title, "折讓單已自動建立"),
            sql`${activitiesTable.description} LIKE ${"%來自退貨 " + existing.returnNumber}`));
        const cnNumber = act?.description?.split(" - ")[0];
        if (cnNumber) {
          const [inv] = await db.select().from(invoicesTable).where(eq(invoicesTable.invoiceNumber, cnNumber));
          creditNote = inv || null;
        }
      }
      // 單一交易 + 鎖定退貨列：庫存回沖、單據作廢、分錄刪除與狀態一起提交
      let updatedRow: typeof salesReturnsTable.$inferSelect;
      try {
        updatedRow = await db.transaction(async (tx) => {
          const [lockedDn] = await tx.select().from(deliveryNotesTable)
            .where(eq(deliveryNotesTable.id, sourceId)).for("update");
          if (!lockedDn) throw new Error("來源送貨單不存在，無法取消退貨");
          const [locked] = await tx.select().from(salesReturnsTable)
            .where(eq(salesReturnsTable.id, id)).for("update");
          if (!locked || locked.status !== "Submitted") {
            throw new Error("退貨單狀態已變更，請重新整理後再試");
          }
          await assertPeriodOpen(tx, locked.returnDate, "取消此退貨（其折讓分錄屬已關帳期間）");

          // paidAmount 是衍生欄位，可能因舊資料或中途失敗而過期。鎖定折讓單後
          // 直接查 settlement ledger，並與所有新增沖帳的發票鎖順序一致，避免
          // 「檢查後才新增沖帳」的競態。
          const creditNoteId = locked.creditNoteInvoiceId ?? creditNote?.id;
          if (!creditNoteId) {
            throw new Error("找不到此退貨自動建立的折讓單，已停止取消以避免帳務不同步");
          }
          const [lockedCreditNote] = await tx.select().from(invoicesTable)
            .where(eq(invoicesTable.id, creditNoteId)).for("update");
          if (!lockedCreditNote) {
            throw new Error("此退貨的折讓單已不存在，已停止取消以避免帳務不同步");
          }
          await assertPeriodOpen(tx, lockedCreditNote.invoiceDate, "取消此退貨的折讓分錄");
          const [settlement] = await tx.select({ id: invoiceSettlementsTable.id })
            .from(invoiceSettlementsTable)
            .where(eq(invoiceSettlementsTable.invoiceId, lockedCreditNote.id))
            .limit(1);
          if (settlement) {
            throw new Error(`折讓單 ${lockedCreditNote.invoiceNumber} 已有沖抵/收付紀錄，請先處理後再取消退貨`);
          }
          // 回沖庫存（確認時加回的庫存要扣回）
          let removedCost = 0;
          const returnItems = locked.items as ReturnItem[];
          const legacyIds = returnItems.filter(i => i.isVirtual === undefined).map(i => i.itemId);
          const liveVirtualIds = new Set<number>();
          if (legacyIds.length > 0) {
            const rows = await tx.select({ id: itemsTable.id }).from(itemsTable)
              .where(and(inArray(itemsTable.id, legacyIds), eq(itemsTable.isVirtual, true)));
            for (const r of rows) liveVirtualIds.add(r.id);
          }
          const physicalQty = new Map<number, number>();
          for (const item of returnItems) {
            if (item.isVirtual ?? liveVirtualIds.has(item.itemId)) continue;
            physicalQty.set(item.itemId, (physicalQty.get(item.itemId) || 0) + item.quantity);
          }
          for (const [itemId, quantity] of [...physicalQty].sort(([a], [b]) => a - b)) {
            const [stockItem] = await tx.select({ id: itemsTable.id, currentStock: itemsTable.currentStock })
              .from(itemsTable).where(eq(itemsTable.id, itemId)).for("update");
            if (!stockItem) throw new Error(`品項 ID ${itemId} 不存在，無法取消退貨`);
            const currentStock = Number(stockItem.currentStock);
            if (currentStock < quantity) {
              throw new Error(`品項 ID ${itemId} 目前庫存 ${currentStock}，不足以取消退貨所需扣回的 ${quantity}`);
            }
            await tx.update(itemsTable).set({
              currentStock: String(currentStock - quantity),
            }).where(eq(itemsTable.id, itemId));
            await logStockMovement(tx, { direction: -1, itemId, warehouseId: locked.warehouseId ?? null, quantity, remarks: `銷貨退回 ${locked.returnNumber} 取消沖回`, source: "return" });
            const [costRow] = await tx.select({ movingAvgCost: itemsTable.movingAvgCost, buyingPrice: itemsTable.buyingPrice }).from(itemsTable).where(eq(itemsTable.id, itemId));
            removedCost = round2(removedCost + quantity * itemUnitCost(costRow));
          }
          // 貨又算賣出去了：依現行成本把存貨轉回銷貨成本
          await postAutoJournal(tx, {
            key: `SR${locked.id}-C`, entryDate: todayTaipei(), action: "取消銷貨退回", projectId: locked.projectId ?? null,
            description: `自動分錄 - 取消銷貨退回 ${locked.returnNumber}`,
            lines: [
              { accountName: "銷貨成本", debit: removedCost, credit: 0, description: `${locked.returnNumber} 取消退貨` },
              { accountName: "存貨", debit: 0, credit: removedCost, description: `${locked.returnNumber} 取消退貨出庫` },
            ],
          });

          // 作廢反轉送貨單
          if (locked.reverseDeliveryNoteId) {
            await tx.update(deliveryNotesTable).set({ status: "Cancelled" })
              .where(eq(deliveryNotesTable.id, locked.reverseDeliveryNoteId));
          } else {
            await tx.update(deliveryNotesTable).set({ status: "Cancelled" })
              .where(eq(deliveryNotesTable.remarks, `退貨反轉送貨單 - 來自 ${locked.returnNumber}`));
          }

          // 作廢折讓單並刪除其自動分錄
          await deleteInvoiceJournalEntry(tx, lockedCreditNote);
          await tx.update(invoicesTable).set({ status: "Cancelled" }).where(eq(invoicesTable.id, lockedCreditNote.id));

          await tx.insert(activitiesTable).values({
            type: "update", title: "退貨已取消",
            description: `${locked.returnNumber} - 庫存已回沖，折讓單 ${lockedCreditNote.invoiceNumber} 與分錄已作廢`,
            module: "Sales",
          });

          const [row] = await tx.update(salesReturnsTable).set({
            status: "Cancelled",
            ...(remarks !== undefined ? { remarks } : {}),
          }).where(eq(salesReturnsTable.id, id)).returning();
          return row;
        });
      } catch (err: any) {
        res.status(400).json({ error: err?.message || "取消退貨失敗" }); return;
      }

      // 取消退貨後（狀態已寫入）重算來源銷貨單狀態
      if (existing.deliveryNoteId) {
        const [srcDN] = await db.select({ salesOrderId: deliveryNotesTable.salesOrderId })
          .from(deliveryNotesTable).where(eq(deliveryNotesTable.id, existing.deliveryNoteId));
        if (srcDN?.salesOrderId) await recalcOrderStatus(srcDN.salesOrderId);
      }
      res.json({ ...updatedRow, totalAmount: Number(updatedRow.totalAmount) });
      return;
    }
    updateData.status = status;
  }

  if (remarks !== undefined) updateData.remarks = remarks;

  const [updated] = await db.update(salesReturnsTable).set(updateData).where(eq(salesReturnsTable.id, id)).returning();
  res.json({ ...updated, totalAmount: Number(updated.totalAmount) });
});

router.delete("/sales-returns/:id", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "銷貨退回單編號格式不正確" }); return; }
  const [existing] = await db.select().from(salesReturnsTable).where(eq(salesReturnsTable.id, id));
  if (!existing) { res.status(404).json({ error: "找不到銷貨退回單" }); return; }
  if (existing.status !== "Draft") {
    res.status(400).json({ error: "只能刪除草稿狀態的退貨單" }); return;
  }
  await db.delete(salesReturnsTable).where(eq(salesReturnsTable.id, id));
  res.json({ success: true });
});

export default router;
