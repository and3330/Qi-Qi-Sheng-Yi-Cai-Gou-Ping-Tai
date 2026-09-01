import { Router, type IRouter } from "express";
import { and, count, desc, eq, gte, inArray, sql, type SQL } from "drizzle-orm";
import {
  db,
  suppliersTable,
  purchaseOrdersTable,
  purchaseOrderItemsTable,
  purchaseReturnsTable,
  purchaseReturnItemsTable,
  productsTable,
  productVariantsTable,
  stockMovementsTable,
  erpAuditLogsTable,
  type PurchaseOrder,
  type PurchaseOrderItem,
  type PurchaseReturn,
  type PurchaseReturnItem,
} from "@workspace/db";
import {
  CreateAdminPurchaseOrderBody,
  UpdateAdminPurchaseOrderStatusBody,
  CreateErpPurchaseReturnBody,
  UpdateErpPurchaseReturnStatusBody,
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
    });
  } catch {
    /* audit 失敗不阻斷主流程 */
  }
}

function serializePO(po: PurchaseOrder, supplierName: string, items: PurchaseOrderItem[]) {
  return {
    id: po.id,
    poNo: po.poNo,
    supplierId: po.supplierId,
    supplierName,
    status: po.status,
    totalAmount: po.totalAmount,
    note: po.note,
    createdAt: po.createdAt.toISOString(),
    orderedAt: po.orderedAt ? po.orderedAt.toISOString() : null,
    receivedAt: po.receivedAt ? po.receivedAt.toISOString() : null,
    items: items.map((i) => ({
      id: i.id,
      productId: i.productId,
      variantId: i.variantId,
      variantName: i.variantName,
      productName: i.productName,
      productCode: i.productCode,
      unitCost: i.unitCost,
      quantity: i.quantity,
    })),
  };
}

async function loadPO(id: number) {
  const [row] = await db
    .select({ po: purchaseOrdersTable, supplierName: suppliersTable.name })
    .from(purchaseOrdersTable)
    .innerJoin(suppliersTable, eq(purchaseOrdersTable.supplierId, suppliersTable.id))
    .where(eq(purchaseOrdersTable.id, id))
    .limit(1);
  if (!row) return null;
  const items = await db
    .select()
    .from(purchaseOrderItemsTable)
    .where(eq(purchaseOrderItemsTable.purchaseOrderId, id));
  return serializePO(row.po, row.supplierName, items);
}

/* ---------- 採購單 ---------- */

router.get("/erp/purchase-orders", requireErpMenu("/purchasing/orders"), async (req, res) => {
  const status = typeof req.query.status === "string" ? req.query.status : "";
  const conds: SQL[] = [];
  if (["draft", "ordered", "received", "cancelled"].includes(status))
    conds.push(eq(purchaseOrdersTable.status, status));
  const rows = await db
    .select({ po: purchaseOrdersTable, supplierName: suppliersTable.name })
    .from(purchaseOrdersTable)
    .innerJoin(suppliersTable, eq(purchaseOrdersTable.supplierId, suppliersTable.id))
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(purchaseOrdersTable.createdAt))
    .limit(300);
  const ids = rows.map((r) => r.po.id);
  const items = ids.length
    ? await db
        .select()
        .from(purchaseOrderItemsTable)
        .where(inArray(purchaseOrderItemsTable.purchaseOrderId, ids))
    : [];
  res.json(
    rows.map((r) =>
      serializePO(r.po, r.supplierName, items.filter((i) => i.purchaseOrderId === r.po.id)),
    ),
  );
});

router.get("/erp/purchase-orders/:id", requireErpMenu("/purchasing/orders"), async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const po = await loadPO(id);
  if (!po) {
    res.status(404).json({ error: "找不到此採購單" });
    return;
  }
  res.json(po);
});

