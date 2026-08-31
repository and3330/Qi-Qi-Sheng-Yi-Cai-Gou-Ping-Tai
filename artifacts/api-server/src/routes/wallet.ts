import { Router, type IRouter } from "express";
import { desc, eq } from "drizzle-orm";
import { db, membersTable, walletTransactionsTable } from "@workspace/db";
import { requireMember } from "../middlewares/requireMember";

const router: IRouter = Router();

router.get("/wallet", requireMember, async (req, res) => {
  const [member] = await db
    .select({ walletBalance: membersTable.walletBalance })
    .from(membersTable)
    .where(eq(membersTable.id, req.member!.id))
    .limit(1);
  const txs = await db
    .select()
    .from(walletTransactionsTable)
    .where(eq(walletTransactionsTable.memberId, req.member!.id))
    .orderBy(desc(walletTransactionsTable.createdAt))
    .limit(200);
  res.json({
    balance: member?.walletBalance ?? 0,
    transactions: txs.map((t) => ({
      id: t.id,
      type: t.type,
      amount: t.amount,
      balanceAfter: t.balanceAfter,
      reason: t.reason,
      refNo: t.refNo,
      createdAt: t.createdAt.toISOString(),
    })),
  });
});

export default router;
