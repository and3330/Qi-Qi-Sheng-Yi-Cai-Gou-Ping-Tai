import { Router, type IRouter } from "express";
import { and, desc, eq, gte, inArray, sql, type SQL } from "drizzle-orm";
import {
  db,
  quotationsTable,
  quotationItemsTable,
  productsTable,
  productVariantsTable,
  membersTable,
  institutionsTable,
  erpEmployeesTable,
  ordersTable,
  orderItemsTable,
  stockMovementsTable,
  type Quotation,
  type QuotationItem,
} from "@workspace/db";
import {
  CreateAdminQuotationBody,
  UpdateAdminQuotationStatusBody,
} from "@workspace/api-zod";
import { requireOps } from "../middlewares/requireMember";
import { resolveMemberGrade, gradeAllowed } from "../middlewares/optionalMember";
import { reindex } from "../lib/aiIndex";
import { WarehouseStockError, allocateSellableStock, syncMirrorStock } from "../lib/warehouseStock";
import {
  ensureErpCustomerForMember,
  createSalesOrderForShopOrder,
} from "../lib/erpSync";

/** 報價單轉訂單失敗時的可預期錯誤（訊息可直接顯示給使用者） */
export class ConvertError extends Error {}

/**
 * 報價單轉訂單（列鎖交易）：檢查狀態、效期、會員、上架與分級，扣庫存，
 * 建立商城訂單並同步產生 ERP 銷貨單。後台路由、AI 助理與 Bot 連線共用這一份。
 * 回傳新訂單 id；不符合條件時丟出 ConvertError。
 */
