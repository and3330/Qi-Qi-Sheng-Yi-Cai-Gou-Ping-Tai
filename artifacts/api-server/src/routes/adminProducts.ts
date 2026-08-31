import { Router, type IRouter } from "express";
import { and, asc, desc, eq, gte, ilike, lte, or, sql, type SQL } from "drizzle-orm";
import {
  db,
  productsTable,
  productVariantsTable,
  stockMovementsTable,
  orderItemsTable,
  type Product,
  type ProductVariant,
  type StockMovement,
} from "@workspace/db";
import {
  CreateAdminProductBody,
  UpdateAdminProductBody,
  AdjustAdminStockBody,
  CreateAdminProductVariantBody,
  UpdateAdminProductVariantBody,
} from "@workspace/api-zod";
import { requireStaff, requireOps } from "../middlewares/requireMember";

const router: IRouter = Router();

export function serializeAdminProduct(p: Product) {
  return {
    id: p.id,
    code: p.code,
    name: p.name,
    category: p.category,
    description: p.description,
    imageUrl: p.imageUrl,
    priceHospital: p.priceHospital,
    priceClinic: p.priceClinic,
    priceConsumer: p.priceConsumer,
    costPrice: p.costPrice,
    stock: p.stock,
    isHot: p.isHot,
    isNew: p.isNew,
    isActive: p.isActive,
    spec: p.spec,
    createdAt: p.createdAt.toISOString(),
  };
}

export function serializeMovement(
  m: StockMovement,
  product: { name: string; code: string },
) {
  return {
    id: m.id,
    productId: m.productId,
    productName: product.name,
    productCode: product.code,
    type: m.type,
    quantity: m.quantity,
    stockAfter: m.stockAfter,
    reason: m.reason,
    refNo: m.refNo,
    createdAt: m.createdAt.toISOString(),
  };
}

router.get("/admin/products", requireStaff, async (req, res) => {
  const search =
    typeof req.query.search === "string" ? req.query.search.trim() : "";
  const category =
    typeof req.query.category === "string" ? req.query.category : "";
  const status = typeof req.query.status === "string" ? req.query.status : "all";

  const conditions: SQL[] = [];
  if (search) {
    conditions.push(
      or(
        ilike(productsTable.name, `%${search}%`),
        ilike(productsTable.code, `%${search}%`),
      )!,
    );
  }
  if (category) conditions.push(eq(productsTable.category, category));
  if (status === "active") conditions.push(eq(productsTable.isActive, true));
  if (status === "inactive") conditions.push(eq(productsTable.isActive, false));

  const rows = await db
    .select()
    .from(productsTable)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(asc(productsTable.code));
  res.json(rows.map(serializeAdminProduct));
});

router.post("/admin/products", requireOps, async (req, res) => {
  const parsed = CreateAdminProductBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "商品資料不完整或格式錯誤" });
    return;
  }
  const data = parsed.data;

  const [existing] = await db
    .select({ id: productsTable.id })
    .from(productsTable)
    .where(eq(productsTable.code, data.code))
    .limit(1);
  if (existing) {
    res.status(400).json({ error: `商品編號 ${data.code} 已存在` });
    return;
  }

  const initialStock = data.stock ?? 0;
  const created = await db.transaction(async (tx) => {
    const [product] = await tx
      .insert(productsTable)
      .values({
        code: data.code,
        name: data.name,
        category: data.category,
        description: data.description ?? null,
        imageUrl: data.imageUrl ?? null,
        priceHospital: data.priceHospital,
        priceClinic: data.priceClinic,
        priceConsumer: data.priceConsumer,
        costPrice: data.costPrice ?? 0,
        stock: initialStock,
        isHot: data.isHot ?? false,
        isNew: data.isNew ?? true,
        isActive: data.isActive ?? true,
        spec: data.spec ?? null,
      })
      .returning();
    if (initialStock > 0) {
      await tx.insert(stockMovementsTable).values({
        productId: product.id,
        type: "adjust",
        quantity: initialStock,
        stockAfter: initialStock,
        reason: "期初庫存",
      });
    }
    return product;
  });
  res.status(201).json(serializeAdminProduct(created));
});

router.patch("/admin/products/:id", requireOps, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const parsed = UpdateAdminProductBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "資料格式不正確" });
    return;
  }
  const data = parsed.data;
  if (data.code) {
    const [dup] = await db
      .select({ id: productsTable.id })
      .from(productsTable)
      .where(eq(productsTable.code, data.code))
      .limit(1);
    if (dup && dup.id !== id) {
      res.status(400).json({ error: `商品編號 ${data.code} 已存在` });
      return;
    }
  }
  const [updated] = await db
    .update(productsTable)
    .set(data)
    .where(eq(productsTable.id, id))
    .returning();
  if (!updated) {
    res.status(404).json({ error: "找不到此商品" });
    return;
  }
  res.json(serializeAdminProduct(updated));
});

router.post("/admin/inventory/adjust", requireOps, async (req, res) => {
  const parsed = AdjustAdminStockBody.safeParse(req.body);
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
      const [product] = await tx
        .select()
        .from(productsTable)
        .where(eq(productsTable.id, productId))
        .limit(1);
      if (!product) throw new Error("ADJUST_FAILED");
      const baseReason = note ? `${reason}：${note}` : reason;
      const [movement] = await tx
        .insert(stockMovementsTable)
        .values({
          productId,
          variantId,
          type: "adjust",
          quantity,
          stockAfter,
          reason: variantName ? `${baseReason}（${variantName}）` : baseReason,
        })
        .returning();
      return { movement, product };
    });
    res
      .status(201)
      .json(serializeMovement(result.movement, result.product));
  } catch (err) {
    if (err instanceof Error && err.message === "ADJUST_FAILED") {
      res.status(400).json({ error: "商品不存在或庫存不足以扣減" });
      return;
    }
    if (err instanceof Error && err.message === "VARIANT_REQUIRED") {
      res.status(400).json({ error: "此商品有多種規格，請指定要調整的規格" });
      return;
    }
    throw err;
  }
});

