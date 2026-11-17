import { Router, type IRouter } from "express";
import { desc, eq, inArray, isNotNull } from "drizzle-orm";
import {
  db, subcontractOrdersTable, suppliersTable, itemsTable, bomsTable, bomItemsTable, projectsTable,
  warehousesTable, invoicesTable, activitiesTable, type SubcontractMaterial, type SubcontractOrder,
} from "@workspace/erp-db";
import { requireAuth } from "../middleware/require-auth";
import { nextDocNumber } from "../lib/doc-number";
import { itemUnitCost, nextMovingAvgCost, postAutoJournal, round2, todayTaipei } from "../lib/inventory-journal";
import { isRealDate } from "../lib/cash-accounts";
import { logStockMovement, warehouseStock } from "../lib/stock-ledger";
import { applyPaymentTerm } from "../lib/invoice-terms";
import { friendlyCaughtError } from "../lib/friendly-errors";
import { atVendor, buildMaterials, closeOut, consumptionFor, feeFor, remainingToIssue, unitCostOf } from "../lib/subcontract";

const router: IRouter = Router();
router.use("/subcontract-orders", requireAuth);
// 誰能用由選單權限決定（和工單、進貨單一樣），自訂角色的倉管與採購也能操作

const parseId = (value: unknown): number | null => {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
};
const round4 = (n: number): number => Math.round((Number(n) || 0) * 10000) / 10000;

function present(order: SubcontractOrder, extra: Record<string, unknown> = {}) {
  const quantity = Number(order.quantity), receivedQuantity = Number(order.receivedQuantity);
  const materialCost = Number(order.materialCost), feeAmount = Number(order.feeAmount);
  const materials = (order.materials || []).map(m => ({ ...m, atVendor: atVendor(m), remainingToIssue: remainingToIssue(m) }));
  return {
    ...order, quantity, receivedQuantity, unitFee: Number(order.unitFee), materialCost, feeAmount, lossAmount: Number(order.lossAmount),
    remainingQuantity: round2(quantity - receivedQuantity),
    unitCost: unitCostOf(materialCost, feeAmount, receivedQuantity),
    materials, ...extra,
  };
}

/** 代工廠倉：每家代工廠一間，沒有就自動建立 */
async function vendorWarehouse(tx: any, supplier: { id: number; name: string }): Promise<number> {
  const [existing] = await tx.select({ id: warehousesTable.id }).from(warehousesTable)
    .where(eq(warehousesTable.subcontractorSupplierId, supplier.id)).orderBy(warehousesTable.id).limit(1);
  if (existing) return existing.id;
  const [created] = await tx.insert(warehousesTable).values({
    name: `代工廠倉－${supplier.name}`.slice(0, 100), location: "放在代工廠的材料（仍屬於公司）", subcontractorSupplierId: supplier.id,
  }).returning({ id: warehousesTable.id });
  return created.id;
}

/** 自己的倉庫（不是代工廠倉）；沒指定就用第一間 */
async function ownWarehouse(tx: any, requested: unknown): Promise<{ id: number; name: string }> {
  const rows = await tx.select({ id: warehousesTable.id, name: warehousesTable.name, supplierId: warehousesTable.subcontractorSupplierId })
    .from(warehousesTable).orderBy(warehousesTable.id);
  const own = rows.filter((w: { supplierId: number | null }) => w.supplierId == null);
  const id = parseId(requested);
  const chosen = id ? own.find((w: { id: number }) => w.id === id) : own[0];
  if (!chosen) throw new Error(id ? "請選擇公司自己的倉庫（不能選代工廠倉）" : "公司還沒有倉庫，請先建立一間");
  return chosen;
}

/** 某個品項目前放在所有代工廠手上的總數量 */
async function heldByVendors(tx: any, itemId: number): Promise<number> {
  const vendors = await tx.select({ id: warehousesTable.id }).from(warehousesTable).where(isNotNull(warehousesTable.subcontractorSupplierId));
  let total = 0;
  for (const vendor of vendors) total += (await warehouseStock(tx, vendor.id)).get(itemId) || 0;
  return round4(total);
}

