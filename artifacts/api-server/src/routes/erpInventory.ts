import { Router, type IRouter, type Request, type Response } from "express";
import { and, asc, count, desc, eq, gte, ilike, inArray, or, sql, type SQL } from "drizzle-orm";
import {
  db,
  productsTable,
  productVariantsTable,
  stockMovementsTable,
  suppliersTable,
  erpWarehousesTable,
  erpCustomersTable,
  priceListsTable,
  priceListItemsTable,
  membersTable,
  erpAuditLogsTable,
  warehouseStockTable,
  stockTransfersTable,
  stockTransferItemsTable,
  erpEmployeesTable,
  type Supplier,
  type ErpCustomer,
  type StockTransfer,
  type StockTransferItem,
} from "@workspace/db";
import {
  WarehouseStockError,
  resolveWarehouseId,
  adjustWarehouseStock,
  decreaseWarehouseStock,
  increaseWarehouseStock,
  syncMirrorStock,
} from "../lib/warehouseStock";
import {
  ErpAdjustStockBody,
  UpdateErpItemBody,
  CreateErpWarehouseBody,
  UpdateErpWarehouseBody,
  CreateErpCustomerBody,
  UpdateErpCustomerBody,
  CreateAdminSupplierBody,
  UpdateAdminSupplierBody,
  CreateErpPriceListBody,
  UpdateErpPriceListBody,
  PutErpPriceListItemsBody,
  CreateErpStockTransferBody,
  UpdateErpStockTransferStatusBody,
} from "@workspace/api-zod";
import { requireErpMenu } from "../middlewares/requireErp";
import { reindex } from "../lib/aiIndex";

const router: IRouter = Router();

class DocError extends Error {}

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

/* ---------- 品項 ---------- */

router.get("/erp/items", requireErpMenu("/inventory/items"), async (req, res) => {
  const search = typeof req.query.search === "string" ? req.query.search.trim() : "";
  const includeInactive = req.query.includeInactive === "true";
  const conds: SQL[] = [];
  if (search) {
    conds.push(
      or(
        ilike(productsTable.name, `%${search}%`),
        ilike(productsTable.code, `%${search}%`),
        ilike(productsTable.category, `%${search}%`),
      )!,
    );
  }
  if (!includeInactive) conds.push(eq(productsTable.isActive, true));
  const rows = await db
    .select()
    .from(productsTable)
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(asc(productsTable.code))
    .limit(500);
  const ids = rows.map((p) => p.id);
  const variants = ids.length
    ? await db
        .select()
        .from(productVariantsTable)
        .where(inArray(productVariantsTable.productId, ids))
    : [];
  res.json(
    rows.map((p) => ({
      id: p.id,
      code: p.code,
      name: p.name,
      category: p.category,
      spec: p.spec,
      unit: p.unit,
      barcode: p.barcode,
      stock: p.stock,
      safetyStock: p.safetyStock,
      costPrice: p.costPrice,
      priceHospital: p.priceHospital,
      priceClinic: p.priceClinic,
      priceConsumer: p.priceConsumer,
      isActive: p.isActive,
      isVirtual: p.isVirtual,
      createdAt: p.createdAt.toISOString(),
      variants: variants
        .filter((v) => v.productId === p.id)
        .map((v) => ({
          id: v.id,
          name: v.name,
          stock: v.stock,
          costPrice: v.costPrice,
          priceHospital: v.priceHospital,
          priceClinic: v.priceClinic,
          priceConsumer: v.priceConsumer,
          isActive: v.isActive,
        })),
    })),
  );
});

router.patch("/erp/items/:id", requireErpMenu("/inventory/items"), async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const parsed = UpdateErpItemBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "資料格式不正確" });
    return;
  }
  const [before] = await db
    .select()
    .from(productsTable)
    .where(eq(productsTable.id, id))
    .limit(1);
  if (!before) {
    res.status(404).json({ error: "找不到此品項" });
    return;
  }
  const changes: Record<string, unknown> = {};
  const d = parsed.data;
  if ("isVirtual" in d) changes.isVirtual = d.isVirtual;
  if ("unit" in d) changes.unit = d.unit ?? null;
  if ("barcode" in d) changes.barcode = d.barcode ?? null;
  if ("safetyStock" in d) changes.safetyStock = d.safetyStock;
  const [updated] = await db
    .update(productsTable)
    .set(changes)
    .where(eq(productsTable.id, id))
    .returning();
  await audit(req, {
    action: "update",
    module: "inventory",
    documentType: "item",
    documentId: String(id),
    description: `更新品項「${updated.name}」ERP 欄位`,
    oldValues: {
      isVirtual: before.isVirtual,
      unit: before.unit,
      barcode: before.barcode,
      safetyStock: before.safetyStock,
    },
    newValues: changes,
  });
  reindex("product", id);
  res.json({
    id: updated.id,
    isVirtual: updated.isVirtual,
    unit: updated.unit,
    barcode: updated.barcode,
    safetyStock: updated.safetyStock,
  });
});