export async function convertQuotationToOrder(id: number): Promise<number | null> {
  let createdOrderId: number | null = null;
  await db.transaction(async (tx) => {
      const [q] = await tx
        .select()
        .from(quotationsTable)
        .where(eq(quotationsTable.id, id))
        .for("update")
        .limit(1);
      if (!q) throw new ConvertError("找不到此報價單");
      if (q.status === "converted") throw new ConvertError("此報價單已轉為訂單");
      if (q.status !== "accepted")
        throw new ConvertError("僅「已接受」的報價單可轉訂單（請先將狀態改為已接受）");
      if (q.validUntil && q.validUntil.getTime() < Date.now())
        throw new ConvertError("報價單已過有效期限，無法轉訂單");
      if (q.memberId == null)
        throw new ConvertError("報價單未綁定會員，無法轉訂單（請先編輯綁定會員）");

      const [member] = await tx
        .select()
        .from(membersTable)
        .where(eq(membersTable.id, q.memberId))
        .limit(1);
      if (!member) throw new ConvertError("綁定的會員不存在");

      const items = await tx
        .select()
        .from(quotationItemsTable)
        .where(eq(quotationItemsTable.quotationId, id));
      if (items.length === 0) throw new ConvertError("報價單沒有品項");

      // 商品須上架、規格須啟用，且會員機構分級須符合商品授權範圍
      const prodRows = await tx
        .select()
        .from(productsTable)
        .where(inArray(productsTable.id, items.map((i) => i.productId)));
      const prodById = new Map(prodRows.map((p) => [p.id, p]));
      const varIds = items.map((i) => i.variantId).filter((v): v is number => v != null);
      const varRows = varIds.length
        ? await tx
            .select()
            .from(productVariantsTable)
            .where(inArray(productVariantsTable.id, varIds))
        : [];
      const varById = new Map(varRows.map((v) => [v.id, v]));
      const memberGrade = await resolveMemberGrade(member);
      for (const item of items) {
        const p = prodById.get(item.productId);
        if (!p || !p.isActive)
          throw new ConvertError(`「${item.productName}」已下架，無法轉訂單`);
        if (!gradeAllowed(p.allowedGrades, memberGrade))
          throw new ConvertError(
            `「${item.productName}」未開放此會員的機構分級購買，無法轉訂單`,
          );
        if (item.variantId != null) {
          const v = varById.get(item.variantId);
          if (!v || !v.isActive)
            throw new ConvertError(
              `「${item.productName}（${item.variantName ?? ""}）」已停售，無法轉訂單`,
            );
        }
      }

      const orderNo = `QB${Date.now()}${String(member.id).padStart(3, "0")}`;

      // 扣庫存（多規格扣規格、無規格扣主商品；虛擬品項不動庫存）
      const stockAfterByItem = new Map<number, number>();
      const allocationsByItem = new Map<number, Array<{ warehouseId: number; quantity: number }>>();
      for (const item of items) {
        if (prodById.get(item.productId)?.isVirtual) continue;
        // 分倉：依可售倉分配扣減
        try {
          const allocations = await allocateSellableStock(tx, {
            productId: item.productId,
            variantId: item.variantId,
            quantity: item.quantity,
          });
          allocationsByItem.set(item.id, allocations);
        } catch (err) {
          if (err instanceof WarehouseStockError)
            throw new ConvertError(
              `庫存不足：${item.productName}${item.variantName ? `（${item.variantName}）` : ""}`,
            );
          throw err;
        }
        const mirrorTotal = await syncMirrorStock(tx, {
          productId: item.productId,
          variantId: item.variantId,
        });
        stockAfterByItem.set(item.id, mirrorTotal);
      }

      // 成本快照
      const productRows = await tx
        .select()
        .from(productsTable)
        .where(inArray(productsTable.id, items.map((i) => i.productId)));
      const costByProduct = new Map(productRows.map((p) => [p.id, p.costPrice]));
      const vIds = items.map((i) => i.variantId).filter((v): v is number => v != null);
      const variantRows = vIds.length
        ? await tx
            .select()
            .from(productVariantsTable)
            .where(inArray(productVariantsTable.id, vIds))
        : [];
      const costByVariant = new Map(variantRows.map((v) => [v.id, v.costPrice]));

      const [order] = await tx
        .insert(ordersTable)
        .values({
          orderNo,
          memberId: member.id,
          status: "pending",
          paymentMethod: "bank_transfer",
          walletSource: null,
          totalAmount: q.totalAmount,
          shippingAddress: null,
          receiverName: member.name,
          receiverPhone: member.phone,
          note: `由報價單 ${q.quoteNo} 轉入`,
        })
        .returning();
      createdOrderId = order.id;

      await tx.insert(orderItemsTable).values(
        items.map((i) => ({
          orderId: order.id,
          productId: i.productId,
          variantId: i.variantId,
          variantName: i.variantName,
          productName: i.productName,
          productCode: i.productCode,
          unitPrice: i.unitPrice,
          quantity: i.quantity,
          unitCost:
            i.variantId != null
              ? costByVariant.get(i.variantId) ?? 0
              : costByProduct.get(i.productId) ?? 0,
        })),
      );

      const stockItems = items.filter(
        (i) => !prodById.get(i.productId)?.isVirtual,
      );
      if (stockItems.length > 0)
      await tx.insert(stockMovementsTable).values(
        stockItems.flatMap((i) => {
          const stockAfter = stockAfterByItem.get(i.id) ?? 0;
          const allocations = allocationsByItem.get(i.id) ?? [];
          return allocations.map((a) => ({
            productId: i.productId,
            variantId: i.variantId,
            type: "sale",
            quantity: -a.quantity,
            stockAfter,
            warehouseId: a.warehouseId,
            reason: i.variantName
              ? `報價單轉訂單（${i.variantName}）`
              : "報價單轉訂單",
            refNo: orderNo,
          }));
        }),
      );

      // 轉單訂單同步產生 ERP 銷貨單
      const customerId = await ensureErpCustomerForMember(tx, member);
      await createSalesOrderForShopOrder(
        tx,
        order,
        customerId,
        member.name || member.username,
        items.map((i) => ({
          productId: i.productId,
          variantId: i.variantId,
          variantName: i.variantName,
          productName: i.productName,
          productCode: i.productCode,
          unitPrice: i.unitPrice,
          quantity: i.quantity,
          unitCost:
            i.variantId != null
              ? costByVariant.get(i.variantId) ?? 0
              : costByProduct.get(i.productId) ?? 0,
          isVirtual: prodById.get(i.productId)?.isVirtual ?? false,
        })),
        "quotation",
        q.creatorEmployeeId,
      );

      await tx
        .update(quotationsTable)
        .set({
          status: "converted",
          convertedOrderId: order.id,
          updatedAt: new Date(),
        })
        .where(eq(quotationsTable.id, id));
    });
  if (createdOrderId != null) reindex("order", createdOrderId);
  return createdOrderId;
}

/**
 * 報價單路由可同時掛在 /admin/quotations（商城後台）與 /erp/quotations（ERP），
 * 共用同一套單據規則（狀態機、轉單列鎖、分級檢查）。
 */