async function lockOrder(tx: any, id: number): Promise<SubcontractOrder> {
  const [order] = await tx.select().from(subcontractOrdersTable).where(eq(subcontractOrdersTable.id, id)).for("update");
  if (!order) throw Object.assign(new Error("找不到這張外包單"), { status: 404 });
  return order;
}

const fail = (res: any, err: any, fallback: string) =>
  res.status(Number(err?.status) || 400).json({ error: friendlyCaughtError(err, fallback) });

router.get("/subcontract-orders", async (req, res): Promise<void> => {
  const rows = await db.select({ order: subcontractOrdersTable, supplierName: suppliersTable.name, itemName: itemsTable.itemName, itemCode: itemsTable.itemCode, projectName: projectsTable.name })
    .from(subcontractOrdersTable)
    .leftJoin(suppliersTable, eq(suppliersTable.id, subcontractOrdersTable.supplierId))
    .leftJoin(itemsTable, eq(itemsTable.id, subcontractOrdersTable.itemId))
    .leftJoin(projectsTable, eq(projectsTable.id, subcontractOrdersTable.projectId))
    .where(req.query.status ? eq(subcontractOrdersTable.status, String(req.query.status)) : undefined)
    .orderBy(desc(subcontractOrdersTable.id)).limit(500);
  res.json(rows.map(r => present(r.order, { supplierName: r.supplierName, itemName: r.itemName, itemCode: r.itemCode, projectName: r.projectName })));
});

/** 各代工廠手上目前有哪些料（跨外包單彙總） */
router.get("/subcontract-orders/vendor-stock", async (_req, res): Promise<void> => {
  const vendors = await db.select({ id: warehousesTable.id, name: warehousesTable.name, supplierId: warehousesTable.subcontractorSupplierId, supplierName: suppliersTable.name })
    .from(warehousesTable).leftJoin(suppliersTable, eq(suppliersTable.id, warehousesTable.subcontractorSupplierId))
    .where(isNotNull(warehousesTable.subcontractorSupplierId)).orderBy(warehousesTable.id);
  const result = [];
  for (const vendor of vendors) {
    const stock = [...(await warehouseStock(db, vendor.id)).entries()].filter(([, qty]) => Math.abs(qty) > 0.0001);
    if (stock.length === 0) continue;
    const items = await db.select({ id: itemsTable.id, itemName: itemsTable.itemName, itemCode: itemsTable.itemCode, unit: itemsTable.unit, movingAvgCost: itemsTable.movingAvgCost, buyingPrice: itemsTable.buyingPrice })
      .from(itemsTable).where(inArray(itemsTable.id, stock.map(([itemId]) => itemId)));
    const byId = new Map(items.map(i => [i.id, i]));
    const lines = stock.map(([itemId, quantity]) => {
      const item = byId.get(itemId);
      return { itemId, itemCode: item?.itemCode || "", itemName: item?.itemName || "（已刪除的品項）", unit: item?.unit || "", quantity: round4(quantity), amount: round2(quantity * itemUnitCost(item)) };
    });
    result.push({ warehouseId: vendor.id, warehouseName: vendor.name, supplierId: vendor.supplierId, supplierName: vendor.supplierName, lines, totalAmount: round2(lines.reduce((s, l) => s + l.amount, 0)) });
  }
  res.json(result);
});