/* ---------- 庫存調整（盤點／報廢等） ---------- */

/**
 * 庫存調整（入庫、出庫、盤點）。同時更新分倉數量、商品庫存與異動紀錄。
 * 商城後台的「調整庫存」（/admin/inventory/adjust）也用這一段。
 */
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

router.post("/erp/inventory/adjust", requireErpMenu("/inventory/items"), handleStockAdjust);

/* ---------- 庫存異動 ---------- */

router.get("/erp/stock-movements", requireErpMenu("/inventory/movements"), async (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const pageSize = 30;
  const conds: SQL[] = [];
  const type = typeof req.query.type === "string" ? req.query.type : "";
  if (["purchase", "sale", "adjust", "sale_return", "purchase_return", "transfer"].includes(type))
    conds.push(eq(stockMovementsTable.type, type));
  const productId = Number(req.query.productId);
  if (Number.isInteger(productId) && productId > 0)
    conds.push(eq(stockMovementsTable.productId, productId));
  const whId = Number(req.query.warehouseId);
  if (Number.isInteger(whId) && whId > 0)
    conds.push(eq(stockMovementsTable.warehouseId, whId));
  const where = conds.length ? and(...conds) : undefined;
  const [[total], rows] = await Promise.all([
    db.select({ n: count() }).from(stockMovementsTable).where(where),
    db
      .select({
        m: stockMovementsTable,
        productName: productsTable.name,
        productCode: productsTable.code,
      })
      .from(stockMovementsTable)
      .innerJoin(productsTable, eq(stockMovementsTable.productId, productsTable.id))
      .where(where)
      .orderBy(desc(stockMovementsTable.id))
      .limit(pageSize)
      .offset((page - 1) * pageSize),
  ]);
  res.json({
    items: rows.map((r) => ({
      id: r.m.id,
      productId: r.m.productId,
      productName: r.productName,
      productCode: r.productCode,
      variantId: r.m.variantId,
      type: r.m.type,
      quantity: r.m.quantity,
      stockAfter: r.m.stockAfter,
      warehouseId: r.m.warehouseId,
      reason: r.m.reason,
      refNo: r.m.refNo,
      createdAt: r.m.createdAt.toISOString(),
    })),
    total: total.n,
    page,
    pageSize,
  });
});

/* ---------- 倉庫 ---------- */

function serializeWarehouse(w: typeof erpWarehousesTable.$inferSelect) {
  return {
    id: w.id,
    code: w.code,
    name: w.name,
    address: w.address,
    note: w.note,
    isDefault: w.isDefault,
    isSellable: w.isSellable,
    isActive: w.isActive,
    createdAt: w.createdAt.toISOString(),
  };
}

router.get("/erp/warehouses", requireErpMenu("/inventory/warehouses"), async (_req, res) => {
  const rows = await db
    .select()
    .from(erpWarehousesTable)
    .orderBy(desc(erpWarehousesTable.isDefault), asc(erpWarehousesTable.id));
  res.json(rows.map(serializeWarehouse));
});

router.post("/erp/warehouses", requireErpMenu("/inventory/warehouses"), async (req, res) => {
  const parsed = CreateErpWarehouseBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "資料格式不正確（編號、名稱必填）" });
    return;
  }
  const [dup] = await db
    .select({ id: erpWarehousesTable.id })
    .from(erpWarehousesTable)
    .where(eq(erpWarehousesTable.code, parsed.data.code))
    .limit(1);
  if (dup) {
    res.status(400).json({ error: `倉庫編號 ${parsed.data.code} 已存在` });
    return;
  }
  const [created] = await db
    .insert(erpWarehousesTable)
    .values({
      code: parsed.data.code,
      name: parsed.data.name,
      address: parsed.data.address ?? null,
      note: parsed.data.note ?? null,
      isSellable: parsed.data.isSellable ?? true,
    })
    .returning();
  await audit(req, {
    action: "create",
    module: "inventory",
    documentType: "warehouse",
    documentId: String(created.id),
    description: `新增倉庫「${created.name}」`,
    newValues: parsed.data,
  });
  res.status(201).json(serializeWarehouse(created));
});

