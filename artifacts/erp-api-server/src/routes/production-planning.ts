import { Router, type IRouter } from "express";
import { eq, desc, and, inArray } from "drizzle-orm";
import { db, salesOrdersTable, bomsTable, bomItemsTable, workOrdersTable, workOrderItemsTable, itemsTable } from "@workspace/erp-db";
import { requireAuth } from "../middleware/require-auth";

const router: IRouter = Router();
router.use("/production-planning", requireAuth);

function generateWoNumber(): string {
  return "WO-" + String(Date.now()).slice(-8);
}

interface FlatMaterial { itemId: number; quantity: number; unit: string }

async function explodeBom(
  bomItems: { itemId: number; quantity: string; unit: string }[],
  ratio: number,
  ancestorPath: Set<number> = new Set()
): Promise<FlatMaterial[]> {
  const result: FlatMaterial[] = [];

  for (const bi of bomItems) {
    const reqQty = Number(bi.quantity) * ratio;

    if (ancestorPath.has(bi.itemId)) {
      const existing = result.find(r => r.itemId === bi.itemId);
      if (existing) existing.quantity += reqQty;
      else result.push({ itemId: bi.itemId, quantity: reqQty, unit: bi.unit });
      continue;
    }

    const [subBom] = await db.select().from(bomsTable)
      .where(and(eq(bomsTable.itemId, bi.itemId), eq(bomsTable.status, "Active")))
      .orderBy(desc(bomsTable.version))
      .limit(1);

    if (subBom) {
      const childPath = new Set(ancestorPath);
      childPath.add(bi.itemId);
      const subBomItems = await db.select().from(bomItemsTable)
        .where(eq(bomItemsTable.bomId, subBom.id));
      const subRatio = reqQty / (Number(subBom.quantity) || 1);
      const subResults = await explodeBom(
        subBomItems.map(s => ({ itemId: s.itemId, quantity: s.quantity, unit: s.unit })),
        subRatio,
        childPath
      );
      for (const sr of subResults) {
        const existing = result.find(r => r.itemId === sr.itemId);
        if (existing) existing.quantity += sr.quantity;
        else result.push(sr);
      }
    } else {
      const existing = result.find(r => r.itemId === bi.itemId);
      if (existing) existing.quantity += reqQty;
      else result.push({ itemId: bi.itemId, quantity: reqQty, unit: bi.unit });
    }
  }

  return result;
}

router.post("/production-planning/generate-from-so", async (req, res): Promise<void> => {
  const { salesOrderId } = req.body;
  if (!salesOrderId) { res.status(400).json({ error: "必須指定銷售訂單" }); return; }

  const [so] = await db.select().from(salesOrdersTable).where(eq(salesOrdersTable.id, Number(salesOrderId)));
  if (!so) { res.status(404).json({ error: "銷售訂單不存在" }); return; }

  const soItems = so.items as Array<{ itemId: number; quantity: number }>;
  if (!soItems || soItems.length === 0) { res.status(400).json({ error: "訂單無品項" }); return; }

  const created: { workOrderNumber: string; itemName: string; quantity: number }[] = [];
  const errors: { itemId: number; error: string }[] = [];

  for (const soItem of soItems) {
    const [bom] = await db.select().from(bomsTable)
      .where(and(eq(bomsTable.itemId, soItem.itemId), eq(bomsTable.status, "Active")))
      .orderBy(desc(bomsTable.version))
      .limit(1);

    if (!bom) {
      errors.push({ itemId: soItem.itemId, error: "無啟用的 BOM" });
      continue;
    }

    const bomItems = await db.select().from(bomItemsTable).where(eq(bomItemsTable.bomId, bom.id));
    const qty = soItem.quantity;
    const bomQty = Number(bom.quantity) || 1;
    const ratio = qty / bomQty;

    const exploded = await explodeBom(
      bomItems.map(bi => ({ itemId: bi.itemId, quantity: bi.quantity, unit: bi.unit })),
      ratio
    );

    // 建單時快照虛擬服務標記（成品與材料）
    const snapshotIds = [bom.itemId, ...exploded.map(m => m.itemId)];
    const virtualRows = await db.select({ id: itemsTable.id, isVirtual: itemsTable.isVirtual })
      .from(itemsTable).where(inArray(itemsTable.id, snapshotIds));
    const virtualMap = new Map(virtualRows.map(r => [r.id, r.isVirtual]));

    await db.transaction(async (tx) => {
      const [wo] = await tx.insert(workOrdersTable).values({
        workOrderNumber: generateWoNumber(),
        bomId: bom.id,
        itemId: bom.itemId,
        salesOrderId: so.id,
        plannedQuantity: String(qty),
        itemIsVirtual: virtualMap.get(bom.itemId) ?? false,
      }).returning();

      for (const mat of exploded) {
        await tx.insert(workOrderItemsTable).values({
          workOrderId: wo.id,
          itemId: mat.itemId,
          requiredQuantity: String(mat.quantity),
          unit: mat.unit,
          isVirtual: virtualMap.get(mat.itemId) ?? false,
        });
      }

      const [itemRow] = await tx.select({ itemName: itemsTable.itemName }).from(itemsTable).where(eq(itemsTable.id, bom.itemId));
      created.push({ workOrderNumber: wo.workOrderNumber, itemName: itemRow?.itemName || "", quantity: qty });
    });
  }

  res.json({ created, errors });
});

export default router;
