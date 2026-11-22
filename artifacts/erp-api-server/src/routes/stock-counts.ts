import { Router, type IRouter } from "express";
import { desc, eq, inArray } from "drizzle-orm";
import { db, stockCountsTable, itemsTable, warehousesTable, projectsTable, activitiesTable, type StockCountLine } from "@workspace/erp-db";
import { requireAuth, requireRole } from "../middleware/require-auth";
import { nextDocNumber } from "../lib/doc-number";
import { itemUnitCost, postAutoJournal, round2, todayTaipei } from "../lib/inventory-journal";
import { isRealDate } from "../lib/cash-accounts";
import { itemsSummary } from "../lib/voucher-entry-text";
import { countDifferences, logStockMovement, warehouseStock } from "../lib/stock-ledger";

const router: IRouter = Router();
router.use("/stock-counts", requireAuth);
// 過帳會動到庫存與帳務，只給管理與財務角色
const POST_ROLES = ["owner", "admin", "finance_admin", "accountant", "manager", "warehouse"] as const;

const parseId = (value: unknown): number | null => {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
};

const summarize = (row: typeof stockCountsTable.$inferSelect) => {
  const diff = countDifferences(row.lines);
  return { lineCount: row.lines.length, countedLines: diff.countedLines, diffLines: diff.rows.length, gain: diff.gain, loss: diff.loss };
};

router.get("/stock-counts", async (_req, res): Promise<void> => {
  const rows = await db.select({ count: stockCountsTable, warehouseName: warehousesTable.name, projectName: projectsTable.name })
    .from(stockCountsTable)
    .leftJoin(warehousesTable, eq(warehousesTable.id, stockCountsTable.warehouseId))
    .leftJoin(projectsTable, eq(projectsTable.id, stockCountsTable.projectId))
    .orderBy(desc(stockCountsTable.id)).limit(300);
  res.json(rows.map(r => {
    const { lines: _lines, ...head } = r.count;
    return { ...head, warehouseName: r.warehouseName, projectName: r.projectName, ...summarize(r.count) };
  }));
});

router.get("/stock-counts/:id", async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  if (!id) { res.status(400).json({ error: "格式不正確" }); return; }
  const [row] = await db.select({ count: stockCountsTable, warehouseName: warehousesTable.name, projectName: projectsTable.name })
    .from(stockCountsTable)
    .leftJoin(warehousesTable, eq(warehousesTable.id, stockCountsTable.warehouseId))
    .leftJoin(projectsTable, eq(projectsTable.id, stockCountsTable.projectId))
    .where(eq(stockCountsTable.id, id));
  if (!row) { res.status(404).json({ error: "找不到這張盤點單" }); return; }
  res.json({ ...row.count, warehouseName: row.warehouseName, projectName: row.projectName, ...summarize(row.count) });
});

/**
 * 開盤點單：把當下帳上的數量存下來，之後填實盤數量。
 * basis＝warehouse：帳上數量是這間倉庫的數量（由進出紀錄加總）
 * basis＝total：帳上數量是品項主檔的全公司合計（只有一間倉庫，或第一次盤點時用）
 */
