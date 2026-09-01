import { and, desc, eq, gt, gte, inArray, lte, lt, sql } from "drizzle-orm";
import { resolveMemberGrade, gradeAllowed } from "../middlewares/optionalMember";
import {
  db,
  productsTable,
  productVariantsTable,
  ordersTable,
  orderItemsTable,
  membersTable,
  institutionsTable,
  institutionWalletTransactionsTable,
  articlesTable,
  profitShareRecordsTable,
  stockMovementsTable,
  aiActionLogsTable,
} from "@workspace/db";
import { applyOrderStatusChange } from "../routes/adminOrders";
import { reindex, searchDocuments } from "./aiIndex";
import {
  WarehouseStockError,
  getDefaultWarehouseId,
  adjustWarehouseStock,
  allocateSellableStock,
} from "./warehouseStock";

/**
 * AI 行政助理工具集
 * 讀取類：直接查詢內建 ERP 資料（進銷存、財務、訂單、佣金）
 * 操作類：執行後寫入 ai_action_logs 稽核；必須先經管理者於專用確認端點明確確認
 */

function tierPrice(
  tier: string,
  p: { priceHospital: number; priceClinic: number; priceConsumer: number },
) {
  if (tier === "hospital") return p.priceHospital;
  if (tier === "clinic") return p.priceClinic;
  return p.priceConsumer;
}

function parseDate(s: string | undefined, fallback: Date): Date {
  if (!s) return fallback;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? fallback : d;
}

// ---------- 讀取類 ----------

async function searchKnowledge(args: { query: string; kinds?: string[] }) {
  const rows = await searchDocuments(args.query, {
    scope: "staff",
    kinds: args.kinds,
    limit: 8,
  });
  return rows.map((r) => ({ kind: r.entityKind, id: r.entityId, title: r.title, content: r.content.slice(0, 800) }));
}

async function salesReport(args: { from?: string; to?: string; groupBy?: string }) {
  const from = parseDate(args.from, new Date(Date.now() - 30 * 86400000));
  const to = parseDate(args.to, new Date());
  to.setHours(23, 59, 59, 999);
  const base = and(
    gte(ordersTable.createdAt, from),
    lte(ordersTable.createdAt, to),
    inArray(ordersTable.status, ["paid", "shipped", "completed"]),
  );
  if (args.groupBy === "product") {
    return db
      .select({
        productName: orderItemsTable.productName,
        variantName: orderItemsTable.variantName,
        quantity: sql<number>`SUM(${orderItemsTable.quantity})::int`,
        revenue: sql<number>`SUM(${orderItemsTable.quantity} * ${orderItemsTable.unitPrice})::int`,
      })
      .from(orderItemsTable)
      .innerJoin(ordersTable, eq(orderItemsTable.orderId, ordersTable.id))
      .where(base)
      .groupBy(orderItemsTable.productName, orderItemsTable.variantName)
      .orderBy(desc(sql`SUM(${orderItemsTable.quantity} * ${orderItemsTable.unitPrice})`));
  }
  if (args.groupBy === "institution") {
    return db
      .select({
        institution: sql<string>`COALESCE(${institutionsTable.name}, '未綁定院所')`,
        orders: sql<number>`COUNT(DISTINCT ${ordersTable.id})::int`,
        revenue: sql<number>`SUM(${ordersTable.totalAmount})::int`,
      })
      .from(ordersTable)
      .innerJoin(membersTable, eq(ordersTable.memberId, membersTable.id))
      .leftJoin(institutionsTable, eq(membersTable.boundInstitutionId, institutionsTable.id))
      .where(base)
      .groupBy(sql`COALESCE(${institutionsTable.name}, '未綁定院所')`)
      .orderBy(desc(sql`SUM(${ordersTable.totalAmount})`));
  }
  return db
    .select({
      day: sql<string>`TO_CHAR(${ordersTable.createdAt}, 'YYYY-MM-DD')`,
      orders: sql<number>`COUNT(*)::int`,
      revenue: sql<number>`SUM(${ordersTable.totalAmount})::int`,
    })
    .from(ordersTable)
    .where(base)
    .groupBy(sql`TO_CHAR(${ordersTable.createdAt}, 'YYYY-MM-DD')`)
    .orderBy(sql`TO_CHAR(${ordersTable.createdAt}, 'YYYY-MM-DD')`);
}

