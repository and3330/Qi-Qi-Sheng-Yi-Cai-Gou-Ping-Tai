import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import { sessionMiddleware } from "./middlewares/session";
import router from "./routes";
import { logger } from "./lib/logger";

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
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(sessionMiddleware());

app.use("/api", router);

export default app;