router.patch("/erp/warehouses/:id", requireErpMenu("/inventory/warehouses"), async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const parsed = UpdateErpWarehouseBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "資料格式不正確" });
    return;
  }
  const [before] = await db
    .select()
    .from(erpWarehousesTable)
    .where(eq(erpWarehousesTable.id, id))
    .limit(1);
  if (!before) {
    res.status(404).json({ error: "找不到此倉庫" });
    return;
  }
  if (before.isDefault && parsed.data.isActive === false) {
    res.status(400).json({ error: "預設倉不可停用" });
    return;
  }
  const [updated] = await db
    .update(erpWarehousesTable)
    .set({
      name: parsed.data.name ?? before.name,
      address: "address" in parsed.data ? parsed.data.address ?? null : before.address,
      note: "note" in parsed.data ? parsed.data.note ?? null : before.note,
      isSellable: parsed.data.isSellable ?? before.isSellable,
      isActive: parsed.data.isActive ?? before.isActive,
    })
    .where(eq(erpWarehousesTable.id, id))
    .returning();
  await audit(req, {
    action: "update",
    module: "inventory",
    documentType: "warehouse",
    documentId: String(id),
    description: `更新倉庫「${updated.name}」`,
    oldValues: before,
    newValues: parsed.data,
  });
  res.json(serializeWarehouse(updated));
});

/* ---------- 分倉庫存 ---------- */

router.get("/erp/warehouse-stock", requireErpMenu("/inventory/items"), async (req, res) => {
  const conds: SQL[] = [];
  const productId = Number(req.query.productId);
  if (Number.isInteger(productId) && productId > 0)
    conds.push(eq(warehouseStockTable.productId, productId));
  const whId = Number(req.query.warehouseId);
  if (Number.isInteger(whId) && whId > 0)
    conds.push(eq(warehouseStockTable.warehouseId, whId));
  const rows = await db
    .select({
      ws: warehouseStockTable,
      warehouseName: erpWarehousesTable.name,
      warehouseCode: erpWarehousesTable.code,
      productName: productsTable.name,
      productCode: productsTable.code,
      variantName: productVariantsTable.name,
    })
    .from(warehouseStockTable)
    .innerJoin(erpWarehousesTable, eq(warehouseStockTable.warehouseId, erpWarehousesTable.id))
    .innerJoin(productsTable, eq(warehouseStockTable.productId, productsTable.id))
    .leftJoin(productVariantsTable, eq(warehouseStockTable.variantId, productVariantsTable.id))
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(
      asc(warehouseStockTable.productId),
      asc(sql`COALESCE(${warehouseStockTable.variantId}, 0)`),
      desc(erpWarehousesTable.isDefault),
      asc(warehouseStockTable.warehouseId),
    )
    .limit(2000);
  res.json(
    rows.map((r) => ({
      id: r.ws.id,
      warehouseId: r.ws.warehouseId,
      warehouseCode: r.warehouseCode,
      warehouseName: r.warehouseName,
      productId: r.ws.productId,
      productCode: r.productCode,
      productName: r.productName,
      variantId: r.ws.variantId,
      variantName: r.variantName ?? null,
      quantity: r.ws.quantity,
    })),
  );
});

/* ---------- 庫存調撥 ---------- */

function serializeST(
  st: StockTransfer,
  items: StockTransferItem[],
  fromName: string,
  toName: string,
) {
  return {
    id: st.id,
    stNo: st.stNo,
    fromWarehouseId: st.fromWarehouseId,
    fromWarehouseName: fromName,
    toWarehouseId: st.toWarehouseId,
    toWarehouseName: toName,
    status: st.status,
    note: st.note,
    creatorEmployeeId: st.creatorEmployeeId,
    createdAt: st.createdAt.toISOString(),
    confirmedAt: st.confirmedAt ? st.confirmedAt.toISOString() : null,
    items: items.map((i) => ({
      id: i.id,
      productId: i.productId,
      variantId: i.variantId,
      variantName: i.variantName,
      productName: i.productName,
      productCode: i.productCode,
      quantity: i.quantity,
    })),
  };
}

