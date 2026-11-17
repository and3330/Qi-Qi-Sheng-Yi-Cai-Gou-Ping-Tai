import { Router, type IRouter } from "express";
import { isMissingProject, PROJECT_REQUIRED_MESSAGE } from "../middleware/project-required";
import { eq, sql } from "drizzle-orm";
import { db, stockEntriesTable, itemsTable, warehousesTable, activitiesTable } from "@workspace/erp-db";
import { ListStockEntriesQueryParams, CreateStockEntryBody } from "@workspace/erp-api-zod";
import { friendlyCaughtError, friendlyValidationError } from "../lib/friendly-errors";
import { requireAuth } from "../middleware/require-auth";
import { itemUnitCost, nextMovingAvgCost, postAutoJournal, round2, todayTaipei } from "../lib/inventory-journal";
import { logStockMovement, warehouseStock } from "../lib/stock-ledger";

const ENTRY_TYPES = ["Receipt", "Issue"];

const router: IRouter = Router();
router.use("/stock-entries", requireAuth);

router.get("/stock-entries", async (req, res): Promise<void> => {
  const query = ListStockEntriesQueryParams.safeParse(req.query);
  const condition = query.success && query.data.type ? eq(stockEntriesTable.entryType, query.data.type) : undefined;

  const entries = await db
    .select({
      id: stockEntriesTable.id,
      entryType: stockEntriesTable.entryType,
      itemId: stockEntriesTable.itemId,
      itemName: itemsTable.itemName,
      warehouseId: stockEntriesTable.warehouseId,
      warehouseName: warehousesTable.name,
      quantity: stockEntriesTable.quantity,
      rate: stockEntriesTable.rate,
      amount: stockEntriesTable.amount,
      remarks: stockEntriesTable.remarks,
      source: stockEntriesTable.source,
      createdAt: stockEntriesTable.createdAt,
    })
    .from(stockEntriesTable)
    .innerJoin(itemsTable, eq(stockEntriesTable.itemId, itemsTable.id))
    .innerJoin(warehousesTable, eq(stockEntriesTable.warehouseId, warehousesTable.id))
    .where(condition)
    .orderBy(stockEntriesTable.createdAt);

  res.json(entries.map(e => ({
    ...e,
    quantity: Number(e.quantity),
    rate: Number(e.rate),
    amount: Number(e.amount),
  })));
});

