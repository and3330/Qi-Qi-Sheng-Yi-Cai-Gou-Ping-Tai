import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import {
  db,
  productsTable,
  productVariantsTable,
  erpWarehousesTable,
  warehouseStockTable,
} from "@workspace/db";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type DbOrTx = Tx | typeof db;

export class WarehouseStockError extends Error {}

/** 每個 process 只需做一次的分倉數量校正（把「總量-各倉合計」差額補進預設倉；已同步時為 no-op）。 */
let reconciled = false;
async function reconcileWarehouseStock(tx: DbOrTx, defaultWarehouseId: number): Promise<void> {
  if (reconciled) return;
  reconciled = true;
  await tx.execute(sql`
    INSERT INTO warehouse_stock (warehouse_id, product_id, variant_id, quantity)
    SELECT ${defaultWarehouseId}, p.id, NULL,
           p.stock - COALESCE((SELECT SUM(ws.quantity) FROM warehouse_stock ws
                                WHERE ws.product_id = p.id AND ws.variant_id IS NULL), 0)
      FROM products p
     WHERE p.is_virtual = false
       AND p.stock > COALESCE((SELECT SUM(ws.quantity) FROM warehouse_stock ws
                                WHERE ws.product_id = p.id AND ws.variant_id IS NULL), 0)
    ON CONFLICT (warehouse_id, product_id, COALESCE(variant_id, 0))
    DO UPDATE SET quantity = warehouse_stock.quantity + EXCLUDED.quantity
  `);
  await tx.execute(sql`
    INSERT INTO warehouse_stock (warehouse_id, product_id, variant_id, quantity)
    SELECT ${defaultWarehouseId}, v.product_id, v.id,
           v.stock - COALESCE((SELECT SUM(ws.quantity) FROM warehouse_stock ws
                                WHERE ws.variant_id = v.id), 0)
      FROM product_variants v
      JOIN products p ON p.id = v.product_id
     WHERE p.is_virtual = false
       AND v.stock > COALESCE((SELECT SUM(ws.quantity) FROM warehouse_stock ws
                                WHERE ws.variant_id = v.id), 0)
    ON CONFLICT (warehouse_id, product_id, COALESCE(variant_id, 0))
    DO UPDATE SET quantity = warehouse_stock.quantity + EXCLUDED.quantity
  `);
}

/**
 * 取得預設倉 id；若尚未有預設倉（含全新環境）則自動建立並將現有總量回填至預設倉。
 */
export async function getDefaultWarehouseId(tx: DbOrTx): Promise<number> {
  const [w] = await tx
    .select({ id: erpWarehousesTable.id })
    .from(erpWarehousesTable)
    .where(eq(erpWarehousesTable.isDefault, true))
    .orderBy(asc(erpWarehousesTable.id))
    .limit(1);
  if (w) {
    // 即使預設倉已存在（舊環境由既有遷移建立），仍需確保分倉數量已從總量回填
    await reconcileWarehouseStock(tx, w.id);
    return w.id;
  }
  // 自動建立預設倉並回填（僅發生於全新環境）
  const [created] = await tx
    .insert(erpWarehousesTable)
    .values({ code: "WH01", name: "主倉庫", isDefault: true })
    .onConflictDoNothing({ target: erpWarehousesTable.code })
    .returning({ id: erpWarehousesTable.id });
  const defId =
    created?.id ??
    (
      await tx
        .select({ id: erpWarehousesTable.id })
        .from(erpWarehousesTable)
        .orderBy(desc(erpWarehousesTable.isDefault), asc(erpWarehousesTable.id))
        .limit(1)
    )[0]?.id;
  if (!defId) throw new WarehouseStockError("找不到預設倉庫");
  await tx.execute(sql`
    INSERT INTO warehouse_stock (warehouse_id, product_id, variant_id, quantity)
    SELECT ${defId}, p.id, NULL, p.stock
    FROM products p
    WHERE p.is_virtual = false
      AND NOT EXISTS (SELECT 1 FROM product_variants v WHERE v.product_id = p.id AND v.is_active = true)
      AND NOT EXISTS (SELECT 1 FROM warehouse_stock ws WHERE ws.product_id = p.id AND ws.variant_id IS NULL)
  `);
  await tx.execute(sql`
    INSERT INTO warehouse_stock (warehouse_id, product_id, variant_id, quantity)
    SELECT ${defId}, v.product_id, v.id, v.stock
    FROM product_variants v JOIN products p ON p.id = v.product_id
    WHERE p.is_virtual = false
      AND NOT EXISTS (SELECT 1 FROM warehouse_stock ws WHERE ws.product_id = v.product_id AND ws.variant_id = v.id)
  `);
  reconciled = true;
  return defId;
}