async function commissionReport(args: { from?: string; to?: string; groupBy?: string }) {
  const from = parseDate(args.from, new Date(Date.now() - 30 * 86400000));
  const to = parseDate(args.to, new Date());
  to.setHours(23, 59, 59, 999);
  const base = and(
    gte(profitShareRecordsTable.createdAt, from),
    lte(profitShareRecordsTable.createdAt, to),
  );
  if (args.groupBy === "city") {
    return db
      .select({
        city: sql<string>`COALESCE(${institutionsTable.city}, '未綁定')`,
        records: sql<number>`COUNT(*)::int`,
        amount: sql<number>`SUM(${profitShareRecordsTable.amount})::int`,
      })
      .from(profitShareRecordsTable)
      .leftJoin(institutionsTable, eq(profitShareRecordsTable.institutionId, institutionsTable.id))
      .where(base)
      .groupBy(sql`COALESCE(${institutionsTable.city}, '未綁定')`)
      .orderBy(desc(sql`SUM(${profitShareRecordsTable.amount})`));
  }
  if (args.groupBy === "department") {
    return db
      .select({
        institution: sql<string>`COALESCE(${institutionsTable.name}, '個人')`,
        department: sql<string>`COALESCE(${profitShareRecordsTable.department}, '未指定')`,
        records: sql<number>`COUNT(*)::int`,
        amount: sql<number>`SUM(${profitShareRecordsTable.amount})::int`,
      })
      .from(profitShareRecordsTable)
      .leftJoin(institutionsTable, eq(profitShareRecordsTable.institutionId, institutionsTable.id))
      .where(base)
      .groupBy(
        sql`COALESCE(${institutionsTable.name}, '個人')`,
        sql`COALESCE(${profitShareRecordsTable.department}, '未指定')`,
      )
      .orderBy(desc(sql`SUM(${profitShareRecordsTable.amount})`));
  }
  return db
    .select({
      institution: sql<string>`COALESCE(${institutionsTable.name}, '個人（未綁定/未審核）')`,
      records: sql<number>`COUNT(*)::int`,
      amount: sql<number>`SUM(${profitShareRecordsTable.amount})::int`,
    })
    .from(profitShareRecordsTable)
    .leftJoin(institutionsTable, eq(profitShareRecordsTable.institutionId, institutionsTable.id))
    .where(base)
    .groupBy(sql`COALESCE(${institutionsTable.name}, '個人（未綁定/未審核）')`)
    .orderBy(desc(sql`SUM(${profitShareRecordsTable.amount})`));
}

async function lowStock(args: { threshold?: number }) {
  const threshold = args.threshold ?? 10;
  const products = await db
    .select({ id: productsTable.id, name: productsTable.name, stock: productsTable.stock })
    .from(productsTable)
    .where(and(eq(productsTable.isActive, true), lt(productsTable.stock, threshold)));
  const variants = await db
    .select({
      id: productVariantsTable.id,
      productId: productVariantsTable.productId,
      productName: productsTable.name,
      variantName: productVariantsTable.name,
      stock: productVariantsTable.stock,
    })
    .from(productVariantsTable)
    .innerJoin(productsTable, eq(productVariantsTable.productId, productsTable.id))
    .where(and(eq(productVariantsTable.isActive, true), lt(productVariantsTable.stock, threshold)));
  // 有規格的商品以規格庫存為準
  const variantProductIds = new Set(variants.map((v) => v.productId));
  const activeVariantProducts = await db
    .select({ productId: productVariantsTable.productId })
    .from(productVariantsTable)
    .where(eq(productVariantsTable.isActive, true));
  const hasVariants = new Set(activeVariantProducts.map((r) => r.productId));
  return {
    products: products.filter((p) => !hasVariants.has(p.id)),
    variants,
    threshold,
    note: variantProductIds.size ? "有規格的商品以各規格庫存為準" : undefined,
  };
}

async function listOrders(args: { status?: string; olderThanDays?: number; limit?: number }) {
  const conds = [];
  if (args.status) conds.push(eq(ordersTable.status, args.status));
  if (args.olderThanDays != null)
    conds.push(lte(ordersTable.createdAt, new Date(Date.now() - args.olderThanDays * 86400000)));
  const rows = await db
    .select({
      id: ordersTable.id,
      orderNo: ordersTable.orderNo,
      status: ordersTable.status,
      totalAmount: ordersTable.totalAmount,
      paymentMethod: ordersTable.paymentMethod,
      createdAt: ordersTable.createdAt,
      memberName: membersTable.name,
    })
    .from(ordersTable)
    .innerJoin(membersTable, eq(ordersTable.memberId, membersTable.id))
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(ordersTable.createdAt))
    .limit(Math.min(args.limit ?? 20, 50));
  return rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString().slice(0, 16) }));
}

