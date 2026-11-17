import session from "express-session";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import { sessionPool } from "@workspace/erp-db";
import { createPgSessionStore } from "./session-store";
import { migrationMaintenanceEnabled } from "./migration-maintenance";
import { logger } from "./logger";

declare module "express-session" {
  interface SessionData {
    user?: { id: number; username: string; displayName: string; role: string; employeeId?: number | null; tenantId?: number; companyCode?: string | null };
  }
}

sessionPool.on("error", () => logger.error("Session database connection failed"));

export function createSessionMiddleware() {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error("SESSION_SECRET is required");
  return session({
    store: createPgSessionStore(sessionPool, () => logger.error("Session database operation failed"),
      migrationMaintenanceEnabled() ? false : undefined),
    secret,
    resave: false,
    saveUninitialized: false,
    rolling: true,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: 1000 * 60 * 60 * 24 * 14, // 14 天
    },
    name: "erp.sid",
  });
}

const SHA256 = (s: string) => crypto.createHash("sha256").update(s).digest("hex");

export async function verifyPassword(plain: string, stored: string): Promise<boolean> {
  if (!plain || !stored) return false;
  if (stored.startsWith("$2")) {
    return bcrypt.compare(plain, stored);
  }
  // 向後相容：原有 SHA-256 帳號
  return SHA256(plain) === stored;
}

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, 10);
}