router.get("/subcontract-orders/:id", async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  if (!id) { res.status(400).json({ error: "外包單編號格式不正確" }); return; }
  const [row] = await db.select({ order: subcontractOrdersTable, supplierName: suppliersTable.name, itemName: itemsTable.itemName, itemCode: itemsTable.itemCode, projectName: projectsTable.name, vendorWarehouseName: warehousesTable.name })
    .from(subcontractOrdersTable)
    .leftJoin(suppliersTable, eq(suppliersTable.id, subcontractOrdersTable.supplierId))
    .leftJoin(itemsTable, eq(itemsTable.id, subcontractOrdersTable.itemId))
    .leftJoin(projectsTable, eq(projectsTable.id, subcontractOrdersTable.projectId))
    .leftJoin(warehousesTable, eq(warehousesTable.id, subcontractOrdersTable.vendorWarehouseId))
    .where(eq(subcontractOrdersTable.id, id));
  if (!row) { res.status(404).json({ error: "找不到這張外包單" }); return; }
  const invoices = await db.select({ id: invoicesTable.id, invoiceNumber: invoicesTable.invoiceNumber, invoiceDate: invoicesTable.invoiceDate, status: invoicesTable.status, totalAmount: invoicesTable.totalAmount, outstandingAmount: invoicesTable.outstandingAmount })
    .from(invoicesTable).where(eq(invoicesTable.subcontractOrderId, id)).orderBy(invoicesTable.id);
  res.json(present(row.order, {
    supplierName: row.supplierName, itemName: row.itemName, itemCode: row.itemCode, projectName: row.projectName, vendorWarehouseName: row.vendorWarehouseName,
    invoices: invoices.map(i => ({ ...i, totalAmount: Number(i.totalAmount), outstandingAmount: Number(i.outstandingAmount) })),
  }));
});

/** 開外包單：依成品的物料清單算出要給代工廠的材料 */
router.post("/subcontract-orders", async (req, res): Promise<void> => {
  const body = req.body || {};
  const supplierId = parseId(body.supplierId), itemId = parseId(body.itemId), projectId = parseId(body.projectId);
  const quantity = Number(body.quantity), unitFee = Number(body.unitFee ?? 0);
  if (!supplierId) { res.status(400).json({ error: "請選擇代工廠" }); return; }
  if (!itemId) { res.status(400).json({ error: "請選擇要加工的成品" }); return; }
  if (!projectId) { res.status(400).json({ error: "請選擇專案：每一筆支出都必須歸屬到專案" }); return; }
  if (!Number.isFinite(quantity) || quantity <= 0) { res.status(400).json({ error: "數量必須大於 0" }); return; }
  if (!Number.isFinite(unitFee) || unitFee < 0) { res.status(400).json({ error: "加工單價不能是負數" }); return; }
  const orderDate = body.orderDate || todayTaipei();
  if (!isRealDate(orderDate)) { res.status(400).json({ error: "日期格式不正確" }); return; }
  if (body.expectedDate && !isRealDate(body.expectedDate)) { res.status(400).json({ error: "預計交貨日格式不正確" }); return; }
  if (body.expectedDate && body.expectedDate < orderDate) { res.status(400).json({ error: "預計交貨日不能早於外包日期" }); return; }
  try {
    const created = await db.transaction(async (tx) => {
      const [supplier] = await tx.select({ id: suppliersTable.id, name: suppliersTable.name }).from(suppliersTable).where(eq(suppliersTable.id, supplierId));
      if (!supplier) throw new Error("找不到這家代工廠");
      const [project] = await tx.select({ id: projectsTable.id }).from(projectsTable).where(eq(projectsTable.id, projectId));
      if (!project) throw new Error("找不到這個專案");
      const [item] = await tx.select({ id: itemsTable.id, itemName: itemsTable.itemName, isVirtual: itemsTable.isVirtual }).from(itemsTable).where(eq(itemsTable.id, itemId));
      if (!item) throw new Error("找不到這個成品");
      if (item.isVirtual) throw new Error(`「${item.itemName}」是虛擬服務，不追蹤庫存，不能外包加工`);

      // 物料清單：有指定用指定的；沒有就用這個成品最新的一版
      const requestedBom = parseId(body.bomId);
      const boms = await tx.select().from(bomsTable).where(eq(bomsTable.itemId, itemId)).orderBy(desc(bomsTable.version), desc(bomsTable.id));
      const bom = requestedBom ? boms.find((b: { id: number }) => b.id === requestedBom) : boms[0];
      if (requestedBom && !bom) throw new Error("這份物料清單不屬於這個成品");
      if (!bom) throw new Error(`「${item.itemName}」還沒有物料清單，請先到「物料清單」建立，系統才知道要給代工廠哪些材料`);
      const bomRows = await tx.select({ itemId: bomItemsTable.itemId, quantity: bomItemsTable.quantity, unit: bomItemsTable.unit, parentBomItemId: bomItemsTable.parentBomItemId, itemName: itemsTable.itemName, isVirtual: itemsTable.isVirtual })
        .from(bomItemsTable).innerJoin(itemsTable, eq(itemsTable.id, bomItemsTable.itemId)).where(eq(bomItemsTable.bomId, bom.id));
      // 只取第一層材料；虛擬服務品項不是實體材料，不用發給代工廠
      const topLevel = bomRows.filter((r: { parentBomItemId: number | null; isVirtual: boolean }) => r.parentBomItemId == null && !r.isVirtual);
      const materials = buildMaterials(
        topLevel.map((r: { itemId: number; itemName: string; unit: string; quantity: string }) => ({ itemId: r.itemId, itemName: r.itemName, unit: r.unit, quantity: Number(r.quantity) })),
        Number(bom.quantity), quantity,
      );
      if (materials.length === 0) throw new Error("這份物料清單沒有實體材料，沒有東西可以發給代工廠");
      if (materials.some(m => m.itemId === itemId)) throw new Error("物料清單的材料不能包含成品自己");

      const vendorWarehouseId = await vendorWarehouse(tx, supplier);
      const orderNumber = await nextDocNumber(tx, "subcontract_orders", "order_number", "SUB", () => `SUB-${String(Date.now()).slice(-8)}`, orderDate);
      const [row] = await tx.insert(subcontractOrdersTable).values({
        orderNumber, supplierId, itemId, bomId: bom.id, projectId,
        quantity: String(quantity), unitFee: unitFee.toFixed(2), taxable: body.taxable !== false,
        vendorWarehouseId, orderDate, expectedDate: body.expectedDate || null,
        remarks: typeof body.remarks === "string" ? body.remarks.trim().slice(0, 500) || null : null,
        materials, createdBy: req.session?.user?.username || "api",
      }).returning();
      await tx.insert(activitiesTable).values({ type: "create", title: "外包單", description: `${orderNumber}：${supplier.name} 加工 ${item.itemName} × ${quantity}`, module: "Manufacturing" });
      return row;
    });
    res.status(201).json(present(created));
  } catch (err: any) { fail(res, err, "外包單建立失敗"); }
});

