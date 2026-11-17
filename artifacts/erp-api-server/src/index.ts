import { runMigrations } from "stripe-replit-sync";
import app from "./app";
import { logger } from "./lib/logger";
import { startScheduler } from "./lib/scheduler";
import { startDemoMode } from "./demo/demo-seed";
import { getStripeSync } from "./lib/stripeClient";
import { resolveDatabaseUrl, runtimeDatabaseProvider } from "@workspace/erp-db";
import { migrationMaintenanceEnabled } from "./lib/migration-maintenance";
import { bootstrapErpSchema } from "./lib/schema-bootstrap";

/** 啟動時初始化 Stripe schema 與資料同步（失敗不擋 ERP 本體） */
async function initStripe(): Promise<void> {
  if (runtimeDatabaseProvider() === "supabase") {
    logger.info("External database: automatic Stripe schema sync disabled");
    return;
  }
  if (process.env.ENABLE_STRIPE_SYNC !== "true") { // 七期網站不收訂閱費，預設不啟動 Stripe
    logger.info("Stripe startup sync disabled");
    return;
  }
  try {
    const databaseUrl = resolveDatabaseUrl();
    await runMigrations({ databaseUrl });
    const stripeSync = await getStripeSync();
    const webhookBaseUrl = `https://${process.env.REPLIT_DOMAINS?.split(",")[0]}`;
    await stripeSync.findOrCreateManagedWebhook(`${webhookBaseUrl}/api/stripe/webhook`);
    stripeSync.syncBackfill()
      .then(() => logger.info("Stripe data synced"))
      .catch((err) => logger.error({ err }, "Stripe sync failed"));
    logger.info("Stripe initialized");
  } catch (err) {
    logger.error({ err }, "Stripe init failed (billing disabled until fixed)");
  }
}

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

// 七期網站：先把 ERP 的資料表建好、補齊，再開始收請求。
// 失敗就不啟動（Replit 發布時新版啟動失敗會保留舊版），避免帶著缺欄位的資料庫上線。
try {
  await bootstrapErpSchema();
} catch (err) {
  logger.error({ err }, "ERP 資料表建立失敗，伺服器不啟動");
  process.exit(1);
}

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }
  logger.info({ port }, "Server listening");
  if (migrationMaintenanceEnabled()) {
    logger.warn("Migration maintenance enabled: webhooks, MCP, sessions, scheduler, demo and startup sync are paused");
    return;
  }
  void initStripe();
  startScheduler();
  startDemoMode();
});