async function financeSummary(args: { from?: string; to?: string }) {
  const from = parseDate(args.from, new Date(Date.now() - 30 * 86400000));
  const to = parseDate(args.to, new Date());
  to.setHours(23, 59, 59, 999);
  const [sales] = await db
    .select({
      orders: sql<number>`COUNT(*)::int`,
      revenue: sql<number>`COALESCE(SUM(${ordersTable.totalAmount}), 0)::int`,
    })
    .from(ordersTable)
    .where(
      and(
        gte(ordersTable.createdAt, from),
        lte(ordersTable.createdAt, to),
        inArray(ordersTable.status, ["paid", "shipped", "completed"]),
      ),
    );
  const [cost] = await db
    .select({
      cost: sql<number>`COALESCE(SUM(${orderItemsTable.quantity} * ${orderItemsTable.unitCost}), 0)::int`,
    })
    .from(orderItemsTable)
    .innerJoin(ordersTable, eq(orderItemsTable.orderId, ordersTable.id))
    .where(
      and(
        gte(ordersTable.createdAt, from),
        lte(ordersTable.createdAt, to),
        inArray(ordersTable.status, ["paid", "shipped", "completed"]),
      ),
    );
  const [commission] = await db
    .select({ amount: sql<number>`COALESCE(SUM(${profitShareRecordsTable.amount}), 0)::int` })
    .from(profitShareRecordsTable)
    .where(and(gte(profitShareRecordsTable.createdAt, from), lte(profitShareRecordsTable.createdAt, to)));
  return {
    period: { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) },
    orders: sales.orders,
    revenue: sales.revenue,
    cost: cost.cost,
    grossProfit: sales.revenue - cost.cost,
    commissionPaid: commission.amount,
  };
}

async function pendingTasks() {
  const [unverified] = await db
    .select({ count: sql<number>`COUNT(*)::int` })
    .from(membersTable)
    .where(
      and(
        sql`${membersTable.boundInstitutionId} IS NOT NULL`,
        eq(membersTable.institutionVerified, false),
      ),
    );
  const [pendingOrders] = await db
    .select({ count: sql<number>`COUNT(*)::int` })
    .from(ordersTable)
    .where(eq(ordersTable.status, "pending"));
  const [toShip] = await db
    .select({ count: sql<number>`COUNT(*)::int` })
    .from(ordersTable)
    .where(eq(ordersTable.status, "paid"));
  const [drafts] = await db
    .select({ count: sql<number>`COUNT(*)::int` })
    .from(articlesTable)
    .where(eq(articlesTable.status, "draft"));
  const low = await lowStock({ threshold: 10 });
  return {
    待審核院所綁定: unverified.count,
    待付款訂單: pendingOrders.count,
    待出貨訂單: toShip.count,
    草稿文章: drafts.count,
    低庫存商品: low.products.length + low.variants.length,
  };
}

// ---------- 操作類 ----------

class ToolError extends Error {}

async function updateOrderStatus(args: { orderId: number; status: string }) {
  if (!["paid", "shipped", "completed", "cancelled"].includes(args.status))
    throw new ToolError("狀態不正確");
  try {
    await applyOrderStatusChange(args.orderId, args.status);
  } catch (err) {
    if (err instanceof Error && err.message === "ORDER_NOT_FOUND") throw new ToolError("找不到此訂單");
    if (err instanceof Error && err.message.startsWith("BAD_TRANSITION:"))
      throw new ToolError(`無法從「${err.message.split(":")[1]}」變更為「${args.status}」`);
    throw err;
  }
  reindex("order", args.orderId);
  return { ok: true, orderId: args.orderId, status: args.status };
}