async function loadST(id: number) {
  const [st] = await db
    .select()
    .from(stockTransfersTable)
    .where(eq(stockTransfersTable.id, id))
    .limit(1);
  if (!st) return null;
  const items = await db
    .select()
    .from(stockTransferItemsTable)
    .where(eq(stockTransferItemsTable.stockTransferId, id));
  const whs = await db
    .select({ id: erpWarehousesTable.id, name: erpWarehousesTable.name })
    .from(erpWarehousesTable)
    .where(inArray(erpWarehousesTable.id, [st.fromWarehouseId, st.toWarehouseId]));
  const nameById = new Map(whs.map((w) => [w.id, w.name]));
  return serializeST(
    st,
    items,
    nameById.get(st.fromWarehouseId) ?? "",
    nameById.get(st.toWarehouseId) ?? "",
  );
}

router.get("/erp/stock-transfers", requireErpMenu("/inventory/transfers"), async (req, res) => {
  const status = typeof req.query.status === "string" ? req.query.status : "";
  const conds: SQL[] = [];
  if (["draft", "confirmed", "cancelled"].includes(status))
    conds.push(eq(stockTransfersTable.status, status));
  const rows = await db
    .select()
    .from(stockTransfersTable)
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(stockTransfersTable.id))
    .limit(300);
  const ids = rows.map((r) => r.id);
  const items = ids.length
    ? await db
        .select()
        .from(stockTransferItemsTable)
        .where(inArray(stockTransferItemsTable.stockTransferId, ids))
    : [];
  const whs = await db
    .select({ id: erpWarehousesTable.id, name: erpWarehousesTable.name })
    .from(erpWarehousesTable);
  const nameById = new Map(whs.map((w) => [w.id, w.name]));
  res.json(
    rows.map((st) =>
      serializeST(
        st,
        items.filter((i) => i.stockTransferId === st.id),
        nameById.get(st.fromWarehouseId) ?? "",
        nameById.get(st.toWarehouseId) ?? "",
      ),
    ),
  );
});

/** 建立調撥單（草稿） */
router.post("/erp/stock-transfers", requireErpMenu("/inventory/transfers"), async (req, res) => {
  const parsed = CreateErpStockTransferBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "調撥單資料不完整" });
    return;
  }
  const input = parsed.data;
  if (input.creatorEmployeeId != null) {
    const [employee] = await db
      .select({ id: erpEmployeesTable.id })
      .from(erpEmployeesTable)
      .where(
        and(
          eq(erpEmployeesTable.id, input.creatorEmployeeId),
          eq(erpEmployeesTable.status, "active"),
        ),
      )
      .limit(1);
    if (!employee) {
      res.status(400).json({ error: "製單人不存在或已停用" });
      return;
    }
  }
  if (input.fromWarehouseId === input.toWarehouseId) {
    res.status(400).json({ error: "來源倉與目的倉不可相同" });
    return;
  }
  for (const line of input.items) {
    if (line.quantity <= 0) {
      res.status(400).json({ error: "調撥數量須大於 0" });
      return;
    }
  }
  // 同品項規格重複列 → 合併數量
  const qtyByKey = new Map<string, { productId: number; variantId: number | null; quantity: number }>();
  for (const line of input.items) {
    const k = `${line.productId}:${line.variantId ?? ""}`;
    const prev = qtyByKey.get(k);
    qtyByKey.set(k, {
      productId: line.productId,
      variantId: line.variantId ?? null,
      quantity: (prev?.quantity ?? 0) + line.quantity,
    });
  }
  if (qtyByKey.size === 0) {
    res.status(400).json({ error: "調撥單沒有品項" });
    return;
  }

  const stNo = `ST${Date.now()}`;
  let result;
  try {
    result = await db.transaction(async (tx) => {
      // 倉庫檢核（須存在且啟用）
      await resolveWarehouseId(tx, input.fromWarehouseId);
      await resolveWarehouseId(tx, input.toWarehouseId);

      const productIds = [...new Set([...qtyByKey.values()].map((l) => l.productId))];
      const prods = await tx
        .select()
        .from(productsTable)
        .where(inArray(productsTable.id, productIds));
      const prodById = new Map(prods.map((p) => [p.id, p]));
      const variantIds = [...qtyByKey.values()]
        .map((l) => l.variantId)
        .filter((v): v is number => v != null);
      const variants = variantIds.length
        ? await tx
            .select()
            .from(productVariantsTable)
            .where(inArray(productVariantsTable.id, variantIds))
        : [];
      const variantById = new Map(variants.map((v) => [v.id, v]));

      const lines: Omit<StockTransferItem, "id" | "stockTransferId">[] = [];
      for (const l of qtyByKey.values()) {
        const p = prodById.get(l.productId);
        if (!p) throw new DocError("包含不存在的品項");
        if (p.isVirtual) throw new DocError(`虛擬品項不可調撥：${p.name}`);
        let variantName: string | null = null;
        if (l.variantId != null) {
          const v = variantById.get(l.variantId);
          if (!v || v.productId !== l.productId)
            throw new DocError(`規格不存在：${p.name}`);
          variantName = v.name;
        } else {
          const [hasVariant] = await tx
            .select({ id: productVariantsTable.id })
            .from(productVariantsTable)
            .where(
              and(
                eq(productVariantsTable.productId, l.productId),
                eq(productVariantsTable.isActive, true),
              ),
            )
            .limit(1);
          if (hasVariant) throw new DocError(`「${p.name}」有多種規格，請指定規格`);
        }
        lines.push({
          productId: l.productId,
          variantId: l.variantId,
          variantName,
          productName: p.name,
          productCode: p.code,
          quantity: l.quantity,
        });
      }

      const [st] = await tx
        .insert(stockTransfersTable)
        .values({
          stNo,
          fromWarehouseId: input.fromWarehouseId,
          toWarehouseId: input.toWarehouseId,
          status: "draft",
          note: input.note ?? null,
          createdBy: req.member!.id,
          creatorEmployeeId: input.creatorEmployeeId ?? null,
        })
        .returning();
      const items = await tx
        .insert(stockTransferItemsTable)
        .values(lines.map((l) => ({ ...l, stockTransferId: st.id })))
        .returning();
      return { st, items };
    });
  } catch (err) {
    if (err instanceof DocError || err instanceof WarehouseStockError) {
      res.status(400).json({ error: err.message });
      return;
    }
    throw err;
  }
  await audit(req, {
    action: "create",
    module: "inventory",
    documentType: "stock_transfer",
    documentId: String(result.st.id),
    description: `建立調撥單 ${stNo}`,
  });
  res.status(201).json(await loadST(result.st.id));
});

