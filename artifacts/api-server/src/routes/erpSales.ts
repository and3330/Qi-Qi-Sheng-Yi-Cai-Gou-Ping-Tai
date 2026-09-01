import { Router, type IRouter } from "express";
import { and, count, desc, eq, gte, inArray, sql, type SQL } from "drizzle-orm";
import {
  db,
  productsTable,
  productVariantsTable,
  stockMovementsTable,
  ordersTable,
  erpCustomersTable,
  priceListItemsTable,
  salesOrdersTable,
  salesOrderItemsTable,
  salesReturnsTable,
  salesReturnItemsTable,
  erpAuditLogsTable,
  type SalesOrder,
  type SalesOrderItem,
  type SalesReturn,
  type SalesReturnItem,
} from "@workspace/db";
import {
  CreateErpSalesOrderBody,
  UpdateErpSalesOrderStatusBody,
  CreateErpSalesReturnBody,
  UpdateErpSalesReturnStatusBody,
} from "@workspace/api-zod";
import { requireErpMenu } from "../middlewares/requireErp";
import { registerQuotationRoutes } from "./adminQuotations";
import { applyOrderStatusChange } from "./adminOrders";
import { reindex } from "../lib/aiIndex";
import { autoPost, postErpSalesOrderInvoice } from "../lib/erpAutoPost";

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

/* ---------- 報價單（與商城後台共用同一套規則） ---------- */

registerQuotationRoutes(router, "/erp/quotations", requireErpMenu("/sales/quotations"));

/* ---------- 銷貨單 ---------- */

function serializeSO(so: SalesOrder, items: SalesOrderItem[]) {
  return {
    id: so.id,
    soNo: so.soNo,
    source: so.source,
    customerId: so.customerId,
    customerName: so.customerName,
    orderId: so.orderId,
    orderNo: so.orderNo,
    status: so.status,
    totalAmount: so.totalAmount,
    note: so.note,
    createdAt: so.createdAt.toISOString(),
    confirmedAt: so.confirmedAt ? so.confirmedAt.toISOString() : null,
    shippedAt: so.shippedAt ? so.shippedAt.toISOString() : null,
    completedAt: so.completedAt ? so.completedAt.toISOString() : null,
    items: items.map((i) => ({
      id: i.id,
      productId: i.productId,
      variantId: i.variantId,
      variantName: i.variantName,
      productName: i.productName,
      productCode: i.productCode,
      unitPrice: i.unitPrice,
      quantity: i.quantity,
      unitCost: i.unitCost,
      isVirtual: i.isVirtual,
    })),
  };
}

async function loadSO(id: number) {
  const [so] = await db
    .select()
    .from(salesOrdersTable)
    .where(eq(salesOrdersTable.id, id))
    .limit(1);
  if (!so) return null;
  const items = await db
    .select()
    .from(salesOrderItemsTable)
    .where(eq(salesOrderItemsTable.salesOrderId, id));
  return serializeSO(so, items);
}

router.get("/erp/sales-orders", requireErpMenu("/sales/orders"), async (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const pageSize = 30;
  const conds: SQL[] = [];
  const status = typeof req.query.status === "string" ? req.query.status : "";
  if (["draft", "confirmed", "shipped", "completed", "cancelled", "returned"].includes(status))
    conds.push(eq(salesOrdersTable.status, status));
  const source = typeof req.query.source === "string" ? req.query.source : "";
  if (["shop", "erp", "quotation"].includes(source))
    conds.push(eq(salesOrdersTable.source, source));
  const where = conds.length ? and(...conds) : undefined;
  const [[total], rows] = await Promise.all([
    db.select({ n: count() }).from(salesOrdersTable).where(where),
    db
      .select()
      .from(salesOrdersTable)
      .where(where)
      .orderBy(desc(salesOrdersTable.id))
      .limit(pageSize)
      .offset((page - 1) * pageSize),
  ]);
  const ids = rows.map((r) => r.id);
  const items = ids.length
    ? await db
        .select()
        .from(salesOrderItemsTable)
        .where(inArray(salesOrderItemsTable.salesOrderId, ids))
    : [];
  res.json({
    items: rows.map((so) =>
      serializeSO(so, items.filter((i) => i.salesOrderId === so.id)),
    ),
    total: total.n,
    page,
    pageSize,
  });
});

