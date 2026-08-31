import { Router, type IRouter } from "express";
import { desc, eq } from "drizzle-orm";
import {
  db,
  institutionsTable,
  institutionWalletTransactionsTable,
  membersTable,
  type InstitutionWalletTransaction,
} from "@workspace/db";
import { AdjustInstitutionWalletBody } from "@workspace/api-zod";
import { requireAdmin } from "../middlewares/requireMember";

const router: IRouter = Router();

function serializeTx(
  t: InstitutionWalletTransaction & { memberName?: string | null },
) {
  return {
    id: t.id,
    institutionId: t.institutionId,
    memberId: t.memberId,
    memberName: t.memberName ?? null,
    type: t.type,
    amount: t.amount,
    balanceAfter: t.balanceAfter,
    reason: t.reason,
    refNo: t.refNo,
    createdAt: t.createdAt.toISOString(),
  };
}

async function loadInstitutionWallet(institutionId: number) {
  const [inst] = await db
    .select()
    .from(institutionsTable)
    .where(eq(institutionsTable.id, institutionId))
    .limit(1);
  if (!inst) return null;
  const txs = await db
    .select({
      id: institutionWalletTransactionsTable.id,
      institutionId: institutionWalletTransactionsTable.institutionId,
      memberId: institutionWalletTransactionsTable.memberId,
      type: institutionWalletTransactionsTable.type,
      amount: institutionWalletTransactionsTable.amount,
      balanceAfter: institutionWalletTransactionsTable.balanceAfter,
      reason: institutionWalletTransactionsTable.reason,
      refNo: institutionWalletTransactionsTable.refNo,
      createdBy: institutionWalletTransactionsTable.createdBy,
      createdAt: institutionWalletTransactionsTable.createdAt,
      memberName: membersTable.name,
    })
    .from(institutionWalletTransactionsTable)
    .leftJoin(
      membersTable,
      eq(institutionWalletTransactionsTable.memberId, membersTable.id),
    )
    .where(eq(institutionWalletTransactionsTable.institutionId, institutionId))
    .orderBy(desc(institutionWalletTransactionsTable.createdAt))
    .limit(300);
  return {
    institutionId: inst.id,
    institutionName: inst.name,
    type: inst.type,
    city: inst.city,
    balance: inst.walletBalance,
    transactions: txs.map(serializeTx),
  };
}

router.get("/admin/institution-wallets", requireAdmin, async (_req, res) => {
  const rows = await db
    .select({
      institutionId: institutionsTable.id,
      institutionName: institutionsTable.name,
      type: institutionsTable.type,
      city: institutionsTable.city,
      balance: institutionsTable.walletBalance,
    })
    .from(institutionsTable)
    .orderBy(desc(institutionsTable.walletBalance));
  res.json(rows);
});

router.get(
  "/admin/institution-wallets/:institutionId",
  requireAdmin,
  async (req, res) => {
    const institutionId = Number(req.params.institutionId);
    if (!Number.isInteger(institutionId)) {
      res.status(400).json({ error: "Invalid id" });
      return;
    }
    const wallet = await loadInstitutionWallet(institutionId);
    if (!wallet) {
      res.status(404).json({ error: "找不到此機構" });
      return;
    }
    res.json(wallet);
  },
);

router.post(
  "/admin/institution-wallets/:institutionId/adjust",
  requireAdmin,
  async (req, res) => {
    const institutionId = Number(req.params.institutionId);
    if (!Number.isInteger(institutionId)) {
      res.status(400).json({ error: "Invalid id" });
      return;
    }
    const parsed = AdjustInstitutionWalletBody.safeParse(req.body);
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
        const [inst] = await tx
          .select()
          .from(institutionsTable)
          .where(eq(institutionsTable.id, institutionId))
          .for("update")
          .limit(1);
        if (!inst) throw new Error("INSTITUTION_NOT_FOUND");
        const newBalance = inst.walletBalance + amount;
        if (newBalance < 0) throw new Error("NEGATIVE_BALANCE");
        await tx
          .update(institutionsTable)
          .set({ walletBalance: newBalance })
          .where(eq(institutionsTable.id, institutionId));
        await tx.insert(institutionWalletTransactionsTable).values({
          institutionId,
          type,
          amount,
          balanceAfter: newBalance,
          reason: reason || (type === "deposit" ? "管理員儲值" : "管理員調整"),
          createdBy: req.member!.id,
        });
      });
    } catch (err) {
      if (err instanceof Error && err.message === "INSTITUTION_NOT_FOUND") {
        res.status(404).json({ error: "找不到此機構" });
        return;
      }
      if (err instanceof Error && err.message === "NEGATIVE_BALANCE") {
        res.status(400).json({ error: "調整後餘額不可為負" });
        return;
      }
      throw err;
    }

    res.json(await loadInstitutionWallet(institutionId));
  },
);

export default router;
