import type { ErrorRequestHandler } from "express";
import { pgErrorCode } from "../lib/pg-error";
import { logger } from "../lib/logger";

type SafeDatabaseError = {
  status: number;
  code: "DATABASE_UPDATE_REQUIRED" | "DUPLICATE_RECORD" | "DATABASE_ERROR";
  error: string;
};

const MISSING_SCHEMA_CODES = new Set(["42P01", "42703", "3F000"]);

export function toSafeDatabaseError(error: unknown): SafeDatabaseError {
  const postgresCode = pgErrorCode(error);

  if (postgresCode && MISSING_SCHEMA_CODES.has(postgresCode)) {
    return {
      status: 503,
      code: "DATABASE_UPDATE_REQUIRED",
      error: "資料庫尚未完成更新，請聯絡系統管理員執行資料庫更新。",
    };
  }

  if (postgresCode === "23505") {
    return {
      status: 409,
      code: "DUPLICATE_RECORD",
      error: "客戶編號或資料已存在，請確認後再試。",
    };
  }

  return {
    status: 500,
    code: "DATABASE_ERROR",
    error: "客戶資料操作失敗，請稍後再試。",
  };
}

/**
 * Keep database implementation details out of API responses and logs. In
 * particular, never pass the original error to the logger because Drizzle
 * errors can contain SQL text, parameters, and customer-entered values.
 */
export const safeJsonDatabaseErrorHandler: ErrorRequestHandler = (error, req, res, next) => {
  if (res.headersSent) {
    next(error);
    return;
  }
  const safeError = toSafeDatabaseError(error);
  logger.error(
    { postgresCode: pgErrorCode(error) || "unknown", method: req.method, route: req.route?.path },
    "Customer database request failed",
  );
  res.status(safeError.status).json({ code: safeError.code, error: safeError.error });
};