router.post("/stock-entries", async (req, res): Promise<void> => {
  const parsed = CreateStockEntryBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: friendlyValidationError(parsed.error) }); return; }

  if (isMissingProject(req.body.projectId)) { res.status(400).json({ error: PROJECT_REQUIRED_MESSAGE }); return; }
  const projectId = Number(req.body.projectId);

  // 舊畫面曾送出 Receive；統一成 Receipt。其他類型一律拒絕，避免不明類型被當成出庫
  const entryType = parsed.data.entryType === "Receive" ? "Receipt" : parsed.data.entryType;
  if (!ENTRY_TYPES.includes(entryType)) { res.status(400).json({ error: "異動類型必須是入庫或出庫" }); return; }
  if (!Number.isFinite(parsed.data.quantity) || parsed.data.quantity <= 0) { res.status(400).json({ error: "數量必須為正數" }); return; }
  if (!Number.isFinite(parsed.data.rate) || parsed.data.rate < 0) { res.status(400).json({ error: "單價不能為負數" }); return; }
  const isReceipt = entryType === "Receipt";
  const stockDelta = isReceipt ? parsed.data.quantity : -parsed.data.quantity;

  let entry;
  try {
    entry = await db.transaction(async (tx) => {
      const [row] = await tx.select({ itemName: itemsTable.itemName, currentStock: itemsTable.currentStock, isVirtual: itemsTable.isVirtual, movingAvgCost: itemsTable.movingAvgCost, buyingPrice: itemsTable.buyingPrice })
        .from(itemsTable).where(eq(itemsTable.id, parsed.data.itemId)).for("update");
      if (!row) throw new Error("品項不存在");
      if (row.isVirtual) throw new Error(`品項「${row.itemName}」為虛擬服務，不追蹤庫存，無法建立庫存異動`);
      const newStock = Number(row.currentStock || 0) + stockDelta;
      if (newStock < 0) throw new Error(`品項「${row.itemName}」庫存不足（現有 ${Number(row.currentStock || 0)}，需出庫 ${parsed.data.quantity}）`);
      const [wh] = await tx.select({ id: warehousesTable.id }).from(warehousesTable).where(eq(warehousesTable.id, parsed.data.warehouseId));
      if (!wh) throw new Error("倉庫不存在");
      // 入庫用輸入的單價（沒填就用現行成本）；出庫一律用現行移動平均成本，帳上存貨才會和庫存報表一致
      const currentCost = itemUnitCost(row);
      const rate = isReceipt ? (parsed.data.rate || currentCost) : (currentCost || parsed.data.rate);
      const amount = round2(parsed.data.quantity * rate);
      const [created] = await tx.insert(stockEntriesTable).values({
        ...parsed.data,
        entryType,
        source: "manual",
        projectId,
        quantity: String(parsed.data.quantity),
        rate: rate.toFixed(2),
        amount: String(amount),
      }).returning();
      const itemValues: Record<string, string> = { currentStock: String(newStock) };
      if (isReceipt && amount > 0) {
        itemValues.movingAvgCost = nextMovingAvgCost(Number(row.currentStock || 0), Number(row.movingAvgCost || 0), parsed.data.quantity, amount).toFixed(4);
      }
      await tx.update(itemsTable).set(itemValues).where(eq(itemsTable.id, parsed.data.itemId));
      // 手動異動視為盤點調整：入庫 借 存貨／貸 存貨盤盈；出庫 借 存貨盤損／貸 存貨
      // 摘要：「入庫調整 品名 × 數量 備註」，不再寫「自動分錄 - …」
      const seText = `${isReceipt ? "入庫" : "出庫"}調整 ${row.itemName} × ${parsed.data.quantity}${parsed.data.remarks ? ` ${parsed.data.remarks}` : ""}`.replace(/｜/g, "／").slice(0, 200);
      await postAutoJournal(tx, {
        key: `SE${created.id}`,
        entryDate: todayTaipei(),
        description: seText,
        action: "建立庫存異動",
        projectId,
        lines: isReceipt
          ? [
            { accountName: "存貨", debit: amount, credit: 0, description: seText },
            { accountName: "存貨盤盈", debit: 0, credit: amount, description: seText },
          ]
          : [
            { accountName: "存貨盤損", debit: amount, credit: 0, description: seText },
            { accountName: "存貨", debit: 0, credit: amount, description: seText },
          ],
      });
      return created;
    });
  } catch (err: any) {
    res.status(400).json({ error: friendlyCaughtError(err, "庫存異動失敗，請確認資料後再試") }); return;
  }

  const [item] = await db.select({ itemName: itemsTable.itemName }).from(itemsTable).where(eq(itemsTable.id, parsed.data.itemId));
  const [wh] = await db.select({ name: warehousesTable.name }).from(warehousesTable).where(eq(warehousesTable.id, parsed.data.warehouseId));

  await db.insert(activitiesTable).values({
    type: "create",
    title: "Stock Entry",
    description: `${isReceipt ? "入庫" : "出庫"}：${item?.itemName || "品項"} × ${parsed.data.quantity}`,
    module: "Inventory",
  });

  res.status(201).json({
    ...entry,
    itemName: item?.itemName || "Unknown",
    warehouseName: wh?.name || "Unknown",
    quantity: Number(entry.quantity),
    rate: Number(entry.rate),
    amount: Number(entry.amount),
  });
});

/**
 * 倉庫調撥：東西從一間倉庫搬到另一間。全公司的總數量和成本都不變，所以不開分錄、也不用選專案，
 * 只在兩間倉庫各記一筆出庫、入庫。
 */