/**
 * 發料給代工廠：材料從自己的倉庫移到代工廠倉。
 * 材料還是公司的，總庫存與成本不變，不產生分錄。
 * 沒指定明細就把還沒發的需求量一次發完。
 */
router.post("/subcontract-orders/:id/issue", async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  if (!id) { res.status(400).json({ error: "外包單編號格式不正確" }); return; }
  const input: any[] | null = Array.isArray(req.body?.lines) ? req.body.lines : null;
  try {
    const result = await db.transaction(async (tx) => {
      const order = await lockOrder(tx, id);
      if (order.status !== "Open") throw new Error("只有進行中的外包單可以發料");
      const from = await ownWarehouse(tx, req.body?.fromWarehouseId);
      const materials: SubcontractMaterial[] = order.materials.map(m => ({ ...m }));
      const wanted = input
        ? input.map(l => ({ itemId: Number(l?.itemId), quantity: Number(l?.quantity) })).filter(l => l.quantity !== 0)
        : materials.map(m => ({ itemId: m.itemId, quantity: remainingToIssue(m) })).filter(l => l.quantity > 0);
      if (wanted.length === 0) throw new Error(input ? "請填寫要發的數量" : "需求的材料都已經發完了");
      const overIssued: string[] = [];
      for (const line of wanted) {
        const material = materials.find(m => m.itemId === line.itemId);
        if (!material) throw new Error("發料的品項不在這張外包單的材料裡");
        if (!Number.isFinite(line.quantity) || line.quantity <= 0) throw new Error(`「${material.itemName}」的發料數量必須大於 0`);
        const [item] = await tx.select({ itemName: itemsTable.itemName, currentStock: itemsTable.currentStock, movingAvgCost: itemsTable.movingAvgCost, buyingPrice: itemsTable.buyingPrice })
          .from(itemsTable).where(eq(itemsTable.id, line.itemId)).for("update");
        if (!item) throw new Error(`「${material.itemName}」這個品項已經不存在`);
        // 公司手上可用的量＝全公司庫存 − 已經放在各代工廠的量
        const available = round4(Number(item.currentStock || 0) - await heldByVendors(tx, line.itemId));
        if (available + 0.0001 < line.quantity) throw new Error(`「${item.itemName}」公司倉庫只有 ${available}，不夠發 ${line.quantity}`);
        const rate = itemUnitCost(item);
        await logStockMovement(tx, { direction: -1, itemId: line.itemId, warehouseId: from.id, quantity: line.quantity, rate, remarks: `外包單 ${order.orderNumber} 發料給代工廠`, source: "subcontract", projectId: order.projectId });
        await logStockMovement(tx, { direction: 1, itemId: line.itemId, warehouseId: order.vendorWarehouseId, quantity: line.quantity, rate, remarks: `外包單 ${order.orderNumber} 收到材料`, source: "subcontract", projectId: order.projectId });
        material.issuedQty = round4(material.issuedQty + line.quantity);
        if (material.issuedQty > material.requiredQty + 0.0001) overIssued.push(`${material.itemName}（需求 ${material.requiredQty}，已發 ${material.issuedQty}）`);
      }
      const [updated] = await tx.update(subcontractOrdersTable).set({ materials }).where(eq(subcontractOrdersTable.id, id)).returning();
      await tx.insert(activitiesTable).values({ type: "update", title: "外包發料", description: `${order.orderNumber}：${wanted.length} 項材料發給代工廠`, module: "Manufacturing" });
      return { order: updated, overIssued };
    });
    // 超過需求量只提醒不擋：實務上常會多給一點備損
    res.json({ ...present(result.order), warning: result.overIssued.length > 0 ? `發料超過需求量：${result.overIssued.join("、")}` : null });
  } catch (err: any) { fail(res, err, "發料失敗"); }
});

