import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import { sessionMiddleware } from "./middlewares/session";
import router from "./routes";
import { logger } from "./lib/logger";
import { handleStripeWebhook } from "./lib/stripeCredits";

const app: Express = express();

const isProd = process.env.NODE_ENV === "production";
const extraOrigins = (process.env.ALLOWED_ORIGINS ?? "")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);

app.set("trust proxy", 1);

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);

app.disable("x-powered-by");

// 基本安全標頭。正式環境才限制被其他網站內嵌，開發預覽不受影響。
app.use((_req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  if (isProd) {
    res.setHeader("X-Frame-Options", "SAMEORIGIN");
    res.setHeader("Strict-Transport-Security", "max-age=15552000");
  }
  next();
});

// 跨來源：正式環境只允許自己的網域（或 ALLOWED_ORIGINS 列出的網域）帶登入身分呼叫。
// 電子報對外 API 用金鑰驗證、不帶登入身分，維持開放。
app.use(
  cors((req, callback) => {
    const origin = req.headers.origin;
    if ((req.url ?? "").startsWith("/api/newsletter/")) {
      callback(null, { origin: true, credentials: false });
      return;
    }
    let allowed = true;
    if (origin && isProd) {
      const host = String(req.headers["x-forwarded-host"] ?? req.headers.host ?? "").split(",")[0].trim();
      let originHost = "";
      try {
        originHost = new URL(origin).host;
      } catch {
        originHost = "";
      }
      allowed = originHost === host || extraOrigins.includes(origin);
    }
    callback(null, { origin: allowed, credentials: true });
  }),
);
// Stripe 付款通知：需要未解析的原始內容才能驗證簽章，所以放在 express.json 之前
app.post(
  "/api/stripe/webhook",
  express.raw({ type: "application/json" }),
  async (req, res) => {
    const signature = req.headers["stripe-signature"];
    if (typeof signature !== "string" || !Buffer.isBuffer(req.body)) {
      res.status(400).json({ error: "Invalid webhook request" });
      return;
    }
    try {
      await handleStripeWebhook(req.body, signature);
      res.json({ received: true });
    } catch (err) {
      // 回傳非 2xx，Stripe 會自動重送；入帳是冪等的，重送不會重複加點
      req.log.error({ err }, "stripe webhook failed");
      res.status(400).json({ error: "Webhook error" });
    }
  },
);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(sessionMiddleware());

app.use("/api", router);

export default app;