router.post("/stock-entries/transfer", async (req, res): Promise<void> => {
  const itemId = Number(req.body?.itemId);
  const fromWarehouseId = Number(req.body?.fromWarehouseId);
  const toWarehouseId = Number(req.body?.toWarehouseId);
  const quantity = Number(req.body?.quantity);
  if (!Number.isInteger(itemId) || itemId <= 0) { res.status(400).json({ error: "請選擇品項" }); return; }
  if (!Number.isInteger(fromWarehouseId) || fromWarehouseId <= 0 || !Number.isInteger(toWarehouseId) || toWarehouseId <= 0) { res.status(400).json({ error: "請選擇調出與調入的倉庫" }); return; }
  if (fromWarehouseId === toWarehouseId) { res.status(400).json({ error: "調出和調入不能是同一間倉庫" }); return; }
  if (!Number.isFinite(quantity) || quantity <= 0) { res.status(400).json({ error: "數量必須為正數" }); return; }
  const note = typeof req.body?.remarks === "string" ? req.body.remarks.trim().slice(0, 200) : "";
  try {
    const result = await db.transaction(async (tx) => {
      const [item] = await tx.select({ itemName: itemsTable.itemName, isVirtual: itemsTable.isVirtual, movingAvgCost: itemsTable.movingAvgCost, buyingPrice: itemsTable.buyingPrice })
        .from(itemsTable).where(eq(itemsTable.id, itemId)).for("update");
      if (!item) throw new Error("品項不存在");
      if (item.isVirtual) throw new Error(`品項「${item.itemName}」為虛擬服務，不追蹤庫存`);
      const warehouses = await tx.select({ id: warehousesTable.id, name: warehousesTable.name }).from(warehousesTable);
      const from = warehouses.find((w: { id: number }) => w.id === fromWarehouseId);
      const to = warehouses.find((w: { id: number }) => w.id === toWarehouseId);
      if (!from || !to) throw new Error("倉庫不存在");
      const available = (await warehouseStock(tx, fromWarehouseId)).get(itemId) || 0;
      if (available + 0.0001 < quantity) throw new Error(`「${from.name}」的「${item.itemName}」只有 ${round2(available)}，不夠調出 ${quantity}`);
      const rate = itemUnitCost(item);
      await logStockMovement(tx, { direction: -1, itemId, warehouseId: fromWarehouseId, quantity, rate, remarks: `調撥至 ${to.name}${note ? `（${note}）` : ""}`, source: "transfer" });
      await logStockMovement(tx, { direction: 1, itemId, warehouseId: toWarehouseId, quantity, rate, remarks: `由 ${from.name} 調入${note ? `（${note}）` : ""}`, source: "transfer" });
      await tx.insert(activitiesTable).values({ type: "create", title: "倉庫調撥", description: `${item.itemName} × ${quantity}：${from.name} → ${to.name}`, module: "Inventory" });
      return { itemName: item.itemName, fromWarehouseName: from.name, toWarehouseName: to.name, quantity };
    });
    res.status(201).json(result);
  } catch (err: any) {
    res.status(400).json({ error: friendlyCaughtError(err, "調撥失敗，請確認資料後再試") });
  }
});

/** 一個品項在各倉庫的數量（調撥時顯示可調數量） */
router.get("/stock-entries/by-warehouse", async (req, res): Promise<void> => {
  const itemId = Number(req.query.itemId);
  if (!Number.isInteger(itemId) || itemId <= 0) { res.status(400).json({ error: "請選擇品項" }); return; }
  const warehouses = await db.select({ id: warehousesTable.id, name: warehousesTable.name }).from(warehousesTable).orderBy(warehousesTable.id);
  const rows = [];
  for (const warehouse of warehouses) rows.push({ warehouseId: warehouse.id, warehouseName: warehouse.name, quantity: round2((await warehouseStock(db, warehouse.id)).get(itemId) || 0) });
  res.json(rows);
});

export default router;
