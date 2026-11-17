import { Router, type IRouter } from "express";
import { eq, ilike, and, ne, sql } from "drizzle-orm";
import { db, itemsTable, activitiesTable } from "@workspace/erp-db";
import { requireAuth } from "../middleware/require-auth";

const router: IRouter = Router();
router.use("/items", requireAuth);

function numericItem(item: any) {
  return {
    ...item,
    sellingPrice: Number(item.sellingPrice),
    buyingPrice: Number(item.buyingPrice),
    currentStock: Number(item.currentStock),
    reorderLevel: Number(item.reorderLevel),
    totalCost: Number(item.totalCost || 0),
    materialCost: Number(item.materialCost || 0),
    expenseCost: Number(item.expenseCost || 0),
    outsourcingCost: Number(item.outsourcingCost || 0),
    laborCost: Number(item.laborCost || 0),
    internalPrice: Number(item.internalPrice || 0),
    wholesalePrice: Number(item.wholesalePrice || 0),
    retailPrice: Number(item.retailPrice || 0),
    svipPrice: Number(item.svipPrice || 0),
    peerPrice: Number(item.peerPrice || 0),
    dealerPrice: Number(item.dealerPrice || 0),
  };
}

router.get("/items", async (req, res): Promise<void> => {
  const search = req.query.search as string | undefined;
  const itemGroup = req.query.itemGroup as string | undefined;
  const itemType = req.query.itemType as string | undefined;

  const conditions = [];
  if (search) conditions.push(ilike(itemsTable.itemName, `%${search}%`));
  if (itemGroup) conditions.push(eq(itemsTable.itemGroup, itemGroup));
  if (itemType) conditions.push(eq(itemsTable.itemType, itemType));
  // 預設只給啟用中的（開單選品項用）；品項管理要看全部的帶 includeInactive=1
  if (req.query.includeInactive !== "1") conditions.push(ne(itemsTable.status, "Inactive"));

  const items = await db.select().from(itemsTable)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(itemsTable.itemCode);

  res.json(items.map(numericItem));
});

router.get("/items/groups", async (_req, res): Promise<void> => {
  const result = await db.execute(sql`SELECT DISTINCT item_group FROM items WHERE item_group IS NOT NULL AND item_group != '' ORDER BY item_group`);
  res.json(result.rows.map((r: any) => r.item_group));
});

router.get("/items/types", async (_req, res): Promise<void> => {
  const result = await db.execute(sql`SELECT DISTINCT item_type FROM items WHERE item_type IS NOT NULL AND item_type != '' ORDER BY item_type`);
  res.json(result.rows.map((r: any) => r.item_type));
});

router.post("/items", async (req, res): Promise<void> => {
  try {
    const data = req.body;
    const numFields = ["sellingPrice", "buyingPrice", "reorderLevel", "totalCost", "materialCost", "expenseCost", "outsourcingCost", "laborCost", "internalPrice", "wholesalePrice", "retailPrice", "svipPrice", "peerPrice", "dealerPrice"];
    const insertData: any = { ...data };
    for (const f of numFields) {
      if (insertData[f] != null) insertData[f] = String(insertData[f]);
    }
    const [item] = await db.insert(itemsTable).values(insertData).returning();
    await db.insert(activitiesTable).values({ type: "create", title: "新增品項", description: `${data.itemName} 已加入品項列表`, module: "Inventory" });
    res.status(201).json(numericItem(item));
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
});

router.get("/items/:id", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }
  const [item] = await db.select().from(itemsTable).where(eq(itemsTable.id, id));
  if (!item) { res.status(404).json({ error: "Item not found" }); return; }
  res.json(numericItem(item));
});

