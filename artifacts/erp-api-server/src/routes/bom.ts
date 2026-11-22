import { Router, type IRouter } from "express";
import { eq, desc, inArray, sql } from "drizzle-orm";
import { db, bomsTable, bomItemsTable, itemsTable, type Bom } from "@workspace/erp-db";
import { requireAuth } from "../middleware/require-auth";

const router: IRouter = Router();
router.use("/boms", requireAuth);

function numericBom(b: Bom) {
  return { ...b, quantity: Number(b.quantity) };
}

type CleanLine = { itemId: number; quantity: number; rate: number; unit: string; parentBomItemId: number | null; level: number; remarks: string | null };

/**
 * 整理原料明細：空白列略過；數量要大於 0；原料不能是成品自己；同一個原料重複就合併數量；
 * 沒給單位就用品項自己的單位。回傳錯誤訊息或整理好的明細。
 */
async function cleanLines(productId: number, raw: unknown): Promise<{ error: string } | { lines: CleanLine[] }> {
  if (!Array.isArray(raw)) return { lines: [] };
  const picked = raw.filter((r: any) => r && Number(r.itemId) > 0);
  if (picked.length === 0) return { lines: [] };
  const ids = [...new Set(picked.map((r: any) => Number(r.itemId)))];
  const found = await db.select({ id: itemsTable.id, unit: itemsTable.unit, itemName: itemsTable.itemName }).from(itemsTable).where(inArray(itemsTable.id, ids));
  const byId = new Map(found.map(f => [f.id, f]));
  const merged = new Map<number, CleanLine>();
  for (const r of picked as any[]) {
    const itemId = Number(r.itemId);
    const item = byId.get(itemId);
    if (!item) return { error: "有一筆原料找不到對應的品項，請重新選擇" };
    if (itemId === productId) return { error: `原料不能是成品自己（${item.itemName}）` };
    const quantity = Number(r.quantity);
    if (!Number.isFinite(quantity) || quantity <= 0) return { error: `「${item.itemName}」的數量要大於 0` };
    const rate = Number(r.rate);
    if (!Number.isFinite(rate) || rate < 0) return { error: `「${item.itemName}」的單價不正確` };
    // 摘要（位置）：這個原料用在哪裡之類的說明，選填
    const remarks = typeof r.remarks === "string" && r.remarks.trim() ? r.remarks.trim() : null;
    const existing = merged.get(itemId);
    if (existing) {
      existing.quantity += quantity;
      // 同一個原料填了兩行：摘要不一樣就接在一起，不要丟掉
      if (remarks && !(existing.remarks ?? "").split("；").includes(remarks)) existing.remarks = existing.remarks ? `${existing.remarks}；${remarks}` : remarks;
      continue;
    }
    merged.set(itemId, { itemId, quantity, rate, unit: (typeof r.unit === "string" && r.unit.trim() && r.unit !== "Nos" ? r.unit.trim() : item.unit) || "Nos", parentBomItemId: r.parentBomItemId ? Number(r.parentBomItemId) : null, level: r.level ? Number(r.level) : 0, remarks });
  }
  return { lines: [...merged.values()] };
}
const lineValues = (bomId: number, l: CleanLine) => ({
  bomId, itemId: l.itemId, quantity: String(l.quantity), unit: l.unit, rate: String(l.rate),
  amount: String(Math.round(l.quantity * l.rate * 100) / 100), parentBomItemId: l.parentBomItemId, level: l.level, remarks: l.remarks,
});

function generateBomNumber(): string {
  return "BOM-" + String(Date.now()).slice(-8);
}

router.get("/boms", async (_req, res): Promise<void> => {
  const rows = await db.select({
    bom: bomsTable,
    itemName: itemsTable.itemName,
    itemCode: itemsTable.itemCode,
    componentCount: sql<number>`(SELECT COUNT(*) FROM bom_items WHERE bom_id = ${bomsTable.id})::int`,
    // 用各原料目前的平均成本（沒有就用進貨價）估算，跟明細頁的算法一致
    materialCost: sql<number>`(SELECT COALESCE(SUM(bi.quantity * CASE WHEN i.is_virtual THEN 0 ELSE COALESCE(NULLIF(i.moving_avg_cost, 0), i.buying_price, 0) END), 0) FROM bom_items bi LEFT JOIN items i ON i.id = bi.item_id WHERE bi.bom_id = ${bomsTable.id})::float`,
  })
    .from(bomsTable)
    .leftJoin(itemsTable, eq(bomsTable.itemId, itemsTable.id))
    .orderBy(desc(bomsTable.createdAt));

  res.json(rows.map(r => ({
    ...numericBom(r.bom),
    itemName: r.itemName || "",
    itemCode: r.itemCode || "",
    componentCount: r.componentCount || 0,
    materialCost: Number(r.materialCost) || 0,
  })));
});