router.post("/stock-counts", async (req, res): Promise<void> => {
  const body = req.body || {};
  const warehouseId = parseId(body.warehouseId);
  const projectId = parseId(body.projectId);
  if (!warehouseId) { res.status(400).json({ error: "請選擇倉庫" }); return; }
  if (!projectId) { res.status(400).json({ error: "請選擇專案：盤盈、盤損要歸屬到專案" }); return; }
  const countDate = body.countDate || todayTaipei();
  if (!isRealDate(countDate)) { res.status(400).json({ error: "盤點日期格式不正確" }); return; }
  const basis = body.basis === "total" ? "total" : "warehouse";
  try {
    const created = await db.transaction(async (tx) => {
      const [warehouse] = await tx.select({ id: warehousesTable.id }).from(warehousesTable).where(eq(warehousesTable.id, warehouseId));
      if (!warehouse) throw new Error("找不到這間倉庫");
      const [project] = await tx.select({ id: projectsTable.id }).from(projectsTable).where(eq(projectsTable.id, projectId));
      if (!project) throw new Error("找不到這個專案");
      const [open] = await tx.select({ countNumber: stockCountsTable.countNumber }).from(stockCountsTable)
        .where(eq(stockCountsTable.status, "Draft")).limit(1);
      if (open) throw new Error(`盤點單 ${open.countNumber} 還沒過帳或取消。同時開兩張盤點單，差異會重複調整`);
      const items = await tx.select({
        id: itemsTable.id, itemCode: itemsTable.itemCode, itemName: itemsTable.itemName, currentStock: itemsTable.currentStock,
        isVirtual: itemsTable.isVirtual, movingAvgCost: itemsTable.movingAvgCost, buyingPrice: itemsTable.buyingPrice,
      }).from(itemsTable).orderBy(itemsTable.itemCode);
      const byWarehouse = basis === "warehouse" ? await warehouseStock(tx, warehouseId) : null;
      const lines: StockCountLine[] = items.filter(i => !i.isVirtual).map(i => ({
        itemId: i.id, itemCode: i.itemCode, itemName: i.itemName,
        systemQty: round2(byWarehouse ? (byWarehouse.get(i.id) || 0) : Number(i.currentStock || 0)),
        countedQty: null, unitCost: itemUnitCost(i),
      }));
      if (lines.length === 0) throw new Error("沒有需要盤點的品項（虛擬服務品項不追蹤庫存）");
      const countNumber = await nextDocNumber(tx, "stock_counts", "count_number", "SC", () => `SC-${String(Date.now()).slice(-8)}`, countDate);
      const [row] = await tx.insert(stockCountsTable).values({
        countNumber, warehouseId, projectId, countDate, basis, lines,
        remarks: typeof body.remarks === "string" ? body.remarks.trim().slice(0, 300) || null : null,
        createdBy: req.session?.user?.username || "api",
      }).returning();
      return row;
    });
    res.status(201).json({ ...created, ...summarize(created) });
  } catch (err: any) {
    res.status(400).json({ error: err?.message || "開單失敗" });
  }
});

/** 儲存實盤數量（可以分次存，沒填的品項維持未盤） */
router.put("/stock-counts/:id", async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  if (!id) { res.status(400).json({ error: "格式不正確" }); return; }
  const input = Array.isArray(req.body?.lines) ? req.body.lines : null;
  if (!input) { res.status(400).json({ error: "格式不正確" }); return; }
  const counted = new Map<number, number | null>();
  for (const line of input) {
    const itemId = parseId(line?.itemId);
    if (!itemId) { res.status(400).json({ error: "品項無效" }); return; }
    if (line.countedQty === null || line.countedQty === "" || line.countedQty === undefined) { counted.set(itemId, null); continue; }
    const qty = Number(line.countedQty);
    if (!Number.isFinite(qty) || qty < 0 || qty > 100_000_000) { res.status(400).json({ error: "實盤數量必須是 0 以上的數字" }); return; }
    counted.set(itemId, round2(qty));
  }
  try {
    const updated = await db.transaction(async (tx) => {
      const [row] = await tx.select().from(stockCountsTable).where(eq(stockCountsTable.id, id)).for("update");
      if (!row) throw Object.assign(new Error("找不到這張盤點單"), { status: 404 });
      if (row.status !== "Draft") throw new Error("這張盤點單已經過帳或取消，不能再修改");
      const lines = row.lines.map(l => counted.has(l.itemId) ? { ...l, countedQty: counted.get(l.itemId)! } : l);
      const [saved] = await tx.update(stockCountsTable).set({
        lines,
        remarks: req.body?.remarks === undefined ? row.remarks : (typeof req.body.remarks === "string" ? req.body.remarks.trim().slice(0, 300) || null : null),
      }).where(eq(stockCountsTable.id, id)).returning();
      return saved;
    });
    res.json({ ...updated, ...summarize(updated) });
  } catch (err: any) {
    res.status(Number(err?.status) || 400).json({ error: err?.message || "儲存失敗" });
  }
});

/**
 * 過帳：依差異調整庫存。盤盈 借 存貨／貸 存貨盤盈；盤損 借 存貨盤損／貸 存貨。
 * 調整的是「差異」而不是把庫存直接改成實盤數，開單之後才發生的進出貨不會被蓋掉。
 */