// 品項切換為虛擬服務前的防呆檢查：
// 1) 仍有庫存（currentStock != 0）不可切換，否則剩餘庫存會被凍結、報表估值失真
// 2) 仍有未完成單據（草稿/進行中）引用該品項時不可切換，避免舊單據行為改變
async function checkVirtualSwitchBlockers(tx: any, itemId: number, currentStock: number): Promise<string[]> {
  const blockers: string[] = [];

  if (currentStock !== 0) {
    blockers.push(`目前庫存為 ${currentStock}，需先調整為 0`);
  }

  // 檢查 items JSONB 中引用該品項、且尚未完成（非 Completed/Cancelled）的單據
  const jsonbDocs: Array<{ table: string; label: string }> = [
    { table: "sales_orders", label: "銷售訂單" },
    { table: "purchase_orders", label: "採購訂單" },
    { table: "delivery_notes", label: "出貨單" },
    { table: "purchase_receipts", label: "進貨單" },
    { table: "sales_returns", label: "銷貨退回單" },
    { table: "purchase_returns", label: "採購退回單" },
  ];
  for (const doc of jsonbDocs) {
    const result = await tx.execute(sql`
      SELECT COUNT(*)::int AS count FROM ${sql.raw(doc.table)}
      WHERE status NOT IN ('Completed', 'Cancelled')
        AND EXISTS (
          SELECT 1 FROM jsonb_array_elements(items) AS line
          WHERE (line->>'itemId')::int = ${itemId}
        )
    `);
    const count = Number((result.rows[0] as any)?.count || 0);
    if (count > 0) blockers.push(`有 ${count} 張未完成的${doc.label}`);
  }

  // 工單以 item_id 引用成品，或透過 work_order_items 引用未發料的物料
  const wo = await tx.execute(sql`
    SELECT COUNT(DISTINCT wo.id)::int AS count FROM work_orders wo
    WHERE wo.status NOT IN ('Completed', 'Cancelled')
      AND (
        wo.item_id = ${itemId}
        OR EXISTS (
          SELECT 1 FROM work_order_items woi
          WHERE woi.work_order_id = wo.id AND woi.item_id = ${itemId}
        )
      )
  `);
  const woCount = Number((wo.rows[0] as any)?.count || 0);
  if (woCount > 0) blockers.push(`有 ${woCount} 張未完成的工單（成品或物料引用此品項）`);

  return blockers;
}

router.patch("/items/:id", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }
  const data = req.body;

  const numFields = ["sellingPrice", "buyingPrice", "reorderLevel", "totalCost", "materialCost", "expenseCost", "outsourcingCost", "laborCost", "internalPrice", "wholesalePrice", "retailPrice", "svipPrice", "peerPrice", "dealerPrice"];
  const updateData: any = { ...data };
  for (const f of numFields) {
    if (updateData[f] != null) updateData[f] = String(updateData[f]);
  }

  try {
    // 在單一交易內鎖定品項列（FOR UPDATE），檢查後才更新，
    // 避免並發庫存異動在檢查與寫入之間造成「虛擬品項仍有庫存」
    const item = await db.transaction(async (tx) => {
      const locked = await tx.execute(sql`
        SELECT is_virtual AS "isVirtual", current_stock AS "currentStock"
        FROM items WHERE id = ${id} FOR UPDATE
      `);
      const existing = locked.rows[0] as { isVirtual: boolean; currentStock: string } | undefined;
      if (!existing) return null;

      // 切換為虛擬服務前的庫存/單據防呆
      if (data.isVirtual === true && !existing.isVirtual) {
        const blockers = await checkVirtualSwitchBlockers(tx, id, Number(existing.currentStock));
        if (blockers.length > 0) {
          const err: any = new Error(`無法切換為虛擬服務：${blockers.join("；")}。請先結清庫存並完成或取消相關單據。`);
          err.virtualSwitchBlockers = blockers;
          throw err;
        }
      }

      const [updated] = await tx.update(itemsTable).set(updateData).where(eq(itemsTable.id, id)).returning();
      return updated ?? null;
    });
    if (!item) { res.status(404).json({ error: "Item not found" }); return; }
    res.json(numericItem(item));
  } catch (e: any) {
    if (e?.virtualSwitchBlockers) {
      res.status(409).json({ error: e.message, blockers: e.virtualSwitchBlockers });
      return;
    }
    throw e;
  }
});

router.delete("/items/:id", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }
  const [item] = await db.delete(itemsTable).where(eq(itemsTable.id, id)).returning();
  if (!item) { res.status(404).json({ error: "Item not found" }); return; }
  res.sendStatus(204);
});

export default router;
