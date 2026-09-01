/**
 * AI CMO — 每日數據收集器
 *
 * 對照本商城實際存在的模組取數：訂單營收、新會員與等級分佈、內容數量、
 * 點數發放與使用、已發布社群貼文、錢包/財務流水。
 * 單一數據源失敗不影響其他（容錯），失敗來源記錄於 errors 陣列。
 * 未串接的外部數據源（GA4、Ahrefs、GSC、廣告花費、電子報）標示為 not_connected。
 */
import { and, eq, gte, lt, sql as dsql } from "drizzle-orm";
import {
  db,
  ordersTable,
  membersTable,
  articlesTable,
  announcementsTable,
  pointTransactionsTable,
  socialPostsTable,
  walletTransactionsTable,
  cmoMetricSnapshotsTable,
} from "@workspace/db";
import { logger } from "./logger";

const TAIPEI_OFFSET_MS = 8 * 60 * 60 * 1000;

/** 台北時區的 YYYY-MM-DD */
export function taipeiDateString(d: Date = new Date()): string {
  return new Date(d.getTime() + TAIPEI_OFFSET_MS).toISOString().slice(0, 10);
}

/** 將台北日期字串轉為該日 00:00（UTC 時間點） */
export function taipeiDayStart(dateStr: string): Date {
  return new Date(new Date(`${dateStr}T00:00:00.000Z`).getTime() - TAIPEI_OFFSET_MS);
}