/** 確保預設倉存在且分倉數量已回填（供商城讀取/分配路徑使用；每 process 只做一次實際工作）。 */
let readyPromise: Promise<void> | null = null;
function ensureWarehouseStockReady(): Promise<void> {
  if (!readyPromise) {
    readyPromise = getDefaultWarehouseId(db).then(
      () => undefined,
      (err) => {
        readyPromise = null; // 失敗時允許下次重試
        throw err;
      },
    );
  }
  return readyPromise;
}

/** 驗證倉庫存在且啟用，回傳倉庫 id；warehouseId 為 null 時回傳預設倉。 */
export async function resolveWarehouseId(
  tx: DbOrTx,
  warehouseId: number | null | undefined,
): Promise<number> {
  if (warehouseId == null) return getDefaultWarehouseId(tx);
  const [w] = await tx
    .select({ id: erpWarehousesTable.id, isActive: erpWarehousesTable.isActive })
    .from(erpWarehousesTable)
    .where(eq(erpWarehousesTable.id, warehouseId))
    .limit(1);
  if (!w) throw new WarehouseStockError("指定的倉庫不存在");
  if (!w.isActive) throw new WarehouseStockError("指定的倉庫已停用");
  return w.id;
}

/**
 * 分倉庫存增加（upsert）。回傳該倉異動後數量。
 */
export async function increaseWarehouseStock(
  tx: DbOrTx,
  args: { warehouseId: number; productId: number; variantId: number | null; quantity: number },
): Promise<number> {
  if (args.quantity <= 0) throw new WarehouseStockError("入庫數量須大於 0");
  const result = await tx.execute(sql`
    INSERT INTO warehouse_stock (warehouse_id, product_id, variant_id, quantity)
    VALUES (${args.warehouseId}, ${args.productId}, ${args.variantId}, ${args.quantity})
    ON CONFLICT (warehouse_id, product_id, COALESCE(variant_id, 0))
    DO UPDATE SET quantity = warehouse_stock.quantity + EXCLUDED.quantity
    RETURNING quantity
  `);
  const rows = result.rows as Array<{ quantity: number }>;
  return Number(rows[0]?.quantity ?? args.quantity);
}

/**
 * 分倉庫存扣減（該倉數量不足時擲出 WarehouseStockError）。回傳該倉異動後數量。
 */
export async function decreaseWarehouseStock(
  tx: DbOrTx,
  args: {
    warehouseId: number;
    productId: number;
    variantId: number | null;
    quantity: number;
    /** 錯誤訊息中顯示的品名 */
    label?: string;
  },
): Promise<number> {
  if (args.quantity <= 0) throw new WarehouseStockError("出庫數量須大於 0");
  const result = await tx.execute(sql`
    UPDATE warehouse_stock
    SET quantity = quantity - ${args.quantity}
    WHERE warehouse_id = ${args.warehouseId}
      AND product_id = ${args.productId}
      AND variant_id IS NOT DISTINCT FROM ${args.variantId}
      AND quantity >= ${args.quantity}
    RETURNING quantity
  `);
  const rows = result.rows as Array<{ quantity: number }>;
  if (rows.length === 0) {
    const [w] = await tx
      .select({ name: erpWarehousesTable.name })
      .from(erpWarehousesTable)
      .where(eq(erpWarehousesTable.id, args.warehouseId))
      .limit(1);
    throw new WarehouseStockError(
      `倉庫「${w?.name ?? args.warehouseId}」庫存不足${args.label ? `：${args.label}` : ""}`,
    );
  }
  return Number(rows[0].quantity);
}

/** 帶正負號的分倉調整：正數入庫、負數出庫（出庫不足擲錯）。 */
export async function adjustWarehouseStock(
  tx: DbOrTx,
  args: { warehouseId: number; productId: number; variantId: number | null; quantity: number; label?: string },
): Promise<number> {
  if (args.quantity > 0) return increaseWarehouseStock(tx, args);
  return decreaseWarehouseStock(tx, { ...args, quantity: -args.quantity });
}

/**
 * 商城扣庫存：依可售倉（is_sellable 且 is_active，預設倉優先）逐倉分配扣減。
 * 可售倉合計不足時擲出 WarehouseStockError。
 * 回傳分配結果（每倉扣多少）。呼叫端仍須自行維護總量欄位。
 */
