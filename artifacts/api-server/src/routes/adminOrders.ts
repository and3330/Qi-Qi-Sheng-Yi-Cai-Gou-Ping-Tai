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
  pointTransactionsTable,
  institutionsTable,
  institutionWalletTransactionsTable,
  type Order,
  type OrderItem,
  productVariantsTable,
  salesReturnItemsTable,
  salesReturnsTable,
  quotationsTable,
} from "@workspace/db";
import {
  UpdateAdminOrderStatusBody,
  UpdateShipmentPhotosBody,
  BulkUpdateAdminOrderStatusBody,
  BulkDeleteAdminOrdersBody,
} from "@workspace/api-zod";
import { requireStaff, requireOps } from "../middlewares/requireMember";
import { reindex, removeFromIndex } from "../lib/aiIndex";
import { syncSalesOrderStatusForOrder } from "../lib/erpSync";
import { getDefaultWarehouseId, increaseWarehouseStock, syncMirrorStock } from "../lib/warehouseStock";
import {
  salesOrdersTable,
  salesOrderItemsTable,
} from "@workspace/db";

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
    shipmentPhotos: o.shipmentPhotos ?? [],
    remitLastFive: o.remitLastFive ?? null,
    remitReportedAt: o.remitReportedAt ? o.remitReportedAt.toISOString() : null,
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