/**
 * 代工廠交貨：成品入庫。
 * 同一筆交易裡做四件事：
 * 1. 扣掉代工廠用掉的材料（依物料清單 × 這批數量）
 * 2. 成品入庫，成本＝用掉的材料＋加工費（未稅），更新成品的移動平均成本
 * 3. 分錄：材料轉成品（借 製成品／貸 存貨）
 * 4. 開一張加工費的採購發票，變成對代工廠的應付帳款（借 製成品、進項稅額／貸 應付帳款）
 */
router.post("/subcontract-orders/:id/receive", async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  if (!id) { res.status(400).json({ error: "外包單編號格式不正確" }); return; }
  const receiveQty = Number(req.body?.quantity);
  if (!Number.isFinite(receiveQty) || receiveQty <= 0) { res.status(400).json({ error: "交貨數量必須大於 0" }); return; }
  const date = req.body?.date || todayTaipei();
  if (!isRealDate(date)) { res.status(400).json({ error: "日期格式不正確" }); return; }
  if (date > todayTaipei()) { res.status(400).json({ error: "交貨日期不能是未來" }); return; }
  try {
    const result = await db.transaction(async (tx) => {
      const order = await lockOrder(tx, id);
      if (order.status !== "Open") throw new Error("只有進行中的外包單可以收貨");
      const received = Number(order.receivedQuantity), planned = Number(order.quantity);
      if (received + receiveQty > planned + 0.0001) throw new Error(`這張單還剩 ${round2(planned - received)} 沒交，不能收 ${receiveQty}`);
      const into = await ownWarehouse(tx, req.body?.warehouseId);
      const materials: SubcontractMaterial[] = order.materials.map(m => ({ ...m }));
      const usage = consumptionFor(materials, receiveQty);
      if (usage.shortages.length > 0) {
        throw new Error(`代工廠手上的材料不夠做這 ${receiveQty} 個，請先發料：${usage.shortages.map(s => `${s.itemName} 需要 ${s.need}、對方只有 ${s.have}`).join("；")}`);
      }

      // 1. 扣掉用掉的材料
      let materialCost = 0;
      for (const line of usage.lines) {
        const [item] = await tx.select({ itemName: itemsTable.itemName, currentStock: itemsTable.currentStock, movingAvgCost: itemsTable.movingAvgCost, buyingPrice: itemsTable.buyingPrice })
          .from(itemsTable).where(eq(itemsTable.id, line.itemId)).for("update");
        if (!item) throw new Error(`「${line.itemName}」這個品項已經不存在`);
        const newStock = round4(Number(item.currentStock || 0) - line.quantity);
        if (newStock < -0.0001) throw new Error(`「${item.itemName}」帳上庫存只有 ${Number(item.currentStock || 0)}，不夠扣 ${line.quantity}`);
        const rate = itemUnitCost(item);
        const cost = round2(line.quantity * rate);
        materialCost = round2(materialCost + cost);
        await tx.update(itemsTable).set({ currentStock: String(newStock) }).where(eq(itemsTable.id, line.itemId));
        await logStockMovement(tx, { direction: -1, itemId: line.itemId, warehouseId: order.vendorWarehouseId, quantity: line.quantity, rate, remarks: `外包單 ${order.orderNumber} 加工耗用`, source: "subcontract", projectId: order.projectId });
        const material = materials.find(m => m.itemId === line.itemId)!;
        material.consumedQty = round4(material.consumedQty + line.quantity);
      }

      // 2. 成品入庫
      const fee = feeFor(receiveQty, Number(order.unitFee), order.taxable);
      const finishedCost = round2(materialCost + fee.net);
      const [finished] = await tx.select().from(itemsTable).where(eq(itemsTable.id, order.itemId)).for("update");
      if (!finished) throw new Error("成品品項已經不存在");
      const stockBefore = Number(finished.currentStock || 0);
      const values: Record<string, string> = { currentStock: String(round2(stockBefore + receiveQty)) };
      if (finishedCost > 0) values.movingAvgCost = nextMovingAvgCost(stockBefore, Number(finished.movingAvgCost || 0), receiveQty, finishedCost).toFixed(4);
      await tx.update(itemsTable).set(values).where(eq(itemsTable.id, order.itemId));
      await logStockMovement(tx, { direction: 1, itemId: order.itemId, warehouseId: into.id, quantity: receiveQty, rate: finishedCost / receiveQty, remarks: `外包單 ${order.orderNumber} 成品交回入庫`, source: "subcontract", projectId: order.projectId });

      // 3. 材料轉成品
      await postAutoJournal(tx, {
        key: `SUB${order.id}-M`, entryDate: date, action: "外包收貨", projectId: order.projectId,
        description: `自動分錄 - 外包單 ${order.orderNumber} 交回 ${finished.itemName} × ${receiveQty}，耗用材料`,
        lines: [
          { accountName: "製成品", debit: materialCost, credit: 0, description: `${order.orderNumber} 耗用材料轉入成品` },
          { accountName: "存貨", debit: 0, credit: materialCost, description: `${order.orderNumber} 材料耗用` },
        ],
      });

      // 4. 加工費 → 應付帳款
      let invoice: typeof invoicesTable.$inferSelect | null = null;
      if (fee.total > 0) {
        const [createdInvoice] = await tx.insert(invoicesTable).values({
          invoiceNumber: `PINV-${order.orderNumber}-${String(Date.now()).slice(-6)}`,
          invoiceType: "Purchase", supplierId: order.supplierId, projectId: order.projectId, subcontractOrderId: order.id,
          invoiceDate: date, status: "Unpaid",
          totalAmount: String(fee.total), outstandingAmount: String(fee.total),
          taxType: order.taxable ? "taxable" : "exempt", taxRate: order.taxable ? "5" : "0",
          netAmount: String(fee.net), taxAmount: String(fee.tax),
          items: [{ itemId: order.itemId, itemName: `加工費：${finished.itemName}`, quantity: receiveQty, rate: Number(order.unitFee), amount: fee.net }],
        }).returning();
        const journal = await postAutoJournal(tx, {
          key: `SUB${order.id}-F`, entryDate: date, action: "外包加工費入帳", projectId: order.projectId,
          description: `自動分錄 - 外包單 ${order.orderNumber} 加工費（發票 ${createdInvoice.invoiceNumber}）`,
          lines: [
            { accountName: "製成品", debit: fee.net, credit: 0, description: `${order.orderNumber} 加工費計入成品成本` },
            ...(fee.tax > 0 ? [{ accountName: "進項稅額", debit: fee.tax, credit: 0, description: `${order.orderNumber} 加工費進項稅額` }] : []),
            { accountName: "應付帳款", debit: 0, credit: fee.total, description: `${order.orderNumber} 應付加工費` },
          ],
        });
        if (journal) await tx.update(invoicesTable).set({ journalEntryId: journal.id }).where(eq(invoicesTable.id, createdInvoice.id));
        invoice = await applyPaymentTerm(tx, { ...createdInvoice, journalEntryId: journal?.id ?? null });
      }

      const newReceived = round2(received + receiveQty);
      const [updated] = await tx.update(subcontractOrdersTable).set({
        receivedQuantity: String(newReceived), materials,
        materialCost: String(round2(Number(order.materialCost) + materialCost)),
        feeAmount: String(round2(Number(order.feeAmount) + fee.net)),
        status: newReceived >= planned - 0.0001 ? "Completed" : "Open",
      }).where(eq(subcontractOrdersTable.id, id)).returning();
      await tx.insert(activitiesTable).values({ type: "update", title: "外包收貨", description: `${order.orderNumber}：交回 ${finished.itemName} × ${receiveQty}，成本 ${finishedCost}`, module: "Manufacturing" });
      return { order: updated, materialCost, fee, finishedCost, invoiceNumber: invoice?.invoiceNumber ?? null };
    });
    res.json({
      ...present(result.order),
      receipt: { quantity: receiveQty, materialCost: result.materialCost, fee: result.fee.net, tax: result.fee.tax, payable: result.fee.total, finishedCost: result.finishedCost, unitCost: round2(result.finishedCost / receiveQty), invoiceNumber: result.invoiceNumber },
    });
  } catch (err: any) { fail(res, err, "收貨失敗"); }
});