export async function allocateSellableStock(
  tx: Tx,
  args: { productId: number; variantId: number | null; quantity: number; label?: string },
): Promise<Array<{ warehouseId: number; quantity: number }>> {
  await ensureWarehouseStockReady();
  const result = await tx.execute(sql`
    SELECT ws.id, ws.warehouse_id, ws.quantity
    FROM warehouse_stock ws
    JOIN erp_warehouses w ON w.id = ws.warehouse_id
    WHERE ws.product_id = ${args.productId}
      AND ws.variant_id IS NOT DISTINCT FROM ${args.variantId}
      AND ws.quantity > 0
      AND w.is_sellable = true
      AND w.is_active = true
    ORDER BY w.is_default DESC, w.id ASC
    FOR UPDATE OF ws
  `);
  const rows = result.rows as Array<{ id: number; warehouse_id: number; quantity: number }>;
  const available = rows.reduce((s, r) => s + Number(r.quantity), 0);
  if (available < args.quantity) {
    throw new WarehouseStockError(`庫存不足${args.label ? `：${args.label}` : ""}`);
  }
  const allocations: Array<{ warehouseId: number; quantity: number }> = [];
  let remaining = args.quantity;
  for (const r of rows) {
    if (remaining <= 0) break;
    const take = Math.min(Number(r.quantity), remaining);
    await tx.execute(
      sql`UPDATE warehouse_stock SET quantity = quantity - ${take} WHERE id = ${r.id}`,
    );
    allocations.push({ warehouseId: Number(r.warehouse_id), quantity: take });
    remaining -= take;
  }
  return allocations;
}

/**
 * 商城可售量：可售倉（is_sellable 且 is_active）合計。
 * 回傳 Map：key 為 `${productId}:${variantId ?? ""}`。
 */
export async function getSellableStockMap(
  productIds: number[],
): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  if (productIds.length === 0) return map;
  await ensureWarehouseStockReady();
  const rows = await db
    .select({
      productId: warehouseStockTable.productId,
      variantId: warehouseStockTable.variantId,
      total: sql<number>`COALESCE(SUM(${warehouseStockTable.quantity}), 0)`,
    })
    .from(warehouseStockTable)
    .innerJoin(erpWarehousesTable, eq(warehouseStockTable.warehouseId, erpWarehousesTable.id))
    .where(
      and(
        inArray(warehouseStockTable.productId, productIds),
        eq(erpWarehousesTable.isSellable, true),
        eq(erpWarehousesTable.isActive, true),
      ),
    )
    .groupBy(warehouseStockTable.productId, warehouseStockTable.variantId);
  for (const r of rows) {
    map.set(`${r.productId}:${r.variantId ?? ""}`, Number(r.total));
  }
  return map;
}

/**
 * 將商品/規格的舊制總量欄位（products.stock / product_variants.stock）同步為「各倉庫存總和」。
 * 這個欄位現在只是分倉庫存（唯一真實數字）的唯讀鏡像，僅供列表顯示/搜尋等既有讀取路徑使用，
 * 所有「是否有庫存可扣」的判斷一律以 warehouse_stock（透過 allocateSellableStock / adjustWarehouseStock 等）為準。
 * 回傳同步後的總量。
 */
export async function syncMirrorStock(
  tx: DbOrTx,
  args: { productId: number; variantId: number | null },
): Promise<number> {
  const result = await tx.execute(sql`
    SELECT COALESCE(SUM(quantity), 0) AS total
    FROM warehouse_stock
    WHERE product_id = ${args.productId}
      AND variant_id IS NOT DISTINCT FROM ${args.variantId}
  `);
  const rows = result.rows as Array<{ total: number | string }>;
  const total = Number(rows[0]?.total ?? 0);
  if (args.variantId == null) {
    await tx.update(productsTable).set({ stock: total }).where(eq(productsTable.id, args.productId));
  } else {
    await tx
      .update(productVariantsTable)
      .set({ stock: total })
      .where(eq(productVariantsTable.id, args.variantId));
  }
  return total;
}

/** 商城可售量（單一品項/規格）。無分倉紀錄時回傳 0。 */
export async function getSellableStock(
  productId: number,
  variantId: number | null,
): Promise<number> {
  await ensureWarehouseStockReady();
  const rows = await db
    .select({ total: sql<number>`COALESCE(SUM(${warehouseStockTable.quantity}), 0)` })
    .from(warehouseStockTable)
    .innerJoin(erpWarehousesTable, eq(warehouseStockTable.warehouseId, erpWarehousesTable.id))
    .where(
      and(
        eq(warehouseStockTable.productId, productId),
        variantId == null
          ? isNull(warehouseStockTable.variantId)
          : eq(warehouseStockTable.variantId, variantId),
        eq(erpWarehousesTable.isSellable, true),
        eq(erpWarehousesTable.isActive, true),
      ),
    );
  return Number(rows[0]?.total ?? 0);
}