router.get("/admin/orders", requireStaff, async (req, res) => {
  const status = typeof req.query.status === "string" ? req.query.status : "";
  const search =
    typeof req.query.search === "string" ? req.query.search.trim() : "";

  const conditions: SQL[] = [];
  if (["pending", "paid", "shipped", "completed", "cancelled", "returned"].includes(status))
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

router.get("/admin/orders/:id", requireStaff, async (req, res) => {
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

// Allowed forward transitions; cancelled/returned restock the items.
const ORDER_TRANSITIONS: Record<string, string[]> = {
  pending: ["paid", "cancelled"],
  paid: ["shipped", "cancelled"],
  shipped: ["completed", "returned"],
  completed: ["returned"],
  cancelled: [],
  returned: [],
};

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * 訂單狀態轉換（含完成入佣金、取消/退貨退款與回補庫存、退貨收回點數與佣金）。
 * 供後台路由、ERP 銷退與 AI 行政助理共用；可傳入外部交易以保持原子性。
 * 失敗時丟出 ORDER_NOT_FOUND 或 BAD_TRANSITION:<現況>。
 */
export async function applyOrderStatusChange(
  id: number,
  target: string,
  outerTx?: Tx,
) {
  const run = async (tx: Tx) => {
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
                // 佣金歸屬：下單人「已審核綁定」院所 → 撥入機構共用錢包；否則入個人錢包
                // （與結帳扣款規則一致：需 institutionVerified；機構不存在時退回個人錢包，避免有紀錄沒入帳）
                let creditedInstitutionId: number | null = null;
                if (
                  member.boundInstitutionId != null &&
                  member.institutionVerified
                ) {
                  const [inst] = await tx
                    .select()
                    .from(institutionsTable)
                    .where(eq(institutionsTable.id, member.boundInstitutionId))
                    .for("update")
                    .limit(1);
                  if (inst) {
                    creditedInstitutionId = inst.id;
                    const newBalance = inst.walletBalance + amount;
                    await tx
                      .update(institutionsTable)
                      .set({ walletBalance: newBalance })
                      .where(eq(institutionsTable.id, inst.id));
                    await tx.insert(institutionWalletTransactionsTable).values({
                      institutionId: inst.id,
                      memberId: member.id,
                      type: "profit_share",
                      amount,
                      balanceAfter: newBalance,
                      reason: `佣金回饋（${rule.name}）`,
                      refNo: order.orderNo,
                    });
                  }
                }
                if (creditedInstitutionId == null) {
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
                }
                await tx.insert(profitShareRecordsTable).values({
                  orderId: order.id,
                  orderNo: order.orderNo,
                  memberId: member.id,
                  ruleId: rule.id,
                  ruleName: rule.name,
                  percentBps: rule.percentBps,
                  institutionId: creditedInstitutionId,
                  department:
                    creditedInstitutionId != null ? member.boundDepartment : null,
                  baseAmount: order.totalAmount,
                  amount,
                });
              }
            }
          }
        }

        // 點數累積：每滿 NT$100 得 1 點（以實付金額計，僅入一次）
        if ((order.pointsEarned ?? 0) === 0) {
          const earn = Math.floor(order.totalAmount / 100);
          if (earn > 0) {
            const [m] = await tx
              .update(membersTable)
              .set({ points: sql`${membersTable.points} + ${earn}` })
              .where(eq(membersTable.id, order.memberId))
              .returning({ points: membersTable.points });
            if (m) {
              await tx.insert(pointTransactionsTable).values({
                memberId: order.memberId,
                type: "earn",
                delta: earn,
                balanceAfter: m.points,
                orderId: order.id,
                note: `訂單完成回饋 ${order.orderNo}`,
              });
              await tx
                .update(ordersTable)
                .set({ pointsEarned: earn })
                .where(eq(ordersTable.id, order.id));
            }
          }
        }
      }

      if (target === "returned") {
        // 收回完成時發放的回饋點數
        if ((order.pointsEarned ?? 0) > 0) {
          const [m] = await tx
            .update(membersTable)
            .set({ points: sql`${membersTable.points} - ${order.pointsEarned}` })
            .where(eq(membersTable.id, order.memberId))
            .returning({ points: membersTable.points });
          if (m) {
            await tx.insert(pointTransactionsTable).values({
              memberId: order.memberId,
              type: "adjust",
              delta: -(order.pointsEarned ?? 0),
              balanceAfter: m.points,
              orderId: order.id,
              note: `訂單退貨收回回饋點數 ${order.orderNo}`,
            });
          }
          await tx
            .update(ordersTable)
            .set({ pointsEarned: 0 })
            .where(eq(ordersTable.id, order.id));
        }
        // 收回已入帳的佣金（依原入帳對象沖回）
        const [psr] = await tx
          .select()
          .from(profitShareRecordsTable)
          .where(eq(profitShareRecordsTable.orderId, id))
          .limit(1);
        if (psr) {
          if (psr.institutionId != null) {
            const [inst] = await tx
              .select()
              .from(institutionsTable)
              .where(eq(institutionsTable.id, psr.institutionId))
              .for("update")
              .limit(1);
            if (inst) {
              const newBalance = inst.walletBalance - psr.amount;
              await tx
                .update(institutionsTable)
                .set({ walletBalance: newBalance })
                .where(eq(institutionsTable.id, inst.id));
              await tx.insert(institutionWalletTransactionsTable).values({
                institutionId: inst.id,
                memberId: psr.memberId,
                type: "adjust",
                amount: -psr.amount,
                balanceAfter: newBalance,
                reason: "訂單退貨收回佣金",
                refNo: order.orderNo,
              });
            }
          } else {
            const [member] = await tx
              .select()
              .from(membersTable)
              .where(eq(membersTable.id, psr.memberId))
              .for("update")
              .limit(1);
            if (member) {
              const newBalance = member.walletBalance - psr.amount;
              await tx
                .update(membersTable)
                .set({ walletBalance: newBalance })
                .where(eq(membersTable.id, member.id));
              await tx.insert(walletTransactionsTable).values({
                memberId: member.id,
                type: "adjust",
                amount: -psr.amount,
                balanceAfter: newBalance,
                reason: "訂單退貨收回佣金",
                refNo: order.orderNo,
              });
            }
          }
          await tx
            .delete(profitShareRecordsTable)
            .where(eq(profitShareRecordsTable.id, psr.id));
        }
      }

      if (target === "cancelled" || target === "returned") {
        const actionLabel = target === "returned" ? "退貨" : "取消";
        // 點數折抵退回：取消時將折抵的點數還給會員
        if ((order.pointsUsed ?? 0) > 0) {
          const [m] = await tx
            .update(membersTable)
            .set({ points: sql`${membersTable.points} + ${order.pointsUsed}` })
            .where(eq(membersTable.id, order.memberId))
            .returning({ points: membersTable.points });
          if (m) {
            await tx.insert(pointTransactionsTable).values({
              memberId: order.memberId,
              type: "refund",
              delta: order.pointsUsed,
              balanceAfter: m.points,
              orderId: order.id,
              note: `訂單${actionLabel}退回折抵點數 ${order.orderNo}`,
            });
          }
        }
        // 錢包已付款的訂單取消 → 依付款來源退回機構共用錢包或個人錢包
        if (order.paymentMethod === "wallet" && order.status !== "pending") {
          if (order.walletSource === "institution") {
            // 找出扣款時的機構（以交易明細為準，避免會員之後改綁）
            const [payTx] = await tx
              .select()
              .from(institutionWalletTransactionsTable)
              .where(
                and(
                  eq(institutionWalletTransactionsTable.refNo, order.orderNo),
                  eq(institutionWalletTransactionsTable.type, "payment"),
                ),
              )
              .limit(1);
            if (payTx) {
              const [inst] = await tx
                .select()
                .from(institutionsTable)
                .where(eq(institutionsTable.id, payTx.institutionId))
                .for("update")
                .limit(1);
              if (inst) {
                const newBalance = inst.walletBalance + order.totalAmount;
                await tx
                  .update(institutionsTable)
                  .set({ walletBalance: newBalance })
                  .where(eq(institutionsTable.id, inst.id));
                await tx.insert(institutionWalletTransactionsTable).values({
                  institutionId: inst.id,
                  memberId: order.memberId,
                  type: "refund",
                  amount: order.totalAmount,
                  balanceAfter: newBalance,
                  reason: `訂單${actionLabel}退款`,
                  refNo: order.orderNo,
                });
              }
            }
          } else {
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
                reason: `訂單${actionLabel}退款`,
                refNo: order.orderNo,
              });
            }
          }
        }
        // Restock the order items and record movements
        const items = await tx
          .select()
          .from(orderItemsTable)
          .where(eq(orderItemsTable.orderId, id));
        // 虛擬品項不動庫存：以 ERP 銷貨單逐行快照為準（無快照則回看商品目前設定）
        const soRows = await tx
          .select({
            productId: salesOrderItemsTable.productId,
            variantId: salesOrderItemsTable.variantId,
            isVirtual: salesOrderItemsTable.isVirtual,
          })
          .from(salesOrderItemsTable)
          .innerJoin(
            salesOrdersTable,
            eq(salesOrderItemsTable.salesOrderId, salesOrdersTable.id),
          )
          .where(eq(salesOrdersTable.orderId, id));
        const virtualByKey = new Map(
          soRows.map((r) => [`${r.productId}:${r.variantId ?? ""}`, r.isVirtual]),
        );
        // 退貨時扣除先前「已確認銷退」已回補過的數量，避免重複入庫
        const alreadyRestocked = new Map<string, number>();
        let confirmedSrNos: string[] = [];
        if (target === "returned") {
          const srNoRows = await tx
            .select({ srNo: salesReturnsTable.srNo })
            .from(salesReturnsTable)
            .innerJoin(
              salesOrdersTable,
              eq(salesReturnsTable.salesOrderId, salesOrdersTable.id),
            )
            .where(
              and(
                eq(salesOrdersTable.orderId, id),
                eq(salesReturnsTable.status, "confirmed"),
              ),
            );
          confirmedSrNos = srNoRows.map((r) => r.srNo);
          const restockedRows = await tx
            .select({
              productId: salesReturnItemsTable.productId,
              variantId: salesReturnItemsTable.variantId,
              quantity: salesReturnItemsTable.quantity,
            })
            .from(salesReturnItemsTable)
            .innerJoin(
              salesReturnsTable,
              eq(salesReturnItemsTable.salesReturnId, salesReturnsTable.id),
            )
            .innerJoin(
              salesOrdersTable,
              eq(salesReturnsTable.salesOrderId, salesOrdersTable.id),
            )
            .where(
              and(
                eq(salesOrdersTable.orderId, id),
                eq(salesReturnsTable.status, "confirmed"),
              ),
            );
          for (const r of restockedRows) {
            const k = `${r.productId}:${r.variantId ?? ""}`;
            alreadyRestocked.set(k, (alreadyRestocked.get(k) ?? 0) + r.quantity);
          }
        }
        for (const item of items) {
          const key = `${item.productId}:${item.variantId ?? ""}`;
          const restocked = alreadyRestocked.get(key) ?? 0;
          const restockQty = Math.min(item.quantity, Math.max(item.quantity - restocked, 0));
          if (restocked > 0) {
            alreadyRestocked.set(key, Math.max(restocked - item.quantity, 0));
          }
          if (restockQty === 0) continue;
          const snap = virtualByKey.get(
            `${item.productId}:${item.variantId ?? ""}`,
          );
          if (snap === true) continue;
          if (snap === undefined) {
            const [p] = await tx
              .select({ isVirtual: productsTable.isVirtual })
              .from(productsTable)
              .where(eq(productsTable.id, item.productId))
              .limit(1);
            if (p?.isVirtual) continue;
          }
          // 分倉：依原銷售的分倉扣帳紀錄回補（多倉分配各自歸還；查無紀錄時回補預設倉）
          const restockRefs = [order.orderNo, ...confirmedSrNos];
          const saleAllocResult = await tx.execute(sql`
            SELECT warehouse_id, SUM(-quantity) AS sold
            FROM stock_movements
            WHERE ref_no IN (${sql.join(restockRefs.map((r) => sql`${r}`), sql`, `)})
              AND type IN ('sale', 'sale_return')
              AND warehouse_id IS NOT NULL
              AND product_id = ${item.productId}
              AND variant_id IS NOT DISTINCT FROM ${item.variantId}
            GROUP BY warehouse_id
            HAVING SUM(-quantity) > 0
            ORDER BY warehouse_id
          `);
          const saleAllocRows = saleAllocResult.rows as Array<{
            warehouse_id: number;
            sold: number;
          }>;
          const restockTargets: Array<{ warehouseId: number; quantity: number }> = [];
          let remainingRestock = restockQty;
          for (const r of saleAllocRows) {
            if (remainingRestock <= 0) break;
            const q = Math.min(Number(r.sold), remainingRestock);
            if (q > 0) {
              restockTargets.push({ warehouseId: Number(r.warehouse_id), quantity: q });
              remainingRestock -= q;
            }
          }
          if (remainingRestock > 0) {
            const defaultWarehouseId = await getDefaultWarehouseId(tx);
            const existing = restockTargets.find((t) => t.warehouseId === defaultWarehouseId);
            if (existing) existing.quantity += remainingRestock;
            else restockTargets.push({ warehouseId: defaultWarehouseId, quantity: remainingRestock });
          }
          for (const t of restockTargets) {
            await increaseWarehouseStock(tx, {
              warehouseId: t.warehouseId,
              productId: item.productId,
              variantId: item.variantId,
              quantity: t.quantity,
            });
          }
          // 舊制總量欄位改為唯讀鏡像：所有分倉回補完成後，同步一次總量供列表顯示
          const mirrorTotal = await syncMirrorStock(tx, {
            productId: item.productId,
            variantId: item.variantId,
          });
          for (const t of restockTargets) {
            await tx.insert(stockMovementsTable).values({
              productId: item.productId,
              variantId: item.variantId,
              type: target === "returned" ? "sale_return" : "sale",
              quantity: t.quantity,
              stockAfter: mirrorTotal,
              warehouseId: t.warehouseId,
              reason: item.variantName
                ? `訂單${actionLabel}回補（${item.variantName}）`
                : `訂單${actionLabel}回補`,
              refNo: order.orderNo,
            });
          }
        }
      }

      await tx
        .update(ordersTable)
        .set({ status: target })
        .where(eq(ordersTable.id, id));

      // 同步 ERP 銷貨單狀態（商城訂單 ↔ 銷貨單一對一）
      await syncSalesOrderStatusForOrder(tx, id, target);
  };
  if (outerTx) {
    await run(outerTx);
  } else {
    await db.transaction(run);
  }
}

