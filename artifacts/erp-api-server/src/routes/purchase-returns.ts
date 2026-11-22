import { Router, type IRouter } from "express";
import { logStockMovement } from "../lib/stock-ledger";
import { nextDocNumber } from "../lib/doc-number";
import { desc, eq, sql, and, inArray } from "drizzle-orm";
import { db, purchaseReturnsTable, purchaseReceiptsTable, suppliersTable, itemsTable, invoicesTable, invoiceSettlementsTable, activitiesTable } from "@workspace/erp-db";
import { requireAuth } from "../middleware/require-auth";
import { isLegacyDoc, LEGACY_DOC_READONLY_MESSAGE } from "../lib/legacy";
import { createInvoiceJournalEntry, deleteInvoiceJournalEntry, assertPeriodOpen } from "../lib/auto-journal";
import { itemUnitCost, postAutoJournal, round2, todayTaipei, vatSplit } from "../lib/inventory-journal";

function generateReversePRNumber(): string {
  return "RPR-" + String(Date.now()).slice(-8);
}

/** 扣項單的稅別跟著原本的採購發票；還沒開發票的比照進貨轉發票的預設（應稅） */
async function noteTaxFields(tx: any, receiptId: number, total: number) {
  const [source] = await tx.select({ taxType: invoicesTable.taxType }).from(invoicesTable)
    .where(and(eq(invoicesTable.purchaseReceiptId, receiptId), sql`${invoicesTable.status} != 'Cancelled'`, eq(invoicesTable.invoiceType, "Purchase"))).limit(1);
  const taxType = source?.taxType && source.taxType !== "unclassified" ? source.taxType : "taxable";
  if (taxType !== "taxable") return { taxType, taxRate: "0", netAmount: String(round2(total)), taxAmount: "0" };
  const { net, tax } = vatSplit(total);
  return { taxType, taxRate: "5", netAmount: String(net), taxAmount: String(tax) };
}

/**
 * 退貨退的是「當初的進價」，但庫存是用「現在的平均成本」扣的，兩個金額可能不一樣。
 * 差額記成進貨價差，帳上存貨才會跟庫存金額一致。sign = 1 是確認退貨，-1 是取消退貨。
 */
async function postReturnVariance(tx: any, ret: { id: number; returnNumber: string; projectId: number | null }, stockValue: number, ledgerValue: number, sign: 1 | -1, date: string) {
  const variance = round2((stockValue - ledgerValue) * sign);
  if (Math.abs(variance) < 0.01) return;
  await postAutoJournal(tx, {
    key: `PRR${ret.id}-${sign === 1 ? "V" : "VC"}`, entryDate: date, action: sign === 1 ? "確認採購退回" : "取消採購退回", projectId: ret.projectId ?? null,
    description: `自動分錄 - 採購退回 ${ret.returnNumber} 進價與平均成本的差額`,
    lines: variance > 0
      ? [{ accountName: "進貨", debit: variance, credit: 0, description: `${ret.returnNumber} 進貨價差` }, { accountName: "存貨", debit: 0, credit: variance, description: `${ret.returnNumber} 進貨價差` }]
      : [{ accountName: "存貨", debit: -variance, credit: 0, description: `${ret.returnNumber} 進貨價差` }, { accountName: "進貨", debit: 0, credit: -variance, description: `${ret.returnNumber} 進貨價差` }],
  });
}

/** 這張退貨單裡實體品項的未稅退款金額（扣項單貸記存貨的金額） */
function stockRefundNet(items: Array<{ itemId: number; amount: number; isVirtual?: boolean }>, liveVirtualIds: Set<number>, taxable: boolean, noteNet: number, noteTotal: number): number {
  const physicalGross = items.filter(i => !(i.isVirtual ?? liveVirtualIds.has(i.itemId))).reduce((s, i) => s + (Number(i.amount) || 0), 0);
  if (!taxable || noteTotal <= 0) return round2(physicalGross);
  return round2(noteNet * (physicalGross / noteTotal));
}