router.post("/erp/purchase-orders", requireErpMenu("/purchasing/orders"), async (req, res) => {
  const parsed = CreateAdminPurchaseOrderBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "採購單資料不完整" });
    return;
  }
  const input = parsed.data;

  const [supplier] = await db
    .select()
    .from(suppliersTable)
    .where(eq(suppliersTable.id, input.supplierId))
    .limit(1);
  if (!supplier) {
    res.status(400).json({ error: "供應商不存在" });
    return;
  }

  const productIds = input.items.map((i) => i.productId);
  const products = await db
    .select()
    .from(productsTable)
    .where(inArray(productsTable.id, productIds));
  const byId = new Map(products.map((p) => [p.id, p]));

  const variantIds = input.items
    .map((i) => i.variantId)
    .filter((v): v is number => v != null);
  const variants = variantIds.length
    ? await db
        .select()
        .from(productVariantsTable)
        .where(inArray(productVariantsTable.id, variantIds))
    : [];
  const variantById = new Map(variants.map((v) => [v.id, v]));

  const noVariantProductIds = input.items
    .filter((i) => i.variantId == null)
    .map((i) => i.productId);
  const requiresVariantRows = noVariantProductIds.length
    ? await db
        .select({ productId: productVariantsTable.productId })
        .from(productVariantsTable)
        .where(
          and(
            inArray(productVariantsTable.productId, noVariantProductIds),
            eq(productVariantsTable.isActive, true),
          ),
        )
    : [];
  const requiresVariant = new Set(requiresVariantRows.map((r) => r.productId));

  for (const line of input.items) {
    const p = byId.get(line.productId);
    if (!p) {
      res.status(400).json({ error: `品項不存在 (id=${line.productId})` });
      return;
    }
    if (p.isVirtual) {
      res.status(400).json({ error: `「${p.name}」為虛擬品項，不可採購入庫` });
      return;
    }
    if (line.variantId == null && requiresVariant.has(line.productId)) {
      res.status(400).json({ error: `「${p.name}」有多種規格，請指定進貨規格` });
      return;
    }
    if (line.variantId != null) {
      const v = variantById.get(line.variantId);
      if (!v || v.productId !== line.productId) {
        res.status(400).json({ error: `「${p.name}」的規格不存在` });
        return;
      }
      if (!v.isActive) {
        res.status(400).json({ error: `「${p.name}（${v.name}）」已停售，請先啟用該規格再進貨` });
        return;
      }
    }
  }

  const totalAmount = input.items.reduce((sum, l) => sum + l.unitCost * l.quantity, 0);
  const poNo = `PO${Date.now()}`;

  const result = await db.transaction(async (tx) => {
    const [po] = await tx
      .insert(purchaseOrdersTable)
      .values({
        poNo,
        supplierId: input.supplierId,
        status: "draft",
        totalAmount,
        note: input.note ?? null,
        createdBy: req.member!.id,
      })
      .returning();
    const items = await tx
      .insert(purchaseOrderItemsTable)
      .values(
        input.items.map((l) => {
          const p = byId.get(l.productId)!;
          const v = l.variantId != null ? variantById.get(l.variantId)! : null;
          return {
            purchaseOrderId: po.id,
            productId: p.id,
            variantId: v?.id ?? null,
            variantName: v?.name ?? null,
            productName: p.name,
            productCode: p.code,
            unitCost: l.unitCost,
            quantity: l.quantity,
          };
        }),
      )
      .returning();
    return { po, items };
  });
  await audit(req, {
    action: "create",
    module: "purchasing",
    documentType: "purchase_order",
    documentId: String(result.po.id),
    description: `開立採購單 ${poNo}（${supplier.name}）`,
  });
  res.status(201).json(serializePO(result.po, supplier.name, result.items));
});