router.get("/erp/sales-orders/:id", requireErpMenu("/sales/orders"), async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const so = await loadSO(id);
  if (!so) {
    res.status(404).json({ error: "找不到此銷貨單" });
    return;
  }
  res.json(so);
});

/** ERP 直接開立銷貨單（草稿；確認時才扣庫存） */
router.post("/erp/sales-orders", requireErpMenu("/sales/orders"), async (req, res) => {
  const parsed = CreateErpSalesOrderBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "銷貨單資料不完整" });
    return;
  }
  const input = parsed.data;

  const [customer] = await db
    .select()
    .from(erpCustomersTable)
    .where(eq(erpCustomersTable.id, input.customerId))
    .limit(1);
  if (!customer) {
    res.status(400).json({ error: "客戶不存在" });
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

  // 有啟用規格的商品必須指定規格
  const noVariantIds = input.items
    .filter((i) => i.variantId == null)
    .map((i) => i.productId);
  const requiresRows = noVariantIds.length
    ? await db
        .select({ productId: productVariantsTable.productId })
        .from(productVariantsTable)
        .where(
          and(
            inArray(productVariantsTable.productId, noVariantIds),
            eq(productVariantsTable.isActive, true),
          ),
        )
    : [];
  const requiresVariant = new Set(requiresRows.map((r) => r.productId));

  for (const line of input.items) {
    const p = byId.get(line.productId);
    if (!p) {
      res.status(400).json({ error: `品項不存在 (id=${line.productId})` });
      return;
    }
    if (line.variantId == null && requiresVariant.has(line.productId)) {
      res.status(400).json({ error: `「${p.name}」有多種規格，請指定規格` });
      return;
    }
    if (line.variantId != null) {
      const v = variantById.get(line.variantId);
      if (!v || v.productId !== line.productId) {
        res.status(400).json({ error: `「${p.name}」的規格不存在` });
        return;
      }
    }
  }

  // 價格：明細有指定用指定價；否則客戶價格表價；否則消費者牌價
  const plItems = customer.priceListId
    ? await db
        .select()
        .from(priceListItemsTable)
        .where(eq(priceListItemsTable.priceListId, customer.priceListId))
    : [];
  const plPrice = new Map(plItems.map((i) => [`${i.productId}:${i.variantId ?? ""}`, i.price]));

  const lines = input.items.map((line) => {
    const p = byId.get(line.productId)!;
    const v = line.variantId != null ? variantById.get(line.variantId)! : null;
    const unitPrice =
      line.unitPrice ??
      plPrice.get(`${p.id}:${v?.id ?? ""}`) ??
      (v ? v.priceConsumer : p.priceConsumer);
    return {
      productId: p.id,
      variantId: v?.id ?? null,
      variantName: v?.name ?? null,
      productName: p.name,
      productCode: p.code,
      unitPrice,
      quantity: line.quantity,
      unitCost: v ? v.costPrice : p.costPrice,
      isVirtual: p.isVirtual,
    };
  });
  const totalAmount = lines.reduce((s, l) => s + l.unitPrice * l.quantity, 0);
  const soNo = `SO${Date.now()}`;

  const result = await db.transaction(async (tx) => {
    const [so] = await tx
      .insert(salesOrdersTable)
      .values({
        soNo,
        source: "erp",
        customerId: customer.id,
        customerName: customer.name,
        status: "draft",
        totalAmount,
        note: input.note ?? null,
        createdBy: req.member!.id,
      })
      .returning();
    const items = await tx
      .insert(salesOrderItemsTable)
      .values(lines.map((l) => ({ ...l, salesOrderId: so.id })))
      .returning();
    return { so, items };
  });
  await audit(req, {
    action: "create",
    module: "sales",
    documentType: "sales_order",
    documentId: String(result.so.id),
    description: `開立銷貨單 ${soNo}（${customer.name}）`,
  });
  res.status(201).json(serializeSO(result.so, result.items));
});