async function adjustStock(args: { productId: number; variantId?: number; quantity: number; reason?: string }) {
  if (!args.quantity) throw new ToolError("調整數量不可為 0");
  const variantId = args.variantId ?? null;
  const reason = args.reason || "AI 助理調整";
  const result = await db.transaction(async (tx) => {
    // AI 助理調整一律使用預設倉；虛擬品項不可調庫存（與 ERP 調整一致）
    const [prod] = await tx
      .select({ isVirtual: productsTable.isVirtual })
      .from(productsTable)
      .where(eq(productsTable.id, args.productId))
      .limit(1);
    if (!prod) throw new ToolError("商品不存在");
    if (prod.isVirtual) throw new ToolError("虛擬品項不可調整庫存");
    const warehouseId = await getDefaultWarehouseId(tx);
    let stockAfter: number;
    let variantName: string | null = null;
    if (variantId != null) {
      const [updated] = await tx
        .update(productVariantsTable)
        .set({ stock: sql`${productVariantsTable.stock} + ${args.quantity}` })
        .where(
          and(
            eq(productVariantsTable.id, variantId),
            eq(productVariantsTable.productId, args.productId),
            gte(productVariantsTable.stock, Math.max(0, -args.quantity)),
          ),
        )
        .returning();
      if (!updated) throw new ToolError("規格不存在或庫存不足以扣減");
      stockAfter = updated.stock;
      variantName = updated.name;
    } else {
      const [hasVariant] = await tx
        .select({ id: productVariantsTable.id })
        .from(productVariantsTable)
        .where(and(eq(productVariantsTable.productId, args.productId), eq(productVariantsTable.isActive, true)))
        .limit(1);
      if (hasVariant) throw new ToolError("此商品有多種規格，請指定 variantId");
      const [updated] = await tx
        .update(productsTable)
        .set({ stock: sql`${productsTable.stock} + ${args.quantity}` })
        .where(and(eq(productsTable.id, args.productId), gte(productsTable.stock, Math.max(0, -args.quantity))))
        .returning();
      if (!updated) throw new ToolError("商品不存在或庫存不足以扣減");
      stockAfter = updated.stock;
    }
    try {
      await adjustWarehouseStock(tx, {
        warehouseId,
        productId: args.productId,
        variantId,
        quantity: args.quantity,
      });
    } catch (err) {
      if (err instanceof WarehouseStockError) throw new ToolError(err.message);
      throw err;
    }
    await tx.insert(stockMovementsTable).values({
      productId: args.productId,
      variantId,
      type: "adjust",
      quantity: args.quantity,
      stockAfter,
      warehouseId,
      reason: variantName ? `${reason}（${variantName}）` : reason,
    });
    return { stockAfter, variantName };
  });
  reindex("product", args.productId);
  return { ok: true, productId: args.productId, variantId, stockAfter: result.stockAfter };
}

async function topupInstitutionWallet(args: { institutionId: number; amount: number; note?: string }) {
  if (!Number.isInteger(args.amount) || args.amount === 0) throw new ToolError("金額不正確");
  const result = await db.transaction(async (tx) => {
    const [inst] = await tx
      .select()
      .from(institutionsTable)
      .where(eq(institutionsTable.id, args.institutionId))
      .for("update")
      .limit(1);
    if (!inst) throw new ToolError("找不到此機構");
    const newBalance = inst.walletBalance + args.amount;
    if (newBalance < 0) throw new ToolError("扣除後餘額不可為負");
    await tx
      .update(institutionsTable)
      .set({ walletBalance: newBalance })
      .where(eq(institutionsTable.id, inst.id));
    await tx.insert(institutionWalletTransactionsTable).values({
      institutionId: inst.id,
      memberId: null,
      type: args.amount > 0 ? "topup" : "adjust",
      amount: args.amount,
      balanceAfter: newBalance,
      reason: args.note || (args.amount > 0 ? "AI 助理儲值" : "AI 助理調整"),
      refNo: null,
    });
    return { name: inst.name, newBalance };
  });
  reindex("institution", args.institutionId);
  return { ok: true, institution: result.name, balance: result.newBalance };
}

async function setArticleStatus(args: { articleId: number; status: string }) {
  if (!["draft", "published", "archived"].includes(args.status)) throw new ToolError("狀態不正確");
  const [row] = await db
    .update(articlesTable)
    .set({ status: args.status, updatedAt: new Date() })
    .where(eq(articlesTable.id, args.articleId))
    .returning();
  if (!row) throw new ToolError("找不到此文章");
  reindex("article", args.articleId);
  return { ok: true, articleId: row.id, title: row.title, status: row.status };
}