router.patch("/admin/orders/:id/status", requireOps, async (req, res) => {
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
    await applyOrderStatusChange(id, target);
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

  reindex("order", id);
  res.json(await loadAdminOrder(id));
});

const STATUS_LABELS: Record<string, string> = {
  pending: "待付款",
  paid: "已付款",
  shipped: "已出貨",
  completed: "已完成",
  cancelled: "已取消",
  returned: "已退貨",
};

// 批量更新訂單狀態：逐筆套用同一套狀態機（含退款/回補庫存/佣金點數沖回），
// 每筆各自為一個交易——某一筆失敗不影響其他筆，並回報跳過原因。
router.post("/admin/orders/bulk-status", requireOps, async (req, res) => {
  const parsed = BulkUpdateAdminOrderStatusBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "批量狀態資料不正確" });
    return;
  }
  const { status: target } = parsed.data;
  const ids = [...new Set(parsed.data.ids)];

  const orderNoById = new Map<number, string>(
    (
      await db
        .select({ id: ordersTable.id, orderNo: ordersTable.orderNo })
        .from(ordersTable)
        .where(inArray(ordersTable.id, ids))
    ).map((r) => [r.id, r.orderNo]),
  );

  const updated: NonNullable<Awaited<ReturnType<typeof loadAdminOrder>>>[] = [];
  const skipped: { id: number; orderNo: string | null; reason: string }[] = [];

  for (const id of ids) {
    try {
      await applyOrderStatusChange(id, target);
      reindex("order", id);
      const order = await loadAdminOrder(id);
      if (order) updated.push(order);
    } catch (err) {
      const orderNo = orderNoById.get(id) ?? null;
      if (err instanceof Error && err.message === "ORDER_NOT_FOUND") {
        skipped.push({ id, orderNo, reason: "找不到此訂單" });
      } else if (
        err instanceof Error &&
        err.message.startsWith("BAD_TRANSITION:")
      ) {
        const current = err.message.split(":")[1];
        skipped.push({
          id,
          orderNo,
          reason: `狀態為「${STATUS_LABELS[current] ?? current}」，無法變更為「${STATUS_LABELS[target] ?? target}」`,
        });
      } else {
        console.error(`[bulk-status] order #${id} failed:`, err);
        skipped.push({ id, orderNo, reason: "處理失敗，請稍後再試" });
      }
    }
  }

  res.json({ updated, skipped });
});

