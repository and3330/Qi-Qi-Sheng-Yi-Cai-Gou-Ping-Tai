import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import { pool } from "@workspace/db";

const PgStore = connectPgSimple(session);

declare module "express-session" {
  interface SessionData {
    memberId?: number;
  }
}

const isProd = process.env.NODE_ENV === "production";

export function sessionMiddleware() {
  const secret = process.env.SESSION_SECRET;
  if (!secret && isProd) {
    throw new Error("SESSION_SECRET must be set in production");
  }
  return session({
    // Table is managed by the drizzle schema (lib/db/src/schema/sessions.ts);
    // createTableIfMissing breaks under the esbuild bundle (table.sql not bundled).
    // pool 轉型：專案裡同時有兩個版本的 pg 型別定義（connect-pg-simple 帶的較舊），執行時是同一個類別
    store: new PgStore({ pool: pool as any, createTableIfMissing: false }),
    secret: secret || "dev-only-secret",
    resave: false,
    saveUninitialized: false,
    proxy: true,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure: isProd,
      maxAge: 30 * 24 * 60 * 60 * 1000, // 30 天
    },
  });
}