export function registerQuotationRoutes(
  router: IRouter,
  base: string,
  guard: import("express").RequestHandler,
) {


function serializeQuotation(
  q: Quotation,
  items: QuotationItem[],
  extra?: {
    memberName?: string | null;
    institutionName?: string | null;
    convertedOrderNo?: string | null;
  },
) {
  return {
    id: q.id,
    quoteNo: q.quoteNo,
    customerName: q.customerName,
    memberId: q.memberId,
    memberName: extra?.memberName ?? null,
    institutionId: q.institutionId,
    institutionName: extra?.institutionName ?? null,
    status: q.status,
    totalAmount: q.totalAmount,
    validUntil: q.validUntil ? q.validUntil.toISOString().slice(0, 10) : null,
    note: q.note,
    creatorEmployeeId: q.creatorEmployeeId,
    convertedOrderId: q.convertedOrderId,
    convertedOrderNo: extra?.convertedOrderNo ?? null,
    createdAt: q.createdAt.toISOString(),
    items: items.map((i) => ({
      id: i.id,
      productId: i.productId,
      variantId: i.variantId,
      variantName: i.variantName,
      productName: i.productName,
      productCode: i.productCode,
      unitPrice: i.unitPrice,
      quantity: i.quantity,
    })),
  };
}

async function loadQuotation(id: number) {
  const [q] = await db
    .select()
    .from(quotationsTable)
    .where(eq(quotationsTable.id, id))
    .limit(1);
  if (!q) return null;
  const items = await db
    .select()
    .from(quotationItemsTable)
    .where(eq(quotationItemsTable.quotationId, id));
  const [member] = q.memberId
    ? await db
        .select({ name: membersTable.name })
        .from(membersTable)
        .where(eq(membersTable.id, q.memberId))
        .limit(1)
    : [];
  const [inst] = q.institutionId
    ? await db
        .select({ name: institutionsTable.name })
        .from(institutionsTable)
        .where(eq(institutionsTable.id, q.institutionId))
        .limit(1)
    : [];
  const [order] = q.convertedOrderId
    ? await db
        .select({ orderNo: ordersTable.orderNo })
        .from(ordersTable)
        .where(eq(ordersTable.id, q.convertedOrderId))
        .limit(1)
    : [];
  return serializeQuotation(q, items, {
    memberName: member?.name ?? null,
    institutionName: inst?.name ?? null,
    convertedOrderNo: order?.orderNo ?? null,
  });
}

router.get(base, guard, async (req, res) => {
  const status = typeof req.query.status === "string" ? req.query.status : "";
  const conditions: SQL[] = [];
  if (["draft", "sent", "accepted", "converted", "cancelled"].includes(status))
    conditions.push(eq(quotationsTable.status, status));

  const rows = await db
    .select()
    .from(quotationsTable)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(quotationsTable.createdAt))
    .limit(300);
  const ids = rows.map((r) => r.id);
  const items = ids.length
    ? await db
        .select()
        .from(quotationItemsTable)
        .where(inArray(quotationItemsTable.quotationId, ids))
    : [];
  const memberIds = rows.map((r) => r.memberId).filter((v): v is number => v != null);
  const instIds = rows.map((r) => r.institutionId).filter((v): v is number => v != null);
  const members = memberIds.length
    ? await db
        .select({ id: membersTable.id, name: membersTable.name })
        .from(membersTable)
        .where(inArray(membersTable.id, memberIds))
    : [];
  const insts = instIds.length
    ? await db
        .select({ id: institutionsTable.id, name: institutionsTable.name })
        .from(institutionsTable)
        .where(inArray(institutionsTable.id, instIds))
    : [];
  const orderIds = rows.map((r) => r.convertedOrderId).filter((v): v is number => v != null);
  const orders = orderIds.length
    ? await db
        .select({ id: ordersTable.id, orderNo: ordersTable.orderNo })
        .from(ordersTable)
        .where(inArray(ordersTable.id, orderIds))
    : [];
  const memberName = new Map(members.map((m) => [m.id, m.name]));
  const instName = new Map(insts.map((i) => [i.id, i.name]));
  const orderNo = new Map(orders.map((o) => [o.id, o.orderNo]));

  res.json(
    rows.map((q) =>
      serializeQuotation(
        q,
        items.filter((i) => i.quotationId === q.id),
        {
          memberName: q.memberId ? memberName.get(q.memberId) ?? null : null,
          institutionName: q.institutionId ? instName.get(q.institutionId) ?? null : null,
          convertedOrderNo: q.convertedOrderId ? orderNo.get(q.convertedOrderId) ?? null : null,
        },
      ),
    ),
  );
});

