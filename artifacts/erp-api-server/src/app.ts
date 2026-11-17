import express, { type Express } from "express";
import helmet from "helmet";
import cors from "cors";
import cookieParser from "cookie-parser";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";
import { optionalApiKeyAuth } from "./middleware/optional-api-key-auth";
import { employeeAccessGuard } from "./middleware/employee-access-guard";
import { auditLogger } from "./middleware/audit-logger";
import { createSessionMiddleware } from "./lib/auth";
import { multerErrorHandler } from "./middleware/multer-error";
import { tenantContext } from "./middleware/tenant-context";
import { databaseTimings } from "./middleware/database-timings";
import { subscriptionGate } from "./middleware/saas-guard";
import { moduleGuard } from "./middleware/module-guard";
import { permissionGuard } from "./middleware/permission-guard";
import { postedChangeGuard } from "./middleware/posted-change-guard";
import { WebhookHandlers } from "./lib/webhookHandlers";
import mcpRouter from "./mcp";
import { pool, runtimeDatabaseProvider } from "@workspace/erp-db";
import { createHash } from "node:crypto";
import { objectStorageBucketId, privateObjectDir } from "./lib/object-storage";
import { rateLimit } from "express-rate-limit";
import { DATABASE_IDENTITY_SQL, migrationIdentityHandler, migrationMaintenanceGate } from "./lib/migration-maintenance";

const app: Express = express();

app.set("trust proxy", 1);
// 七期網站：商城 API 已佔用 /api，ERP 對外走 /erp-api 與 /erp-mcp。
// 進來後改寫回 ERP 原本的 /api、/mcp 路徑，其餘程式不用改。
app.use((req, _res, next) => {
  if (req.url === "/erp-api" || req.url.startsWith("/erp-api/") || req.url.startsWith("/erp-api?")) req.url = "/api" + req.url.slice(8);
  else if (req.url === "/erp-mcp" || req.url.startsWith("/erp-mcp/") || req.url.startsWith("/erp-mcp?")) req.url = "/mcp" + req.url.slice(8);
  next();
});
app.use(migrationMaintenanceGate());
app.get("/api/migration/status",
  rateLimit({ windowMs: 60_000, limit: 30, standardHeaders: "draft-7", legacyHeaders: false }),
  migrationIdentityHandler(async () => {
    const client = await pool.connect();
    let broken = false;
    try {
      await client.query("BEGIN READ ONLY");
      await client.query("SET LOCAL statement_timeout='5s'");
      const { rows } = await client.query(DATABASE_IDENTITY_SQL);
      return {
        fingerprint: rows[0]?.fingerprint,
        readOnlyReplica: rows[0]?.replica,
        walPosition: rows[0]?.wal_position,
        storageFingerprint: createHash("sha256")
          .update(process.env.ERP_STORAGE_PROVIDER || runtimeDatabaseProvider()).update("\0")
          .update(objectStorageBucketId).update("\0").update(privateObjectDir).digest("hex"),
      };
    } finally {
      try { await client.query("ROLLBACK"); } catch { broken = true; }
      client.release(broken);
    }
  }),
);

// Stripe webhook：必須在 express.json 之前註冊（需要原始 Buffer 驗簽）
app.post("/api/stripe/webhook", express.raw({ type: "application/json" }), async (req, res) => {
  const signature = req.headers["stripe-signature"];
  if (!signature) { res.status(400).json({ error: "Missing stripe-signature" }); return; }
  try {
    const sig = Array.isArray(signature) ? signature[0] : signature;
    if (!Buffer.isBuffer(req.body)) {
      logger.error("STRIPE WEBHOOK ERROR: req.body is not a Buffer — webhook route must be before express.json()");
      res.status(500).json({ error: "Webhook processing error" });
      return;
    }
    await WebhookHandlers.processWebhook(req.body as Buffer, sig);
    res.status(200).json({ received: true });
  } catch (error: any) {
    logger.error({ err: error?.message }, "Stripe webhook error");
    res.status(400).json({ error: "Webhook processing error" });
  }
});

// 安全性 HTTP 標頭（CSP 由前端託管端控制，這裡先關閉避免破壞頁面）
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false,
  crossOriginResourcePolicy: { policy: "cross-origin" },
}));

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) { return { id: req.id, method: req.method, url: req.url?.split("?")[0] }; },
      res(res) { return { statusCode: res.statusCode }; },
    },
  }),
);
// 僅允許自家網域跨域攜帶憑證，防止任意網站帶著使用者 cookie 呼叫 API
function buildAllowedOrigins(): Set<string> {
  const origins = new Set<string>();
  for (const d of (process.env.REPLIT_DOMAINS || "").split(",")) {
    const domain = d.trim();
    if (domain) origins.add(`https://${domain}`);
  }
  if (process.env.REPLIT_DEV_DOMAIN) origins.add(`https://${process.env.REPLIT_DEV_DOMAIN}`);
  if (process.env.PUBLIC_BASE_URL) { try { origins.add(new URL(process.env.PUBLIC_BASE_URL).origin); } catch { /* 設定格式錯誤時忽略 */ } }
  if (process.env.NODE_ENV !== "production") {
    origins.add("http://localhost");
    origins.add("http://localhost:80");
    origins.add("http://127.0.0.1");
  }
  return origins;
}
const allowedOrigins = buildAllowedOrigins();
const isAllowedOrigin = (origin: string) =>
  allowedOrigins.has(origin) ||
  (process.env.NODE_ENV !== "production" && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin));

app.use(cors({
  origin(origin, callback) {
    // 無 Origin（同源導航、curl、伺服器對伺服器）一律放行
    if (!origin || isAllowedOrigin(origin)) callback(null, true);
    else callback(null, false);
  },
  credentials: true,
}));
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true }));
// AI has its own bearer authentication and fixed tenant, never session/API-key middleware.
app.use("/mcp", mcpRouter);
app.use(cookieParser());
app.use(databaseTimings);
app.use(createSessionMiddleware());

// CSRF 防護：帶 Origin 的跨站寫入請求，Origin 必須在允許清單內
// （CORS 只擋瀏覽器讀回應、不擋請求本身，因此需在處理前主動拒絕）
app.use("/api", (req, res, next) => {
  const origin = req.headers.origin;
  if (!origin) { next(); return; } // 同源導航 / curl / 伺服器對伺服器
  const isWrite = ["POST", "PUT", "PATCH", "DELETE"].includes(req.method.toUpperCase());
  if (isWrite && !isAllowedOrigin(origin)) {
    res.status(403).json({ error: "禁止的來源", message: "此請求來源不被允許" });
    return;
  }
  next();
});

// postedChangeGuard：已入帳單據的修改、作廢先送審（要在 auditLogger 前面，送審不算真的改了）
app.use("/api", optionalApiKeyAuth, tenantContext, subscriptionGate, moduleGuard, employeeAccessGuard, permissionGuard, postedChangeGuard, auditLogger, router);
app.use("/api", multerErrorHandler);

export default app;