router.patch("/erp/purchase-orders/:id/status", requireErpMenu("/purchasing/orders"), async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const parsed = UpdateAdminPurchaseOrderStatusBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "狀態不正確" });
    return;
  }
  const target = parsed.data.status;
  const [po] = await db
    .select()
    .from(purchaseOrdersTable)
    .where(eq(purchaseOrdersTable.id, id))
    .limit(1);
  if (!po) {
    res.status(404).json({ error: "找不到此採購單" });
    return;
  }
  const allowed =
    (target === "ordered" && po.status === "draft") ||
    (target === "cancelled" && (po.status === "draft" || po.status === "ordered"));
  if (!allowed) {
    res.status(400).json({ error: `無法從「${po.status}」變更為「${target}」` });
    return;
  }
  // 條件式 UPDATE 防競態
  const [changed] = await db
    .update(purchaseOrdersTable)
    .set(
      target === "ordered"
        ? { status: "ordered", orderedAt: new Date() }
        : { status: "cancelled" },
    )
    .where(and(eq(purchaseOrdersTable.id, id), eq(purchaseOrdersTable.status, po.status)))
    .returning({ id: purchaseOrdersTable.id });
  if (!changed) {
    res.status(409).json({ error: "採購單狀態已變更，請重新整理後再試" });
    return;
  }
  await audit(req, {
    action: target,
    module: "purchasing",
    documentType: "purchase_order",
    documentId: String(id),
    description: `採購單 ${po.poNo} → ${target}`,
  });
  res.json(await loadPO(id));
});

/** 採購收貨：列鎖採購單防重複收貨，入庫並更新成本 */
router.post("/erp/purchase-orders/:id/receive", requireErpMenu("/purchasing/receiving"), async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  let poNo = "";
  const productIds: number[] = [];
  try {
    await db.transaction(async (tx) => {
      const [po] = await tx
        .select()
        .from(purchaseOrdersTable)
        .where(eq(purchaseOrdersTable.id, id))
        .for("update")
        .limit(1);
      if (!po) throw new DocError("找不到此採購單");
      if (po.status !== "ordered") throw new DocError("只有「已下單」的採購單可以收貨");
      poNo = po.poNo;

      const items = await tx
        .select()
        .from(purchaseOrderItemsTable)
        .where(eq(purchaseOrderItemsTable.purchaseOrderId, id));

      for (const item of items) {
        // 虛擬品項不動庫存（逐行檢查商品目前設定）
        const [p] = await tx
          .select({ isVirtual: productsTable.isVirtual })
          .from(productsTable)
          .where(eq(productsTable.id, item.productId))
          .limit(1);
        if (p?.isVirtual) continue;
        productIds.push(item.productId);
        let stockAfter: number | null = null;
        if (item.variantId != null) {
          const [updated] = await tx
            .update(productVariantsTable)
            .set({
              stock: sql`${productVariantsTable.stock} + ${item.quantity}`,
              costPrice: item.unitCost,
            })
            .where(eq(productVariantsTable.id, item.variantId))
            .returning();
          if (updated) stockAfter = updated.stock;
        } else {
          const [updated] = await tx
            .update(productsTable)
            .set({
              stock: sql`${productsTable.stock} + ${item.quantity}`,
              costPrice: item.unitCost,
            })
            .where(eq(productsTable.id, item.productId))
            .returning();
          if (updated) stockAfter = updated.stock;
        }
        if (stockAfter == null) continue;
        await tx.insert(stockMovementsTable).values({
          productId: item.productId,
          variantId: item.variantId,
          type: "purchase",
          quantity: item.quantity,
          stockAfter,
          reason: item.variantName ? `採購進貨（${item.variantName}）` : "採購進貨",
          refNo: po.poNo,
        });
      }

      await tx
        .update(purchaseOrdersTable)
        .set({ status: "received", receivedAt: new Date() })
        .where(eq(purchaseOrdersTable.id, id));
    });
  } catch (err) {
    if (err instanceof DocError) {
      res.status(err.message === "找不到此採購單" ? 404 : 400).json({ error: err.message });
      return;
    }
    throw err;
  }
  for (const pid of new Set(productIds)) reindex("product", pid);
  await audit(req, {
    action: "receive",
    module: "purchasing",
    documentType: "purchase_order",
    documentId: String(id),
    description: `採購收貨 ${poNo}`,
  });
  res.json(await loadPO(id));
});

