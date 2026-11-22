import { Router, type IRouter } from "express";
import { timesheetsTable, jobCardsTable, workstationsTable } from "@workspace/erp-db";
import { conversionCost } from "../lib/timesheets";
import { and, eq, desc, inArray, sql } from "drizzle-orm";
import { db, workOrdersTable, workOrderItemsTable, bomsTable, bomItemsTable, itemsTable, stockEntriesTable, warehousesTable, customersTable, employeesTable, salesOrdersTable, type WorkOrder } from "@workspace/erp-db";
import { requireAuth } from "../middleware/require-auth";
import { assertLinkedInspectionsAccepted } from "../lib/quality-gate";
import { closeWorkOrderWip, finishCostShare, itemUnitCost, nextMovingAvgCost, postAutoJournal, round2, todayTaipei, workOrderWipBalance } from "../lib/inventory-journal";

/** 取得預設倉庫 ID（用於工單庫存異動紀錄） */
async function getDefaultWarehouseId(tx: any): Promise<number | null> {
  const [wh] = await tx.select({ id: warehousesTable.id }).from(warehousesTable).limit(1);
  return wh?.id ?? null;
}

/**
 * 把還沒計入的人工與製造費用轉進這張工單的在製品：
 * - 人工：填到這張工單、已核准的工時表
 * - 製造費用：已完成的工單卡時數 × 工作站每小時費用
 * 每一筆只計一次（costApplied），分批完工不會重複。
 */
async function applyConversionCost(tx: any, wo: { id: number; workOrderNumber: string; projectId?: number | null }): Promise<{ labor: number; overhead: number; total: number }> {
  const sheets = await tx.select({ id: timesheetsTable.id, costAmount: timesheetsTable.costAmount }).from(timesheetsTable)
    .where(and(eq(timesheetsTable.workOrderId, wo.id), eq(timesheetsTable.status, "Approved"), eq(timesheetsTable.costApplied, false))).for("update");
  const cards = await tx.select({ id: jobCardsTable.id, totalHours: jobCardsTable.totalHours, hourRate: workstationsTable.hourRate })
    .from(jobCardsTable).innerJoin(workstationsTable, eq(workstationsTable.id, jobCardsTable.workstationId))
    .where(and(eq(jobCardsTable.workOrderId, wo.id), eq(jobCardsTable.status, "Completed"), eq(jobCardsTable.costApplied, false)));
  const cost = conversionCost({
    timesheetCosts: sheets.map((s: { costAmount: string }) => Number(s.costAmount)),
    jobCards: cards.map((c: { totalHours: string; hourRate: string }) => ({ totalHours: Number(c.totalHours), hourRate: Number(c.hourRate) })),
  });
  if (cost.total <= 0) return cost;
  await postAutoJournal(tx, {
    key: `WO${wo.id}-L`,
    entryDate: todayTaipei(),
    description: `自動分錄 - 工單 ${wo.workOrderNumber} 人工 ${cost.labor}、製造費用 ${cost.overhead} 轉入在製品`,
    action: "工單人工與製造費用入帳",
    projectId: wo.projectId ?? null,
    lines: [
      { accountName: "在製品", debit: cost.total, credit: 0, description: `${wo.workOrderNumber} 人工與製造費用` },
      { accountName: "已分攤製造成本", debit: 0, credit: cost.total, description: `${wo.workOrderNumber} 轉入在製品` },
    ],
  });
  if (sheets.length > 0) await tx.update(timesheetsTable).set({ costApplied: true }).where(inArray(timesheetsTable.id, sheets.map((s: { id: number }) => s.id)));
  if (cards.length > 0) await tx.update(jobCardsTable).set({ costApplied: true }).where(inArray(jobCardsTable.id, cards.map((c: { id: number }) => c.id)));
  await tx.execute(sql`UPDATE work_orders SET conversion_cost = conversion_cost + ${cost.total} WHERE id = ${wo.id}`);
  return cost;
}