async function createOrder(args: {
  memberUsername: string;
  items: Array<{ productId: number; variantId?: number; quantity: number }>;
  paymentMethod?: string;
  shippingAddress?: string;
  note?: string;
}) {
  const paymentMethod = args.paymentMethod ?? "cod";
  if (!["cod", "transfer"].includes(paymentMethod))
    throw new ToolError("AI 助理僅能建立貨到付款（cod）或匯款（transfer）訂單");
  if (!args.items?.length) throw new ToolError("缺少商品明細");
  const [member] = await db
    .select()
    .from(membersTable)
    .where(eq(membersTable.username, args.memberUsername))
    .limit(1);
  if (!member) throw new ToolError(`找不到會員 ${args.memberUsername}`);

  const productIds = args.items.map((i) => i.productId);
  const products = await db.select().from(productsTable).where(inArray(productsTable.id, productIds));
  const byId = new Map(products.map((p) => [p.id, p]));
  const variantIds = args.items.map((i) => i.variantId).filter((v): v is number => v != null);
  const variants = variantIds.length
    ? await db.select().from(productVariantsTable).where(inArray(productVariantsTable.id, variantIds))
    : [];
  const variantById = new Map(variants.map((v) => [v.id, v]));
  const noVariantIds = args.items.filter((i) => i.variantId == null).map((i) => i.productId);
  const requiring = noVariantIds.length
    ? await db
        .select({ productId: productVariantsTable.productId })
        .from(productVariantsTable)
        .where(and(inArray(productVariantsTable.productId, noVariantIds), eq(productVariantsTable.isActive, true)))
    : [];
  const requiresVariant = new Set(requiring.map((r) => r.productId));

  const memberGrade = await resolveMemberGrade(member);
  for (const line of args.items) {
    const p = byId.get(line.productId);
    if (!p) throw new ToolError(`商品不存在 (id=${line.productId})`);
    if (!p.isActive) throw new ToolError(`「${p.name}」已下架`);
    if (!gradeAllowed(p.allowedGrades, memberGrade))
      throw new ToolError(`「${p.name}」未開放此會員的機構分級購買，無法代客下單`);
    if (!Number.isInteger(line.quantity) || line.quantity < 1) throw new ToolError("數量不正確");
    if (line.variantId == null && requiresVariant.has(line.productId))
      throw new ToolError(`「${p.name}」有多種規格，請指定 variantId`);
    if (line.variantId != null) {
      const v = variantById.get(line.variantId);
      if (!v || v.productId !== line.productId) throw new ToolError(`「${p.name}」的規格不存在`);
      if (!v.isActive) throw new ToolError(`「${p.name}（${v.name}）」已停售`);
    }
  }

  const lines = args.items.map((line) => {
    const p = byId.get(line.productId)!;
    const v = line.variantId != null ? variantById.get(line.variantId)! : null;
    return {
      productId: p.id,
      variantId: v?.id ?? null,
      variantName: v?.name ?? null,
      productName: p.name,
      productCode: p.code,
      unitPrice: v ? tierPrice(member.tier, v) : tierPrice(member.tier, p),
      quantity: line.quantity,
      unitCost: v ? v.costPrice : p.costPrice,
    };
  });
  const totalAmount = lines.reduce((sum, l) => sum + l.unitPrice * l.quantity, 0);
  const orderNo = `QB${Date.now()}${String(member.id).padStart(3, "0")}`;

  const order = await db.transaction(async (tx) => {
    const stockAfterByKey = new Map<string, number>();
    const allocationsByKey = new Map<string, Array<{ warehouseId: number; quantity: number }>>();
    // 同一商品/規格可能出現多列：先彙總數量，避免分配結果被後列覆蓋
    const aggregatedItems = new Map<
      string,
      { productId: number; variantId: number | null; quantity: number }
    >();
    for (const item of args.items) {
      if (byId.get(item.productId)!.isVirtual) continue; // 虛擬品項不動庫存
      const key = `${item.productId}:${item.variantId ?? ""}`;
      const agg = aggregatedItems.get(key);
      if (agg) agg.quantity += item.quantity;
      else
        aggregatedItems.set(key, {
          productId: item.productId,
          variantId: item.variantId ?? null,
          quantity: item.quantity,
        });
    }
    for (const line of aggregatedItems.values()) {
      // 分倉：依可售倉分配扣減
      try {
        const allocations = await allocateSellableStock(tx, {
          productId: line.productId,
          variantId: line.variantId ?? null,
          quantity: line.quantity,
        });
        allocationsByKey.set(`${line.productId}:${line.variantId ?? ""}`, allocations);
      } catch (err) {
        if (err instanceof WarehouseStockError) {
          const p = byId.get(line.productId)!;
          const v = line.variantId != null ? variantById.get(line.variantId) : null;
          throw new ToolError(`庫存不足：${p.name}${v ? `（${v.name}）` : ""}`);
        }
        throw err;
      }
      if (line.variantId != null) {
        const dec = await tx
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
        if (!dec.length) {
          const p = byId.get(line.productId)!;
          const v = variantById.get(line.variantId)!;
          throw new ToolError(`庫存不足：${p.name}（${v.name}）`);
        }
        stockAfterByKey.set(`${line.productId}:${line.variantId}`, dec[0].stock);
      } else {
        const dec = await tx
          .update(productsTable)
          .set({ stock: sql`${productsTable.stock} - ${line.quantity}` })
          .where(
            and(
              eq(productsTable.id, line.productId),
              eq(productsTable.isActive, true),
              gte(productsTable.stock, line.quantity),
            ),
          )
          .returning({ stock: productsTable.stock });
        if (!dec.length) throw new ToolError(`庫存不足：${byId.get(line.productId)!.name}`);
        stockAfterByKey.set(`${line.productId}:`, dec[0].stock);
      }
    }
    const [order] = await tx
      .insert(ordersTable)
      .values({
        orderNo,
        memberId: member.id,
        status: "pending",
        paymentMethod,
        walletSource: null,
        totalAmount,
        shippingAddress: args.shippingAddress ?? member.name,
        receiverName: member.name,
        receiverPhone: member.phone ?? "",
        note: args.note ? `【AI 助理代建】${args.note}` : "【AI 助理代建】",
      })
      .returning();
    await tx.insert(orderItemsTable).values(lines.map((l) => ({ ...l, orderId: order.id })));
    const seenMovementKeys = new Set<string>();
    const movementValues =
      lines.flatMap((l) => {
        if (byId.get(l.productId)!.isVirtual) return []; // 虛擬品項不動庫存
        const key = `${l.productId}:${l.variantId ?? ""}`;
        if (seenMovementKeys.has(key)) return []; // 重複列已彙總於分配結果
        seenMovementKeys.add(key);
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
      });
    if (movementValues.length > 0) await tx.insert(stockMovementsTable).values(movementValues);
    return order;
  });
  reindex("order", order.id);
  for (const l of lines) reindex("product", l.productId);
  return { ok: true, orderId: order.id, orderNo, totalAmount, member: member.name };
}