/* ---------- 採購退回 ---------- */

function serializePR(
  pr: PurchaseReturn,
  supplierName: string,
  items: PurchaseReturnItem[],
  poNo?: string | null,
) {
  return {
    id: pr.id,
    prNo: pr.prNo,
    supplierId: pr.supplierId,
    supplierName,
    purchaseOrderId: pr.purchaseOrderId,
    purchaseOrderNo: poNo ?? null,
    status: pr.status,
    totalAmount: pr.totalAmount,
    reason: pr.reason,
    note: pr.note,
    createdAt: pr.createdAt.toISOString(),
    confirmedAt: pr.confirmedAt ? pr.confirmedAt.toISOString() : null,
    items: items.map((i) => ({
      id: i.id,
      productId: i.productId,
      variantId: i.variantId,
      variantName: i.variantName,
      productName: i.productName,
      productCode: i.productCode,
      unitCost: i.unitCost,
      quantity: i.quantity,
      isVirtual: i.isVirtual,
    })),
  };
}

async function loadPR(id: number) {
  const [row] = await db
    .select({ pr: purchaseReturnsTable, supplierName: suppliersTable.name })
    .from(purchaseReturnsTable)
    .innerJoin(suppliersTable, eq(purchaseReturnsTable.supplierId, suppliersTable.id))
    .where(eq(purchaseReturnsTable.id, id))
    .limit(1);
  if (!row) return null;
  const items = await db
    .select()
    .from(purchaseReturnItemsTable)
    .where(eq(purchaseReturnItemsTable.purchaseReturnId, id));
  let poNo: string | null = null;
  if (row.pr.purchaseOrderId) {
    const [po] = await db
      .select({ poNo: purchaseOrdersTable.poNo })
      .from(purchaseOrdersTable)
      .where(eq(purchaseOrdersTable.id, row.pr.purchaseOrderId))
      .limit(1);
    poNo = po?.poNo ?? null;
  }
  return serializePR(row.pr, row.supplierName, items, poNo);
}

router.get("/erp/purchase-returns", requireErpMenu("/purchasing/returns"), async (req, res) => {
  const status = typeof req.query.status === "string" ? req.query.status : "";
  const conds: SQL[] = [];
  if (["draft", "confirmed", "cancelled"].includes(status))
    conds.push(eq(purchaseReturnsTable.status, status));
  const rows = await db
    .select({ pr: purchaseReturnsTable, supplierName: suppliersTable.name })
    .from(purchaseReturnsTable)
    .innerJoin(suppliersTable, eq(purchaseReturnsTable.supplierId, suppliersTable.id))
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(purchaseReturnsTable.id))
    .limit(300);
  const ids = rows.map((r) => r.pr.id);
  const items = ids.length
    ? await db
        .select()
        .from(purchaseReturnItemsTable)
        .where(inArray(purchaseReturnItemsTable.purchaseReturnId, ids))
    : [];
  const poIds = rows.map((r) => r.pr.purchaseOrderId).filter((v): v is number => v != null);
  const pos = poIds.length
    ? await db
        .select({ id: purchaseOrdersTable.id, poNo: purchaseOrdersTable.poNo })
        .from(purchaseOrdersTable)
        .where(inArray(purchaseOrdersTable.id, poIds))
    : [];
  const poNoById = new Map(pos.map((p) => [p.id, p.poNo]));
  res.json(
    rows.map((r) =>
      serializePR(
        r.pr,
        r.supplierName,
        items.filter((i) => i.purchaseReturnId === r.pr.id),
        r.pr.purchaseOrderId ? poNoById.get(r.pr.purchaseOrderId) ?? null : null,
      ),
    ),
  );
});

