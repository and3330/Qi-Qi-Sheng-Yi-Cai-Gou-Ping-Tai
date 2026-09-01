import { Router, type IRouter } from "express";
import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";

class InsufficientStockError extends Error {
  constructor(public productName: string) {
    super(`Insufficient stock: ${productName}`);
  }
}
class InsufficientWalletError extends Error {
  constructor() {
    super("Insufficient wallet balance");
  }
}
import {
  db,
  ordersTable,
  orderItemsTable,
  productsTable,
  productVariantsTable,
  cartItemsTable,
  stockMovementsTable,
  membersTable,
  walletTransactionsTable,
  institutionsTable,
  institutionWalletTransactionsTable,
  pointTransactionsTable,
  type Order,
  type OrderItem,
} from "@workspace/db";
import { CreateOrderBody, GetOrderParams } from "@workspace/api-zod";
import { reindex } from "../lib/aiIndex";
import {
  ensureErpCustomerForMember,
  createSalesOrderForShopOrder,
} from "../lib/erpSync";
import { requireMember } from "../middlewares/requireMember";
import { WarehouseStockError, allocateSellableStock } from "../lib/warehouseStock";
import { resolveMemberGrade, gradeAllowed } from "../middlewares/optionalMember";

class InsufficientPointsError extends Error {}

const router: IRouter = Router();

router.use("/orders", requireMember);

function serializeOrder(o: Order, items: OrderItem[]) {
  return {
    id: o.id,
    orderNo: o.orderNo,
    status: o.status,
    paymentMethod: o.paymentMethod,
    totalAmount: o.totalAmount,
    shippingAddress: o.shippingAddress,
    receiverName: o.receiverName,
    receiverPhone: o.receiverPhone,
    note: o.note,
    pointsUsed: o.pointsUsed ?? 0,
    pointsEarned: o.pointsEarned ?? 0,
    shipmentPhotos: o.shipmentPhotos ?? [],
    createdAt: o.createdAt.toISOString(),
    items: items.map((i) => ({
      id: i.id,
      productId: i.productId,
      productName: i.productName,
      productCode: i.productCode,
      variantId: i.variantId,
      variantName: i.variantName,
      unitPrice: i.unitPrice,
      quantity: i.quantity,
    })),
  };
}

function tierPrice(
  tier: string,
  p: { priceHospital: number; priceClinic: number; priceConsumer: number },
) {
  if (tier === "hospital") return p.priceHospital;
  if (tier === "clinic") return p.priceClinic;
  return p.priceConsumer;
}

router.get("/orders", async (req, res) => {
  const orders = await db
    .select()
    .from(ordersTable)
    .where(eq(ordersTable.memberId, req.member!.id))
    .orderBy(desc(ordersTable.createdAt));
  const ids = orders.map((o) => o.id);
  const items = ids.length
    ? await db
        .select()
        .from(orderItemsTable)
        .where(inArray(orderItemsTable.orderId, ids))
    : [];
  res.json(
    orders.map((o) =>
      serializeOrder(
        o,
        items.filter((i) => i.orderId === o.id),
      ),
    ),
  );
});

