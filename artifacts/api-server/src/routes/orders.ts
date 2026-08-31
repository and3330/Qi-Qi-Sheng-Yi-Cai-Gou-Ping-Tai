import { Router, type IRouter } from "express";
import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";

class InsufficientStockError extends Error {
  constructor(public productName: string) {
    super(`Insufficient stock: ${productName}`);
  }
}
import {
  db,
  ordersTable,
  orderItemsTable,
  productsTable,
  cartItemsTable,
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
    if (!byId.has(line.productId)) {
      res.status(400).json({ error: `商品不存在 (id=${line.productId})` });
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
      for (const line of input.items) {
        const decremented = await tx
          .update(productsTable)
          .set({ stock: sql`${productsTable.stock} - ${line.quantity}` })
          .where(
            and(
              eq(productsTable.id, line.productId),
              gte(productsTable.stock, line.quantity),
            ),
          )
          .returning({ id: productsTable.id });
        if (decremented.length === 0) {
          const p = byId.get(line.productId)!;
          throw new InsufficientStockError(p.name);
        }
      }

      const [order] = await tx
        .insert(ordersTable)
        .values({
          orderNo,
          memberId: req.member!.id,
          status: "pending",
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
