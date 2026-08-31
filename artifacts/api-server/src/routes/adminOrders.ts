import { Router, type IRouter } from "express";
import { and, desc, eq, gte, ilike, inArray, lte, or, sql, type SQL } from "drizzle-orm";
import {
  db,
  ordersTable,
  orderItemsTable,
  membersTable,
  productsTable,
  stockMovementsTable,
  purchaseOrdersTable,
  purchaseOrderItemsTable,
  profitRulesTable,
  profitShareRecordsTable,
  walletTransactionsTable,
  type Order,
  type OrderItem,
} from "@workspace/db";
import { UpdateAdminOrderStatusBody } from "@workspace/api-zod";
import { requireAdmin } from "../middlewares/requireMember";

const router: IRouter = Router();

function serializeAdminOrder(
  o: Order,
  member: { name: string; tier: string },
  items: OrderItem[],
) {
  return {
    id: o.id,
    orderNo: o.orderNo,
    memberId: o.memberId,
    memberName: member.name,
    memberTier: member.tier,
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

router.get("/admin/orders", requireAdmin, async (req, res) => {
  const status = typeof req.query.status === "string" ? req.query.status : "";
  const search =
    typeof req.query.search === "string" ? req.query.search.trim() : "";

  const conditions: SQL[] = [];
  if (["pending", "paid", "shipped", "completed", "cancelled"].includes(status))
    conditions.push(eq(ordersTable.status, status));
  if (search) {
    conditions.push(
      or(
        ilike(ordersTable.orderNo, `%${search}%`),
        ilike(membersTable.name, `%${search}%`),
      )!,
    );
  }

  const rows = await db
    .select({
      order: ordersTable,
      memberName: membersTable.name,
      memberTier: membersTable.tier,
    })
    .from(ordersTable)
    .innerJoin(membersTable, eq(ordersTable.memberId, membersTable.id))
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(ordersTable.createdAt))
    .limit(300);

  const ids = rows.map((r) => r.order.id);
  const items = ids.length
    ? await db
        .select()
        .from(orderItemsTable)
        .where(inArray(orderItemsTable.orderId, ids))
    : [];

  res.json(
    rows.map((r) =>
      serializeAdminOrder(
        r.order,
        { name: r.memberName, tier: r.memberTier },
        items.filter((i) => i.orderId === r.order.id),
      ),
    ),
  );
});

async function loadAdminOrder(id: number) {
  const [row] = await db
    .select({
      order: ordersTable,
      memberName: membersTable.name,
      memberTier: membersTable.tier,
    })
    .from(ordersTable)
    .innerJoin(membersTable, eq(ordersTable.memberId, membersTable.id))
    .where(eq(ordersTable.id, id))
    .limit(1);
  if (!row) return null;
  const items = await db
    .select()
    .from(orderItemsTable)
    .where(eq(orderItemsTable.orderId, id));
  return serializeAdminOrder(
    row.order,
    { name: row.memberName, tier: row.memberTier },
    items,
  );
}

router.get("/admin/orders/:id", requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const order = await loadAdminOrder(id);
  if (!order) {
    res.status(404).json({ error: "找不到此訂單" });
    return;
  }
  res.json(order);
});

// Allowed forward transitions; cancelled restocks the items.
const ORDER_TRANSITIONS: Record<string, string[]> = {
  pending: ["paid", "cancelled"],
  paid: ["shipped", "cancelled"],
  shipped: ["completed"],
  completed: [],
  cancelled: [],
};

