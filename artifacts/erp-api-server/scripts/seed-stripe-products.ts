import { getUncachableStripeClient } from "../src/lib/stripeClient";

/**
 * 建立 Stripe 產品與價格（冪等，可重複執行）：
 * 1. 神幫手AI ERP 月費 US$49/月（lookup_key: erp_monthly_49）
 * 2. AI 點數 100 點 US$10（lookup_key: ai_credits_100）
 *
 * 執行：pnpm --filter @workspace/erp-api-server exec tsx scripts/seed-stripe-products.ts
 */
async function main() {
  const stripe = await getUncachableStripeClient();

  async function ensurePrice(opts: {
    productName: string; description: string; lookupKey: string;
    unitAmount: number; recurring?: { interval: "month" };
  }) {
    const existing = await stripe.prices.list({ lookup_keys: [opts.lookupKey], limit: 1 });
    if (existing.data.length > 0) {
      console.log(`price ${opts.lookupKey} already exists: ${existing.data[0].id}`);
      return;
    }
    const product = await stripe.products.create({ name: opts.productName, description: opts.description });
    const price = await stripe.prices.create({
      product: product.id,
      unit_amount: opts.unitAmount,
      currency: "usd",
      lookup_key: opts.lookupKey,
      ...(opts.recurring ? { recurring: opts.recurring } : {}),
    });
    console.log(`created ${opts.productName}: product=${product.id} price=${price.id}`);
  }

  await ensurePrice({
    productName: "神幫手AI ERP 月費方案",
    description: "每家公司每月 US$49，人數不限，含完整 ERP 功能",
    lookupKey: "erp_monthly_49",
    unitAmount: 4900,
    recurring: { interval: "month" },
  });
  await ensurePrice({
    productName: "AI 點數 100 點",
    description: "AI 助理對話點數，每包 100 點（1 點 = 1 次 AI 對話）",
    lookupKey: "ai_credits_100",
    unitAmount: 1000,
  });
  console.log("done");
}

main().catch((e) => { console.error(e); process.exit(1); });