/**
 * 銷貨單狀態流轉。
 * - ERP 開立單：draft→confirmed（扣庫存，列鎖交易）、confirmed→shipped→completed、draft/confirmed→cancelled（回補庫存）
 * - 商城訂單產生的單：出貨／完成／取消一律走商城訂單狀態機（applyOrderStatusChange），
 *   由其同步回寫銷貨單，確保錢包／點數／庫存一致。
 */
router.patch("/erp/sales-orders/:id/status", requireErpMenu("/sales/orders"), async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const parsed = UpdateErpSalesOrderStatusBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "狀態不正確" });
    return;
  }
  const target = parsed.data.status;

  const [so] = await db
    .select()
    .from(salesOrdersTable)
    .where(eq(salesOrdersTable.id, id))
    .limit(1);
  if (!so) {
    res.status(404).json({ error: "找不到此銷貨單" });
    return;
  }

  // 商城訂單連動：透過商城狀態機執行（會在同一交易同步銷貨單）
  if (so.orderId != null) {
    const mapToOrder: Record<string, string> = {
      shipped: "shipped",
      completed: "completed",
      cancelled: "cancelled",
    };
    const orderTarget = mapToOrder[target];
    if (!orderTarget) {
      res.status(400).json({ error: "商城訂單產生的銷貨單僅支援出貨／完成／取消" });
      return;
    }
    try {
      await applyOrderStatusChange(so.orderId, orderTarget);
    } catch (err) {
      if (err instanceof Error && err.message === "ORDER_NOT_FOUND") {
        res.status(404).json({ error: "對應的商城訂單不存在" });
        return;
      }
      if (err instanceof Error && err.message.startsWith("BAD_TRANSITION:")) {
        res.status(400).json({
          error: `商城訂單目前為「${err.message.split(":")[1]}」，無法變更為「${orderTarget}」`,
        });
        return;
      }
      throw err;
    }
    reindex("order", so.orderId);
    await audit(req, {
      action: target,
      module: "sales",
      documentType: "sales_order",
      documentId: String(id),
      description: `銷貨單 ${so.soNo} → ${target}（連動商城訂單 ${so.orderNo}）`,
    });
    res.json(await loadSO(id));
    return;
  }

  // ERP 開立單
  try {
    await db.transaction(async (tx) => {
      const [locked] = await tx
        .select()
        .from(salesOrdersTable)
        .where(eq(salesOrdersTable.id, id))
        .for("update")
        .limit(1);
      if (!locked) throw new DocError("找不到此銷貨單");
      const allowed =
        (target === "confirmed" && locked.status === "draft") ||
        (target === "shipped" && locked.status === "confirmed") ||
        (target === "completed" && locked.status === "shipped") ||
        (target === "cancelled" && ["draft", "confirmed"].includes(locked.status));
      if (!allowed)
        throw new DocError(`無法從「${locked.status}」變更為「${target}」`);

      const items = await tx
        .select()
        .from(salesOrderItemsTable)
        .where(eq(salesOrderItemsTable.salesOrderId, id));

      if (target === "confirmed") {
        // 確認出貨承諾 → 扣庫存（虛擬品項不動庫存）
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
              throw new DocError(`庫存不足：${item.productName}（${item.variantName ?? ""}）`);
            await tx.insert(stockMovementsTable).values({
              productId: item.productId,
              variantId: item.variantId,
              type: "sale",
              quantity: -item.quantity,
              stockAfter: dec[0].stock,
              reason: `銷貨出貨（${item.variantName}）`,
              refNo: locked.soNo,
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
            if (dec.length === 0) throw new DocError(`庫存不足：${item.productName}`);
            await tx.insert(stockMovementsTable).values({
              productId: item.productId,
              variantId: null,
              type: "sale",
              quantity: -item.quantity,
              stockAfter: dec[0].stock,
              reason: "銷貨出貨",
              refNo: locked.soNo,
            });
          }
        }
      }

      if (target === "cancelled" && locked.status === "confirmed") {
        // 已扣庫存 → 回補（虛擬品項不動庫存）
        for (const item of items) {
          if (item.isVirtual) continue;
          if (item.variantId != null) {
            const [u] = await tx
              .update(productVariantsTable)
              .set({ stock: sql`${productVariantsTable.stock} + ${item.quantity}` })
              .where(eq(productVariantsTable.id, item.variantId))
              .returning({ stock: productVariantsTable.stock });
            if (u)
              await tx.insert(stockMovementsTable).values({
                productId: item.productId,
                variantId: item.variantId,
                type: "sale",
                quantity: item.quantity,
                stockAfter: u.stock,
                reason: `銷貨取消回補（${item.variantName}）`,
                refNo: locked.soNo,
              });
          } else {
            const [u] = await tx
              .update(productsTable)
              .set({ stock: sql`${productsTable.stock} + ${item.quantity}` })
              .where(eq(productsTable.id, item.productId))
              .returning({ stock: productsTable.stock });
            if (u)
              await tx.insert(stockMovementsTable).values({
                productId: item.productId,
                variantId: null,
                type: "sale",
                quantity: item.quantity,
                stockAfter: u.stock,
                reason: "銷貨取消回補",
                refNo: locked.soNo,
              });
          }
        }
      }

      const sets: Record<string, unknown> = { status: target };
      if (target === "confirmed") sets.confirmedAt = new Date();
      if (target === "shipped") sets.shippedAt = new Date();
      if (target === "completed") sets.completedAt = new Date();
      await tx.update(salesOrdersTable).set(sets).where(eq(salesOrdersTable.id, id));
    });
    // ERP 原生銷貨單確認 → 自動開立 AR 發票 + 傳票（冪等、失敗不阻斷）
    if (target === "confirmed") {
      autoPost(`erp_so_invoice:${id}`, () => postErpSalesOrderInvoice(id));
    }
  } catch (err) {
    if (err instanceof DocError) {
      res.status(400).json({ error: err.message });
      return;
    }
    throw err;
  }
  await audit(req, {
    action: target,
    module: "sales",
    documentType: "sales_order",
    documentId: String(id),
    description: `銷貨單 ${so.soNo} → ${target}`,
  });
  res.json(await loadSO(id));
});

