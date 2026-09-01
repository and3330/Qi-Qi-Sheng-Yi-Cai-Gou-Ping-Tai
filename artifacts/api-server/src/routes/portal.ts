import { Router, type IRouter } from "express";
import type { Request, Response, NextFunction } from "express";
import { and, count, desc, eq, gte, inArray, ne, sql, sum , notInArray} from "drizzle-orm";
import {
  db,
  membersTable,
  ordersTable,
  orderItemsTable,
  institutionsTable,
  walletTransactionsTable,
  institutionWalletTransactionsTable,
  profitShareRecordsTable,
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
            notInArray(ordersTable.status, ["cancelled", "returned"]),
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
    ["pending", "paid", "shipped", "completed", "cancelled", "returned"].includes(status)
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
          notInArray(ordersTable.status, ["cancelled", "returned"]),
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
          notInArray(ordersTable.status, ["cancelled", "returned"]),
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

router.get("/portal/wallet", requirePortal, async (req, res) => {
  const member = req.member!;
  const institutionScoped =
    member.boundInstitutionId != null && member.institutionVerified;

  if (institutionScoped) {
    const [inst] = await db
      .select({
        name: institutionsTable.name,
        walletBalance: institutionsTable.walletBalance,
      })
      .from(institutionsTable)
      .where(eq(institutionsTable.id, member.boundInstitutionId!))
      .limit(1);
    const txs = await db
      .select({
        id: institutionWalletTransactionsTable.id,
        type: institutionWalletTransactionsTable.type,
        amount: institutionWalletTransactionsTable.amount,
        balanceAfter: institutionWalletTransactionsTable.balanceAfter,
        reason: institutionWalletTransactionsTable.reason,
        refNo: institutionWalletTransactionsTable.refNo,
        createdAt: institutionWalletTransactionsTable.createdAt,
        memberName: membersTable.name,
      })
      .from(institutionWalletTransactionsTable)
      .leftJoin(
        membersTable,
        eq(institutionWalletTransactionsTable.memberId, membersTable.id),
      )
      .where(
        eq(
          institutionWalletTransactionsTable.institutionId,
          member.boundInstitutionId!,
        ),
      )
      .orderBy(desc(institutionWalletTransactionsTable.createdAt))
      .limit(300);
    res.json({
      walletKind: "institution",
      institutionName: inst?.name ?? null,
      balance: inst?.walletBalance ?? 0,
      transactions: txs.map((t) => ({
        id: t.id,
        memberName: t.memberName,
        type: t.type,
        amount: t.amount,
        balanceAfter: t.balanceAfter,
        reason: t.reason,
        refNo: t.refNo,
        createdAt: t.createdAt.toISOString(),
      })),
    });
    return;
  }

  const txs = await db
    .select()
    .from(walletTransactionsTable)
    .where(eq(walletTransactionsTable.memberId, member.id))
    .orderBy(desc(walletTransactionsTable.createdAt))
    .limit(300);
  res.json({
    walletKind: "member",
    institutionName: null,
    balance: member.walletBalance,
    transactions: txs.map((t) => ({
      id: t.id,
      memberName: null,
      type: t.type,
      amount: t.amount,
      balanceAfter: t.balanceAfter,
      reason: t.reason,
      refNo: t.refNo,
      createdAt: t.createdAt.toISOString(),
    })),
  });
});

// 機構佣金對帳：僅已審核綁定者可見，逐筆明細供核對
router.get("/portal/commissions", requirePortal, async (req, res) => {
  const member = req.member!;
  if (!member.boundInstitutionId || !member.institutionVerified) {
    res.json({
      institutionScope: false,
      totalAmount: 0,
      recordCount: 0,
      records: [],
    });
    return;
  }
  const where = eq(
    profitShareRecordsTable.institutionId,
    member.boundInstitutionId,
  );
  const [totals] = await db
    .select({
      totalAmount: sql<number>`coalesce(sum(${profitShareRecordsTable.amount}), 0)`,
      recordCount: sql<number>`count(*)`,
    })
    .from(profitShareRecordsTable)
    .where(where);
  const rows = await db
    .select({
      record: profitShareRecordsTable,
      memberName: membersTable.name,
    })
    .from(profitShareRecordsTable)
    .innerJoin(
      membersTable,
      eq(profitShareRecordsTable.memberId, membersTable.id),
    )
    .where(where)
    .orderBy(desc(profitShareRecordsTable.createdAt))
    .limit(300);
  res.json({
    institutionScope: true,
    totalAmount: Number(totals.totalAmount),
    recordCount: Number(totals.recordCount),
    records: rows.map(({ record, memberName }) => ({
      id: record.id,
      orderNo: record.orderNo,
      memberName,
      department: record.department,
      ruleName: record.ruleName,
      percentBps: record.percentBps,
      baseAmount: record.baseAmount,
      amount: record.amount,
      createdAt: record.createdAt.toISOString(),
    })),
  });
});

export default router;
