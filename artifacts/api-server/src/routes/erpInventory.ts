import { Router, type IRouter } from "express";
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
  type Supplier,
  type ErpCustomer,
} from "@workspace/db";
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
} from "@workspace/api-zod";
import { requireErpMenu } from "../middlewares/requireErp";
import { reindex } from "../lib/aiIndex";

const router: IRouter = Router();

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

router.post("/erp/inventory/adjust", requireErpMenu("/inventory/items"), async (req, res) => {
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

      let stockAfter: number;
      let variantName: string | null = null;
      if (variantId != null) {
        const [updatedVariant] = await tx
          .update(productVariantsTable)
          .set({ stock: sql`${productVariantsTable.stock} + ${quantity}` })
          .where(
            and(
              eq(productVariantsTable.id, variantId),
              eq(productVariantsTable.productId, productId),
              gte(productVariantsTable.stock, Math.max(0, -quantity)),
            ),
          )
          .returning();
        if (!updatedVariant) throw new Error("ADJUST_FAILED");
        stockAfter = updatedVariant.stock;
        variantName = updatedVariant.name;
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
        const [updatedProduct] = await tx
          .update(productsTable)
          .set({ stock: sql`${productsTable.stock} + ${quantity}` })
          .where(
            and(
              eq(productsTable.id, productId),
              gte(productsTable.stock, Math.max(0, -quantity)),
            ),
          )
          .returning();
        if (!updatedProduct) throw new Error("ADJUST_FAILED");
        stockAfter = updatedProduct.stock;
      }
      const baseReason = note ? `${reason}：${note}` : reason;
      const [movement] = await tx
        .insert(stockMovementsTable)
        .values({
          productId,
          variantId,
          type: "adjust",
          quantity,
          stockAfter,
          warehouseId: parsed.data.warehouseId ?? null,
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
    throw err;
  }
});

/* ---------- 庫存異動 ---------- */

router.get("/erp/stock-movements", requireErpMenu("/inventory/movements"), async (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const pageSize = 30;
  const conds: SQL[] = [];
  const type = typeof req.query.type === "string" ? req.query.type : "";
  if (["purchase", "sale", "adjust", "sale_return", "purchase_return"].includes(type))
    conds.push(eq(stockMovementsTable.type, type));
  const productId = Number(req.query.productId);
  if (Number.isInteger(productId) && productId > 0)
    conds.push(eq(stockMovementsTable.productId, productId));
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