/** 建立採退單（草稿）：可依已收貨採購單帶入品項，數量不可超過原收貨數量 */
router.post("/erp/purchase-returns", requireErpMenu("/purchasing/returns"), async (req, res) => {
  const parsed = CreateErpPurchaseReturnBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "採退單資料不完整" });
    return;
  }
  const input = parsed.data;

  // 同一來源明細重複列 → 合併數量，避免逐列檢查被繞過
  const qtyByItemId = new Map<number, number>();
  for (const line of input.items) {
    if (line.quantity <= 0) {
      res.status(400).json({ error: "退回數量須大於 0" });
      return;
    }
    qtyByItemId.set(
      line.purchaseOrderItemId,
      (qtyByItemId.get(line.purchaseOrderItemId) ?? 0) + line.quantity,
    );
  }
  if (qtyByItemId.size === 0) {
    res.status(400).json({ error: "採退單沒有品項" });
    return;
  }

  const prNo = `PR${Date.now()}`;
  let result;
  try {
    result = await db.transaction(async (tx) => {
      // 鎖採購單主檔，序列化同一張單的併發建立採退
      const [po] = await tx
        .select()
        .from(purchaseOrdersTable)
        .where(eq(purchaseOrdersTable.id, input.purchaseOrderId))
        .limit(1)
        .for("update");
      if (!po) throw new DocError("採購單不存在");
      if (po.status !== "received") throw new DocError("僅已收貨的採購單可建立採退");
      const poItems = await tx
        .select()
        .from(purchaseOrderItemsTable)
        .where(eq(purchaseOrderItemsTable.purchaseOrderId, po.id));
      const poItemById = new Map(poItems.map((i) => [i.id, i]));

      // 已建立（草稿/已確認）採退數量防超退
      const prevs = await tx
        .select()
        .from(purchaseReturnsTable)
        .where(
          and(
            eq(purchaseReturnsTable.purchaseOrderId, po.id),
            inArray(purchaseReturnsTable.status, ["draft", "confirmed"]),
          ),
        );
      const prevIds = prevs.map((r) => r.id);
      const prevItems = prevIds.length
        ? await tx
            .select()
            .from(purchaseReturnItemsTable)
            .where(inArray(purchaseReturnItemsTable.purchaseReturnId, prevIds))
        : [];
      const returnedQty = new Map<string, number>();
      for (const i of prevItems) {
        const k = `${i.productId}:${i.variantId ?? ""}`;
        returnedQty.set(k, (returnedQty.get(k) ?? 0) + i.quantity);
      }

      const prodRows = await tx
        .select({ id: productsTable.id, isVirtual: productsTable.isVirtual })
        .from(productsTable)
        .where(inArray(productsTable.id, poItems.map((i) => i.productId)));
      const virtualById = new Map(prodRows.map((p) => [p.id, p.isVirtual]));

      const lines: Omit<PurchaseReturnItem, "id" | "purchaseReturnId">[] = [];
      for (const [poItemId, quantity] of qtyByItemId) {
        const poItem = poItemById.get(poItemId);
        if (!poItem) throw new DocError("採退明細與採購單不符");
        const k = `${poItem.productId}:${poItem.variantId ?? ""}`;
        const already = returnedQty.get(k) ?? 0;
        if (quantity + already > poItem.quantity) {
          throw new DocError(
            `「${poItem.productName}」退回數量超過原收貨數量（已退/退回中 ${already}）`,
          );
        }
        returnedQty.set(k, already + quantity);
        lines.push({
          productId: poItem.productId,
          variantId: poItem.variantId,
          variantName: poItem.variantName,
          productName: poItem.productName,
          productCode: poItem.productCode,
          unitCost: poItem.unitCost,
          quantity,
          isVirtual: virtualById.get(poItem.productId) ?? false,
        });
      }

      const totalAmount = lines.reduce((s, l) => s + l.unitCost * l.quantity, 0);
      const [pr] = await tx
        .insert(purchaseReturnsTable)
        .values({
          prNo,
          supplierId: po.supplierId,
          purchaseOrderId: po.id,
          status: "draft",
          totalAmount,
          reason: input.reason ?? null,
          note: input.note ?? null,
          createdBy: req.member!.id,
        })
        .returning();
      const items = await tx
        .insert(purchaseReturnItemsTable)
        .values(lines.map((l) => ({ ...l, purchaseReturnId: pr.id })))
        .returning();
      return { pr, items, poNo: po.poNo };
    });
  } catch (err) {
    if (err instanceof DocError) {
      res.status(400).json({ error: err.message });
      return;
    }
    throw err;
  }
  await audit(req, {
    action: "create",
    module: "purchasing",
    documentType: "purchase_return",
    documentId: String(result.pr.id),
    description: `建立採退單 ${prNo}（${result.poNo}）`,
  });
  res.status(201).json(await loadPR(result.pr.id));
});