/* ---------- 銷貨退回 ---------- */

function serializeSR(sr: SalesReturn, items: SalesReturnItem[], salesOrderNo?: string | null) {
  return {
    id: sr.id,
    srNo: sr.srNo,
    salesOrderId: sr.salesOrderId,
    salesOrderNo: salesOrderNo ?? null,
    customerId: sr.customerId,
    customerName: sr.customerName,
    status: sr.status,
    totalAmount: sr.totalAmount,
    reason: sr.reason,
    note: sr.note,
    createdAt: sr.createdAt.toISOString(),
    confirmedAt: sr.confirmedAt ? sr.confirmedAt.toISOString() : null,
    items: items.map((i) => ({
      id: i.id,
      productId: i.productId,
      variantId: i.variantId,
      variantName: i.variantName,
      productName: i.productName,
      productCode: i.productCode,
      unitPrice: i.unitPrice,
      quantity: i.quantity,
      isVirtual: i.isVirtual,
    })),
  };
}

async function loadSR(id: number) {
  const [sr] = await db
    .select()
    .from(salesReturnsTable)
    .where(eq(salesReturnsTable.id, id))
    .limit(1);
  if (!sr) return null;
  const items = await db
    .select()
    .from(salesReturnItemsTable)
    .where(eq(salesReturnItemsTable.salesReturnId, id));
  let soNo: string | null = null;
  if (sr.salesOrderId) {
    const [so] = await db
      .select({ soNo: salesOrdersTable.soNo })
      .from(salesOrdersTable)
      .where(eq(salesOrdersTable.id, sr.salesOrderId))
      .limit(1);
    soNo = so?.soNo ?? null;
  }
  return serializeSR(sr, items, soNo);
}

