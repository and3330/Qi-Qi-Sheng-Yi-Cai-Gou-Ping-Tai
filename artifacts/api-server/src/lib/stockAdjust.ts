import { type Request, type Response } from "express";
import { and, eq } from "drizzle-orm";
import { db, productsTable, productVariantsTable, stockMovementsTable, erpAuditLogsTable } from "@workspace/db";
import { WarehouseStockError, resolveWarehouseId, adjustWarehouseStock, syncMirrorStock } from "./warehouseStock";
import { ErpAdjustStockBody } from "@workspace/api-zod";
import { reindex } from "./aiIndex";

/**
 * 商城後台的「調整庫存」（入庫、出庫、盤點）。同時更新分倉數量、商品庫存與異動紀錄。
 * 原本寫在舊 ERP 的庫存路由裡；舊 ERP 移除後獨立成這個檔。
 */
async function audit(
  req: { member?: { id: number; name: string; username: string } },
  entry: {
    action: string;
    module: string;
    documentType?: string;
    documentId?: string;
    description?: string;
    oldValues?: unknown;
    newValues?: unknown;
  },
) {
  try {
    const m = req.member!;
    await db.insert(erpAuditLogsTable).values({
      action: entry.action,
      module: entry.module,
      documentType: entry.documentType ?? null,
      documentId: entry.documentId ?? null,
      userId: m.id,
      userName: m.name || m.username,
      description: entry.description ?? null,
      oldValues: entry.oldValues ?? null,
      newValues: entry.newValues ?? null,
    });
  } catch {
    /* audit 失敗不阻斷主流程 */
  }
}

export async function handleStockAdjust(req: Request, res: Response): Promise<void> {
  const parsed = ErpAdjustStockBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "資料格式不正確" });
    return;
  }
  const { productId, quantity, reason, note } = parsed.data;
  const variantId = parsed.data.variantId ?? null;
  if (quantity === 0) {
    res.status(400).json({ error: "調整數量不可為 0" });
    return;
  }

  try {
    const result = await db.transaction(async (tx) => {
      // 列鎖商品，並擋虛擬品項
      const [product] = await tx
        .select()
        .from(productsTable)
        .where(eq(productsTable.id, productId))
        .for("update")
        .limit(1);
      if (!product) throw new Error("ADJUST_FAILED");
      if (product.isVirtual) throw new Error("VIRTUAL_ITEM");

      const warehouseId = await resolveWarehouseId(tx, parsed.data.warehouseId ?? null);
      let stockAfter: number;
      let variantName: string | null = null;
      if (variantId != null) {
        const [variant] = await tx
          .select({ name: productVariantsTable.name })
          .from(productVariantsTable)
          .where(
            and(
              eq(productVariantsTable.id, variantId),
              eq(productVariantsTable.productId, productId),
            ),
          )
          .limit(1);
        if (!variant) throw new Error("ADJUST_FAILED");
        variantName = variant.name;
      } else {
        // 有啟用規格的商品，無規格的異動一律拒絕
        const [hasVariant] = await tx
          .select({ id: productVariantsTable.id })
          .from(productVariantsTable)
          .where(
            and(
              eq(productVariantsTable.productId, productId),
              eq(productVariantsTable.isActive, true),
            ),
          )
          .limit(1);
        if (hasVariant) throw new Error("VARIANT_REQUIRED");
      }
      // 分倉庫存同步調整（出庫時該倉不足會擲錯回滾）
      await adjustWarehouseStock(tx, {
        warehouseId,
        productId,
        variantId,
        quantity,
        label: variantName ? `${product.name}（${variantName}）` : product.name,
      });
      stockAfter = await syncMirrorStock(tx, { productId, variantId });
      const baseReason = note ? `${reason}：${note}` : reason;
      const [movement] = await tx
        .insert(stockMovementsTable)
        .values({
          productId,
          variantId,
          type: "adjust",
          quantity,
          stockAfter,
          warehouseId,
          reason: variantName ? `${baseReason}（${variantName}）` : baseReason,
        })
        .returning();
      return { movement, product };
    });
    await audit(req, {
      action: "adjust",
      module: "inventory",
      documentType: "stock_movement",
      documentId: String(result.movement.id),
      description: `庫存調整 ${result.product.name} ${quantity > 0 ? "+" : ""}${quantity}（${reason}）`,
    });
    reindex("product", productId);
    res.status(201).json({
      id: result.movement.id,
      productId,
      variantId,
      quantity,
      stockAfter: result.movement.stockAfter,
      reason: result.movement.reason,
      createdAt: result.movement.createdAt.toISOString(),
    });
  } catch (err) {
    if (err instanceof Error && err.message === "ADJUST_FAILED") {
      res.status(400).json({ error: "品項不存在或庫存不足以扣減" });
      return;
    }
    if (err instanceof Error && err.message === "VARIANT_REQUIRED") {
      res.status(400).json({ error: "此品項有多種規格，請指定要調整的規格" });
      return;
    }
    if (err instanceof Error && err.message === "VIRTUAL_ITEM") {
      res.status(400).json({ error: "虛擬品項不可調整庫存" });
      return;
    }
    if (err instanceof WarehouseStockError) {
      res.status(400).json({ error: err.message });
      return;
    }
    throw err;
  }
}