// ---------- 工具註冊表 ----------

export const READ_TOOLS = new Set([
  "search_knowledge",
  "sales_report",
  "commission_report",
  "low_stock",
  "list_orders",
  "finance_summary",
  "pending_tasks",
]);

export const ACTION_TOOLS = new Set([
  "update_order_status",
  "adjust_stock",
  "topup_institution_wallet",
  "set_article_status",
  "create_order",
]);

export const toolDefinitions = [
  {
    type: "function" as const,
    function: {
      name: "search_knowledge",
      description:
        "語意檢索全站知識庫（商品、訂單、會員、機構、佣金、文章、公告）。適合模糊或跨資料的問題。",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "查詢內容" },
          kinds: {
            type: "array",
            items: { type: "string", enum: ["product", "order", "member", "institution", "article", "announcement", "commission"] },
            description: "限定資料類型（可省略）",
          },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "sales_report",
      description: "銷售統計報表。groupBy: day（每日）/ institution（依機構）/ product（依商品）。",
      parameters: {
        type: "object",
        properties: {
          from: { type: "string", description: "起日 YYYY-MM-DD，省略為 30 天前" },
          to: { type: "string", description: "迄日 YYYY-MM-DD，省略為今天" },
          groupBy: { type: "string", enum: ["day", "institution", "product"] },
        },
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "commission_report",
      description: "佣金統計。groupBy: institution（依機構）/ city（依縣市）/ department（依科室）。",
      parameters: {
        type: "object",
        properties: {
          from: { type: "string" },
          to: { type: "string" },
          groupBy: { type: "string", enum: ["institution", "city", "department"] },
        },
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "low_stock",
      description: "低庫存清單（商品與規格）。",
      parameters: {
        type: "object",
        properties: { threshold: { type: "integer", description: "低於此數量視為低庫存，預設 10" } },
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "list_orders",
      description: "查詢訂單列表，可依狀態與建立天數過濾（例如未出貨超過三天 = status=paid, olderThanDays=3）。",
      parameters: {
        type: "object",
        properties: {
          status: { type: "string", enum: ["pending", "paid", "shipped", "completed", "cancelled"] },
          olderThanDays: { type: "integer" },
          limit: { type: "integer" },
        },
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "finance_summary",
      description: "財務摘要：期間營收、成本、毛利、佣金支出。",
      parameters: {
        type: "object",
        properties: { from: { type: "string" }, to: { type: "string" } },
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "pending_tasks",
      description: "待辦總覽：待審核綁定、待付款、待出貨、草稿文章、低庫存。",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "update_order_status",
      description: "變更訂單狀態（paid/shipped/completed/cancelled）。取消會退款並回補庫存；完成會撥入佣金。執行前必須先向管理者確認。",
      parameters: {
        type: "object",
        properties: {
          confirmationId: { type: "integer", description: "第二階段執行時帶入第一階段回傳的確認碼；首次呼叫請勿帶" },
          orderId: { type: "integer" },
          status: { type: "string", enum: ["paid", "shipped", "completed", "cancelled"] },
        },
        required: ["orderId", "status"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "adjust_stock",
      description: "調整庫存（正數增加、負數減少）。有規格的商品必須指定 variantId。執行前必須先向管理者確認。",
      parameters: {
        type: "object",
        properties: {
          confirmationId: { type: "integer", description: "第二階段執行時帶入第一階段回傳的確認碼；首次呼叫請勿帶" },
          productId: { type: "integer" },
          variantId: { type: "integer" },
          quantity: { type: "integer" },
          reason: { type: "string" },
        },
        required: ["productId", "quantity"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "topup_institution_wallet",
      description: "機構共用錢包儲值（正數）或調整（負數）。執行前必須先向管理者確認。",
      parameters: {
        type: "object",
        properties: {
          confirmationId: { type: "integer", description: "第二階段執行時帶入第一階段回傳的確認碼；首次呼叫請勿帶" },
          institutionId: { type: "integer" },
          amount: { type: "integer", description: "金額（元），正數儲值、負數扣除" },
          note: { type: "string" },
        },
        required: ["institutionId", "amount"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "set_article_status",
      description: "變更文章狀態：draft（草稿）/ published（發佈）/ archived（封存）。執行前必須先向管理者確認。",
      parameters: {
        type: "object",
        properties: {
          confirmationId: { type: "integer", description: "第二階段執行時帶入第一階段回傳的確認碼；首次呼叫請勿帶" },
          articleId: { type: "integer" },
          status: { type: "string", enum: ["draft", "published", "archived"] },
        },
        required: ["articleId", "status"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "create_order",
      description:
        "替會員建立訂單（僅限貨到付款 cod 或匯款 transfer）。價格依會員身份自動計算，會扣庫存。有規格的商品必須指定 variantId。執行前必須先向管理者確認會員、商品、數量。",
      parameters: {
        type: "object",
        properties: {
          confirmationId: { type: "integer", description: "第二階段執行時帶入第一階段回傳的確認碼；首次呼叫請勿帶" },
          memberUsername: { type: "string", description: "會員帳號" },
          items: {
            type: "array",
            items: {
              type: "object",
              properties: {
                productId: { type: "integer" },
                variantId: { type: "integer" },
                quantity: { type: "integer" },
              },
              required: ["productId", "quantity"],
            },
          },
          paymentMethod: { type: "string", enum: ["cod", "transfer"] },
          shippingAddress: { type: "string" },
          note: { type: "string" },
        },
        required: ["memberUsername", "items"],
      },
    },
  },
];

const executors: Record<string, (args: any) => Promise<unknown>> = {
  search_knowledge: searchKnowledge,
  sales_report: salesReport,
  commission_report: commissionReport,
  low_stock: lowStock,
  list_orders: listOrders,
  finance_summary: financeSummary,
  pending_tasks: pendingTasks,
  update_order_status: updateOrderStatus,
  adjust_stock: adjustStock,
  topup_institution_wallet: topupInstitutionWallet,
  set_article_status: setArticleStatus,
  create_order: createOrder,
};

/** 執行工具；操作類寫入稽核紀錄 */
export interface ToolContext {
  memberId: number;
  memberRole: string;
  conversationId: number;
  /** 本次 HTTP 請求代碼；僅用於稽核，不作為授權依據 */
  requestNonce: string;
}

/** 只有系統管理員可執行的操作工具 */
const ADMIN_ONLY_ACTIONS = new Set(["topup_institution_wallet"]);

const CONFIRM_TTL_MS = 10 * 60 * 1000;

export async function executeTool(
  name: string,
  args: any,
  ctx: ToolContext,
): Promise<{ result: unknown; isError: boolean }> {
  const fn = executors[name];
  if (!fn) return { result: { error: `未知工具 ${name}` }, isError: true };
  const isAction = ACTION_TOOLS.has(name);

  if (!isAction) {
    try {
      return { result: await fn(args ?? {}), isError: false };
    } catch (err) {
      const message = err instanceof ToolError ? err.message : "執行失敗";
      if (!(err instanceof ToolError)) console.error(`[assistant] tool ${name} failed:`, err);
      return { result: { error: message }, isError: true };
    }
  }

  // ---- 操作類工具：伺服器端明確確認 ----
  if (ADMIN_ONLY_ACTIONS.has(name) && ctx.memberRole !== "admin") {
    return { result: { error: "此操作僅限系統管理員執行" }, isError: true };
  }

  const { confirmationId, ...payloadArgs } = args ?? {};

  if (confirmationId) {
    return {
      result: {
        error:
          "模型不可授權或執行待確認操作；只有管理者按下介面上的確認按鈕，才能由伺服器直接執行。",
      },
      isError: true,
    };
  }

  // 第一階段：只建立待確認紀錄，不執行。
  const [row] = await db
    .insert(aiActionLogsTable)
    .values({
      memberId: ctx.memberId,
      action: name,
      payload: payloadArgs,
      status: "pending",
      conversationId: ctx.conversationId,
      requestNonce: ctx.requestNonce,
    })
    .returning({ id: aiActionLogsTable.id });
  return {
    result: {
      requiresConfirmation: true,
      confirmationId: row.id,
      notice:
        "此操作尚未執行。請向管理者完整複述操作內容，並請其使用介面上的「確認執行」按鈕。一般對話文字不構成授權。",
    },
    isError: false,
  };
}

export async function confirmAndExecuteAction(
  actionId: number,
  ctx: Omit<ToolContext, "requestNonce">,
): Promise<
  | { ok: true; action: string; result: unknown }
  | { ok: false; error: string; status: number }
> {
  const cutoff = new Date(Date.now() - CONFIRM_TTL_MS);
  const [claimed] = await db
    .update(aiActionLogsTable)
    .set({ status: "executing" })
    .where(
      and(
        eq(aiActionLogsTable.id, actionId),
        eq(aiActionLogsTable.status, "pending"),
        eq(aiActionLogsTable.memberId, ctx.memberId),
        eq(aiActionLogsTable.conversationId, ctx.conversationId),
        gt(aiActionLogsTable.createdAt, cutoff),
      ),
    )
    .returning({
      id: aiActionLogsTable.id,
      action: aiActionLogsTable.action,
      payload: aiActionLogsTable.payload,
    });
  if (!claimed) {
    return {
      ok: false,
      error: "待確認操作不存在、已執行或已逾時",
      status: 409,
    };
  }

  if (
    ADMIN_ONLY_ACTIONS.has(claimed.action) &&
    ctx.memberRole !== "admin"
  ) {
    await db
      .update(aiActionLogsTable)
      .set({ status: "rejected", result: "此操作僅限系統管理員執行" })
      .where(eq(aiActionLogsTable.id, claimed.id));
    return {
      ok: false,
      error: "此操作僅限系統管理員執行",
      status: 403,
    };
  }

  const fn = executors[claimed.action];
  if (!fn || !ACTION_TOOLS.has(claimed.action)) {
    await db
      .update(aiActionLogsTable)
      .set({ status: "error", result: "未知或非操作類工具" })
      .where(eq(aiActionLogsTable.id, claimed.id));
    return { ok: false, error: "未知或非操作類工具", status: 400 };
  }

  try {
    // 一律以 pending 時保存的參數執行，避免確認後被抽換內容
    const result = await fn(claimed.payload ?? {});
    await db
      .update(aiActionLogsTable)
      .set({ status: "ok", result: JSON.stringify(result).slice(0, 2000) })
      .where(eq(aiActionLogsTable.id, claimed.id))
      .catch(() => {});
    return { ok: true, action: claimed.action, result };
  } catch (err) {
    const message = err instanceof ToolError ? err.message : "執行失敗";
    if (!(err instanceof ToolError))
      console.error(`[assistant] confirmed tool ${claimed.action} failed:`, err);
    await db
      .update(aiActionLogsTable)
      .set({ status: "error", result: message })
      .where(eq(aiActionLogsTable.id, claimed.id))
      .catch(() => {});
    return { ok: false, error: message, status: 400 };
  }
}