router.get("/erp/sales-returns", requireErpMenu("/sales/returns"), async (req, res) => {
  const status = typeof req.query.status === "string" ? req.query.status : "";
  const conds: SQL[] = [];
  if (["draft", "confirmed", "cancelled"].includes(status))
    conds.push(eq(salesReturnsTable.status, status));
  const rows = await db
    .select()
    .from(salesReturnsTable)
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(salesReturnsTable.id))
    .limit(300);
  const ids = rows.map((r) => r.id);
  const items = ids.length
    ? await db
        .select()
        .from(salesReturnItemsTable)
        .where(inArray(salesReturnItemsTable.salesReturnId, ids))
    : [];
  const soIds = rows.map((r) => r.salesOrderId).filter((v): v is number => v != null);
  const sos = soIds.length
    ? await db
        .select({ id: salesOrdersTable.id, soNo: salesOrdersTable.soNo })
        .from(salesOrdersTable)
        .where(inArray(salesOrdersTable.id, soIds))
    : [];
  const soNoById = new Map(sos.map((s) => [s.id, s.soNo]));
  res.json(
    rows.map((sr) =>
      serializeSR(
        sr,
        items.filter((i) => i.salesReturnId === sr.id),
        sr.salesOrderId ? soNoById.get(sr.salesOrderId) ?? null : null,
      ),
    ),
  );
});