/** 採退單狀態：draft→confirmed（扣庫存出庫，庫存不足擋下）、draft→cancelled */
router.patch("/erp/purchase-returns/:id/status", requireErpMenu("/purchasing/returns"), async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const parsed = UpdateErpPurchaseReturnStatusBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "狀態不正確" });
    return;
  }
  const target = parsed.data.status;

  let reindexProductIds: number[] = [];
  try {
    await db.transaction(async (tx) => {
      const [pr] = await tx
        .select()
        .from(purchaseReturnsTable)
        .where(eq(purchaseReturnsTable.id, id))
        .for("update")
        .limit(1);
      if (!pr) throw new DocError("找不到此採退單");
      if (pr.status !== "draft")
        throw new DocError(`無法從「${pr.status}」變更為「${target}」`);

      if (target === "confirmed") {
        const items = await tx
          .select()
          .from(purchaseReturnItemsTable)
          .where(eq(purchaseReturnItemsTable.purchaseReturnId, id));
        reindexProductIds = items.map((i) => i.productId);
        for (const item of items) {
          if (item.isVirtual) continue;
          if (item.variantId != null) {
            const dec = await tx
              .update(productVariantsTable)
              .set({ stock: sql`${productVariantsTable.stock} - ${item.quantity}` })
              .where(
                and(
                  eq(productVariantsTable.id, item.variantId),
                  gte(productVariantsTable.stock, item.quantity),
                ),
              )
              .returning({ stock: productVariantsTable.stock });
            if (dec.length === 0)
              throw new DocError(
                `庫存不足，無法退回：${item.productName}（${item.variantName ?? ""}）`,
              );
            await tx.insert(stockMovementsTable).values({
              productId: item.productId,
              variantId: item.variantId,
              type: "purchase_return",
              quantity: -item.quantity,
              stockAfter: dec[0].stock,
              reason: `採購退回出庫（${item.variantName}）`,
              refNo: pr.prNo,
            });
          } else {
            const dec = await tx
              .update(productsTable)
              .set({ stock: sql`${productsTable.stock} - ${item.quantity}` })
              .where(
                and(
                  eq(productsTable.id, item.productId),
                  gte(productsTable.stock, item.quantity),
                ),
              )
              .returning({ stock: productsTable.stock });
            if (dec.length === 0)
              throw new DocError(`庫存不足，無法退回：${item.productName}`);
            await tx.insert(stockMovementsTable).values({
              productId: item.productId,
              variantId: null,
              type: "purchase_return",
              quantity: -item.quantity,
              stockAfter: dec[0].stock,
              reason: "採購退回出庫",
              refNo: pr.prNo,
            });
          }
        }
      }

      await tx
        .update(purchaseReturnsTable)
        .set(
          target === "confirmed"
            ? { status: "confirmed", confirmedAt: new Date() }
            : { status: "cancelled" },
        )
        .where(eq(purchaseReturnsTable.id, id));
    });
  } catch (err) {
    if (err instanceof DocError) {
      res.status(400).json({ error: err.message });
      return;
    }
    throw err;
  }
  for (const pid of new Set(reindexProductIds)) reindex("product", pid);
  await audit(req, {
    action: target,
    module: "purchasing",
    documentType: "purchase_return",
    documentId: String(id),
    description: `採退單 #${id} → ${target}`,
  });
  res.json(await loadPR(id));
});

export default router;
