/**
 * AI 點數：使用 AI 助理與 Bot 連線會扣點，點數由後台以 Stripe 刷卡儲值。
 *
 * 設定（部署環境變數）：
 *   AI_CREDITS_ENFORCED       設為 "false" 可暫時不扣點（預設會扣）
 *   AI_CREDIT_PACK_POINTS     一包幾點（預設 100）
 *   AI_CREDIT_PACK_AMOUNT     一包的價格，以該幣別最小單位計（預設 1000＝US$10.00）
 *   AI_CREDIT_PACK_CURRENCY   幣別（預設 usd）
 *   STRIPE_SECRET_KEY         收款方的 Stripe 金鑰（只放在 Secrets）
 *   STRIPE_WEBHOOK_SECRET     Stripe webhook 簽章密鑰（只放在 Secrets）
 *
 * 餘額只會經由這個檔案的函式變動：付款入帳（冪等）、使用扣點（原子）、
 * 以及平台方用指令補點（scripts/grant-ai-credits.ts）。後台沒有手動加點的入口。
 */
import { sql } from "drizzle-orm";
import { db, aiCreditAccountTable, aiCreditTransactionsTable } from "@workspace/db";
import { desc, eq } from "drizzle-orm";

const positiveInt = (value: string | undefined, fallback: number) => {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : fallback;
};

export function creditPricing() {
  return {
    packPoints: positiveInt(process.env.AI_CREDIT_PACK_POINTS, 100),
    packAmount: positiveInt(process.env.AI_CREDIT_PACK_AMOUNT, 1000),
    currency: (process.env.AI_CREDIT_PACK_CURRENCY || "usd").trim().toLowerCase(),
  };
}

export const creditsEnforced = () =>
  (process.env.AI_CREDITS_ENFORCED || "true").trim().toLowerCase() !== "false";

const rowsOf = (result: unknown) =>
  ((result as { rows?: unknown[] }).rows ?? (result as unknown[])) as Array<Record<string, unknown>>;

export async function getCreditBalance(): Promise<number> {
  const [row] = await db
    .select({ balance: aiCreditAccountTable.balance })
    .from(aiCreditAccountTable)
    .where(eq(aiCreditAccountTable.id, 1))
    .limit(1);
  return row?.balance ?? 0;
}

export async function listCreditTransactions(limit = 100) {
  return db
    .select()
    .from(aiCreditTransactionsTable)
    .orderBy(desc(aiCreditTransactionsTable.createdAt), desc(aiCreditTransactionsTable.id))
    .limit(limit);
}

/**
 * 使用扣點（原子）：餘額足夠才會扣成功。回傳 true＝可以繼續使用。
 * 未啟用扣點時一律回傳 true 且不記錄。
 */
export async function chargeAiCredits(
  cost: number,
  reason: string,
  memberId?: number | null,
): Promise<boolean> {
  if (!creditsEnforced() || cost <= 0) return true;
  const result = await db.execute(sql`
    UPDATE ai_credit_account
    SET balance = balance - ${cost}, updated_at = now()
    WHERE id = 1 AND balance >= ${cost}
    RETURNING balance
  `);
  const rows = rowsOf(result);
  if (rows.length === 0) return false;
  // 紀錄寫入失敗不影響已完成的扣點
  await db
    .insert(aiCreditTransactionsTable)
    .values({
      delta: -cost,
      balanceAfter: Number(rows[0].balance),
      reason: reason.slice(0, 200),
      memberId: memberId ?? null,
    })
    .catch(() => {});
  return true;
}

/**
 * 加點（交易式）。帶 stripeRef 時具冪等性：同一筆付款重複呼叫只會入帳一次。
 * 回傳 credited=false 表示這筆付款先前已入帳。
 */
export async function addAiCredits(args: {
  points: number;
  reason: string;
  stripeRef?: string | null;
  memberId?: number | null;
}): Promise<{ credited: boolean; balance: number }> {
  if (!Number.isInteger(args.points) || args.points <= 0)
    throw new Error("加點數量須為正整數");
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`INSERT INTO ai_credit_account (id, balance) VALUES (1, 0) ON CONFLICT (id) DO NOTHING`,
    );
    const inserted = rowsOf(
      await tx.execute(sql`
        INSERT INTO ai_credit_transactions (delta, balance_after, reason, stripe_ref, member_id)
        VALUES (${args.points}, 0, ${args.reason.slice(0, 200)}, ${args.stripeRef ?? null}, ${args.memberId ?? null})
        ON CONFLICT (stripe_ref) WHERE stripe_ref IS NOT NULL DO NOTHING
        RETURNING id
      `),
    );
    if (inserted.length === 0) {
      const [row] = await tx
        .select({ balance: aiCreditAccountTable.balance })
        .from(aiCreditAccountTable)
        .where(eq(aiCreditAccountTable.id, 1));
      return { credited: false, balance: row?.balance ?? 0 };
    }
    const updated = rowsOf(
      await tx.execute(sql`
        UPDATE ai_credit_account
        SET balance = balance + ${args.points}, updated_at = now()
        WHERE id = 1
        RETURNING balance
      `),
    );
    const balance = Number(updated[0].balance);
    await tx.execute(
      sql`UPDATE ai_credit_transactions SET balance_after = ${balance} WHERE id = ${Number(inserted[0].id)}`,
    );
    return { credited: true, balance };
  });
}

export const INSUFFICIENT_CREDITS_MESSAGE =
  "AI 點數不足，請系統管理員到後台「AI 點數」儲值後再繼續使用。";