/** 建立銷退單（草稿）：以銷貨單為依據，數量不可超過原單 */
router.post("/erp/sales-returns", requireErpMenu("/sales/returns"), async (req, res) => {
  const parsed = CreateErpSalesReturnBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "銷退單資料不完整" });
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
      line.salesOrderItemId,
      (qtyByItemId.get(line.salesOrderItemId) ?? 0) + line.quantity,
    );
  }
  if (qtyByItemId.size === 0) {
    res.status(400).json({ error: "銷退單沒有品項" });
    return;
  }

  const srNo = `SR${Date.now()}`;
  let result;
  try {
    result = await db.transaction(async (tx) => {
      // 鎖銷貨單主檔，序列化同一張單的併發建立銷退
      const [so] = await tx
        .select()
        .from(salesOrdersTable)
        .where(eq(salesOrdersTable.id, input.salesOrderId))
        .limit(1)
        .for("update");
      if (!so) throw new DocError("銷貨單不存在");
      if (!["shipped", "completed"].includes(so.status)) {
        throw new DocError("僅已出貨或已完成的銷貨單可建立銷退");
      }
      const soItems = await tx
        .select()
        .from(salesOrderItemsTable)
        .where(eq(salesOrderItemsTable.salesOrderId, so.id));
      const soItemById = new Map(soItems.map((i) => [i.id, i]));

      // 已存在（草稿/已確認）銷退的數量（防超退）
      const prevReturns = await tx
        .select({ sr: salesReturnsTable })
        .from(salesReturnsTable)
        .where(
          and(
            eq(salesReturnsTable.salesOrderId, so.id),
            inArray(salesReturnsTable.status, ["draft", "confirmed"]),
          ),
        );
      const prevIds = prevReturns.map((r) => r.sr.id);
      const prevItems = prevIds.length
        ? await tx
            .select()
            .from(salesReturnItemsTable)
            .where(inArray(salesReturnItemsTable.salesReturnId, prevIds))
        : [];
      const returnedQty = new Map<string, number>();
      for (const i of prevItems) {
        const k = `${i.productId}:${i.variantId ?? ""}`;
        returnedQty.set(k, (returnedQty.get(k) ?? 0) + i.quantity);
      }

      const lines: Omit<SalesReturnItem, "id" | "salesReturnId">[] = [];
      for (const [soItemId, quantity] of qtyByItemId) {
        const soItem = soItemById.get(soItemId);
        if (!soItem) throw new DocError("銷退明細與銷貨單不符");
        const k = `${soItem.productId}:${soItem.variantId ?? ""}`;
        const already = returnedQty.get(k) ?? 0;
        if (quantity + already > soItem.quantity) {
          throw new DocError(
            `「${soItem.productName}」退回數量超過原銷貨數量（已退/退回中 ${already}）`,
          );
        }
        returnedQty.set(k, already + quantity);
        lines.push({
          productId: soItem.productId,
          variantId: soItem.variantId,
          variantName: soItem.variantName,
          productName: soItem.productName,
          productCode: soItem.productCode,
          unitPrice: soItem.unitPrice,
          quantity,
          isVirtual: soItem.isVirtual,
        });
      }

      const totalAmount = lines.reduce((s, l) => s + l.unitPrice * l.quantity, 0);
      const [sr] = await tx
        .insert(salesReturnsTable)
        .values({
          srNo,
          salesOrderId: so.id,
          customerId: so.customerId,
          customerName: so.customerName,
          status: "draft",
          totalAmount,
          reason: input.reason ?? null,
          note: input.note ?? null,
          createdBy: req.member!.id,
        })
        .returning();
      const items = await tx
        .insert(salesReturnItemsTable)
        .values(lines.map((l) => ({ ...l, salesReturnId: sr.id })))
        .returning();
      return { sr, items, soNo: so.soNo };
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
    module: "sales",
    documentType: "sales_return",
    documentId: String(result.sr.id),
    description: `建立銷退單 ${srNo}（${result.soNo}）`,
  });
  res.status(201).json(serializeSR(result.sr, result.items, result.soNo));
});