const router: IRouter = Router();
router.use("/work-orders", requireAuth);

function numericWo(w: WorkOrder) {
  return { ...w, plannedQuantity: Number(w.plannedQuantity), completedQuantity: Number(w.completedQuantity) };
}

function generateWoNumber(): string {
  return "WO-" + String(Date.now()).slice(-8);
}

const VALID_TRANSITIONS: Record<string, string[]> = {
  Draft: ["In Progress"],
  "In Progress": ["Completed", "Cancelled"],
  Completed: [],
  Cancelled: [],
};

/** 清單與明細共用的欄位：工單本身＋成品、BOM、客戶、承辦人、來源銷貨單的名稱 */
const woColumns = {
  wo: workOrdersTable,
  itemName: itemsTable.itemName,
  itemCode: itemsTable.itemCode,
  bomNumber: bomsTable.bomNumber,
  customerName: customersTable.name,
  handlerFirstName: employeesTable.firstName,
  handlerLastName: employeesTable.lastName,
  salesOrderNumber: salesOrdersTable.orderNumber,
};
function woQuery() {
  return db.select(woColumns)
    .from(workOrdersTable)
    .leftJoin(itemsTable, eq(workOrdersTable.itemId, itemsTable.id))
    .leftJoin(bomsTable, eq(workOrdersTable.bomId, bomsTable.id))
    .leftJoin(customersTable, eq(workOrdersTable.customerId, customersTable.id))
    .leftJoin(employeesTable, eq(workOrdersTable.handlerId, employeesTable.id))
    .leftJoin(salesOrdersTable, eq(workOrdersTable.salesOrderId, salesOrdersTable.id));
}
/** 員工姓名：中文姓名直接接起來，英文姓名中間留一個空白 */
function personName(first: string | null, last: string | null): string {
  return `${first || ""}${/^[A-Za-z]/.test(last || "") ? " " : ""}${last || ""}`.trim();
}
type WoRow = { wo: WorkOrder; itemName: string | null; itemCode: string | null; bomNumber: string | null; customerName: string | null; handlerFirstName: string | null; handlerLastName: string | null; salesOrderNumber: string | null };
function woView(r: WoRow) {
  return {
    ...numericWo(r.wo),
    itemName: r.itemName || "",
    itemCode: r.itemCode || "",
    bomNumber: r.bomNumber || "",
    customerName: r.customerName || "",
    handlerName: personName(r.handlerFirstName, r.handlerLastName),
    salesOrderNumber: r.salesOrderNumber || "",
  };
}

router.get("/work-orders", async (_req, res): Promise<void> => {
  const rows = await woQuery().orderBy(desc(workOrdersTable.createdAt));
  res.json(rows.map(woView));
});

router.get("/work-orders/:id", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }

  const [row] = await woQuery().where(eq(workOrdersTable.id, id));

  if (!row) { res.status(404).json({ error: "Not found" }); return; }

  const woItems = await db.select({
    woItem: workOrderItemsTable,
    itemName: itemsTable.itemName,
    itemCode: itemsTable.itemCode,
  })
    .from(workOrderItemsTable)
    .leftJoin(itemsTable, eq(workOrderItemsTable.itemId, itemsTable.id))
    .where(eq(workOrderItemsTable.workOrderId, id));

  res.json({
    ...woView(row),
    items: woItems.map(i => ({
      ...i.woItem,
      requiredQuantity: Number(i.woItem.requiredQuantity),
      issuedQuantity: Number(i.woItem.issuedQuantity),
      itemName: i.itemName || "",
      itemCode: i.itemCode || "",
    })),
  });
});