/** 調撥單狀態：draft→confirmed（來源倉出庫、目的倉入庫，同交易列鎖）、draft→cancelled */
router.patch("/erp/stock-transfers/:id/status", requireErpMenu("/inventory/transfers"), async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const parsed = UpdateErpStockTransferStatusBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "狀態不正確" });
    return;
  }
  const target = parsed.data.status;

  let stNo = "";
  try {
    await db.transaction(async (tx) => {
      const [st] = await tx
        .select()
        .from(stockTransfersTable)
        .where(eq(stockTransfersTable.id, id))
        .for("update")
        .limit(1);
      if (!st) throw new DocError("找不到此調撥單");
      if (st.status !== "draft")
        throw new DocError(`無法從「${st.status}」變更為「${target}」`);
      stNo = st.stNo;

      if (target === "confirmed") {
        // 倉庫須仍啟用
        await resolveWarehouseId(tx, st.fromWarehouseId);
        await resolveWarehouseId(tx, st.toWarehouseId);
        const items = await tx
          .select()
          .from(stockTransferItemsTable)
          .where(eq(stockTransferItemsTable.stockTransferId, id));
        for (const item of items) {
          // 列鎖商品，序列化同品項併發異動
          const [p] = await tx
            .select()
            .from(productsTable)
            .where(eq(productsTable.id, item.productId))
            .for("update")
            .limit(1);
          if (!p) throw new DocError(`品項不存在：${item.productName}`);
          const label = item.variantName
            ? `${item.productName}（${item.variantName}）`
            : item.productName;
          await decreaseWarehouseStock(tx, {
            warehouseId: st.fromWarehouseId,
            productId: item.productId,
            variantId: item.variantId,
            quantity: item.quantity,
            label,
          });
          await increaseWarehouseStock(tx, {
            warehouseId: st.toWarehouseId,
            productId: item.productId,
            variantId: item.variantId,
            quantity: item.quantity,
          });
          // 調撥不影響總量；仍同步鏡像並以其總量記錄 movement。
          const stockAfter = await syncMirrorStock(tx, {
            productId: item.productId,
            variantId: item.variantId,
          });
          await tx.insert(stockMovementsTable).values([
            {
              productId: item.productId,
              variantId: item.variantId,
              type: "transfer",
              quantity: -item.quantity,
              stockAfter,
              warehouseId: st.fromWarehouseId,
              reason: item.variantName ? `調撥出庫（${item.variantName}）` : "調撥出庫",
              refNo: st.stNo,
            },
            {
              productId: item.productId,
              variantId: item.variantId,
              type: "transfer",
              quantity: item.quantity,
              stockAfter,
              warehouseId: st.toWarehouseId,
              reason: item.variantName ? `調撥入庫（${item.variantName}）` : "調撥入庫",
              refNo: st.stNo,
            },
          ]);
        }
      }

      await tx
        .update(stockTransfersTable)
        .set(
          target === "confirmed"
            ? { status: "confirmed", confirmedAt: new Date() }
            : { status: "cancelled" },
        )
        .where(eq(stockTransfersTable.id, id));
    });
  } catch (err) {
    if (err instanceof DocError || err instanceof WarehouseStockError) {
      res.status(400).json({ error: err.message });
      return;
    }
    throw err;
  }
  await audit(req, {
    action: target,
    module: "inventory",
    documentType: "stock_transfer",
    documentId: String(id),
    description: `調撥單 ${stNo} → ${target}`,
  });
  res.json(await loadST(id));
});