// ---------- 商品多規格 ----------

function serializeAdminVariant(v: ProductVariant) {
  return {
    id: v.id,
    productId: v.productId,
    name: v.name,
    priceHospital: v.priceHospital,
    priceClinic: v.priceClinic,
    priceConsumer: v.priceConsumer,
    costPrice: v.costPrice,
    stock: v.stock,
    isActive: v.isActive,
    createdAt: v.createdAt.toISOString(),
  };
}

router.get(
  "/admin/products/:id/variants",
  requireStaff,
  async (req, res) => {
    const productId = Number(req.params.id);
    if (!Number.isInteger(productId)) {
      res.status(400).json({ error: "Invalid id" });
      return;
    }
    const rows = await db
      .select()
      .from(productVariantsTable)
      .where(eq(productVariantsTable.productId, productId))
      .orderBy(asc(productVariantsTable.id));
    res.json(rows.map(serializeAdminVariant));
  },
);

router.post(
  "/admin/products/:id/variants",
  requireOps,
  async (req, res) => {
    const productId = Number(req.params.id);
    if (!Number.isInteger(productId)) {
      res.status(400).json({ error: "Invalid id" });
      return;
    }
    const parsed = CreateAdminProductVariantBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "規格資料不完整" });
      return;
    }
    const [product] = await db
      .select({ id: productsTable.id })
      .from(productsTable)
      .where(eq(productsTable.id, productId))
      .limit(1);
    if (!product) {
      res.status(404).json({ error: "找不到此商品" });
      return;
    }
    const data = parsed.data;
    const created = await db.transaction(async (tx) => {
      const [variant] = await tx
        .insert(productVariantsTable)
        .values({
          productId,
          name: data.name,
          priceHospital: data.priceHospital,
          priceClinic: data.priceClinic,
          priceConsumer: data.priceConsumer,
          costPrice: data.costPrice ?? 0,
          stock: data.stock ?? 0,
          isActive: data.isActive ?? true,
        })
        .returning();
      if ((data.stock ?? 0) > 0) {
        await tx.insert(stockMovementsTable).values({
          productId,
          variantId: variant.id,
          type: "adjust",
          quantity: data.stock ?? 0,
          stockAfter: data.stock ?? 0,
          reason: `期初庫存（${variant.name}）`,
        });
      }
      return variant;
    });
    res.status(201).json(serializeAdminVariant(created));
  },
);

router.patch("/admin/variants/:id", requireOps, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const parsed = UpdateAdminProductVariantBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "規格資料不完整" });
    return;
  }
  // 庫存請走庫存調整功能，避免遺失異動紀錄
  const { stock: _ignored, ...rest } = parsed.data as Record<string, unknown> & {
    stock?: number;
  };
  const [updated] = await db
    .update(productVariantsTable)
    .set(rest)
    .where(eq(productVariantsTable.id, id))
    .returning();
  if (!updated) {
    res.status(404).json({ error: "找不到此規格" });
    return;
  }
  res.json(serializeAdminVariant(updated));
});

router.delete("/admin/variants/:id", requireOps, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const [used] = await db
    .select({ id: orderItemsTable.id })
    .from(orderItemsTable)
    .where(eq(orderItemsTable.variantId, id))
    .limit(1);
  if (used) {
    res
      .status(400)
      .json({ error: "此規格已有訂單紀錄，無法刪除，請改為停售" });
    return;
  }
  const deleted = await db
    .delete(productVariantsTable)
    .where(eq(productVariantsTable.id, id))
    .returning({ id: productVariantsTable.id });
  if (!deleted.length) {
    res.status(404).json({ error: "找不到此規格" });
    return;
  }
  res.status(204).end();
});

router.get("/admin/stock-movements", requireStaff, async (req, res) => {
  const productId = req.query.productId ? Number(req.query.productId) : null;
  const type = typeof req.query.type === "string" ? req.query.type : "";
  const from = typeof req.query.from === "string" ? req.query.from : "";
  const to = typeof req.query.to === "string" ? req.query.to : "";

  const conditions: SQL[] = [];
  if (productId && Number.isInteger(productId))
    conditions.push(eq(stockMovementsTable.productId, productId));
  if (type === "purchase" || type === "sale" || type === "adjust")
    conditions.push(eq(stockMovementsTable.type, type));
  if (from) conditions.push(gte(stockMovementsTable.createdAt, new Date(from)));
  if (to) {
    const end = new Date(to);
    end.setDate(end.getDate() + 1);
    conditions.push(lte(stockMovementsTable.createdAt, end));
  }

  const rows = await db
    .select({
      movement: stockMovementsTable,
      productName: productsTable.name,
      productCode: productsTable.code,
    })
    .from(stockMovementsTable)
    .innerJoin(productsTable, eq(stockMovementsTable.productId, productsTable.id))
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(stockMovementsTable.createdAt), desc(stockMovementsTable.id))
    .limit(500);

  res.json(
    rows.map((r) =>
      serializeMovement(r.movement, {
        name: r.productName,
        code: r.productCode,
      }),
    ),
  );
});

export default router;