router.post("/work-orders", async (req, res): Promise<void> => {
  const { bomId, plannedQuantity, priority, plannedStartDate, plannedEndDate, salesOrderId, customerId, handlerId, remarks } = req.body;
  if (!bomId || !plannedQuantity) { res.status(400).json({ error: "必填：BOM、計畫數量" }); return; }

  const [bom] = await db.select().from(bomsTable).where(eq(bomsTable.id, Number(bomId)));
  if (!bom) { res.status(404).json({ error: "BOM not found" }); return; }
  if (bom.status !== "Active") { res.status(400).json({ error: "BOM 必須為啟用狀態" }); return; }

  // 銷貨單、客戶、承辦人都選填；有填就要找得到
  const optionalId = (v: unknown): number | null | "bad" => {
    if (v === undefined || v === null || v === "") return null;
    const n = Number(v);
    return Number.isInteger(n) && n > 0 ? n : "bad";
  };
  const soId = optionalId(salesOrderId), custId = optionalId(customerId), hdlId = optionalId(handlerId);
  if (soId === "bad" || custId === "bad" || hdlId === "bad") { res.status(400).json({ error: "銷貨單、客戶或承辦人的資料不正確，請重新選擇" }); return; }
  let orderCustomerId: number | null = null;
  let salesOrderNumber = "";
  if (soId) {
    const [so] = await db.select({ id: salesOrdersTable.id, customerId: salesOrdersTable.customerId, orderNumber: salesOrdersTable.orderNumber }).from(salesOrdersTable).where(eq(salesOrdersTable.id, soId));
    if (!so) { res.status(400).json({ error: "找不到這張銷貨單，請重新選擇" }); return; }
    orderCustomerId = so.customerId;
    salesOrderNumber = so.orderNumber;
  }
  // 沒另外選客戶時，用銷貨單的客戶
  const finalCustomerId = custId ?? orderCustomerId;
  let customerName = "";
  if (finalCustomerId) {
    const [cust] = await db.select({ name: customersTable.name }).from(customersTable).where(eq(customersTable.id, finalCustomerId));
    if (!cust) { res.status(400).json({ error: "找不到這個客戶，請重新選擇" }); return; }
    customerName = cust.name;
  }
  let handlerName = "";
  if (hdlId) {
    const [emp] = await db.select({ firstName: employeesTable.firstName, lastName: employeesTable.lastName }).from(employeesTable).where(eq(employeesTable.id, hdlId));
    if (!emp) { res.status(400).json({ error: "找不到這位承辦人，請重新選擇" }); return; }
    handlerName = personName(emp.firstName, emp.lastName);
  }

  const bomItems = await db.select().from(bomItemsTable).where(eq(bomItemsTable.bomId, bom.id));
  const qty = Number(plannedQuantity);
  const bomQty = Number(bom.quantity) || 1;

  // 建單時快照虛擬服務標記（成品與材料）
  const snapshotIds = [bom.itemId, ...bomItems.map(bi => bi.itemId)];
  const virtualRows = await db.select({ id: itemsTable.id, isVirtual: itemsTable.isVirtual })
    .from(itemsTable).where(inArray(itemsTable.id, snapshotIds));
  const virtualMap = new Map(virtualRows.map(r => [r.id, r.isVirtual]));

  // 等資料確定寫入之後才回應：原本在還沒寫完時就先回應，緊接著的下一個動作偶爾會找不到這張工單
  const created = await db.transaction(async (tx) => {
    const [wo] = await tx.insert(workOrdersTable).values({
      workOrderNumber: generateWoNumber(),
      bomId: bom.id,
      itemId: bom.itemId,
      salesOrderId: soId,
      customerId: finalCustomerId,
      handlerId: hdlId,
      plannedQuantity: String(qty),
      priority: priority || "Medium",
      plannedStartDate: plannedStartDate || null,
      plannedEndDate: plannedEndDate || null,
      remarks: remarks || null,
      itemIsVirtual: virtualMap.get(bom.itemId) ?? false,
    }).returning();

    for (const bi of bomItems) {
      const reqQty = (Number(bi.quantity) / bomQty) * qty;
      await tx.insert(workOrderItemsTable).values({
        workOrderId: wo.id,
        itemId: bi.itemId,
        requiredQuantity: String(reqQty),
        unit: bi.unit,
        isVirtual: virtualMap.get(bi.itemId) ?? false,
      });
    }

    const [itemRow] = await tx.select({ itemName: itemsTable.itemName, itemCode: itemsTable.itemCode }).from(itemsTable).where(eq(itemsTable.id, bom.itemId));
    return {
      ...numericWo(wo),
      itemName: itemRow?.itemName || "",
      itemCode: itemRow?.itemCode || "",
      bomNumber: bom.bomNumber,
      customerName,
      handlerName,
      salesOrderNumber,
    };
  });
  res.status(201).json(created);
});

