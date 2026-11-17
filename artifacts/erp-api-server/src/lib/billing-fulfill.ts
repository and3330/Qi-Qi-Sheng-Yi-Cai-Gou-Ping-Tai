import type Stripe from "stripe";
import { pool } from "@workspace/erp-db";
import { invalidateTenantCache } from "../middleware/saas-guard";
import { logger } from "./logger";

export const CREDITS_PER_PACK = 100;

/**
 * 依 Checkout Session 完成訂閱/點數入帳。
 * 交易式且冪等（credit_transactions.stripe_ref 唯一索引）：
 * webhook 與 /billing/confirm 都呼叫這裡，重複呼叫不會重複入點。
 * tenants / credit_transactions 不在 RLS 範圍，使用擁有者連線即可。
 */
export async function fulfillCheckoutSession(session: Stripe.Checkout.Session): Promise<{ kind: string; credits?: number; alreadyProcessed?: boolean }> {
  const tenantId = Number(session.metadata?.tenantId);
  if (!Number.isInteger(tenantId) || tenantId <= 0) throw new Error("checkout session missing tenantId metadata");
  if (session.payment_status !== "paid") return { kind: "unpaid" };

  const kind = session.metadata?.kind;
  if (kind === "subscription") {
    const subId = typeof session.subscription === "string" ? session.subscription : session.subscription?.id;
    await pool.query(
      `UPDATE tenants SET status='active', stripe_subscription_id=COALESCE($2, stripe_subscription_id) WHERE id=$1`,
      [tenantId, subId ?? null],
    );
    invalidateTenantCache(tenantId);
    return { kind: "subscription" };
  }

  if (kind === "credits") {
    const packs = Number(session.metadata?.packs) || 1;
    const credits = packs * CREDITS_PER_PACK;
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const ins = await client.query(
        `INSERT INTO credit_transactions (tenant_id, delta, balance_after, reason, stripe_ref)
         VALUES ($1, $2, 0, $3, $4)
         ON CONFLICT (stripe_ref) WHERE stripe_ref IS NOT NULL DO NOTHING
         RETURNING id`,
        [tenantId, credits, `購買 AI 點數 ${packs} 包（${credits} 點）`, session.id],
      );
      if (ins.rows.length === 0) {
        await client.query("ROLLBACK");
        return { kind: "credits", alreadyProcessed: true };
      }
      const upd = await client.query(
        `UPDATE tenants SET ai_credits = ai_credits + $2 WHERE id=$1 RETURNING ai_credits`,
        [tenantId, credits],
      );
      await client.query(`UPDATE credit_transactions SET balance_after=$2 WHERE id=$1`, [ins.rows[0].id, upd.rows[0].ai_credits]);
      await client.query("COMMIT");
      invalidateTenantCache(tenantId);
      return { kind: "credits", credits };
    } catch (e) {
      await client.query("ROLLBACK").catch(() => {});
      throw e;
    } finally {
      client.release();
    }
  }

  return { kind: "unknown" };
}

/** 依 Stripe 訂閱狀態同步 tenants.status（webhook 觸發） */
export async function syncSubscriptionStatus(subscriptionId: string, stripeStatus: string): Promise<void> {
  const mapped = stripeStatus === "active" || stripeStatus === "trialing" ? "active"
    : stripeStatus === "past_due" || stripeStatus === "unpaid" ? "past_due"
    : "canceled";
  const r = await pool.query(
    `UPDATE tenants SET status=$2 WHERE stripe_subscription_id=$1 AND is_exempt=false RETURNING id`,
    [subscriptionId, mapped],
  );
  for (const row of r.rows) invalidateTenantCache(row.id);
  if (r.rows.length) logger.info({ subscriptionId, mapped }, "tenant subscription status synced from webhook");
}