router.get("/boms/:id", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }

  const [row] = await db.select({
    bom: bomsTable,
    itemName: itemsTable.itemName,
    itemCode: itemsTable.itemCode,
  })
    .from(bomsTable)
    .leftJoin(itemsTable, eq(bomsTable.itemId, itemsTable.id))
    .where(eq(bomsTable.id, id));

  if (!row) { res.status(404).json({ error: "Not found" }); return; }

  const items = await db.select({
    bomItem: bomItemsTable,
    itemName: itemsTable.itemName,
    itemCode: itemsTable.itemCode,
    specification: itemsTable.specification,
    movingAvgCost: itemsTable.movingAvgCost,
    buyingPrice: itemsTable.buyingPrice,
    isVirtual: itemsTable.isVirtual,
  })
    .from(bomItemsTable)
    .leftJoin(itemsTable, eq(bomItemsTable.itemId, itemsTable.id))
    .where(eq(bomItemsTable.bomId, id));

  const detailItems = items.map(i => {
    const quantity = Number(i.bomItem.quantity);
    const currentUnitCost = i.isVirtual ? 0 : (Number(i.movingAvgCost) || Number(i.buyingPrice) || 0);
    return {
      ...i.bomItem,
      quantity,
      rate: Number(i.bomItem.rate),
      amount: Number(i.bomItem.amount),
      itemName: i.itemName || "",
      itemCode: i.itemCode || "",
      specification: i.specification || "",
      currentUnitCost,
      currentCost: Math.round(quantity * currentUnitCost * 100) / 100,
    };
  });
  const estimatedMaterialCost = Math.round(detailItems.reduce((sum, i) => sum + i.currentCost, 0) * 100) / 100;
  const batchQuantity = Number(row.bom.quantity) || 1;

  res.json({
    ...numericBom(row.bom),
    itemName: row.itemName || "",
    itemCode: row.itemCode || "",
    items: detailItems,
    // 依各材料目前的平均成本估算：做一批要多少材料成本、平均一個成品多少
    estimatedMaterialCost,
    estimatedUnitCost: batchQuantity > 0 ? Math.round((estimatedMaterialCost / batchQuantity) * 100) / 100 : 0,
  });
});

router.post("/boms", async (req, res): Promise<void> => {
  const { itemId, quantity, unit, remarks, items } = req.body;
  if (!itemId) { res.status(400).json({ error: "必須選擇成品" }); return; }
  const [product] = await db.select({ id: itemsTable.id, unit: itemsTable.unit }).from(itemsTable).where(eq(itemsTable.id, Number(itemId)));
  if (!product) { res.status(400).json({ error: "找不到這個成品，請重新選擇" }); return; }
  if (!(Number(quantity || 1) > 0)) { res.status(400).json({ error: "產出數量要大於 0" }); return; }
  const cleaned = await cleanLines(product.id, items);
  if ("error" in cleaned) { res.status(400).json({ error: cleaned.error }); return; }

  const existingBoms = await db.select().from(bomsTable).where(eq(bomsTable.itemId, Number(itemId)));
  const version = existingBoms.length + 1;

  // 等資料確定寫入之後才回應，緊接著的下一個動作才找得到這張物料清單
  const created = await db.transaction(async (tx) => {
    const [bom] = await tx.insert(bomsTable).values({
      bomNumber: generateBomNumber(),
      itemId: Number(itemId),
      version,
      quantity: String(Number(quantity) || 1),
      unit: (typeof unit === "string" && unit.trim() && unit !== "Nos" ? unit.trim() : product.unit) || "Nos",
      remarks: remarks || null,
    }).returning();

    for (const line of cleaned.lines) await tx.insert(bomItemsTable).values(lineValues(bom.id, line));

    const [itemRow] = await tx.select({ itemName: itemsTable.itemName }).from(itemsTable).where(eq(itemsTable.id, Number(itemId)));
    return { ...numericBom(bom), itemName: itemRow?.itemName || "", items: [] };
  });
  res.status(201).json(created);
});

router.patch("/boms/:id", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }

  const [existing] = await db.select().from(bomsTable).where(eq(bomsTable.id, id));
  if (!existing) { res.status(404).json({ error: "Not found" }); return; }

  const updates: Record<string, unknown> = {};
  if (req.body.status !== undefined) updates.status = req.body.status;
  if (req.body.quantity !== undefined) updates.quantity = String(Number(req.body.quantity));
  if (req.body.unit !== undefined) updates.unit = req.body.unit;
  if (req.body.remarks !== undefined) updates.remarks = req.body.remarks;
  if (updates.status !== undefined && !["Draft", "Active", "Inactive"].includes(String(updates.status))) { res.status(400).json({ error: "狀態不正確" }); return; }
  if (updates.quantity !== undefined && !(Number(updates.quantity) > 0)) { res.status(400).json({ error: "產出數量要大於 0" }); return; }
  let newLines: CleanLine[] | null = null;
  if (req.body.items && Array.isArray(req.body.items)) {
    const cleaned = await cleanLines(existing.itemId, req.body.items);
    if ("error" in cleaned) { res.status(400).json({ error: cleaned.error }); return; }
    newLines = cleaned.lines;
  }
  // 沒有原料的清單不能啟用（啟用後開工單會領不到料）
  if (updates.status === "Active") {
    const count = newLines ? newLines.length : (await db.select({ id: bomItemsTable.id }).from(bomItemsTable).where(eq(bomItemsTable.bomId, id))).length;
    if (count === 0) { res.status(400).json({ error: "這張物料清單還沒有原料，請先加上原料再啟用" }); return; }
  }

  await db.transaction(async (tx) => {
    if (Object.keys(updates).length > 0) {
      await tx.update(bomsTable).set(updates).where(eq(bomsTable.id, id));
    }

    if (newLines) {
      await tx.delete(bomItemsTable).where(eq(bomItemsTable.bomId, id));
      for (const line of newLines) await tx.insert(bomItemsTable).values(lineValues(id, line));
    }
  });

  const [updated] = await db.select().from(bomsTable).where(eq(bomsTable.id, id));
  res.json(numericBom(updated));
});

router.delete("/boms/:id", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }
  const [existing] = await db.select().from(bomsTable).where(eq(bomsTable.id, id));
  if (!existing) { res.status(404).json({ error: "Not found" }); return; }
  if (existing.status !== "Draft") { res.status(400).json({ error: "只能刪除草稿狀態的 BOM" }); return; }
  await db.transaction(async (tx) => {
    await tx.delete(bomItemsTable).where(eq(bomItemsTable.bomId, id));
    await tx.delete(bomsTable).where(eq(bomsTable.id, id));
  });
  res.json({ success: true });
});

export default router;
