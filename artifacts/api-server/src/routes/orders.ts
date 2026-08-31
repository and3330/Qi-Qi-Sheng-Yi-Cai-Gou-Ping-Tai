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
  cartItemsTable,
  stockMovementsTable,
  membersTable,
  walletTransactionsTable,
  type Order,
  type OrderItem,
} from "@workspace/db";
import { CreateOrderBody, GetOrderParams } from "@workspace/api-zod";
import { requireMember } from "../middlewares/requireMember";

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
    createdAt: o.createdAt.toISOString(),
    items: items.map((i) => ({
      id: i.id,
      productId: i.productId,
      productName: i.productName,
      productCode: i.productCode,
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
  }

  const tier = req.member!.tier;
  const lines = input.items.map((line) => {
    const p = byId.get(line.productId)!;
    return {
      productId: p.id,
      productName: p.name,
      productCode: p.code,
      unitPrice: tierPrice(tier, p),
      quantity: line.quantity,
      unitCost: p.costPrice,
    };
  });
  const totalAmount = lines.reduce(
    (sum, l) => sum + l.unitPrice * l.quantity,
    0,
  );

  const orderNo = `QB${Date.now()}${String(req.member!.id).padStart(3, "0")}`;

  try {
    const result = await db.transaction(async (tx) => {
      // Atomically decrement stock; fail if insufficient.
      const stockAfterById = new Map<number, number>();
      for (const line of input.items) {
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
        stockAfterById.set(line.productId, decremented[0].stock);
      }

      // 錢包付款：鎖定會員列、檢查餘額並扣款（餘額不可為負）
      if (input.paymentMethod === "wallet") {
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

      const [order] = await tx
        .insert(ordersTable)
        .values({
          orderNo,
          memberId: req.member!.id,
          status: input.paymentMethod === "wallet" ? "paid" : "pending",
          paymentMethod: input.paymentMethod,
          totalAmount,
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

      // Record sale stock movements
      await tx.insert(stockMovementsTable).values(
        lines.map((l) => ({
          productId: l.productId,
          type: "sale",
          quantity: -l.quantity,
          stockAfter: stockAfterById.get(l.productId) ?? 0,
          reason: "銷售出貨",
          refNo: orderNo,
        })),
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