router.post("/orders", async (req, res) => {
  const parsed = CreateOrderBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "訂單資料不完整" });
    return;
  }
  const input = parsed.data;

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

  // 有規格的商品必須指定規格
  const productIdsWithoutVariant = input.items
    .filter((i) => i.variantId == null)
    .map((i) => i.productId);
  const productsRequiringVariant = productIdsWithoutVariant.length
    ? await db
        .select({ productId: productVariantsTable.productId })
        .from(productVariantsTable)
        .where(
          and(
            inArray(productVariantsTable.productId, productIdsWithoutVariant),
            eq(productVariantsTable.isActive, true),
          ),
        )
    : [];
  const requiresVariant = new Set(
    productsRequiringVariant.map((r) => r.productId),
  );

  const memberGrade = await resolveMemberGrade(req.member);
  for (const line of input.items) {
    const p = byId.get(line.productId);
    if (!p) {
      res.status(400).json({ error: `商品不存在 (id=${line.productId})` });
      return;
    }
    if (!p.isActive) {
      res.status(400).json({ error: `「${p.name}」已下架，請自購物車移除後再結帳` });
      return;
    }
    if (!gradeAllowed(p.allowedGrades, memberGrade)) {
      res.status(400).json({ error: `「${p.name}」未開放您的機構分級購買，請自購物車移除後再結帳` });
      return;
    }
    if (line.variantId == null && requiresVariant.has(line.productId)) {
      res.status(400).json({ error: `「${p.name}」有多種規格，請重新選擇規格後再結帳` });
      return;
    }
    if (line.variantId != null) {
      const v = variantById.get(line.variantId);
      if (!v || v.productId !== line.productId) {
        res.status(400).json({ error: `「${p.name}」的規格不存在` });
        return;
      }
      if (!v.isActive) {
        res.status(400).json({ error: `「${p.name}（${v.name}）」已停售，請自購物車移除後再結帳` });
        return;
      }
    }
  }

  const tier = req.member!.tier;
  const lines = input.items.map((line) => {
    const p = byId.get(line.productId)!;
    const v = line.variantId != null ? variantById.get(line.variantId)! : null;
    return {
      productId: p.id,
      variantId: v?.id ?? null,
      variantName: v?.name ?? null,
      productName: p.name,
      productCode: p.code,
      unitPrice: v ? tierPrice(tier, v) : tierPrice(tier, p),
      quantity: line.quantity,
      unitCost: v ? v.costPrice : p.costPrice,
      isVirtual: p.isVirtual,
    };
  });
  const grossAmount = lines.reduce(
    (sum, l) => sum + l.unitPrice * l.quantity,
    0,
  );

  // 點數折抵：1 點 = NT$1，不可超過持有點數與訂單金額
  const pointsToUse = Math.floor(input.pointsToUse ?? 0);
  if (pointsToUse < 0) {
    res.status(400).json({ error: "點數折抵格式不正確" });
    return;
  }
  if (pointsToUse > 0 && pointsToUse > req.member!.points) {
    res.status(400).json({ error: "點數不足" });
    return;
  }
  if (pointsToUse > grossAmount) {
    res.status(400).json({ error: "折抵點數不可超過訂單金額" });
    return;
  }
  const totalAmount = grossAmount - pointsToUse;

  const orderNo = `QB${Date.now()}${String(req.member!.id).padStart(3, "0")}`;

  try {
    const result = await db.transaction(async (tx) => {
      // Atomically decrement stock; fail if insufficient.
      // 多規格商品扣規格庫存，無規格商品扣商品庫存。
      // 分倉：依可售倉（預設倉優先）分配扣減，可售倉合計不足即擋下。
      const stockAfterByKey = new Map<string, number>();
      const allocationsByKey = new Map<string, Array<{ warehouseId: number; quantity: number }>>();
      // 同一商品/規格可能出現多列：先彙總數量，避免分配結果被後列覆蓋
      const aggregatedLines = new Map<
        string,
        { productId: number; variantId: number | null; quantity: number }
      >();
      for (const item of input.items) {
        if (byId.get(item.productId)!.isVirtual) continue; // 虛擬品項不動庫存
        const key = `${item.productId}:${item.variantId ?? ""}`;
        const agg = aggregatedLines.get(key);
        if (agg) agg.quantity += item.quantity;
        else
          aggregatedLines.set(key, {
            productId: item.productId,
            variantId: item.variantId ?? null,
            quantity: item.quantity,
          });
      }
      for (const line of aggregatedLines.values()) {
        {
          const p = byId.get(line.productId)!;
          const v = line.variantId != null ? variantById.get(line.variantId)! : null;
          try {
            const allocations = await allocateSellableStock(tx, {
              productId: line.productId,
              variantId: line.variantId,
              quantity: line.quantity,
            });
            allocationsByKey.set(`${line.productId}:${line.variantId ?? ""}`, allocations);
          } catch (err) {
            if (err instanceof WarehouseStockError)
              throw new InsufficientStockError(v ? `${p.name}（${v.name}）` : p.name);
            throw err;
          }
        }
        if (line.variantId != null) {
          const decremented = await tx
            .update(productVariantsTable)
            .set({ stock: sql`${productVariantsTable.stock} - ${line.quantity}` })
            .where(
              and(
                eq(productVariantsTable.id, line.variantId),
                eq(productVariantsTable.isActive, true),
                gte(productVariantsTable.stock, line.quantity),
              ),
            )
            .returning({ stock: productVariantsTable.stock });
          if (decremented.length === 0) {
            const p = byId.get(line.productId)!;
            const v = variantById.get(line.variantId)!;
            throw new InsufficientStockError(`${p.name}（${v.name}）`);
          }
          stockAfterByKey.set(`${line.productId}:${line.variantId}`, decremented[0].stock);
        } else {
          const decremented = await tx
            .update(productsTable)
            .set({ stock: sql`${productsTable.stock} - ${line.quantity}` })
            .where(
              and(
                eq(productsTable.id, line.productId),
                eq(productsTable.isActive, true),
                gte(productsTable.stock, line.quantity),
              ),
            )
            .returning({ id: productsTable.id, stock: productsTable.stock });
          if (decremented.length === 0) {
            const p = byId.get(line.productId)!;
            throw new InsufficientStockError(p.name);
          }
          stockAfterByKey.set(`${line.productId}:`, decremented[0].stock);
        }
      }

      // 點數折抵：原子扣點（餘額不足則失敗），並寫入點數異動紀錄
      if (pointsToUse > 0) {
        const [deducted] = await tx
          .update(membersTable)
          .set({ points: sql`${membersTable.points} - ${pointsToUse}` })
          .where(
            and(
              eq(membersTable.id, req.member!.id),
              gte(membersTable.points, pointsToUse),
            ),
          )
          .returning({ points: membersTable.points });
        if (!deducted) throw new InsufficientPointsError();
        await tx.insert(pointTransactionsTable).values({
          memberId: req.member!.id,
          type: "redeem",
          delta: -pointsToUse,
          balanceAfter: deducted.points,
          note: `訂單折抵 ${orderNo}`,
        });
      }

      // 錢包付款：已審核綁定院所的機構會員扣「機構共用錢包」，其他扣個人錢包
      let walletSource: "member" | "institution" | null = null;
      if (input.paymentMethod === "wallet") {
        const useInstitutionWallet =
          (req.member!.tier === "hospital" || req.member!.tier === "clinic") &&
          req.member!.boundInstitutionId != null &&
          req.member!.institutionVerified;
        if (useInstitutionWallet) {
          walletSource = "institution";
          const [inst] = await tx
            .select({ walletBalance: institutionsTable.walletBalance })
            .from(institutionsTable)
            .where(eq(institutionsTable.id, req.member!.boundInstitutionId!))
            .for("update")
            .limit(1);
          if (!inst || inst.walletBalance < totalAmount)
            throw new InsufficientWalletError();
          const newBalance = inst.walletBalance - totalAmount;
          await tx
            .update(institutionsTable)
            .set({ walletBalance: newBalance })
            .where(eq(institutionsTable.id, req.member!.boundInstitutionId!));
          await tx.insert(institutionWalletTransactionsTable).values({
            institutionId: req.member!.boundInstitutionId!,
            memberId: req.member!.id,
            type: "payment",
            amount: -totalAmount,
            balanceAfter: newBalance,
            reason: "訂單機構錢包付款",
            refNo: orderNo,
          });
        } else {
          walletSource = "member";
          const [member] = await tx
            .select({ walletBalance: membersTable.walletBalance })
            .from(membersTable)
            .where(eq(membersTable.id, req.member!.id))
            .for("update")
            .limit(1);
          if (!member || member.walletBalance < totalAmount)
            throw new InsufficientWalletError();
          const newBalance = member.walletBalance - totalAmount;
          await tx
            .update(membersTable)
            .set({ walletBalance: newBalance })
            .where(eq(membersTable.id, req.member!.id));
          await tx.insert(walletTransactionsTable).values({
            memberId: req.member!.id,
            type: "payment",
            amount: -totalAmount,
            balanceAfter: newBalance,
            reason: "訂單錢包付款",
            refNo: orderNo,
          });
        }
      }

      const [order] = await tx
        .insert(ordersTable)
        .values({
          orderNo,
          memberId: req.member!.id,
          status: input.paymentMethod === "wallet" ? "paid" : "pending",
          paymentMethod: input.paymentMethod,
          walletSource,
          totalAmount,
          pointsUsed: pointsToUse,
          shippingAddress: input.shippingAddress,
          receiverName: input.receiverName,
          receiverPhone: input.receiverPhone,
          note: input.note ?? null,
        })
        .returning();

      const items = await tx
        .insert(orderItemsTable)
        .values(lines.map((l) => ({ ...l, orderId: order.id })))
        .returning();

      if (pointsToUse > 0) {
        await tx
          .update(pointTransactionsTable)
          .set({ orderId: order.id })
          .where(
            and(
              eq(pointTransactionsTable.memberId, req.member!.id),
              eq(pointTransactionsTable.note, `訂單折抵 ${orderNo}`),
            ),
          );
      }

      // Record sale stock movements（虛擬品項不動庫存；分倉分配逐倉記錄）
      const seenMovementKeys = new Set<string>();
      const stockLines = lines.filter((l) => {
        if (l.isVirtual) return false;
        const key = `${l.productId}:${l.variantId ?? ""}`;
        if (seenMovementKeys.has(key)) return false; // 重複列已彙總於分配結果
        seenMovementKeys.add(key);
        return true;
      });
      if (stockLines.length > 0)
      await tx.insert(stockMovementsTable).values(
        stockLines.flatMap((l) => {
          const key = `${l.productId}:${l.variantId ?? ""}`;
          const stockAfter = stockAfterByKey.get(key) ?? 0;
          const allocations = allocationsByKey.get(key) ?? [];
          return allocations.map((a) => ({
            productId: l.productId,
            variantId: l.variantId,
            type: "sale",
            quantity: -a.quantity,
            stockAfter,
            warehouseId: a.warehouseId,
            reason: l.variantName ? `銷售出貨（${l.variantName}）` : "銷售出貨",
            refNo: orderNo,
          }));
        }),
      );

      // 商城訂單自動產生 ERP 銷貨單（同一交易；order_id 部分唯一索引防重複單據）
      const customerId = await ensureErpCustomerForMember(tx, req.member!);
      await createSalesOrderForShopOrder(
        tx,
        order,
        customerId,
        req.member!.name || req.member!.username,
        lines,
        "shop",
      );

      if (input.clearCart) {
        await tx
          .delete(cartItemsTable)
          .where(
            and(
              eq(cartItemsTable.memberId, req.member!.id),
              inArray(cartItemsTable.productId, productIds),
            ),
          );
      }

      return { order, items };
    });

    reindex("order", result.order.id);
    for (const pid of new Set(productIds)) reindex("product", pid);
    res.status(201).json(serializeOrder(result.order, result.items));
  } catch (err) {
    if (err instanceof InsufficientStockError) {
      res.status(400).json({ error: `庫存不足：${err.productName}` });
      return;
    }
    if (err instanceof InsufficientWalletError) {
      res.status(400).json({ error: "錢包餘額不足" });
      return;
    }
    if (err instanceof InsufficientPointsError) {
      res.status(400).json({ error: "點數不足" });
      return;
    }
    throw err;
  }
});

router.get("/orders/:id", async (req, res) => {
  const parsed = GetOrderParams.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const [order] = await db
    .select()
    .from(ordersTable)
    .where(
      and(
        eq(ordersTable.id, parsed.data.id),
        eq(ordersTable.memberId, req.member!.id),
      ),
    )
    .limit(1);
  if (!order) {
    res.status(404).json({ error: "訂單不存在" });
    return;
  }
  const items = await db
    .select()
    .from(orderItemsTable)
    .where(eq(orderItemsTable.orderId, order.id));
  res.json(serializeOrder(order, items));
});

export default router;