router.post(base, guard, async (req, res) => {
  const parsed = CreateAdminQuotationBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "報價單資料不完整" });
    return;
  }
  const input = parsed.data;

  if (input.memberId != null) {
    const [m] = await db
      .select({ id: membersTable.id })
      .from(membersTable)
      .where(eq(membersTable.id, input.memberId))
      .limit(1);
    if (!m) {
      res.status(400).json({ error: "綁定的會員不存在" });
      return;
    }
  }
  if (input.institutionId != null) {
    const [i] = await db
      .select({ id: institutionsTable.id })
      .from(institutionsTable)
      .where(eq(institutionsTable.id, input.institutionId))
      .limit(1);
    if (!i) {
      res.status(400).json({ error: "綁定的機構不存在" });
      return;
    }
  }
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

  // 有啟用規格的商品必須指定規格（轉訂單時才能正確扣庫存）
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
      res.status(400).json({ error: `商品不存在 (id=${line.productId})` });
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

  const totalAmount = input.items.reduce(
    (sum, l) => sum + l.unitPrice * l.quantity,
    0,
  );
  const quoteNo = `QT${Date.now()}`;

  const result = await db.transaction(async (tx) => {
    const [q] = await tx
      .insert(quotationsTable)
      .values({
        quoteNo,
        customerName: input.customerName,
        memberId: input.memberId ?? null,
        institutionId: input.institutionId ?? null,
        status: "draft",
        totalAmount,
        validUntil: input.validUntil ? new Date(input.validUntil) : null,
        note: input.note ?? null,
        createdBy: req.member!.id,
        creatorEmployeeId: input.creatorEmployeeId ?? null,
      })
      .returning();
    const items = await tx
      .insert(quotationItemsTable)
      .values(
        input.items.map((l) => {
          const p = byId.get(l.productId)!;
          const v = l.variantId != null ? variantById.get(l.variantId)! : null;
          return {
            quotationId: q.id,
            productId: p.id,
            variantId: v?.id ?? null,
            variantName: v?.name ?? null,
            productName: p.name,
            productCode: p.code,
            unitPrice: l.unitPrice,
            quantity: l.quantity,
          };
        }),
      )
      .returning();
    return { q, items };
  });

  res.status(201).json(serializeQuotation(result.q, result.items));
});

router.get(`${base}/:id`, guard, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const q = await loadQuotation(id);
  if (!q) {
    res.status(404).json({ error: "找不到此報價單" });
    return;
  }
  res.json(q);
});

router.patch(`${base}/:id/status`, guard, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const parsed = UpdateAdminQuotationStatusBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "狀態不正確" });
    return;
  }
  const target = parsed.data.status;
  const [q] = await db
    .select()
    .from(quotationsTable)
    .where(eq(quotationsTable.id, id))
    .limit(1);
  if (!q) {
    res.status(404).json({ error: "找不到此報價單" });
    return;
  }
  const allowed =
    (target === "sent" && q.status === "draft") ||
    (target === "accepted" && (q.status === "draft" || q.status === "sent")) ||
    (target === "cancelled" &&
      ["draft", "sent", "accepted"].includes(q.status));
  if (!allowed) {
    res.status(400).json({ error: `無法從「${q.status}」變更為「${target}」` });
    return;
  }
  const [changed] = await db
    .update(quotationsTable)
    .set({ status: target, updatedAt: new Date() })
    .where(and(eq(quotationsTable.id, id), eq(quotationsTable.status, q.status)))
    .returning({ id: quotationsTable.id });
  if (!changed) {
    res.status(409).json({ error: "報價單狀態已變更，請重新整理後再試" });
    return;
  }
  res.json(await loadQuotation(id));
});

/** 報價單轉訂單：依報價價格建立訂單（匯款、待付款）並扣庫存 */
router.post(`${base}/:id/convert`, guard, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }

  try {
    await convertQuotationToOrder(id);
  } catch (err) {
    if (err instanceof ConvertError) {
      res.status(400).json({ error: err.message });
      return;
    }
    throw err;
  }
  res.json(await loadQuotation(id));
});

}

const router: IRouter = Router();
registerQuotationRoutes(router, "/admin/quotations", requireOps);
export default router;
