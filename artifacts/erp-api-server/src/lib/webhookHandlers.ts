import { getStripeSync, getUncachableStripeClient } from "./stripeClient";
import { fulfillCheckoutSession, syncSubscriptionStatus } from "./billing-fulfill";
import { logger } from "./logger";

export class WebhookHandlers {
  static async processWebhook(payload: Buffer, signature: string): Promise<void> {
    if (!Buffer.isBuffer(payload)) {
      throw new Error(
        "STRIPE WEBHOOK ERROR: Payload must be a Buffer. Received type: " + typeof payload +
        ". Ensure webhook route is registered BEFORE app.use(express.json()).",
      );
    }
    const sync = await getStripeSync();
    // 簽章驗證由 stripe-replit-sync 完成；驗證失敗會 throw，不會進到下面的入帳邏輯
    await sync.processWebhook(payload, signature);

    // 付款入帳：不信任 payload 內容，僅取 id 後向 Stripe API 取回正本
    try {
      const event = JSON.parse(payload.toString("utf8"));
      if (event?.type === "checkout.session.completed") {
        const sessionId = event.data?.object?.id;
        if (typeof sessionId === "string" && sessionId.startsWith("cs_")) {
          const stripe = await getUncachableStripeClient();
          const session = await stripe.checkout.sessions.retrieve(sessionId);
          await fulfillCheckoutSession(session);
        }
      } else if (event?.type === "customer.subscription.updated" || event?.type === "customer.subscription.deleted") {
        const subId = event.data?.object?.id;
        if (typeof subId === "string" && subId.startsWith("sub_")) {
          const stripe = await getUncachableStripeClient();
          const sub = await stripe.subscriptions.retrieve(subId);
          await syncSubscriptionStatus(sub.id, sub.status);
        }
      }
    } catch (e: any) {
      // 入帳失敗不能讓 webhook 回 200 → 讓 Stripe 重試
      logger.error({ err: e?.message }, "stripe webhook fulfillment failed");
      throw e;
    }
  }
}
