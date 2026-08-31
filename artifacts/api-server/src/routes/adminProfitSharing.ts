import { Router, type IRouter } from "express";
import { and, desc, eq, gte, lte, sql, type SQL } from "drizzle-orm";
import {
  db,
  membersTable,
  profitRulesTable,
  profitShareRecordsTable,
  type ProfitRule,
} from "@workspace/db";
import {
  CreateAdminProfitRuleBody,
  UpdateAdminProfitRuleBody,
} from "@workspace/api-zod";
import { requireAdmin } from "../middlewares/requireMember";

const router: IRouter = Router();

function serializeRule(r: ProfitRule) {
  return {
    id: r.id,
    name: r.name,
    tier: r.tier,
    percentBps: r.percentBps,
    isActive: r.isActive,
    createdAt: r.createdAt.toISOString(),
  };
}

router.get("/admin/profit-rules", requireAdmin, async (_req, res) => {
  const rules = await db
    .select()
    .from(profitRulesTable)
    .orderBy(desc(profitRulesTable.createdAt));
  res.json(rules.map(serializeRule));
});

// 同一身份同時間只允許一條啟用中的規則，避免分潤金額不確定
async function hasActiveConflict(tier: string, excludeId?: number) {
  const rows = await db
    .select({ id: profitRulesTable.id })
    .from(profitRulesTable)
    .where(
      and(eq(profitRulesTable.tier, tier), eq(profitRulesTable.isActive, true)),
    );
  return rows.some((r) => r.id !== excludeId);
}

// 資料庫層 partial unique index 的違反（併發時的最後防線）
function isActiveRuleConflict(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const e = err as { code?: string; constraint?: string; cause?: unknown; message?: string };
  if (
    e.code === "23505" &&
    String(e.constraint ?? e.message ?? "").includes("profit_rules_one_active_per_tier")
  ) {
    return true;
  }
  return e.cause ? isActiveRuleConflict(e.cause) : false;
}

router.post("/admin/profit-rules", requireAdmin, async (req, res) => {
  const parsed = CreateAdminProfitRuleBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "規則資料不完整" });
    return;
  }
  if ((parsed.data.isActive ?? true) && (await hasActiveConflict(parsed.data.tier))) {
    res.status(400).json({ error: "此身份已有啟用中的分潤規則，請先停用舊規則" });
    return;
  }
  try {
    const [rule] = await db
      .insert(profitRulesTable)
      .values({
        name: parsed.data.name,
        tier: parsed.data.tier,
        percentBps: parsed.data.percentBps,
        isActive: parsed.data.isActive ?? true,
      })
      .returning();
    res.status(201).json(serializeRule(rule));
  } catch (err) {
    if (isActiveRuleConflict(err)) {
      res.status(400).json({ error: "此身份已有啟用中的分潤規則，請先停用舊規則" });
      return;
    }
    throw err;
  }
});

router.patch("/admin/profit-rules/:id", requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const parsed = UpdateAdminProfitRuleBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "規則資料不完整" });
    return;
  }
  if ((parsed.data.isActive ?? true) && (await hasActiveConflict(parsed.data.tier, id))) {
    res.status(400).json({ error: "此身份已有啟用中的分潤規則，請先停用舊規則" });
    return;
  }
  try {
    const [rule] = await db
      .update(profitRulesTable)
      .set({
        name: parsed.data.name,
        tier: parsed.data.tier,
        percentBps: parsed.data.percentBps,
        isActive: parsed.data.isActive ?? true,
      })
      .where(eq(profitRulesTable.id, id))
      .returning();
    if (!rule) {
      res.status(404).json({ error: "找不到此規則" });
      return;
    }
    res.json(serializeRule(rule));
  } catch (err) {
    if (isActiveRuleConflict(err)) {
      res.status(400).json({ error: "此身份已有啟用中的分潤規則，請先停用舊規則" });
      return;
    }
    throw err;
  }
});

router.delete("/admin/profit-rules/:id", requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const deleted = await db
    .delete(profitRulesTable)
    .where(eq(profitRulesTable.id, id))
    .returning({ id: profitRulesTable.id });
  if (!deleted.length) {
    res.status(404).json({ error: "找不到此規則" });
    return;
  }
  res.status(204).end();
});

router.get("/admin/profit-report", requireAdmin, async (req, res) => {
  const from = typeof req.query.from === "string" ? req.query.from : "";
  const to = typeof req.query.to === "string" ? req.query.to : "";
  const memberId = Number(req.query.memberId);

  const conds: SQL[] = [];
  if (from) conds.push(gte(profitShareRecordsTable.createdAt, new Date(from)));
  if (to) {
    const end = new Date(to);
    end.setDate(end.getDate() + 1);
    conds.push(lte(profitShareRecordsTable.createdAt, end));
  }
  if (Number.isInteger(memberId) && memberId > 0)
    conds.push(eq(profitShareRecordsTable.memberId, memberId));
  const where = conds.length ? and(...conds) : undefined;

  // 彙總數字以全部符合的紀錄計算（不受明細筆數上限影響）
  const [totals] = await db
    .select({
      totalAmount: sql<number>`coalesce(sum(${profitShareRecordsTable.amount}), 0)`,
      recordCount: sql<number>`count(*)`,
    })
    .from(profitShareRecordsTable)
    .where(where);

  const memberRows = await db
    .select({
      memberId: profitShareRecordsTable.memberId,
      memberName: membersTable.name,
      tier: membersTable.tier,
      orderCount: sql<number>`count(*)`,
      amount: sql<number>`coalesce(sum(${profitShareRecordsTable.amount}), 0)`,
    })
    .from(profitShareRecordsTable)
    .innerJoin(membersTable, eq(profitShareRecordsTable.memberId, membersTable.id))
    .where(where)
    .groupBy(
      profitShareRecordsTable.memberId,
      membersTable.name,
      membersTable.tier,
    );

  const RECORD_LIMIT = 500;
  const rows = await db
    .select({
      record: profitShareRecordsTable,
      memberName: membersTable.name,
    })
    .from(profitShareRecordsTable)
    .innerJoin(membersTable, eq(profitShareRecordsTable.memberId, membersTable.id))
    .where(where)
    .orderBy(desc(profitShareRecordsTable.createdAt))
    .limit(RECORD_LIMIT);

  res.json({
    from: from || null,
    to: to || null,
    totalAmount: Number(totals.totalAmount),
    recordCount: Number(totals.recordCount),
    recordsTruncated: Number(totals.recordCount) > rows.length,
    members: memberRows
      .map((m) => ({
        memberId: m.memberId,
        memberName: m.memberName,
        tier: m.tier,
        orderCount: Number(m.orderCount),
        amount: Number(m.amount),
      }))
      .sort((a, b) => b.amount - a.amount),
    records: rows.map(({ record, memberName }) => ({
      id: record.id,
      orderId: record.orderId,
      orderNo: record.orderNo,
      memberId: record.memberId,
      memberName,
      ruleName: record.ruleName,
      percentBps: record.percentBps,
      baseAmount: record.baseAmount,
      amount: record.amount,
      createdAt: record.createdAt.toISOString(),
    })),
  });
});

export default router;