/** 把還在代工廠的料退回倉庫（returns）或記成損耗；回傳損耗金額 */
async function settleVendorStock(tx: any, order: SubcontractOrder, returns: Array<{ itemId: number; quantity: number }>, toWarehouseId: number, date: string, materials: SubcontractMaterial[]): Promise<number> {
  const plan = closeOut(materials, returns);
  if (plan.error) throw new Error(plan.error);
  let lossAmount = 0;
  const lossNames: string[] = [];
  for (const line of plan.lines) {
    const [item] = await tx.select({ itemName: itemsTable.itemName, currentStock: itemsTable.currentStock, movingAvgCost: itemsTable.movingAvgCost, buyingPrice: itemsTable.buyingPrice })
      .from(itemsTable).where(eq(itemsTable.id, line.itemId)).for("update");
    if (!item) throw new Error(`「${line.itemName}」這個品項已經不存在`);
    const rate = itemUnitCost(item);
    const material = materials.find(m => m.itemId === line.itemId)!;
    if (line.returnQty > 0) {
      await logStockMovement(tx, { direction: -1, itemId: line.itemId, warehouseId: order.vendorWarehouseId, quantity: line.returnQty, rate, remarks: `外包單 ${order.orderNumber} 剩料退回`, source: "subcontract", projectId: order.projectId });
      await logStockMovement(tx, { direction: 1, itemId: line.itemId, warehouseId: toWarehouseId, quantity: line.returnQty, rate, remarks: `外包單 ${order.orderNumber} 代工廠退回剩料`, source: "subcontract", projectId: order.projectId });
      material.returnedQty = round4(material.returnedQty + line.returnQty);
    }
    if (line.lossQty > 0) {
      const newStock = round4(Number(item.currentStock || 0) - line.lossQty);
      if (newStock < -0.0001) throw new Error(`「${item.itemName}」帳上庫存只有 ${Number(item.currentStock || 0)}，不夠扣損耗 ${line.lossQty}`);
      await tx.update(itemsTable).set({ currentStock: String(newStock) }).where(eq(itemsTable.id, line.itemId));
      await logStockMovement(tx, { direction: -1, itemId: line.itemId, warehouseId: order.vendorWarehouseId, quantity: line.lossQty, rate, remarks: `外包單 ${order.orderNumber} 加工損耗`, source: "subcontract", projectId: order.projectId });
      material.lossQty = round4(material.lossQty + line.lossQty);
      lossAmount = round2(lossAmount + line.lossQty * rate);
      lossNames.push(`${item.itemName} × ${line.lossQty}`);
    }
  }
  if (lossAmount > 0) {
    await postAutoJournal(tx, {
      key: `SUB${order.id}-X`, entryDate: date, action: "外包損耗入帳", projectId: order.projectId,
      description: `自動分錄 - 外包單 ${order.orderNumber} 加工損耗：${lossNames.join("、")}`.slice(0, 300),
      lines: [
        { accountName: "存貨盤損", debit: lossAmount, credit: 0, description: `${order.orderNumber} 加工損耗` },
        { accountName: "存貨", debit: 0, credit: lossAmount, description: `${order.orderNumber} 損耗的材料` },
      ],
    });
  }
  return lossAmount;
}