/* ---------- 客戶 ---------- */

function serializeCustomer(c: ErpCustomer, memberUsername?: string | null) {
  return {
    id: c.id,
    code: c.code,
    name: c.name,
    memberId: c.memberId,
    memberUsername: memberUsername ?? null,
    institutionId: c.institutionId,
    contactPerson: c.contactPerson,
    phone: c.phone,
    email: c.email,
    address: c.address,
    taxId: c.taxId,
    paymentTerms: c.paymentTerms,
    priceListId: c.priceListId,
    note: c.note,
    isActive: c.isActive,
    createdAt: c.createdAt.toISOString(),
  };
}

router.get("/erp/customers", requireErpMenu("/partners/customers"), async (req, res) => {
  const search = typeof req.query.search === "string" ? req.query.search.trim() : "";
  const conds: SQL[] = [];
  if (search) {
    conds.push(
      or(
        ilike(erpCustomersTable.name, `%${search}%`),
        ilike(erpCustomersTable.code, `%${search}%`),
        ilike(erpCustomersTable.phone, `%${search}%`),
      )!,
    );
  }
  const rows = await db
    .select({ c: erpCustomersTable, memberUsername: membersTable.username })
    .from(erpCustomersTable)
    .leftJoin(membersTable, eq(erpCustomersTable.memberId, membersTable.id))
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(erpCustomersTable.isActive), asc(erpCustomersTable.id))
    .limit(500);
  res.json(rows.map((r) => serializeCustomer(r.c, r.memberUsername)));
});

router.post("/erp/customers", requireErpMenu("/partners/customers"), async (req, res) => {
  const parsed = CreateErpCustomerBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "資料格式不正確（編號、名稱必填）" });
    return;
  }
  const d = parsed.data;
  const [dup] = await db
    .select({ id: erpCustomersTable.id })
    .from(erpCustomersTable)
    .where(eq(erpCustomersTable.code, d.code))
    .limit(1);
  if (dup) {
    res.status(400).json({ error: `客戶編號 ${d.code} 已存在` });
    return;
  }
  const [created] = await db
    .insert(erpCustomersTable)
    .values({
      code: d.code,
      name: d.name,
      contactPerson: d.contactPerson ?? null,
      phone: d.phone ?? null,
      email: d.email ?? null,
      address: d.address ?? null,
      taxId: d.taxId ?? null,
      paymentTerms: d.paymentTerms ?? null,
      priceListId: d.priceListId ?? null,
      note: d.note ?? null,
    })
    .returning();
  await audit(req, {
    action: "create",
    module: "partners",
    documentType: "customer",
    documentId: String(created.id),
    description: `新增客戶「${created.name}」`,
    newValues: d,
  });
  res.status(201).json(serializeCustomer(created));
});