router.patch("/admin/orders/:id/status", requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const parsed = UpdateAdminOrderStatusBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "狀態不正確" });
    return;
  }
  const target = parsed.data.status;

  try {
    await db.transaction(async (tx) => {
      const [order] = await tx
        .select()
        .from(ordersTable)
        .where(eq(ordersTable.id, id))
        .for("update")
        .limit(1);
      if (!order) throw new Error("ORDER_NOT_FOUND");
      if (!ORDER_TRANSITIONS[order.status]?.includes(target))
        throw new Error(`BAD_TRANSITION:${order.status}`);

      if (target === "completed") {
        // 訂單完成 → 依分潤規則入帳（會員層級優先於「全部」規則）
        const [existing] = await tx
          .select({ id: profitShareRecordsTable.id })
          .from(profitShareRecordsTable)
          .where(eq(profitShareRecordsTable.orderId, id))
          .limit(1);
        if (!existing) {
          const [member] = await tx
            .select()
            .from(membersTable)
            .where(eq(membersTable.id, order.memberId))
            .for("update")
            .limit(1);
          if (member) {
            // 確定性選擇：身份專屬優先於「全部」，同身份取最新建立的規則
            // （建立/更新 API 亦強制同身份僅一條啟用規則）
            const rules = await tx
              .select()
              .from(profitRulesTable)
              .where(eq(profitRulesTable.isActive, true))
              .orderBy(
                desc(profitRulesTable.createdAt),
                desc(profitRulesTable.id),
              );
            const rule =
              rules.find((r) => r.tier === member.tier) ??
              rules.find((r) => r.tier === "all");
            if (rule && rule.percentBps > 0) {
              const amount = Math.floor(
                (order.totalAmount * rule.percentBps) / 10000,
              );
              if (amount > 0) {
                const newBalance = member.walletBalance + amount;
                await tx
                  .update(membersTable)
                  .set({ walletBalance: newBalance })
                  .where(eq(membersTable.id, member.id));
                await tx.insert(walletTransactionsTable).values({
                  memberId: member.id,
                  type: "profit_share",
                  amount,
                  balanceAfter: newBalance,
                  reason: `利潤分享（${rule.name}）`,
                  refNo: order.orderNo,
                });
                await tx.insert(profitShareRecordsTable).values({
                  orderId: order.id,
                  orderNo: order.orderNo,
                  memberId: member.id,
                  ruleId: rule.id,
                  ruleName: rule.name,
                  percentBps: rule.percentBps,
                  baseAmount: order.totalAmount,
                  amount,
                });
              }
            }
          }
        }
      }

      if (target === "cancelled") {
        // 錢包已付款的訂單取消 → 退款回錢包
        if (order.paymentMethod === "wallet" && order.status !== "pending") {
          const [member] = await tx
            .select()
            .from(membersTable)
            .where(eq(membersTable.id, order.memberId))
            .for("update")
            .limit(1);
          if (member) {
            const newBalance = member.walletBalance + order.totalAmount;
            await tx
              .update(membersTable)
              .set({ walletBalance: newBalance })
              .where(eq(membersTable.id, member.id));
            await tx.insert(walletTransactionsTable).values({
              memberId: member.id,
              type: "refund",
              amount: order.totalAmount,
              balanceAfter: newBalance,
              reason: "訂單取消退款",
              refNo: order.orderNo,
            });
          }
        }
        // Restock the order items and record movements
        const items = await tx
          .select()
          .from(orderItemsTable)
          .where(eq(orderItemsTable.orderId, id));
        for (const item of items) {
          const [updated] = await tx
            .update(productsTable)
            .set({ stock: sql`${productsTable.stock} + ${item.quantity}` })
            .where(eq(productsTable.id, item.productId))
            .returning();
          if (!updated) continue;
          await tx.insert(stockMovementsTable).values({
            productId: item.productId,
            type: "sale",
            quantity: item.quantity,
            stockAfter: updated.stock,
            reason: "訂單取消回補",
            refNo: order.orderNo,
          });
        }
      }

      await tx
        .update(ordersTable)
        .set({ status: target })
        .where(eq(ordersTable.id, id));
    });
  } catch (err) {
    if (err instanceof Error && err.message === "ORDER_NOT_FOUND") {
      res.status(404).json({ error: "找不到此訂單" });
      return;
    }
    if (err instanceof Error && err.message.startsWith("BAD_TRANSITION:")) {
      res.status(400).json({
        error: `無法從「${err.message.split(":")[1]}」變更為「${target}」`,
      });
      return;
    }
    throw err;
  }

  res.json(await loadAdminOrder(id));
});