// 批量刪除訂單：僅「已取消/已退貨」可刪（財務與庫存已沖回）；
// 已有銷退單紀錄者保留帳務不可刪。連動的 ERP 銷貨單一併刪除。
router.post("/admin/orders/bulk-delete", requireOps, async (req, res) => {
  const parsed = BulkDeleteAdminOrdersBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "批量刪除資料不正確" });
    return;
  }
  const ids = [...new Set(parsed.data.ids)];

  const deletedIds: number[] = [];
  const skipped: { id: number; orderNo: string | null; reason: string }[] = [];

  for (const id of ids) {
    try {
      const outcome = await db.transaction(async (tx) => {
        const [order] = await tx
          .select()
          .from(ordersTable)
          .where(eq(ordersTable.id, id))
          .for("update")
          .limit(1);
        if (!order) return { ok: false as const, orderNo: null, reason: "找不到此訂單" };
        if (order.status !== "cancelled" && order.status !== "returned") {
          return {
            ok: false as const,
            orderNo: order.orderNo,
            reason: "僅「已取消」或「已退貨」的訂單可刪除，請先取消訂單",
          };
        }
        // 由報價單轉入的訂單：報價單狀態已鎖定為 converted，刪單會留下懸空關聯，不可刪
        const [linkedQuote] = await tx
          .select({ id: quotationsTable.id, quoteNo: quotationsTable.quoteNo })
          .from(quotationsTable)
          .where(eq(quotationsTable.convertedOrderId, id))
          .limit(1);
        if (linkedQuote) {
          return {
            ok: false as const,
            orderNo: order.orderNo,
            reason: `此訂單由報價單 ${linkedQuote.quoteNo} 轉入，為保留關聯不可刪除`,
          };
        }
        // 已有會計自動立帳傳票（付款/退款/佣金）：刪單會讓帳務失去來源稽核軌跡，不可刪
        const journalResult = await tx.execute(sql`
          SELECT id FROM erp_journal_entries
          WHERE source_type IN ('shop_order_paid', 'shop_order_refund')
            AND source_id = ${String(id)}
          LIMIT 1
        `);
        if (journalResult.rows.length > 0) {
          return {
            ok: false as const,
            orderNo: order.orderNo,
            reason: "此訂單已有會計傳票紀錄，為保留帳務稽核軌跡不可刪除",
          };
        }
        // 連動 ERP 銷貨單：若已有銷退單，保留完整帳務紀錄，不可刪
        const linkedSOs = await tx
          .select({ id: salesOrdersTable.id })
          .from(salesOrdersTable)
          .where(eq(salesOrdersTable.orderId, id));
        if (linkedSOs.length) {
          const soIds = linkedSOs.map((s) => s.id);
          const [sr] = await tx
            .select({ id: salesReturnsTable.id })
            .from(salesReturnsTable)
            .where(inArray(salesReturnsTable.salesOrderId, soIds))
            .limit(1);
          if (sr) {
            return {
              ok: false as const,
              orderNo: order.orderNo,
              reason: "此訂單已有銷退單帳務紀錄，為保留稽核軌跡不可刪除",
            };
          }
          await tx
            .delete(salesOrderItemsTable)
            .where(inArray(salesOrderItemsTable.salesOrderId, soIds));
          await tx
            .delete(salesOrdersTable)
            .where(inArray(salesOrdersTable.id, soIds));
        }
        await tx
          .delete(profitShareRecordsTable)
          .where(eq(profitShareRecordsTable.orderId, id));
        await tx.delete(orderItemsTable).where(eq(orderItemsTable.orderId, id));
        await tx.delete(ordersTable).where(eq(ordersTable.id, id));
        return { ok: true as const, orderNo: order.orderNo, reason: "" };
      });
      if (outcome.ok) {
        deletedIds.push(id);
        removeFromIndex("order", id);
      } else {
        skipped.push({ id, orderNo: outcome.orderNo, reason: outcome.reason });
      }
    } catch (err) {
      console.error(`[bulk-delete] order #${id} failed:`, err);
      skipped.push({ id, orderNo: null, reason: "刪除失敗，請稍後再試" });
    }
  }

  res.json({ deletedIds, skipped });
});

router.get("/admin/reports/inventory", requireStaff, async (req, res) => {
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
    sql`${ordersTable.status} NOT IN ('cancelled', 'returned')`,
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

// 出貨照片存證：營運人員上傳後將物件路徑存入訂單
router.post(
  "/admin/orders/:id/shipment-photos",
  requireOps,
  async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      res.status(400).json({ error: "Invalid id" });
      return;
    }
    const parsed = UpdateShipmentPhotosBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "照片資料不正確" });
      return;
    }
    const photos = parsed.data.photos;
    if (photos.some((p) => !p.startsWith("/objects/"))) {
      res.status(400).json({ error: "照片路徑不正確" });
      return;
    }
    const [row] = await db
      .update(ordersTable)
      .set({ shipmentPhotos: photos })
      .where(eq(ordersTable.id, id))
      .returning({ shipmentPhotos: ordersTable.shipmentPhotos });
    if (!row) {
      res.status(404).json({ error: "找不到此訂單" });
      return;
    }
    res.json({ shipmentPhotos: row.shipmentPhotos });
  },
);

export default router;
