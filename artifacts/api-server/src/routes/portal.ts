import { Router, type IRouter } from "express";
import type { Request, Response, NextFunction } from "express";
import { and, count, desc, eq, gte, inArray, ne, sql, sum } from "drizzle-orm";
import {
  db,
  membersTable,
  ordersTable,
  orderItemsTable,
  institutionsTable,
  type Member,
} from "@workspace/db";
import { requireMember } from "../middlewares/requireMember";

const router: IRouter = Router();

/** 僅限醫院 / 診所藥局會員使用機構後台 */
function requirePortal(req: Request, res: Response, next: NextFunction) {
  requireMember(req, res, () => {
    const tier = req.member?.tier;
    if (tier !== "hospital" && tier !== "clinic") {
      res.status(403).json({ error: "僅限醫院／診所藥局會員使用機構後台" });
      return;
    }
    next();
  });
}

/** 資料範圍：已綁定院所者為同院所全部成員，否則僅本人 */
async function scopeMemberIds(
  member: Member,
): Promise<{ memberIds: number[]; institutionScope: boolean }> {
  // 院所範圍需 (1) 已綁定院所且 (2) 綁定已由管理員審核，否則僅能看自己的資料
  if (!member.boundInstitutionId || !member.institutionVerified) {
    return { memberIds: [member.id], institutionScope: false };
  }
  const rows = await db
    .select({ id: membersTable.id })
    .from(membersTable)
    .where(eq(membersTable.boundInstitutionId, member.boundInstitutionId));
  return { memberIds: rows.map((r) => r.id), institutionScope: true };
}

function serializePortalOrder(o: {
  id: number;
  orderNo: string;
  status: string;
  paymentMethod: string;
  totalAmount: number;
  memberName: string | null;
  boundDepartment: string | null;
  createdAt: Date;
}) {
  return {
    id: o.id,
    orderNo: o.orderNo,
    status: o.status,
    paymentMethod: o.paymentMethod,
    totalAmount: o.totalAmount,
    memberName: o.memberName ?? "",
    boundDepartment: o.boundDepartment,
    createdAt: o.createdAt.toISOString(),
  };
}

router.get("/portal/summary", requirePortal, async (req, res) => {
  const member = req.member!;
  const { memberIds, institutionScope } = await scopeMemberIds(member);

  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  const [institution] = member.boundInstitutionId
    ? await db
        .select({ name: institutionsTable.name })
        .from(institutionsTable)
        .where(eq(institutionsTable.id, member.boundInstitutionId))
        .limit(1)
    : [undefined];

  const [[monthOrders], [monthTotal], [pendingOrders], recentOrders] =
    await Promise.all([
      db
        .select({ value: count() })
        .from(ordersTable)
        .where(
          and(
            inArray(ordersTable.memberId, memberIds),
            gte(ordersTable.createdAt, monthStart),
          ),
        ),
      db
        .select({ value: sum(ordersTable.totalAmount) })
        .from(ordersTable)
        .where(
          and(
            inArray(ordersTable.memberId, memberIds),
            gte(ordersTable.createdAt, monthStart),
            ne(ordersTable.status, "cancelled"),
          ),
        ),
      db
        .select({ value: count() })
        .from(ordersTable)
        .where(
          and(
            inArray(ordersTable.memberId, memberIds),
            eq(ordersTable.status, "pending"),
          ),
        ),
      db
        .select({
          id: ordersTable.id,
          orderNo: ordersTable.orderNo,
          status: ordersTable.status,
          paymentMethod: ordersTable.paymentMethod,
          totalAmount: ordersTable.totalAmount,
          memberName: membersTable.name,
          boundDepartment: membersTable.boundDepartment,
          createdAt: ordersTable.createdAt,
        })
        .from(ordersTable)
        .innerJoin(membersTable, eq(ordersTable.memberId, membersTable.id))
        .where(inArray(ordersTable.memberId, memberIds))
        .orderBy(desc(ordersTable.createdAt))
        .limit(5),
    ]);

  res.json({
    institutionName: institution?.name ?? null,
    institutionScope,
    tier: member.tier,
    walletBalance: member.walletBalance,
    monthOrderCount: monthOrders.value,
    monthPurchaseTotal: Number(monthTotal.value ?? 0),
    pendingOrderCount: pendingOrders.value,
    recentOrders: recentOrders.map(serializePortalOrder),
  });
});