router.get("/admin/reports/inventory", requireAdmin, async (req, res) => {
  const from = typeof req.query.from === "string" ? req.query.from : "";
  const to = typeof req.query.to === "string" ? req.query.to : "";

  const conditions: SQL[] = [];
  if (from) conditions.push(gte(stockMovementsTable.createdAt, new Date(from)));
  if (to) {
    const end = new Date(to);
    end.setDate(end.getDate() + 1);
    conditions.push(lte(stockMovementsTable.createdAt, end));
  }

  const movements = await db
    .select({
      productId: stockMovementsTable.productId,
      type: stockMovementsTable.type,
      quantity: stockMovementsTable.quantity,
    })
    .from(stockMovementsTable)
    .where(conditions.length ? and(...conditions) : undefined);

  const products = await db
    .select({
      id: productsTable.id,
      name: productsTable.name,
      code: productsTable.code,
      stock: productsTable.stock,
      costPrice: productsTable.costPrice,
    })
    .from(productsTable);
  const productById = new Map(products.map((p) => [p.id, p]));


  // Sale amounts from order items within the period (based on order creation)
  const orderConditions: SQL[] = [
    sql`${ordersTable.status} <> 'cancelled'`,
  ];
  if (from) orderConditions.push(gte(ordersTable.createdAt, new Date(from)));
  if (to) {
    const end = new Date(to);
    end.setDate(end.getDate() + 1);
    orderConditions.push(lte(ordersTable.createdAt, end));
  }
  const soldLines = await db
    .select({
      productId: orderItemsTable.productId,
      quantity: orderItemsTable.quantity,
      amount: sql<number>`${orderItemsTable.unitPrice} * ${orderItemsTable.quantity}`,
    })
    .from(orderItemsTable)
    .innerJoin(ordersTable, eq(orderItemsTable.orderId, ordersTable.id))
    .where(and(...orderConditions));

  // Purchase amounts from received PO movements: use refNo→unitCost not stored;
  // approximate purchase amount via purchase movements * product costPrice is
  // wrong when cost changes. Instead join PO items received in the period.
  type Row = {
    productId: number;
    purchasedQty: number;
    purchasedAmount: number;
    soldQty: number;
    soldAmount: number;
    adjustedQty: number;
  };
  const rowsMap = new Map<number, Row>();
  const rowFor = (pid: number): Row => {
    let r = rowsMap.get(pid);
    if (!r) {
      r = {
        productId: pid,
        purchasedQty: 0,
        purchasedAmount: 0,
        soldQty: 0,
        soldAmount: 0,
        adjustedQty: 0,
      };
      rowsMap.set(pid, r);
    }
    return r;
  };

  for (const m of movements) {
    const r = rowFor(m.productId);
    if (m.type === "purchase") r.purchasedQty += m.quantity;
    else if (m.type === "adjust") r.adjustedQty += m.quantity;
  }

  for (const line of soldLines) {
    const r = rowFor(line.productId);
    r.soldQty += line.quantity;
    r.soldAmount += Number(line.amount);
  }

  // Purchase amounts: PO items of POs received in the period
  const poDateConds: SQL[] = [eq(purchaseOrdersTable.status, "received")];
  if (from)
    poDateConds.push(gte(purchaseOrdersTable.receivedAt, new Date(from)));
  if (to) {
    const end = new Date(to);
    end.setDate(end.getDate() + 1);
    poDateConds.push(lte(purchaseOrdersTable.receivedAt, end));
  }
  const poLines = await db
    .select({
      productId: purchaseOrderItemsTable.productId,
      amount: sql<number>`${purchaseOrderItemsTable.unitCost} * ${purchaseOrderItemsTable.quantity}`,
    })
    .from(purchaseOrderItemsTable)
    .innerJoin(
      purchaseOrdersTable,
      eq(purchaseOrderItemsTable.purchaseOrderId, purchaseOrdersTable.id),
    )
    .where(and(...poDateConds));
  for (const line of poLines) {
    rowFor(line.productId).purchasedAmount += Number(line.amount);
  }

  const rows = [...rowsMap.values()]
    .map((r) => {
      const p = productById.get(r.productId);
      return {
        ...r,
        productName: p?.name ?? `#${r.productId}`,
        productCode: p?.code ?? "-",
        currentStock: p?.stock ?? 0,
      };
    })
    .sort((a, b) => a.productCode.localeCompare(b.productCode));

  res.json({
    from: from || null,
    to: to || null,
    purchaseTotalQty: rows.reduce((s, r) => s + r.purchasedQty, 0),
    purchaseTotalAmount: rows.reduce((s, r) => s + r.purchasedAmount, 0),
    saleTotalQty: rows.reduce((s, r) => s + r.soldQty, 0),
    saleTotalAmount: rows.reduce((s, r) => s + r.soldAmount, 0),
    adjustTotalQty: rows.reduce((s, r) => s + r.adjustedQty, 0),
    rows,
  });
});

export default router;
