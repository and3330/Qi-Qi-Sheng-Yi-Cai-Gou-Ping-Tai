import { Router, type IRouter } from "express";
import { desc, eq, sql } from "drizzle-orm";
import { db, tenantsTable, creditTransactionsTable } from "@workspace/erp-db";
import { requireAuth, requireRole, sessionOnly } from "../middleware/require-auth";
import { reqTenantId } from "../middleware/tenant-context";
import { loadTenant, invalidateTenantCache, isSubscriptionActive } from "../middleware/saas-guard";
import { getUncachableStripeClient } from "../lib/stripeClient";
import { fulfillCheckoutSession, CREDITS_PER_PACK } from "../lib/billing-fulfill";

const router: IRouter = Router();

router.use("/billing", sessionOnly, requireAuth);

const SUB_LOOKUP = "erp_monthly_49";
const CREDIT_LOOKUP = "ai_credits_100";

async function findPriceId(lookupKey: string): Promise<string | null> {
  const result = await db.execute(
    sql`SELECT id FROM stripe.prices WHERE lookup_key = ${lookupKey} AND active = true LIMIT 1`,
  );
  return (result.rows[0]?.id as string) ?? null;
}

function appBaseUrl(req: any): string {
  const origin = req.headers.origin as string | undefined;
  if (origin) return origin;
  return `${req.protocol}://${req.get("host")}`;
}

/** 訂閱與點數狀態（並從 stripe 同步表懶更新訂閱狀態） */
router.get("/billing/status", async (req, res): Promise<void> => {
  const tenantId = reqTenantId(req);
  let tenant = await loadTenant(tenantId, true);
  if (!tenant) { res.status(404).json({ error: "租戶不存在" }); return; }

  // 懶同步：有訂閱 id 時，從 stripe.subscriptions 查最新狀態
  if (tenant.stripeSubscriptionId) {
    const result = await db.execute(
      sql`SELECT status FROM stripe.subscriptions WHERE id = ${tenant.stripeSubscriptionId} LIMIT 1`,
    );
    const stripeStatus = result.rows[0]?.status as string | undefined;
    if (stripeStatus) {
      const mapped = stripeStatus === "active" || stripeStatus === "trialing" ? "active"
        : stripeStatus === "past_due" || stripeStatus === "unpaid" ? "past_due"
        : "canceled";
      if (mapped !== tenant.status && !tenant.isExempt) {
        await db.update(tenantsTable).set({ status: mapped }).where(eq(tenantsTable.id, tenantId));
        invalidateTenantCache(tenantId);
        tenant = await loadTenant(tenantId, true);
      }
    }
  }

  const t = tenant!;
  const trialDaysLeft = t.trialEndsAt
    ? Math.max(0, Math.ceil((new Date(t.trialEndsAt).getTime() - Date.now()) / 86_400_000))
    : null;
  res.json({
    tenant: { id: t.id, name: t.name, status: t.status, isExempt: t.isExempt },
    subscriptionActive: isSubscriptionActive(t),
    trialEndsAt: t.trialEndsAt,
    trialDaysLeft,
    aiCredits: t.aiCredits,
    pricing: { monthlyUsd: 49, creditPackUsd: 10, creditPackPoints: CREDITS_PER_PACK },
  });
});

/** 點數異動紀錄 */
router.get("/billing/credits/history", async (req, res): Promise<void> => {
  const tenantId = reqTenantId(req);
  const rows = await db.select().from(creditTransactionsTable)
    .where(eq(creditTransactionsTable.tenantId, tenantId))
    .orderBy(desc(creditTransactionsTable.createdAt)).limit(100);
  res.json(rows);
});

async function ensureStripeCustomer(tenantId: number): Promise<string> {
  const tenant = await loadTenant(tenantId, true);
  if (!tenant) throw new Error("租戶不存在");
  if (tenant.stripeCustomerId) return tenant.stripeCustomerId;
  const stripe = await getUncachableStripeClient();
  const customer = await stripe.customers.create({
    name: tenant.name,
    email: tenant.contactEmail ?? undefined,
    metadata: { tenantId: String(tenantId) },
  });
  await db.update(tenantsTable).set({ stripeCustomerId: customer.id }).where(eq(tenantsTable.id, tenantId));
  invalidateTenantCache(tenantId);
  return customer.id;
}

