/**
 * AI 點數（後台）：查看餘額與紀錄、以 Stripe 刷卡儲值。
 * 沒有手動加點的入口；餘額只會因付款入帳而增加。
 */
import { Router, type IRouter, type Request } from "express";
import { requireAdmin, requireOps } from "../middlewares/requireMember";
import {
  creditPricing,
  creditsEnforced,
  getCreditBalance,
  listCreditTransactions,
} from "../lib/aiCredits";
import {
  createCreditCheckout,
  fulfillCreditCheckout,
  stripeConfigured,
} from "../lib/stripeCredits";
import { describeAiProviders } from "@workspace/integrations-openai-ai-server";

const router: IRouter = Router();

function publicBaseUrl(req: Request): string {
  const configured = process.env.PUBLIC_BASE_URL?.trim().replace(/\/+$/, "");
  if (configured) return configured;
  const host = String(req.headers["x-forwarded-host"] ?? req.headers.host ?? "")
    .split(",")[0]
    .trim();
  return `${req.protocol}://${host}`;
}

router.get("/admin/ai-credits", requireOps, async (_req, res) => {
  const [balance, transactions] = await Promise.all([
    getCreditBalance(),
    listCreditTransactions(100),
  ]);
  const pricing = creditPricing();
  const strong = describeAiProviders().find((p) => p.tier === "strong");
  res.json({
    balance,
    enforced: creditsEnforced(),
    stripeConfigured: stripeConfigured(),
    packPoints: pricing.packPoints,
    packAmount: pricing.packAmount,
    currency: pricing.currency,
    aiProvider: strong?.source ?? "none",
    aiModel: strong?.model ?? "",
    transactions: transactions.map((t) => ({
      id: t.id,
      delta: t.delta,
      balanceAfter: t.balanceAfter,
      reason: t.reason,
      createdAt: t.createdAt.toISOString(),
    })),
  });
});

router.post("/admin/ai-credits/checkout", requireAdmin, async (req, res) => {
  if (!stripeConfigured()) {
    res.status(503).json({ error: "尚未開通刷卡儲值，請聯絡系統服務商" });
    return;
  }
  const packs = Math.min(50, Math.max(1, Math.floor(Number(req.body?.packs) || 1)));
  try {
    const url = await createCreditCheckout({
      packs,
      baseUrl: publicBaseUrl(req),
      memberId: req.member!.id,
      email: req.member!.email,
    });
    res.json({ url });
  } catch (err) {
    req.log.error({ err }, "create credit checkout failed");
    res.status(502).json({ error: "無法建立結帳頁，請稍後再試" });
  }
});

/** 付款後返回頁面時呼叫，立即確認入帳（與 webhook 共用同一個冪等入帳函式） */
router.post("/admin/ai-credits/confirm", requireOps, async (req, res) => {
  const sessionId = String(req.body?.sessionId || "");
  if (!sessionId.startsWith("cs_") || !stripeConfigured()) {
    res.status(400).json({ error: "無效的付款資訊" });
    return;
  }
  try {
    const result = await fulfillCreditCheckout(sessionId);
    res.json({
      status: result.status,
      points: result.points ?? 0,
      balance: result.balance ?? (await getCreditBalance()),
    });
  } catch (err) {
    req.log.error({ err }, "confirm credit checkout failed");
    res.status(502).json({ error: "無法確認付款，請稍後重新整理" });
  }
});

export default router;