export function addDays(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export type CmoSnapshotData = {
  date: string;
  revenue?: {
    ordersCount: number;
    revenue: number;
    paidOrdersCount: number;
    paidRevenue: number;
    cancelledCount: number;
  };
  members?: {
    newMembers: number;
    totalMembers: number;
    tierDistribution: Record<string, number>;
  };
  content?: {
    publishedArticles: number;
    publishedAnnouncements: number;
    newArticles: number;
  };
  points?: { issued: number; redeemed: number };
  social?: {
    publishedPosts: number;
    byPlatform: Record<string, number>;
  };
  wallet?: { deposits: number; payments: number; net: number };
  notConnected: string[];
  errors: string[];
  collectedAt: string;
};

/** 收集指定台北日期（整日）的營運數據；各來源獨立容錯 */
export async function collectDailyMetrics(dateStr: string): Promise<CmoSnapshotData> {
  const start = taipeiDayStart(dateStr);
  const end = taipeiDayStart(addDays(dateStr, 1));
  const errors: string[] = [];
  const data: CmoSnapshotData = {
    date: dateStr,
    notConnected: ["ga4", "ahrefs", "search_console", "ad_spend", "newsletter"],
    errors,
    collectedAt: new Date().toISOString(),
  };

  // 訂單營收
  try {
    const rows = await db
      .select({ status: ordersTable.status, count: dsql<number>`count(*)::int`, total: dsql<number>`coalesce(sum(${ordersTable.totalAmount}),0)::int` })
      .from(ordersTable)
      .where(and(gte(ordersTable.createdAt, start), lt(ordersTable.createdAt, end)))
      .groupBy(ordersTable.status);
    const nonCancelled = rows.filter((r) => r.status !== "cancelled");
    const paidStatuses = new Set(["paid", "shipped", "completed"]);
    data.revenue = {
      ordersCount: nonCancelled.reduce((s, r) => s + r.count, 0),
      revenue: nonCancelled.reduce((s, r) => s + r.total, 0),
      paidOrdersCount: rows.filter((r) => paidStatuses.has(r.status)).reduce((s, r) => s + r.count, 0),
      paidRevenue: rows.filter((r) => paidStatuses.has(r.status)).reduce((s, r) => s + r.total, 0),
      cancelledCount: rows.filter((r) => r.status === "cancelled").reduce((s, r) => s + r.count, 0),
    };
  } catch (err) {
    errors.push(`revenue: ${(err as Error).message}`);
  }

  // 會員
  try {
    const [{ newMembers }] = await db
      .select({ newMembers: dsql<number>`count(*)::int` })
      .from(membersTable)
      .where(and(gte(membersTable.createdAt, start), lt(membersTable.createdAt, end)));
    const tierRows = await db
      .select({ tier: membersTable.tier, count: dsql<number>`count(*)::int` })
      .from(membersTable)
      .where(eq(membersTable.isActive, true))
      .groupBy(membersTable.tier);
    data.members = {
      newMembers,
      totalMembers: tierRows.reduce((s, r) => s + r.count, 0),
      tierDistribution: Object.fromEntries(tierRows.map((r) => [r.tier ?? "unknown", r.count])),
    };
  } catch (err) {
    errors.push(`members: ${(err as Error).message}`);
  }

  // 內容（無瀏覽/按讚追蹤表，以發布量計）
  try {
    const [[{ pubArticles }], [{ pubAnn }], [{ newArticles }]] = await Promise.all([
      db.select({ pubArticles: dsql<number>`count(*)::int` }).from(articlesTable).where(eq(articlesTable.status, "published")),
      db.select({ pubAnn: dsql<number>`count(*)::int` }).from(announcementsTable).where(eq(announcementsTable.status, "published")),
      db.select({ newArticles: dsql<number>`count(*)::int` }).from(articlesTable).where(and(gte(articlesTable.publishedAt, start), lt(articlesTable.publishedAt, end))),
    ]);
    data.content = { publishedArticles: pubArticles, publishedAnnouncements: pubAnn, newArticles };
  } catch (err) {
    errors.push(`content: ${(err as Error).message}`);
  }

  // 點數
  try {
    const [{ issued, redeemed }] = await db
      .select({
        issued: dsql<number>`coalesce(sum(case when ${pointTransactionsTable.delta} > 0 then ${pointTransactionsTable.delta} else 0 end),0)::int`,
        redeemed: dsql<number>`coalesce(sum(case when ${pointTransactionsTable.type} = 'redeem' then -${pointTransactionsTable.delta} else 0 end),0)::int`,
      })
      .from(pointTransactionsTable)
      .where(and(gte(pointTransactionsTable.createdAt, start), lt(pointTransactionsTable.createdAt, end)));
    data.points = { issued, redeemed };
  } catch (err) {
    errors.push(`points: ${(err as Error).message}`);
  }

  // 社群貼文（依 publishedAt 計）
  try {
    const rows = await db
      .select()
      .from(socialPostsTable)
      .where(
        and(
          eq(socialPostsTable.status, "published"),
          gte(socialPostsTable.publishedAt, start),
          lt(socialPostsTable.publishedAt, end),
        ),
      );
    const byPlatform: Record<string, number> = {};
    for (const p of rows) {
      for (const plat of p.platforms ?? []) byPlatform[plat] = (byPlatform[plat] ?? 0) + 1;
    }
    data.social = { publishedPosts: rows.length, byPlatform };
  } catch (err) {
    errors.push(`social: ${(err as Error).message}`);
  }

  // 錢包流水
  try {
    const [{ deposits, payments, net }] = await db
      .select({
        deposits: dsql<number>`coalesce(sum(case when ${walletTransactionsTable.amount} > 0 then ${walletTransactionsTable.amount} else 0 end),0)::int`,
        payments: dsql<number>`coalesce(sum(case when ${walletTransactionsTable.amount} < 0 then -${walletTransactionsTable.amount} else 0 end),0)::int`,
        net: dsql<number>`coalesce(sum(${walletTransactionsTable.amount}),0)::int`,
      })
      .from(walletTransactionsTable)
      .where(and(gte(walletTransactionsTable.createdAt, start), lt(walletTransactionsTable.createdAt, end)));
    data.wallet = { deposits, payments, net };
  } catch (err) {
    errors.push(`wallet: ${(err as Error).message}`);
  }

  return data;
}

/** 收集並保存快照（同日 upsert 覆寫） */
export async function collectAndStoreSnapshot(dateStr: string): Promise<CmoSnapshotData> {
  const data = await collectDailyMetrics(dateStr);
  await db
    .insert(cmoMetricSnapshotsTable)
    .values({ snapshotDate: dateStr, data })
    .onConflictDoUpdate({
      target: cmoMetricSnapshotsTable.snapshotDate,
      set: { data },
    });
  if (data.errors.length) {
    logger.warn({ date: dateStr, errors: data.errors }, "[CMO] 部分數據源收集失敗");
  }
  return data;
}

/** 讀取快照；不存在時即時收集並保存 */
export async function getOrCollectSnapshot(dateStr: string): Promise<CmoSnapshotData> {
  const [row] = await db
    .select()
    .from(cmoMetricSnapshotsTable)
    .where(eq(cmoMetricSnapshotsTable.snapshotDate, dateStr))
    .limit(1);
  if (row) return row.data as CmoSnapshotData;
  return collectAndStoreSnapshot(dateStr);
}