/** 建立月費訂閱 Checkout */
router.post("/billing/subscribe", requireRole("owner", "admin"), async (req, res): Promise<void> => {
  const tenantId = reqTenantId(req);
  const tenant = await loadTenant(tenantId, true);
  if (!tenant) { res.status(404).json({ error: "租戶不存在" }); return; }
  if (tenant.isExempt) { res.status(400).json({ error: "此公司為免收費帳戶，不需訂閱" }); return; }
  const priceId = await findPriceId(SUB_LOOKUP);
  if (!priceId) { res.status(503).json({ error: "訂閱方案尚未設定，請稍後再試" }); return; }

  const customerId = await ensureStripeCustomer(tenantId);
  const stripe = await getUncachableStripeClient();
  const base = appBaseUrl(req);
  const session = await stripe.checkout.sessions.create({
    customer: customerId,
    mode: "subscription",
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: `${base}/app/billing?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${base}/app/billing?canceled=1`,
    metadata: { tenantId: String(tenantId), kind: "subscription" },
  });
  res.json({ url: session.url });
});

/** 購買 AI 點數（一次性付款，US$10 = 100 點，可買多包） */
router.post("/billing/buy-credits", requireRole("owner", "admin"), async (req, res): Promise<void> => {
  const tenantId = reqTenantId(req);
  const packs = Math.min(10, Math.max(1, Number(req.body?.packs) || 1));
  const priceId = await findPriceId(CREDIT_LOOKUP);
  if (!priceId) { res.status(503).json({ error: "點數方案尚未設定，請稍後再試" }); return; }

  const customerId = await ensureStripeCustomer(tenantId);
  const stripe = await getUncachableStripeClient();
  const base = appBaseUrl(req);
  const session = await stripe.checkout.sessions.create({
    customer: customerId,
    mode: "payment",
    line_items: [{ price: priceId, quantity: packs }],
    success_url: `${base}/app/billing?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${base}/app/billing?canceled=1`,
    metadata: { tenantId: String(tenantId), kind: "credits", packs: String(packs) },
  });
  res.json({ url: session.url });
});

/** Checkout 完成確認（success_url 回來時呼叫；冪等） */
router.post("/billing/confirm", async (req, res): Promise<void> => {
  const tenantId = reqTenantId(req);
  const sessionId = String(req.body?.sessionId || "");
  if (!sessionId.startsWith("cs_")) { res.status(400).json({ error: "無效的 session id" }); return; }

  const stripe = await getUncachableStripeClient();
  const session = await stripe.checkout.sessions.retrieve(sessionId);
  if (session.metadata?.tenantId !== String(tenantId)) { res.status(403).json({ error: "此交易不屬於你的公司" }); return; }
  if (session.payment_status !== "paid") { res.json({ ok: false, status: session.payment_status }); return; }

  // 交易式 + 冪等入帳（與 webhook 共用同一套邏輯；webhook 為主要入帳路徑，這裡是使用者返回時的即時確認）
  const result = await fulfillCheckoutSession(session);
  res.json({ ok: true, ...result });
});

/** Stripe 客戶入口（管理/取消訂閱、更新卡片） */
router.post("/billing/portal", requireRole("owner", "admin"), async (req, res): Promise<void> => {
  const tenantId = reqTenantId(req);
  const tenant = await loadTenant(tenantId, true);
  if (!tenant?.stripeCustomerId) { res.status(400).json({ error: "尚未有付款紀錄" }); return; }
  const stripe = await getUncachableStripeClient();
  const session = await stripe.billingPortal.sessions.create({
    customer: tenant.stripeCustomerId,
    return_url: `${appBaseUrl(req)}/app/billing`,
  });
  res.json({ url: session.url });
});

export default router;