const router: IRouter = Router();
router.use("/purchase-returns", requireAuth);

function generatePRTNumber(): string {
  return "PRT-" + String(Date.now()).slice(-8);
}
function generateDebitNoteNumber(): string {
  return "DBN-" + String(Date.now()).slice(-8);
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
    if (quantity > max) throw new Error(`品項 ID ${itemId} 累計退貨 ${quantity} 超過原進貨數量 ${max}`);
  }
}

const VALID_TRANSITIONS: Record<string, string[]> = {
  Draft: ["Submitted", "Cancelled"],
  Submitted: ["Completed", "Cancelled"],
  Completed: [],
  Cancelled: [],
};

router.get("/purchase-returns", async (_req, res): Promise<void> => {
  const returns = await db
    .select({
      id: purchaseReturnsTable.id, returnNumber: purchaseReturnsTable.returnNumber,
      purchaseReceiptId: purchaseReturnsTable.purchaseReceiptId, supplierId: purchaseReturnsTable.supplierId,
      supplierName: suppliersTable.name, warehouseId: purchaseReturnsTable.warehouseId,
      returnDate: purchaseReturnsTable.returnDate, reason: purchaseReturnsTable.reason,
      status: purchaseReturnsTable.status, totalAmount: purchaseReturnsTable.totalAmount,
      items: purchaseReturnsTable.items, remarks: purchaseReturnsTable.remarks, createdAt: purchaseReturnsTable.createdAt,
    })
    .from(purchaseReturnsTable)
    .innerJoin(suppliersTable, eq(purchaseReturnsTable.supplierId, suppliersTable.id))
    .orderBy(desc(purchaseReturnsTable.returnDate), desc(purchaseReturnsTable.id));
  res.json(returns.map(r => ({ ...r, totalAmount: Number(r.totalAmount) })));
});

router.post("/purchase-returns", async (req, res): Promise<void> => {
  const { purchaseReceiptId, supplierId, warehouseId, returnDate, reason, items, remarks, departmentId, projectId } = req.body;
  if (!purchaseReceiptId || !supplierId || !returnDate || !items?.length) {
    res.status(400).json({ error: "缺少必填欄位（需指定進貨單）" }); return;
  }

  const [pr] = await db.select().from(purchaseReceiptsTable).where(eq(purchaseReceiptsTable.id, purchaseReceiptId));
  if (pr && isLegacyDoc(pr.extraFields)) { res.status(400).json({ error: LEGACY_DOC_READONLY_MESSAGE }); return; }
  if (!pr) { res.status(400).json({ error: "進貨單不存在" }); return; }
  if (pr.status !== "Submitted" && pr.status !== "Completed") {
    res.status(400).json({ error: "進貨單必須為已確認或已完成狀態" }); return;
  }
  if (pr.supplierId !== supplierId) { res.status(400).json({ error: "供應商與進貨單不符" }); return; }

  const prItems = pr.items as ReturnItem[];
  const receivedQty: Record<number, number> = {};
  for (const pi of prItems) { receivedQty[pi.itemId] = pi.quantity; }

  const existingReturns = await db.select({ items: purchaseReturnsTable.items })
    .from(purchaseReturnsTable)
    .where(and(eq(purchaseReturnsTable.purchaseReceiptId, purchaseReceiptId), sql`${purchaseReturnsTable.status} IN ('Submitted','Completed')`));
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
    const maxReturnable = (receivedQty[item.itemId] || 0) - (alreadyReturned[item.itemId] || 0);
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
      const [lockedReceipt] = await tx.select().from(purchaseReceiptsTable)
        .where(eq(purchaseReceiptsTable.id, purchaseReceiptId)).for("update");
      if (!lockedReceipt || !["Submitted", "Completed"].includes(lockedReceipt.status) || lockedReceipt.supplierId !== supplierId) {
        throw new Error("進貨單狀態或供應商已變更，請重新整理後再試");
      }
      const siblings = await tx.select({ items: purchaseReturnsTable.items }).from(purchaseReturnsTable)
        .where(and(eq(purchaseReturnsTable.purchaseReceiptId, purchaseReceiptId), sql`${purchaseReturnsTable.status} IN ('Submitted','Completed')`));
      assertReturnCapacity(lockedReceipt.items as ReturnItem[], returnItems, siblings);
      const [ret] = await tx.insert(purchaseReturnsTable).values({
        returnNumber: await nextDocNumber(tx, "purchase_returns", "return_number", "PRT", generatePRTNumber), purchaseReceiptId, supplierId,
        warehouseId: warehouseId || null, returnDate, reason: reason || null,
        totalAmount: String(totalAmount), items: returnItems, remarks: remarks || null,
        departmentId: departmentId ? Number(departmentId) : null,
        projectId: projectId ? Number(projectId) : null,
      }).returning();
      const [sup] = await tx.select({ name: suppliersTable.name }).from(suppliersTable).where(eq(suppliersTable.id, supplierId));
      await tx.insert(activitiesTable).values({
        type: "create", title: "進貨退出單已建立",
        description: `${ret.returnNumber} - ${sup?.name || "供應商"} - $${totalAmount.toFixed(2)}`, module: "Purchasing",
      });
      return { ret, supplierName: sup?.name || "Unknown" };
    });
    res.status(201).json({ ...result.ret, supplierName: result.supplierName, totalAmount });
  } catch (err: any) {
    res.status(400).json({ error: err?.message || "建立採購退回單失敗" });
  }
});