/** 銷退單狀態：draft→confirmed（回補庫存＋同步商城訂單）、draft→cancelled */
router.patch("/erp/sales-returns/:id/status", requireErpMenu("/sales/returns"), async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const parsed = UpdateErpSalesReturnStatusBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "狀態不正確" });
    return;
  }
  const target = parsed.data.status;

  let reindexProductIds: number[] = [];
  try {
    await db.transaction(async (tx) => {
      const [sr] = await tx
        .select()
        .from(salesReturnsTable)
        .where(eq(salesReturnsTable.id, id))
        .for("update")
        .limit(1);
      if (!sr) throw new DocError("找不到此銷退單");
      if (sr.status !== "draft")
        throw new DocError(`無法從「${sr.status}」變更為「${target}」`);

      if (target === "confirmed") {
        const items = await tx
          .select()
          .from(salesReturnItemsTable)
          .where(eq(salesReturnItemsTable.salesReturnId, id));
        reindexProductIds = items.map((i) => i.productId);

        // 取得來源銷貨單並判斷是否「全數退回」（含先前已確認銷退 + 本單）
        let so: SalesOrder | null = null;
        let fullReturn = false;
        if (sr.salesOrderId != null) {
          const [row] = await tx
            .select()
            .from(salesOrdersTable)
            .where(eq(salesOrdersTable.id, sr.salesOrderId))
            .for("update")
            .limit(1);
          so = row ?? null;
          if (so) {
            const soItems = await tx
              .select()
              .from(salesOrderItemsTable)
              .where(eq(salesOrderItemsTable.salesOrderId, so.id));
            const prevConfirmed = await tx
              .select({ sr: salesReturnsTable })
              .from(salesReturnsTable)
              .where(
                and(
                  eq(salesReturnsTable.salesOrderId, so.id),
                  eq(salesReturnsTable.status, "confirmed"),
                ),
              );
            const prevIds = prevConfirmed
              .map((r) => r.sr.id)
              .filter((rid) => rid !== id);
            const prevItems = prevIds.length
              ? await tx
                  .select()
                  .from(salesReturnItemsTable)
                  .where(inArray(salesReturnItemsTable.salesReturnId, prevIds))
              : [];
            const returnedByKey = new Map<string, number>();
            for (const i of [...prevItems, ...items]) {
              const k = `${i.productId}:${i.variantId ?? ""}`;
              returnedByKey.set(k, (returnedByKey.get(k) ?? 0) + i.quantity);
            }
            fullReturn = soItems.every(
              (i) =>
                (returnedByKey.get(`${i.productId}:${i.variantId ?? ""}`) ?? 0) >=
                i.quantity,
            );
          }
        }

        if (so?.orderId != null && fullReturn) {
          // 連動商城訂單且全數退回：交由商城訂單狀態機統一處理
          // （退款、收回點數與佣金、回補庫存、同步銷貨單狀態），此處不另動庫存。
          try {
            await applyOrderStatusChange(so.orderId, "returned", tx);
          } catch (err) {
            if (err instanceof Error && err.message.startsWith("BAD_TRANSITION:")) {
              throw new DocError(
                `商城訂單目前為「${err.message.split(":")[1]}」，無法退貨`,
              );
            }
            throw err;
          }
          await tx
            .update(salesReturnsTable)
            .set({ status: "confirmed", confirmedAt: new Date() })
            .where(eq(salesReturnsTable.id, id));
          return;
        }

        for (const item of items) {
          if (item.isVirtual) continue;
          if (item.variantId != null) {
            const [u] = await tx
              .update(productVariantsTable)
              .set({ stock: sql`${productVariantsTable.stock} + ${item.quantity}` })
              .where(eq(productVariantsTable.id, item.variantId))
              .returning({ stock: productVariantsTable.stock });
            if (!u) throw new DocError(`「${item.productName}」規格不存在，無法入庫`);
            await tx.insert(stockMovementsTable).values({
              productId: item.productId,
              variantId: item.variantId,
              type: "sale_return",
              quantity: item.quantity,
              stockAfter: u.stock,
              reason: `銷貨退回入庫（${item.variantName}）`,
              refNo: sr.srNo,
            });
          } else {
            const [u] = await tx
              .update(productsTable)
              .set({ stock: sql`${productsTable.stock} + ${item.quantity}` })
              .where(eq(productsTable.id, item.productId))
              .returning({ stock: productsTable.stock });
            if (!u) throw new DocError(`「${item.productName}」品項不存在，無法入庫`);
            await tx.insert(stockMovementsTable).values({
              productId: item.productId,
              variantId: null,
              type: "sale_return",
              quantity: item.quantity,
              stockAfter: u.stock,
              reason: "銷貨退回入庫",
              refNo: sr.srNo,
            });
          }
        }

        // 全數退回時將銷貨單標記為退貨；部分退回不變更單據狀態。
        // （連動商城的全退在上方已由訂單狀態機處理並同步銷貨單。）
        if (so && fullReturn) {
          await tx
            .update(salesOrdersTable)
            .set({ status: "returned" })
            .where(eq(salesOrdersTable.id, so.id));
        }
      }

      await tx
        .update(salesReturnsTable)
        .set(
          target === "confirmed"
            ? { status: "confirmed", confirmedAt: new Date() }
            : { status: "cancelled" },
        )
        .where(eq(salesReturnsTable.id, id));
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
    module: "sales",
    documentType: "sales_return",
    documentId: String(id),
    description: `銷退單 #${id} → ${target}`,
  });
  res.json(await loadSR(id));
});

export default router;