/**
 * 結案：處理還在代工廠手上的料。
 * returns 填退回倉庫的數量；沒退回的部分算加工損耗，從庫存扣掉並入帳。
 * 成品沒交完也可以結案（不再等對方交貨）。
 */
router.post("/subcontract-orders/:id/close", async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  if (!id) { res.status(400).json({ error: "外包單編號格式不正確" }); return; }
  const returns = (Array.isArray(req.body?.returns) ? req.body.returns : []).map((r: any) => ({ itemId: Number(r?.itemId), quantity: Number(r?.quantity) || 0 }));
  const date = req.body?.date || todayTaipei();
  if (!isRealDate(date)) { res.status(400).json({ error: "日期格式不正確" }); return; }
  try {
    const result = await db.transaction(async (tx) => {
      const order = await lockOrder(tx, id);
      if (order.status !== "Open" && order.status !== "Completed") throw new Error("這張外包單已經結案或取消");
      const into = await ownWarehouse(tx, req.body?.toWarehouseId);
      const materials: SubcontractMaterial[] = order.materials.map(m => ({ ...m }));
      const lossAmount = await settleVendorStock(tx, order, returns, into.id, date, materials);
      const [updated] = await tx.update(subcontractOrdersTable).set({
        materials, status: "Closed", lossAmount: String(round2(Number(order.lossAmount) + lossAmount)),
      }).where(eq(subcontractOrdersTable.id, id)).returning();
      await tx.insert(activitiesTable).values({ type: "update", title: "外包結案", description: `${order.orderNumber} 結案${lossAmount > 0 ? `，損耗 ${lossAmount}` : ""}`, module: "Manufacturing" });
      return updated;
    });
    res.json(present(result));
  } catch (err: any) { fail(res, err, "結案失敗"); }
});