router.get("/purchase-returns/:id", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "採購退回單編號格式不正確" }); return; }
  const [ret] = await db
    .select({
      id: purchaseReturnsTable.id, returnNumber: purchaseReturnsTable.returnNumber,
      purchaseReceiptId: purchaseReturnsTable.purchaseReceiptId, supplierId: purchaseReturnsTable.supplierId,
      supplierName: suppliersTable.name, warehouseId: purchaseReturnsTable.warehouseId,
      returnDate: purchaseReturnsTable.returnDate, reason: purchaseReturnsTable.reason,
      status: purchaseReturnsTable.status, totalAmount: purchaseReturnsTable.totalAmount,
      items: purchaseReturnsTable.items, remarks: purchaseReturnsTable.remarks, createdAt: purchaseReturnsTable.createdAt,
    })
    .from(purchaseReturnsTable)
    .innerJoin(suppliersTable, eq(purchaseReturnsTable.supplierId, suppliersTable.id))
    .where(eq(purchaseReturnsTable.id, id));
  if (!ret) { res.status(404).json({ error: "找不到採購退回單" }); return; }
  res.json({ ...ret, totalAmount: Number(ret.totalAmount) });
});

router.patch("/purchase-returns/:id", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "採購退回單編號格式不正確" }); return; }

  const [existing] = await db.select().from(purchaseReturnsTable).where(eq(purchaseReturnsTable.id, id));
  if (!existing) { res.status(404).json({ error: "找不到採購退回單" }); return; }

  const { status, remarks } = req.body;
  const updateData: Record<string, unknown> = {};

  if (status) {
    const allowed = VALID_TRANSITIONS[existing.status] || [];
    if (!allowed.includes(status)) {
      res.status(400).json({ error: `無法從「${existing.status}」轉換為「${status}」` }); return;
    }

    if (status === "Submitted" && existing.status === "Draft") {
      const sourceId = existing.purchaseReceiptId;
      if (!sourceId) { res.status(400).json({ error: "退貨單未連結來源進貨單，無法確認" }); return; }
      // 單一交易 + 鎖定退貨列：庫存、反轉進貨單、扣項單、分錄與狀態一起提交，避免部分生效與併發重複確認
      let updatedRow: typeof purchaseReturnsTable.$inferSelect;
      try {
        updatedRow = await db.transaction(async (tx) => {
          const [lockedReceipt] = await tx.select().from(purchaseReceiptsTable)
            .where(eq(purchaseReceiptsTable.id, sourceId)).for("update");
          if (!lockedReceipt) throw new Error("來源進貨單不存在，無法確認退貨");
          const [locked] = await tx.select().from(purchaseReturnsTable)
            .where(eq(purchaseReturnsTable.id, id)).for("update");
          if (!locked || locked.status !== "Draft") {
            throw new Error("退貨單狀態已變更，請重新整理後再試");
          }
          const returnItems = locked.items as ReturnItem[];
          const siblings = await tx.select({ items: purchaseReturnsTable.items }).from(purchaseReturnsTable)
            .where(and(
              eq(purchaseReturnsTable.purchaseReceiptId, sourceId),
              sql`${purchaseReturnsTable.id} != ${locked.id}`,
              sql`${purchaseReturnsTable.status} IN ('Submitted','Completed')`,
            ));
          assertReturnCapacity(lockedReceipt.items as ReturnItem[], returnItems, siblings);
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
          let removedStockValue = 0;
          for (const [itemId, quantity] of [...physicalQty].sort(([a], [b]) => a - b)) {
            const [stockItem] = await tx.select({ id: itemsTable.id, currentStock: itemsTable.currentStock, movingAvgCost: itemsTable.movingAvgCost, buyingPrice: itemsTable.buyingPrice })
              .from(itemsTable).where(eq(itemsTable.id, itemId)).for("update");
            if (!stockItem) throw new Error(`品項 ID ${itemId} 不存在，無法確認退貨`);
            const currentStock = Number(stockItem.currentStock);
            if (currentStock < quantity) {
              throw new Error(`品項 ID ${itemId} 目前庫存 ${currentStock}，不足以退回 ${quantity}`);
            }
            removedStockValue = round2(removedStockValue + quantity * itemUnitCost(stockItem));
            await tx.update(itemsTable).set({
              currentStock: String(currentStock - quantity),
            }).where(eq(itemsTable.id, itemId));
            await logStockMovement(tx, { direction: -1, itemId, warehouseId: locked.warehouseId ?? null, quantity, remarks: `採購退回 ${locked.returnNumber} 出庫`, source: "return" });
          }

          const [reversePR] = await tx.insert(purchaseReceiptsTable).values({
            receiptNumber: generateReversePRNumber(),
            purchaseOrderId: null,
            supplierId: locked.supplierId,
            receiptDate: locked.returnDate,
            totalAmount: "-" + locked.totalAmount,
            items: returnItems,
            remarks: `退貨反轉進貨單 - 來自 ${locked.returnNumber}`,
            status: "Submitted",
          }).returning();

          await tx.insert(activitiesTable).values({
            type: "create", title: "反轉進貨單已自動建立",
            description: `${reversePR.receiptNumber} - 來自退貨 ${locked.returnNumber}`, module: "Purchasing",
          });

          const debitItems = returnItems.map(i => ({
            itemId: i.itemId, itemName: i.itemName, quantity: i.quantity, rate: i.rate, amount: i.amount,
          }));
          const [debitNote] = await tx.insert(invoicesTable).values({
            invoiceNumber: generateDebitNoteNumber(),
            invoiceType: "Debit Note",
            supplierId: locked.supplierId,
            projectId: locked.projectId ?? null,
            invoiceDate: locked.returnDate,
            totalAmount: locked.totalAmount,
            outstandingAmount: locked.totalAmount,
            ...(await noteTaxFields(tx, sourceId, Number(locked.totalAmount))),
            items: debitItems,
            status: "Submitted",
          }).returning();

          // 自動沖回成本分錄：借 應付帳款 / 貸 存貨、進項稅額（回寫 invoices.journalEntryId）
          await createInvoiceJournalEntry(tx, debitNote);
          const ledgerValue = stockRefundNet(returnItems as any, liveVirtualIds, debitNote.taxType === "taxable", Number(debitNote.netAmount), Number(debitNote.totalAmount));
          await postReturnVariance(tx, locked, removedStockValue, ledgerValue, 1, locked.returnDate);

          await tx.insert(activitiesTable).values({
            type: "create", title: "扣項單已自動建立",
            description: `${debitNote.invoiceNumber} - 來自退貨 ${locked.returnNumber}`, module: "Accounting",
          });

          const [row] = await tx.update(purchaseReturnsTable).set({
            status: "Submitted",
            debitNoteInvoiceId: debitNote.id,
            reverseReceiptId: reversePR.id,
            ...(remarks !== undefined ? { remarks } : {}),
          }).where(eq(purchaseReturnsTable.id, id)).returning();
          return row;
        });
      } catch (err: any) {
        res.status(400).json({ error: err?.message || "確認退貨失敗" }); return;
      }
      res.json({ ...updatedRow, totalAmount: Number(updatedRow.totalAmount) });
      return;
    }

    if (status === "Cancelled" && existing.status === "Submitted") {
      const sourceId = existing.purchaseReceiptId;
      if (!sourceId) { res.status(400).json({ error: "退貨單未連結來源進貨單，無法取消" }); return; }
      // 取消已確認的退貨：同步作廢自動建立的扣項單、分錄與反轉進貨單，並回補庫存
      // 找到扣項單（新資料有連結；舊資料透過活動紀錄回查）
      let debitNote = null as (typeof invoicesTable.$inferSelect) | null;
      if (existing.debitNoteInvoiceId) {
        const [inv] = await db.select().from(invoicesTable).where(eq(invoicesTable.id, existing.debitNoteInvoiceId));
        debitNote = inv || null;
      } else {
        const [act] = await db.select({ description: activitiesTable.description }).from(activitiesTable)
          .where(and(eq(activitiesTable.title, "扣項單已自動建立"),
            sql`${activitiesTable.description} LIKE ${"%來自退貨 " + existing.returnNumber}`));
        const dbnNumber = act?.description?.split(" - ")[0];
        if (dbnNumber) {
          const [inv] = await db.select().from(invoicesTable).where(eq(invoicesTable.invoiceNumber, dbnNumber));
          debitNote = inv || null;
        }
      }
      // 單一交易 + 鎖定退貨列：庫存回補、單據作廢、分錄刪除與狀態一起提交
      let updatedRow: typeof purchaseReturnsTable.$inferSelect;
      try {
        updatedRow = await db.transaction(async (tx) => {
          const [lockedReceipt] = await tx.select().from(purchaseReceiptsTable)
            .where(eq(purchaseReceiptsTable.id, sourceId)).for("update");
          if (!lockedReceipt) throw new Error("來源進貨單不存在，無法取消退貨");
          const [locked] = await tx.select().from(purchaseReturnsTable)
            .where(eq(purchaseReturnsTable.id, id)).for("update");
          if (!locked || locked.status !== "Submitted") {
            throw new Error("退貨單狀態已變更，請重新整理後再試");
          }
          await assertPeriodOpen(tx, locked.returnDate, "取消此退貨（其扣項分錄屬已關帳期間）");

          // paidAmount 是衍生欄位；取消前必須鎖定扣項單並直接檢查 settlement
          // ledger，避免過期欄位或併發沖帳讓已沖抵單據被作廢。
          const debitNoteId = locked.debitNoteInvoiceId ?? debitNote?.id;
          if (!debitNoteId) {
            throw new Error("找不到此退貨自動建立的扣項單，已停止取消以避免帳務不同步");
          }
          const [lockedDebitNote] = await tx.select().from(invoicesTable)
            .where(eq(invoicesTable.id, debitNoteId)).for("update");
          if (!lockedDebitNote) {
            throw new Error("此退貨的扣項單已不存在，已停止取消以避免帳務不同步");
          }
          await assertPeriodOpen(tx, lockedDebitNote.invoiceDate, "取消此退貨的扣項分錄");
          const [settlement] = await tx.select({ id: invoiceSettlementsTable.id })
            .from(invoiceSettlementsTable)
            .where(eq(invoiceSettlementsTable.invoiceId, lockedDebitNote.id))
            .limit(1);
          if (settlement) {
            throw new Error(`扣項單 ${lockedDebitNote.invoiceNumber} 已有沖抵/收付紀錄，請先處理後再取消退貨`);
          }
          // 回補庫存（確認時扣掉的庫存要加回）
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
          let restoredStockValue = 0;
          for (const [itemId, quantity] of [...physicalQty].sort(([a], [b]) => a - b)) {
            const [stockItem] = await tx.select({ id: itemsTable.id, currentStock: itemsTable.currentStock, movingAvgCost: itemsTable.movingAvgCost, buyingPrice: itemsTable.buyingPrice })
              .from(itemsTable).where(eq(itemsTable.id, itemId)).for("update");
            if (!stockItem) throw new Error(`品項 ID ${itemId} 不存在，無法取消退貨`);
            restoredStockValue = round2(restoredStockValue + quantity * itemUnitCost(stockItem));
            await tx.update(itemsTable).set({
              currentStock: String(Number(stockItem.currentStock) + quantity),
            }).where(eq(itemsTable.id, itemId));
            await logStockMovement(tx, { direction: 1, itemId, warehouseId: locked.warehouseId ?? null, quantity, remarks: `採購退回 ${locked.returnNumber} 取消沖回`, source: "return" });
          }

          // 作廢反轉進貨單
          if (locked.reverseReceiptId) {
            await tx.update(purchaseReceiptsTable).set({ status: "Cancelled" })
              .where(eq(purchaseReceiptsTable.id, locked.reverseReceiptId));
          } else {
            await tx.update(purchaseReceiptsTable).set({ status: "Cancelled" })
              .where(eq(purchaseReceiptsTable.remarks, `退貨反轉進貨單 - 來自 ${locked.returnNumber}`));
          }

          // 作廢扣項單並刪除其自動分錄
          await postReturnVariance(tx, locked, restoredStockValue,
            stockRefundNet(returnItems as any, liveVirtualIds, lockedDebitNote.taxType === "taxable", Number(lockedDebitNote.netAmount), Number(lockedDebitNote.totalAmount)), -1, todayTaipei());
          await deleteInvoiceJournalEntry(tx, lockedDebitNote);
          await tx.update(invoicesTable).set({ status: "Cancelled" }).where(eq(invoicesTable.id, lockedDebitNote.id));

          await tx.insert(activitiesTable).values({
            type: "update", title: "進貨退出已取消",
            description: `${locked.returnNumber} - 庫存已回補，扣項單 ${lockedDebitNote.invoiceNumber} 與分錄已作廢`,
            module: "Purchasing",
          });

          const [row] = await tx.update(purchaseReturnsTable).set({
            status: "Cancelled",
            ...(remarks !== undefined ? { remarks } : {}),
          }).where(eq(purchaseReturnsTable.id, id)).returning();
          return row;
        });
      } catch (err: any) {
        res.status(400).json({ error: err?.message || "取消退貨失敗" }); return;
      }
      res.json({ ...updatedRow, totalAmount: Number(updatedRow.totalAmount) });
      return;
    }
    updateData.status = status;
  }

  if (remarks !== undefined) updateData.remarks = remarks;

  const [updated] = await db.update(purchaseReturnsTable).set(updateData).where(eq(purchaseReturnsTable.id, id)).returning();
  res.json({ ...updated, totalAmount: Number(updated.totalAmount) });
});

router.delete("/purchase-returns/:id", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "採購退回單編號格式不正確" }); return; }
  const [existing] = await db.select().from(purchaseReturnsTable).where(eq(purchaseReturnsTable.id, id));
  if (!existing) { res.status(404).json({ error: "找不到採購退回單" }); return; }
  if (existing.status !== "Draft") {
    res.status(400).json({ error: "只能刪除草稿狀態的退貨單" }); return;
  }
  await db.delete(purchaseReturnsTable).where(eq(purchaseReturnsTable.id, id));
  res.json({ success: true });
});

export default router;