router.patch("/erp/customers/:id", requireErpMenu("/partners/customers"), async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const parsed = UpdateErpCustomerBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "資料格式不正確" });
    return;
  }
  const [before] = await db
    .select()
    .from(erpCustomersTable)
    .where(eq(erpCustomersTable.id, id))
    .limit(1);
  if (!before) {
    res.status(404).json({ error: "找不到此客戶" });
    return;
  }
  const d = parsed.data;
  const changes: Record<string, unknown> = {};
  if (d.name !== undefined) changes.name = d.name;
  if ("contactPerson" in d) changes.contactPerson = d.contactPerson ?? null;
  if ("phone" in d) changes.phone = d.phone ?? null;
  if ("email" in d) changes.email = d.email ?? null;
  if ("address" in d) changes.address = d.address ?? null;
  if ("taxId" in d) changes.taxId = d.taxId ?? null;
  if ("paymentTerms" in d) changes.paymentTerms = d.paymentTerms ?? null;
  if ("priceListId" in d) changes.priceListId = d.priceListId ?? null;
  if ("note" in d) changes.note = d.note ?? null;
  if (d.isActive !== undefined) changes.isActive = d.isActive;
  const [updated] = await db
    .update(erpCustomersTable)
    .set(changes)
    .where(eq(erpCustomersTable.id, id))
    .returning();
  await audit(req, {
    action: "update",
    module: "partners",
    documentType: "customer",
    documentId: String(id),
    description: `更新客戶「${updated.name}」`,
    oldValues: before,
    newValues: d,
  });
  res.json(serializeCustomer(updated));
});

/* ---------- 供應商（ERP 端） ---------- */

function serializeSupplier(s: Supplier) {
  return {
    id: s.id,
    name: s.name,
    contactPerson: s.contactPerson,
    phone: s.phone,
    email: s.email,
    address: s.address,
    paymentTerms: s.paymentTerms,
    note: s.note,
    isActive: s.isActive,
    createdAt: s.createdAt.toISOString(),
  };
}

router.get("/erp/suppliers", requireErpMenu("/partners/suppliers"), async (req, res) => {
  const search = typeof req.query.search === "string" ? req.query.search.trim() : "";
  const conds: SQL[] = [];
  if (search) {
    conds.push(
      or(
        ilike(suppliersTable.name, `%${search}%`),
        ilike(suppliersTable.contactPerson, `%${search}%`),
        ilike(suppliersTable.phone, `%${search}%`),
      )!,
    );
  }
  const rows = await db
    .select()
    .from(suppliersTable)
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(suppliersTable.isActive), desc(suppliersTable.createdAt));
  res.json(rows.map(serializeSupplier));
});

router.post("/erp/suppliers", requireErpMenu("/partners/suppliers"), async (req, res) => {
  const parsed = CreateAdminSupplierBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "供應商資料不完整" });
    return;
  }
  const d = parsed.data;
  const [created] = await db
    .insert(suppliersTable)
    .values({
      name: d.name,
      contactPerson: d.contactPerson ?? null,
      phone: d.phone ?? null,
      email: d.email ?? null,
      address: d.address ?? null,
      paymentTerms: d.paymentTerms ?? null,
      note: d.note ?? null,
    })
    .returning();
  await audit(req, {
    action: "create",
    module: "partners",
    documentType: "supplier",
    documentId: String(created.id),
    description: `新增供應商「${created.name}」`,
    newValues: d,
  });
  res.status(201).json(serializeSupplier(created));
});

router.patch("/erp/suppliers/:id", requireErpMenu("/partners/suppliers"), async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const parsed = UpdateAdminSupplierBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "資料格式不正確" });
    return;
  }
  const [updated] = await db
    .update(suppliersTable)
    .set(parsed.data)
    .where(eq(suppliersTable.id, id))
    .returning();
  if (!updated) {
    res.status(404).json({ error: "找不到此供應商" });
    return;
  }
  await audit(req, {
    action: "update",
    module: "partners",
    documentType: "supplier",
    documentId: String(id),
    description: `更新供應商「${updated.name}」`,
    newValues: parsed.data,
  });
  res.json(serializeSupplier(updated));
});

/* ---------- 價格表 ---------- */

router.get("/erp/price-lists", requireErpMenu("/sales/price-lists"), async (_req, res) => {
  const rows = await db
    .select()
    .from(priceListsTable)
    .orderBy(desc(priceListsTable.isActive), asc(priceListsTable.id));
  const ids = rows.map((r) => r.id);
  const items = ids.length
    ? await db
        .select()
        .from(priceListItemsTable)
        .where(inArray(priceListItemsTable.priceListId, ids))
    : [];
  res.json(
    rows.map((pl) => ({
      id: pl.id,
      name: pl.name,
      description: pl.description,
      isActive: pl.isActive,
      createdAt: pl.createdAt.toISOString(),
      items: items
        .filter((i) => i.priceListId === pl.id)
        .map((i) => ({
          id: i.id,
          productId: i.productId,
          variantId: i.variantId,
          price: i.price,
        })),
    })),
  );
});

