import { Router, type IRouter } from "express";
import { inArray } from "drizzle-orm";
import { db, itemsTable } from "@workspace/erp-db";
import { requireAuth } from "../middleware/require-auth";

const router: IRouter = Router();

router.post("/anomaly-check", requireAuth, async (req, res): Promise<void> => {
  const { docType, items } = req.body as {
    docType?: unknown;
    items?: { itemId?: unknown; rate?: unknown; quantity?: unknown }[];
    customerId?: unknown;
  };
  if (docType !== "sales_order" && docType !== "purchase_order") {
    res.status(400).json({ error: "資料格式有誤：單據類型為必填或格式不正確" });
    return;
  }
  if (!Array.isArray(items)) {
    res.status(400).json({ error: "資料格式有誤：品項明細為必填或格式不正確" });
    return;
  }

  const validLines = items
    .map((item, index) => ({
      index,
      itemId: Number(item.itemId),
      rate: Number(item.rate),
      quantity: Number(item.quantity),
    }))
    .filter(item => Number.isInteger(item.itemId) && item.itemId > 0
      && Number.isFinite(item.rate) && Number.isFinite(item.quantity));
  const itemIds = [...new Set(validLines.map(item => item.itemId))];
  if (itemIds.length === 0) {
    res.json({ warnings: [] });
    return;
  }

  const itemRows = await db.select({
    id: itemsTable.id,
    movingAvgCost: itemsTable.movingAvgCost,
  }).from(itemsTable).where(inArray(itemsTable.id, itemIds));
  const costs = new Map(itemRows.map(item => [item.id, Number(item.movingAvgCost) || 0]));
  const warnings = validLines.flatMap(line => {
    const movingAvgCost = costs.get(line.itemId) || 0;
    if (docType === "sales_order" && line.rate < movingAvgCost) {
      return [{
        index: line.index,
        itemId: line.itemId,
        message: `負毛利: 售價低於平均成本 NT$${movingAvgCost.toLocaleString("zh-TW", { maximumFractionDigits: 2 })}`,
      }];
    }
    if (docType === "purchase_order" && movingAvgCost > 0 && line.rate > movingAvgCost * 1.2) {
      const percent = Math.round((line.rate / movingAvgCost - 1) * 100);
      return [{
        index: line.index,
        itemId: line.itemId,
        message: `進價比平均成本高 ${percent}%`,
      }];
    }
    return [];
  });

  res.json({ warnings });
});

export default router;