router.patch("/work-orders/:id", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }

  const [existing] = await db.select().from(workOrdersTable).where(eq(workOrdersTable.id, id));
  if (!existing) { res.status(404).json({ error: "Not found" }); return; }

  if (req.body.status) {
    const newStatus = req.body.status as string;
    const allowed = VALID_TRANSITIONS[existing.status];
    if (!allowed || !allowed.includes(newStatus)) {
      res.status(400).json({ error: `無法從 ${existing.status} 轉為 ${newStatus}` }); return;
    }

    const updates: Record<string, unknown> = { status: newStatus };
    if (newStatus === "In Progress" && !existing.actualStartDate) {
      updates.actualStartDate = todayTaipei();
    }
    if (newStatus === "Completed") {
      updates.actualEndDate = todayTaipei();
      if (req.body.completedQuantity !== undefined) {
        updates.completedQuantity = String(Number(req.body.completedQuantity));
      }
    }

    try {
      const updated = await db.transaction(async (tx) => {
        const [locked] = await tx.select().from(workOrdersTable).where(eq(workOrdersTable.id, id)).for("update");
        if (!locked) throw new Error("Not found");
        if (!(VALID_TRANSITIONS[locked.status] || []).includes(newStatus)) throw new Error(`無法從 ${locked.status} 轉為 ${newStatus}`);
        // 結案時把還掛在在製品的成本轉出，帳上不留懸空餘額
        if (newStatus === "Completed" || newStatus === "Cancelled") {
          await closeWorkOrderWip(tx, locked, newStatus === "Completed" ? "完工結案" : "取消");
        }
        const [row] = await tx.update(workOrdersTable).set(updates).where(eq(workOrdersTable.id, id)).returning();
        return row;
      });
      res.json(numericWo(updated));
    } catch (err: any) {
      res.status(400).json({ error: err.message || "更新失敗" });
    }
    return;
  }

  const updates: Record<string, unknown> = {};
  const fields = ["priority", "plannedStartDate", "plannedEndDate", "remarks"];
  for (const f of fields) {
    if (req.body[f] !== undefined) updates[f] = req.body[f] || null;
  }
  if (req.body.completedQuantity !== undefined) updates.completedQuantity = String(Number(req.body.completedQuantity));

  if (Object.keys(updates).length === 0) { res.status(400).json({ error: "No updates" }); return; }
  const [updated] = await db.update(workOrdersTable).set(updates).where(eq(workOrdersTable.id, id)).returning();
  res.json(numericWo(updated));
});