router.post("/erp/price-lists", requireErpMenu("/sales/price-lists"), async (req, res) => {
  const parsed = CreateErpPriceListBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "資料格式不正確（名稱必填）" });
    return;
  }
  const [created] = await db
    .insert(priceListsTable)
    .values({
      name: parsed.data.name,
      description: parsed.data.description ?? null,
    })
    .returning();
  await audit(req, {
    action: "create",
    module: "sales",
    documentType: "price_list",
    documentId: String(created.id),
    description: `新增價格表「${created.name}」`,
  });
  res.status(201).json({
    id: created.id,
    name: created.name,
    description: created.description,
    isActive: created.isActive,
    createdAt: created.createdAt.toISOString(),
    items: [],
  });
});

router.patch("/erp/price-lists/:id", requireErpMenu("/sales/price-lists"), async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const parsed = UpdateErpPriceListBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "資料格式不正確" });
    return;
  }
  const [before] = await db
    .select()
    .from(priceListsTable)
    .where(eq(priceListsTable.id, id))
    .limit(1);
  if (!before) {
    res.status(404).json({ error: "找不到此價格表" });
    return;
  }
  const [updated] = await db
    .update(priceListsTable)
    .set({
      name: parsed.data.name ?? before.name,
      description:
        "description" in parsed.data
          ? parsed.data.description ?? null
          : before.description,
      isActive: parsed.data.isActive ?? before.isActive,
    })
    .where(eq(priceListsTable.id, id))
    .returning();
  await audit(req, {
    action: "update",
    module: "sales",
    documentType: "price_list",
    documentId: String(id),
    description: `更新價格表「${updated.name}」`,
  });
  const items = await db
    .select()
    .from(priceListItemsTable)
    .where(eq(priceListItemsTable.priceListId, id));
  res.json({
    id: updated.id,
    name: updated.name,
    description: updated.description,
    isActive: updated.isActive,
    createdAt: updated.createdAt.toISOString(),
    items: items.map((i) => ({
      id: i.id,
      productId: i.productId,
      variantId: i.variantId,
      price: i.price,
    })),
  });
});

router.put("/erp/price-lists/:id/items", requireErpMenu("/sales/price-lists"), async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const parsed = PutErpPriceListItemsBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "資料格式不正確" });
    return;
  }
  const [pl] = await db
    .select()
    .from(priceListsTable)
    .where(eq(priceListsTable.id, id))
    .limit(1);
  if (!pl) {
    res.status(404).json({ error: "找不到此價格表" });
    return;
  }
  // 驗證品項存在
  const productIds = [...new Set(parsed.data.items.map((i) => i.productId))];
  const products = productIds.length
    ? await db
        .select({ id: productsTable.id })
        .from(productsTable)
        .where(inArray(productsTable.id, productIds))
    : [];
  if (products.length !== productIds.length) {
    res.status(400).json({ error: "包含不存在的品項" });
    return;
  }
  // 同一價格表內品項+規格不可重複
  const keys = new Set<string>();
  for (const i of parsed.data.items) {
    const k = `${i.productId}:${i.variantId ?? ""}`;
    if (keys.has(k)) {
      res.status(400).json({ error: "同一品項規格重複設價" });
      return;
    }
    keys.add(k);
  }
  const items = await db.transaction(async (tx) => {
    await tx.delete(priceListItemsTable).where(eq(priceListItemsTable.priceListId, id));
    if (parsed.data.items.length === 0) return [];
    return tx
      .insert(priceListItemsTable)
      .values(
        parsed.data.items.map((i) => ({
          priceListId: id,
          productId: i.productId,
          variantId: i.variantId ?? null,
          price: i.price,
        })),
      )
      .returning();
  });
  await audit(req, {
    action: "update",
    module: "sales",
    documentType: "price_list",
    documentId: String(id),
    description: `更新價格表「${pl.name}」品項（${items.length} 筆）`,
  });
  res.json({
    id: pl.id,
    name: pl.name,
    description: pl.description,
    isActive: pl.isActive,
    createdAt: pl.createdAt.toISOString(),
    items: items.map((i) => ({
      id: i.id,
      productId: i.productId,
      variantId: i.variantId,
      price: i.price,
    })),
  });
});

export default router;
