import { Router, type IRouter } from "express";
import { desc, eq } from "drizzle-orm";
import { db, pointTransactionsTable } from "@workspace/db";
import { requireMember } from "../middlewares/requireMember";

const router: IRouter = Router();

/** 我的點數異動紀錄（點數餘額在 /auth/me 的 points 欄位） */
router.get("/member/points/transactions", requireMember, async (req, res) => {
  const rows = await db
    .select()
    .from(pointTransactionsTable)
    .where(eq(pointTransactionsTable.memberId, req.member!.id))
    .orderBy(desc(pointTransactionsTable.createdAt))
    .limit(200);
  res.json(
    rows.map((t) => ({
      id: t.id,
      type: t.type,
      delta: t.delta,
      balanceAfter: t.balanceAfter,
      orderId: t.orderId,
      note: t.note,
      createdAt: t.createdAt.toISOString(),
    })),
  );
});

export default router;