router.get("/portal/orders", requirePortal, async (req, res) => {
  const member = req.member!;
  const { memberIds } = await scopeMemberIds(member);

  const status =
    typeof req.query.status === "string" ? req.query.status : undefined;
  const conditions = [inArray(ordersTable.memberId, memberIds)];
  if (
    status &&
    ["pending", "paid", "shipped", "completed", "cancelled"].includes(status)
  ) {
    conditions.push(eq(ordersTable.status, status));
  }

  const rows = await db
    .select({
      id: ordersTable.id,
      orderNo: ordersTable.orderNo,
      status: ordersTable.status,
      paymentMethod: ordersTable.paymentMethod,
      totalAmount: ordersTable.totalAmount,
      memberName: membersTable.name,
      boundDepartment: membersTable.boundDepartment,
      createdAt: ordersTable.createdAt,
    })
    .from(ordersTable)
    .innerJoin(membersTable, eq(ordersTable.memberId, membersTable.id))
    .where(and(...conditions))
    .orderBy(desc(ordersTable.createdAt))
    .limit(200);

  res.json(rows.map(serializePortalOrder));
});

router.get("/portal/reports", requirePortal, async (req, res) => {
  const member = req.member!;
  const { memberIds, institutionScope } = await scopeMemberIds(member);

  const now = new Date();
  const sixMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 5, 1);

  const [monthRows, topRows] = await Promise.all([
    db
      .select({
        month: sql<string>`to_char(${ordersTable.createdAt}, 'YYYY-MM')`,
        orderCount: count(),
        purchaseTotal: sum(ordersTable.totalAmount),
      })
      .from(ordersTable)
      .where(
        and(
          inArray(ordersTable.memberId, memberIds),
          gte(ordersTable.createdAt, sixMonthsAgo),
          ne(ordersTable.status, "cancelled"),
        ),
      )
      .groupBy(sql`to_char(${ordersTable.createdAt}, 'YYYY-MM')`),
    db
      .select({
        productName: orderItemsTable.productName,
        productCode: orderItemsTable.productCode,
        quantity: sum(orderItemsTable.quantity),
        amount: sum(
          sql`${orderItemsTable.unitPrice} * ${orderItemsTable.quantity}`,
        ),
      })
      .from(orderItemsTable)
      .innerJoin(ordersTable, eq(orderItemsTable.orderId, ordersTable.id))
      .where(
        and(
          inArray(ordersTable.memberId, memberIds),
          gte(ordersTable.createdAt, sixMonthsAgo),
          ne(ordersTable.status, "cancelled"),
        ),
      )
      .groupBy(orderItemsTable.productName, orderItemsTable.productCode)
      .orderBy(desc(sum(sql`${orderItemsTable.unitPrice} * ${orderItemsTable.quantity}`)))
      .limit(10),
  ]);

  // 補齊近 6 個月（沒有訂單的月份補 0）
  const byMonth = new Map(monthRows.map((r) => [r.month, r]));
  const months = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const row = byMonth.get(key);
    months.push({
      month: key,
      orderCount: row ? Number(row.orderCount) : 0,
      purchaseTotal: row ? Number(row.purchaseTotal ?? 0) : 0,
    });
  }

  res.json({
    institutionScope,
    months,
    topProducts: topRows.map((r) => ({
      productName: r.productName,
      productCode: r.productCode,
      quantity: Number(r.quantity ?? 0),
      amount: Number(r.amount ?? 0),
    })),
  });
});

export default router;
