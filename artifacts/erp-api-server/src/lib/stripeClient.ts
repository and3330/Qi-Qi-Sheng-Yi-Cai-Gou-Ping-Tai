import Stripe from "stripe";
import { StripeSync } from "stripe-replit-sync";
import { resolveDatabaseUrl } from "@workspace/erp-db";

/** 從 Replit connection API 取得 Stripe 憑證（不快取，金鑰可能輪替） */
async function getStripeCredentials(): Promise<{ secretKey: string; webhookSecret?: string }> {
  // 優先使用使用者提供的 Secret（Replit Secrets），其次才是 Stripe 整合連線
  if (process.env.STRIPE_SECRET_KEY) {
    return { secretKey: process.env.STRIPE_SECRET_KEY };
  }
  const hostname = process.env.REPLIT_CONNECTORS_HOSTNAME;
  const xReplitToken = process.env.REPL_IDENTITY
    ? "repl " + process.env.REPL_IDENTITY
    : process.env.WEB_REPL_RENEWAL
      ? "depl " + process.env.WEB_REPL_RENEWAL
      : null;

  if (!hostname || !xReplitToken) {
    throw new Error("Missing Replit environment variables. Ensure the Stripe integration is connected via the Integrations tab.");
  }

  const resp = await fetch(
    `https://${hostname}/api/v2/connection?include_secrets=true&connector_names=stripe`,
    {
      headers: { Accept: "application/json", X_REPLIT_TOKEN: xReplitToken },
      signal: AbortSignal.timeout(10_000),
    },
  );
  if (!resp.ok) throw new Error(`Failed to fetch Stripe credentials: ${resp.status} ${resp.statusText}`);

  const data: any = await resp.json();
  const settings = data.items?.[0]?.settings;
  const secretKey = settings?.secret_key ?? settings?.secret;
  if (!secretKey) {
    throw new Error("Stripe integration not connected or missing secret key. Connect Stripe via the Integrations tab first.");
  }
  return { secretKey, webhookSecret: settings.webhook_secret };
}

export async function getUncachableStripeClient(): Promise<Stripe> {
  const { secretKey } = await getStripeCredentials();
  return new Stripe(secretKey);
}

export async function getStripeSync(): Promise<StripeSync> {
  const databaseUrl = resolveDatabaseUrl();
  const { secretKey, webhookSecret } = await getStripeCredentials();
  return new StripeSync({
    poolConfig: { connectionString: databaseUrl },
    stripeSecretKey: secretKey,
    stripeWebhookSecret: webhookSecret ?? "",
  });
}
