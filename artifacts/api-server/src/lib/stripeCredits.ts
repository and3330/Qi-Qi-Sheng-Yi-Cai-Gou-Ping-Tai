/**
 * AI 點數的 Stripe 收款：建立結帳頁、付款完成後入帳。
 * 入帳一律向 Stripe 取回付款正本後才執行，並以 Checkout Session id 防止重複入帳。
 * webhook 與「付款後返回頁面」兩條路徑共用同一個入帳函式。
 */
import Stripe from "stripe";
import { addAiCredits, creditPricing } from "./aiCredits";

export const stripeConfigured = () => !!process.env.STRIPE_SECRET_KEY?.trim();

export function getStripe(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY?.trim();
  if (!key) throw new Error("尚未設定 STRIPE_SECRET_KEY");
  return new Stripe(key);
}

/** 標記這筆結帳屬於本系統的 AI 點數，入帳時會核對 */
const CHECKOUT_KIND = "ai_credits";

export async function createCreditCheckout(args: {
  packs: number;
  baseUrl: string;
  memberId: number;
  email?: string | null;
}): Promise<string> {
  const pricing = creditPricing();
  const stripe = getStripe();
  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    line_items: [
      {
        quantity: args.packs,
        price_data: {
          currency: pricing.currency,
          unit_amount: pricing.packAmount,
          product_data: { name: `AI 點數 ${pricing.packPoints} 點` },
        },
      },
    ],
    ...(args.email ? { customer_email: args.email } : {}),
    success_url: `${args.baseUrl}/admin/ai-credits?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${args.baseUrl}/admin/ai-credits?canceled=1`,
    metadata: {
      kind: CHECKOUT_KIND,
      packs: String(args.packs),
      // 點數以建立結帳當下的設定為準，之後調整價格不影響已建立的結帳
      points: String(args.packs * pricing.packPoints),
      memberId: String(args.memberId),
    },
  });
  if (!session.url) throw new Error("Stripe 未回傳結帳網址");
  return session.url;
}

/** 依 Checkout Session 入帳（冪等）。只處理已付款、且屬於本系統 AI 點數的結帳。 */
export async function fulfillCreditCheckout(
  sessionId: string,
): Promise<{ status: "credited" | "already" | "unpaid" | "ignored"; points?: number; balance?: number }> {
  const stripe = getStripe();
  const session = await stripe.checkout.sessions.retrieve(sessionId);
  if (session.metadata?.kind !== CHECKOUT_KIND) return { status: "ignored" };
  if (session.payment_status !== "paid") return { status: "unpaid" };
  const points = Number(session.metadata?.points);
  if (!Number.isInteger(points) || points <= 0) return { status: "ignored" };
  const memberId = Number(session.metadata?.memberId);
  const result = await addAiCredits({
    points,
    reason: `刷卡儲值 ${points} 點`,
    stripeRef: session.id,
    memberId: Number.isInteger(memberId) ? memberId : null,
  });
  return {
    status: result.credited ? "credited" : "already",
    points,
    balance: result.balance,
  };
}

/** 驗證 webhook 簽章並處理付款完成事件。簽章不符會丟出錯誤。 */
export async function handleStripeWebhook(payload: Buffer, signature: string): Promise<void> {
  const secret = process.env.STRIPE_WEBHOOK_SECRET?.trim();
  if (!secret) throw new Error("尚未設定 STRIPE_WEBHOOK_SECRET");
  const stripe = getStripe();
  const event = stripe.webhooks.constructEvent(payload, signature, secret);
  if (
    event.type === "checkout.session.completed" ||
    event.type === "checkout.session.async_payment_succeeded"
  ) {
    const session = event.data.object as Stripe.Checkout.Session;
    await fulfillCreditCheckout(session.id);
  }
}
