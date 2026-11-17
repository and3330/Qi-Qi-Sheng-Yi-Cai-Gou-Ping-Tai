import { randomBytes, timingSafeEqual } from "node:crypto";

/**
 * 伺服器「自己呼叫自己」用的一次性憑證：AI 全權身分的通用操作工具，
 * 是在伺服器內部轉呼叫既有的 /api 路由，讓所有既有的檢查（必填、關帳、庫存、信用額度…）照常生效。
 * 憑證每次啟動隨機產生、只存在記憶體，不會寫進資料庫、日誌或回應裡，外部無法得知。
 */
const INTERNAL_TOKEN = randomBytes(32).toString("hex");
export const INTERNAL_HEADER = "x-erp-internal-token";
export const INTERNAL_TENANT_HEADER = "x-erp-internal-tenant";

export function internalHeaders(tenantId: number): Record<string, string> {
  return { [INTERNAL_HEADER]: INTERNAL_TOKEN, [INTERNAL_TENANT_HEADER]: String(tenantId) };
}

/** 是不是伺服器自己發出的內部呼叫；是的話回傳租戶 id */
export function internalTenant(headers: Record<string, unknown>): number | null {
  const supplied = headers[INTERNAL_HEADER];
  if (typeof supplied !== "string" || supplied.length !== INTERNAL_TOKEN.length) return null;
  if (!timingSafeEqual(Buffer.from(supplied), Buffer.from(INTERNAL_TOKEN))) return null;
  const tenantId = Number(headers[INTERNAL_TENANT_HEADER]);
  return Number.isSafeInteger(tenantId) && tenantId > 0 ? tenantId : null;
}