router.post("/work-orders/:id/issue-material", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }

  const [wo] = await db.select().from(workOrdersTable).where(eq(workOrdersTable.id, id));
  if (!wo) { res.status(404).json({ error: "Not found" }); return; }
  if (wo.status !== "In Progress") { res.status(400).json({ error: "工單必須為進行中" }); return; }

  const { itemId, quantity } = req.body;
  if (!itemId || !quantity) { res.status(400).json({ error: "必填：品項、數量" }); return; }

  const woItems = await db.select().from(workOrderItemsTable)
    .where(eq(workOrderItemsTable.workOrderId, id));
  const target = woItems.find(i => i.itemId === Number(itemId));
  if (!target) { res.status(400).json({ error: "此品項不在工單材料中" }); return; }

  const qty = Number(quantity);
  if (!Number.isFinite(qty) || qty <= 0) { res.status(400).json({ error: "數量必須為正數" }); return; }

  let newIssued = 0;
  let issuedCost = 0;
  try {
    await db.transaction(async (tx) => {
      // 鎖定工單材料列後在鎖內重算累計發料，防止並發超發
      const [lockedLine] = await tx.select().from(workOrderItemsTable)
        .where(eq(workOrderItemsTable.id, target.id)).for("update");
      if (!lockedLine) throw new Error("工單材料不存在");
      newIssued = Number(lockedLine.issuedQuantity) + qty;
      if (newIssued > Number(lockedLine.requiredQuantity) + 0.001) {
        throw new Error(`發料後累計 ${newIssued} 超過需求量 ${Number(lockedLine.requiredQuantity)}`);
      }

      const [item] = await tx.select({ itemName: itemsTable.itemName, currentStock: itemsTable.currentStock, isVirtual: itemsTable.isVirtual, movingAvgCost: itemsTable.movingAvgCost, buyingPrice: itemsTable.buyingPrice })
        .from(itemsTable).where(eq(itemsTable.id, Number(itemId))).for("update");
      if (!item) throw new Error("品項不存在");

      await tx.update(workOrderItemsTable).set({ issuedQuantity: String(newIssued) }).where(eq(workOrderItemsTable.id, target.id));

      // 虛擬服務品項不追蹤庫存：仍記錄發料數量，但不扣庫存、不寫庫存異動（優先用建單快照，舊單據回查主檔）
      if (lockedLine.isVirtual ?? item.isVirtual) return;

      const newStock = Number(item.currentStock || 0) - qty;
      if (newStock < 0) throw new Error(`品項「${item.itemName}」庫存不足（現有 ${Number(item.currentStock || 0)}，需發料 ${qty}）`);
      await tx.update(itemsTable).set({ currentStock: String(newStock) }).where(eq(itemsTable.id, Number(itemId)));

      // 發料成本＝數量 × 材料移動平均成本，同步入帳：借 在製品／貸 存貨
      const unitCost = itemUnitCost(item);
      issuedCost = round2(qty * unitCost);
      const whId = await getDefaultWarehouseId(tx);
      if (whId) {
        await tx.insert(stockEntriesTable).values({
          entryType: "Issue", itemId: Number(itemId), warehouseId: whId,
          quantity: String(qty), rate: unitCost.toFixed(2), amount: String(issuedCost),
          remarks: `工單 ${wo.workOrderNumber} 發料`, source: "work-order",
        });
      }
      await postAutoJournal(tx, {
        key: `WO${wo.id}-M`,
        entryDate: todayTaipei(),
        description: `自動分錄 - 工單 ${wo.workOrderNumber} 發料 ${item.itemName} × ${qty}`,
        action: "工單發料",
        lines: [
          { accountName: "在製品", debit: issuedCost, credit: 0, description: `${wo.workOrderNumber} 領用 ${item.itemName}` },
          { accountName: "存貨", debit: 0, credit: issuedCost, description: `${wo.workOrderNumber} 材料出庫 ${item.itemName}` },
        ],
      });
    });
  } catch (err: any) {
    res.status(400).json({ error: err.message || "發料失敗" }); return;
  }

  res.json({ success: true, issuedQuantity: newIssued, issuedCost });
});

