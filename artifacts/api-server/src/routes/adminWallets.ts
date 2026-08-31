import { Router, type IRouter } from "express";
import { and, desc, eq, gte, lte, sql, type SQL } from "drizzle-orm";
import {
  db,
  membersTable,
  walletTransactionsTable,
  type WalletTransaction,
} from "@workspace/db";
import { AdjustAdminMemberWalletBody } from "@workspace/api-zod";
import { requireAdmin } from "../middlewares/requireMember";

const router: IRouter = Router();

function serializeTx(t: WalletTransaction) {
  return {
    id: t.id,
    type: t.type,
    amount: t.amount,
    balanceAfter: t.balanceAfter,
    reason: t.reason,
    refNo: t.refNo,
    createdAt: t.createdAt.toISOString(),
  };
}

function periodConditions(from: string, to: string): SQL[] {
  const conds: SQL[] = [];
  if (from) conds.push(gte(walletTransactionsTable.createdAt, new Date(from)));
  if (to) {
    const end = new Date(to);
    end.setDate(end.getDate() + 1);
    conds.push(lte(walletTransactionsTable.createdAt, end));
  }
  return conds;
}

router.get("/admin/wallets/stats", requireAdmin, async (req, res) => {
  const from = typeof req.query.from === "string" ? req.query.from : "";
  const to = typeof req.query.to === "string" ? req.query.to : "";

  const members = await db
    .select({
      id: membersTable.id,
      username: membersTable.username,
      name: membersTable.name,
      tier: membersTable.tier,
      walletBalance: membersTable.walletBalance,
    })
    .from(membersTable)
    .where(eq(membersTable.role, "member"));

  const conds = periodConditions(from, to);
  const txs = await db
    .select({
      memberId: walletTransactionsTable.memberId,
      type: walletTransactionsTable.type,
      amount: walletTransactionsTable.amount,
    })
    .from(walletTransactionsTable)
    .where(conds.length ? and(...conds) : undefined);

  type Agg = { deposit: number; spend: number; profitShare: number; adjust: number };
  const byMember = new Map<number, Agg>();
  const totals: Agg = { deposit: 0, spend: 0, profitShare: 0, adjust: 0 };
  for (const t of txs) {
    let a = byMember.get(t.memberId);
    if (!a) {
      a = { deposit: 0, spend: 0, profitShare: 0, adjust: 0 };
      byMember.set(t.memberId, a);
    }
    if (t.type === "deposit") {
      a.deposit += t.amount;
      totals.deposit += t.amount;
    } else if (t.type === "payment") {
      a.spend += -t.amount;
      totals.spend += -t.amount;
    } else if (t.type === "refund") {
      a.spend -= t.amount;
      totals.spend -= t.amount;
    } else if (t.type === "profit_share") {
      a.profitShare += t.amount;
      totals.profitShare += t.amount;
    } else if (t.type === "adjust") {
      a.adjust += t.amount;
      totals.adjust += t.amount;
    }
  }

  res.json({
    from: from || null,
    to: to || null,
    totalBalance: members.reduce((s, m) => s + m.walletBalance, 0),
    depositTotal: totals.deposit,
    spendTotal: totals.spend,
    profitShareTotal: totals.profitShare,
    adjustTotal: totals.adjust,
    members: members
      .map((m) => {
        const a = byMember.get(m.id);
        return {
          memberId: m.id,
          username: m.username,
          name: m.name,
          tier: m.tier,
          balance: m.walletBalance,
          depositTotal: a?.deposit ?? 0,
          spendTotal: a?.spend ?? 0,
          profitShareTotal: a?.profitShare ?? 0,
        };
      })
      .sort((a, b) => b.balance - a.balance),
  });
});

async function loadMemberWallet(memberId: number) {
  const [m] = await db
    .select()
    .from(membersTable)
    .where(eq(membersTable.id, memberId))
    .limit(1);
  if (!m) return null;
  const txs = await db
    .select()
    .from(walletTransactionsTable)
    .where(eq(walletTransactionsTable.memberId, memberId))
    .orderBy(desc(walletTransactionsTable.createdAt))
    .limit(300);
  return {
    memberId: m.id,
    username: m.username,
    name: m.name,
    tier: m.tier,
    balance: m.walletBalance,
    transactions: txs.map(serializeTx),
  };
}

router.get("/admin/wallets/:memberId", requireAdmin, async (req, res) => {
  const memberId = Number(req.params.memberId);
  if (!Number.isInteger(memberId)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const wallet = await loadMemberWallet(memberId);
  if (!wallet) {
    res.status(404).json({ error: "找不到此會員" });
    return;
  }
  res.json(wallet);
});

router.post("/admin/wallets/:memberId/adjust", requireAdmin, async (req, res) => {
  const memberId = Number(req.params.memberId);
  if (!Number.isInteger(memberId)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const parsed = AdjustAdminMemberWalletBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "資料不完整" });
    return;
  }
  const { type, amount, reason } = parsed.data;
  if (amount === 0) {
    res.status(400).json({ error: "金額不可為 0" });
    return;
  }
  if (type === "deposit" && amount <= 0) {
    res.status(400).json({ error: "儲值金額必須為正數" });
    return;
  }

  try {
    await db.transaction(async (tx) => {
      const [member] = await tx
        .select()
        .from(membersTable)
        .where(eq(membersTable.id, memberId))
        .for("update")
        .limit(1);
      if (!member) throw new Error("MEMBER_NOT_FOUND");
      const newBalance = member.walletBalance + amount;
      if (newBalance < 0) throw new Error("NEGATIVE_BALANCE");
      await tx
        .update(membersTable)
        .set({ walletBalance: newBalance })
        .where(eq(membersTable.id, memberId));
      await tx.insert(walletTransactionsTable).values({
        memberId,
        type,
        amount,
        balanceAfter: newBalance,
        reason: reason || (type === "deposit" ? "管理員儲值" : "管理員調整"),
        createdBy: req.member!.id,
      });
    });
  } catch (err) {
    if (err instanceof Error && err.message === "MEMBER_NOT_FOUND") {
      res.status(404).json({ error: "找不到此會員" });
      return;
    }
    if (err instanceof Error && err.message === "NEGATIVE_BALANCE") {
      res.status(400).json({ error: "調整後餘額不可為負" });
      return;
    }
    throw err;
  }

  res.json(await loadMemberWallet(memberId));
});

export default router;