router.post("/stock-counts/:id/post", requireRole(...POST_ROLES), async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  if (!id) { res.status(400).json({ error: "格式不正確" }); return; }
  try {
    const posted = await db.transaction(async (tx) => {
      const [row] = await tx.select().from(stockCountsTable).where(eq(stockCountsTable.id, id)).for("update");
      if (!row) throw Object.assign(new Error("找不到這張盤點單"), { status: 404 });
      if (row.status !== "Draft") throw new Error("這張盤點單已經過帳或取消");
      const diff = countDifferences(row.lines);
      if (diff.countedLines === 0) throw new Error("還沒有填任何實盤數量");
      const ids = diff.rows.map(r => r.itemId).sort((a, b) => a - b);
      const items = ids.length > 0
        ? await tx.select({ id: itemsTable.id, itemName: itemsTable.itemName, currentStock: itemsTable.currentStock, isVirtual: itemsTable.isVirtual })
          .from(itemsTable).where(inArray(itemsTable.id, ids)).orderBy(itemsTable.id).for("update")
        : [];
      const itemById = new Map<number, (typeof items)[number]>(items.map((i: (typeof items)[number]) => [i.id, i]));
      for (const line of diff.rows) {
        const item = itemById.get(line.itemId);
        if (!item) throw new Error(`品項「${line.itemName}」已經不存在，請取消這張盤點單重新開單`);
        if (item.isVirtual) throw new Error(`品項「${line.itemName}」已改成虛擬服務，不能調整庫存`);
        const newStock = round2(Number(item.currentStock || 0) + line.diff);
        if (newStock < 0) throw new Error(`品項「${line.itemName}」調整後庫存會變成負數（現有 ${Number(item.currentStock || 0)}，盤損 ${-line.diff}）。開單後可能已經出貨，請重新盤點`);
        await tx.update(itemsTable).set({ currentStock: String(newStock) }).where(eq(itemsTable.id, line.itemId));
        await logStockMovement(tx, {
          direction: line.diff > 0 ? 1 : -1, itemId: line.itemId, warehouseId: row.warehouseId, quantity: Math.abs(line.diff),
          rate: line.unitCost, remarks: `盤點單 ${row.countNumber} ${line.diff > 0 ? "盤盈" : "盤損"}`, source: "count", projectId: row.projectId,
        });
      }
      const gainText = itemsSummary(diff.rows.filter(r => r.diff > 0).map(r => r.itemName));
      const lossText = itemsSummary(diff.rows.filter(r => r.diff < 0).map(r => r.itemName));
      await postAutoJournal(tx, {
        key: `SC${row.id}`,
        entryDate: row.countDate,
        // 摘要寫盤了什麼（盤盈／盤損的品名），單號放在分錄編號尾巴（-SC），總分類帳會顯示成來源單號
        description: [gainText && `盤盈 ${gainText}`, lossText && `盤損 ${lossText}`].filter(Boolean).join("、") || "盤點調整",
        action: "盤點過帳",
        projectId: row.projectId,
        lines: [
          { accountName: "存貨", debit: diff.gain, credit: 0, description: `盤盈 ${gainText}`.trim() },
          { accountName: "存貨盤盈", debit: 0, credit: diff.gain, description: `盤盈 ${gainText}`.trim() },
          { accountName: "存貨盤損", debit: diff.loss, credit: 0, description: `盤損 ${lossText}`.trim() },
          { accountName: "存貨", debit: 0, credit: diff.loss, description: `盤損 ${lossText}`.trim() },
        ],
      });
      const [saved] = await tx.update(stockCountsTable).set({
        status: "Posted", postedBy: req.session?.user?.username || "api", postedAt: new Date(),
      }).where(eq(stockCountsTable.id, id)).returning();
      await tx.insert(activitiesTable).values({ type: "update", title: "盤點過帳", description: `${row.countNumber}：調整 ${diff.rows.length} 個品項`, module: "Inventory" });
      return saved;
    });
    res.json({ ...posted, ...summarize(posted) });
  } catch (err: any) {
    res.status(Number(err?.status) || 400).json({ error: err?.message || "過帳失敗" });
  }
});

router.post("/stock-counts/:id/cancel", async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  if (!id) { res.status(400).json({ error: "格式不正確" }); return; }
  const [row] = await db.select({ status: stockCountsTable.status }).from(stockCountsTable).where(eq(stockCountsTable.id, id));
  if (!row) { res.status(404).json({ error: "找不到這張盤點單" }); return; }
  if (row.status !== "Draft") { res.status(400).json({ error: "只有盤點中的單可以取消；已過帳的差異請再開一張盤點單調整" }); return; }
  const [saved] = await db.update(stockCountsTable).set({ status: "Cancelled" }).where(eq(stockCountsTable.id, id)).returning();
  res.json({ ...saved, ...summarize(saved) });
});

export default router;