router.post("/work-orders/:id/finish", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }

  const [wo] = await db.select().from(workOrdersTable).where(eq(workOrdersTable.id, id));
  if (!wo) { res.status(404).json({ error: "Not found" }); return; }
  if (wo.status !== "In Progress") { res.status(400).json({ error: "工單必須為進行中" }); return; }

  const finishedQty = Number(req.body.quantity) || Number(wo.plannedQuantity);
  if (finishedQty <= 0) { res.status(400).json({ error: "完工數量必須為正數" }); return; }

  let finishedCost = 0;
  try {
    await db.transaction(async (tx) => {
      // 有連結到這張工單的品質檢驗時，全部合格才能完工入庫
      await assertLinkedInspectionsAccepted(tx, "Work Order", id, "完工入庫");
      // 鎖定工單列後在鎖內重算完工累計，防止並發超量完工
      const [lockedWo] = await tx.select().from(workOrdersTable).where(eq(workOrdersTable.id, id)).for("update");
      if (!lockedWo) throw new Error("Not found");
      if (lockedWo.status !== "In Progress") throw new Error("工單必須為進行中");
      const newCompleted = Number(lockedWo.completedQuantity) + finishedQty;
      if (newCompleted > Number(lockedWo.plannedQuantity) + 0.001) {
        throw new Error(`完工累計 ${newCompleted} 超過計劃數量 ${Number(lockedWo.plannedQuantity)}`);
      }

      await tx.update(workOrdersTable).set({
        completedQuantity: String(newCompleted),
      }).where(eq(workOrdersTable.id, id));

      const [item] = await tx.select().from(itemsTable).where(eq(itemsTable.id, wo.itemId)).for("update");
      // 虛擬服務品項不追蹤庫存：仍記錄完工數量，但不加庫存、不寫庫存異動（優先用建單快照，舊單據回查主檔）
      if (lockedWo.itemIsVirtual ?? item?.isVirtual) return;
      // 先把還沒計入的人工（工時表）與製造費用（工作站時數）轉進在製品，成品成本才不會只有材料
      await applyConversionCost(tx, { id: wo.id, workOrderNumber: wo.workOrderNumber, projectId: (wo as any).projectId ?? null });
      // 完工成本＝這張工單目前累積在在製品的全部成本，轉入製成品並更新成品的移動平均成本
      finishedCost = finishCostShare(await workOrderWipBalance(tx, id), finishedQty, Number(lockedWo.plannedQuantity), Number(lockedWo.completedQuantity));
      if (item) {
        const currentStock = Number(item.currentStock || 0);
        const values: Record<string, string> = { currentStock: String(currentStock + finishedQty) };
        if (finishedCost > 0) {
          values.movingAvgCost = nextMovingAvgCost(currentStock, Number(item.movingAvgCost || 0), finishedQty, finishedCost).toFixed(4);
        }
        await tx.update(itemsTable).set(values).where(eq(itemsTable.id, wo.itemId));
      }
      const whId = await getDefaultWarehouseId(tx);
      if (whId) {
        await tx.insert(stockEntriesTable).values({
          entryType: "Receipt", itemId: wo.itemId, warehouseId: whId,
          quantity: String(finishedQty), rate: (finishedCost / finishedQty).toFixed(2), amount: String(finishedCost),
          remarks: `工單 ${wo.workOrderNumber} 完工入庫`, source: "work-order",
        });
      }
      await postAutoJournal(tx, {
        key: `WO${wo.id}-F`,
        entryDate: todayTaipei(),
        description: `自動分錄 - 工單 ${wo.workOrderNumber} 完工入庫 × ${finishedQty}`,
        action: "工單完工入庫",
        lines: [
          { accountName: "製成品", debit: finishedCost, credit: 0, description: `${wo.workOrderNumber} 完工入庫` },
          { accountName: "在製品", debit: 0, credit: finishedCost, description: `${wo.workOrderNumber} 在製品轉出` },
        ],
      });
    });
  } catch (err: any) {
    res.status(400).json({ error: err.message || "完工失敗" }); return;
  }

  res.json({ success: true, finishedQuantity: finishedQty, finishedCost });
});

router.delete("/work-orders/:id", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }
  const [existing] = await db.select().from(workOrdersTable).where(eq(workOrdersTable.id, id));
  if (!existing) { res.status(404).json({ error: "Not found" }); return; }
  if (existing.status !== "Draft") { res.status(400).json({ error: "只能刪除草稿狀態的工單" }); return; }
  await db.transaction(async (tx) => {
    await tx.delete(workOrderItemsTable).where(eq(workOrderItemsTable.workOrderId, id));
    await tx.delete(workOrdersTable).where(eq(workOrdersTable.id, id));
  });
  res.json({ success: true });
});

export default router;