/** 取消：還沒收過成品才能取消；已經發出去的料全部退回倉庫 */
router.post("/subcontract-orders/:id/cancel", async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  if (!id) { res.status(400).json({ error: "外包單編號格式不正確" }); return; }
  try {
    const result = await db.transaction(async (tx) => {
      const order = await lockOrder(tx, id);
      if (order.status !== "Open") throw new Error("只有進行中的外包單可以取消");
      if (Number(order.receivedQuantity) > 0) throw new Error("已經收過成品，不能取消；不再繼續的話請按「結案」");
      const into = await ownWarehouse(tx, req.body?.toWarehouseId);
      const materials: SubcontractMaterial[] = order.materials.map(m => ({ ...m }));
      const allBack = materials.map(m => ({ itemId: m.itemId, quantity: atVendor(m) })).filter(r => r.quantity > 0);
      await settleVendorStock(tx, order, allBack, into.id, todayTaipei(), materials);
      const [updated] = await tx.update(subcontractOrdersTable).set({ materials, status: "Cancelled" }).where(eq(subcontractOrdersTable.id, id)).returning();
      await tx.insert(activitiesTable).values({ type: "update", title: "外包單取消", description: `${order.orderNumber} 已取消${allBack.length > 0 ? "，材料已退回倉庫" : ""}`, module: "Manufacturing" });
      return updated;
    });
    res.json(present(result));
  } catch (err: any) { fail(res, err, "取消失敗"); }
});

export default router;
