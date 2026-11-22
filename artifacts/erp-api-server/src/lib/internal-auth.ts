import { randomBytes, timingSafeEqual } from "node:crypto";

/**
 * 伺服器「自己呼叫自己」用的一次性憑證：AI 助理的通用操作工具，
 * 是在伺服器內部轉呼叫既有的 /api 路由，讓所有既有的檢查（必填、關帳、庫存、信用額度…）照常生效。
 * 憑證每次啟動隨機產生、只存在記憶體，不會寫進資料庫、日誌或回應裡，外部無法得知。
 *
 * 從 ERP 金鑰來的呼叫會帶上金鑰綁定的使用者，轉呼叫時就以那個人的角色把關。
 */
const INTERNAL_TOKEN = randomBytes(32).toString("hex");
export const INTERNAL_HEADER = "x-erp-internal-token";
export const INTERNAL_TENANT_HEADER = "x-erp-internal-tenant";
export const INTERNAL_USER_HEADER = "x-erp-internal-user";
export const INTERNAL_KEY_HEADER = "x-erp-internal-key";

export function internalHeaders(tenantId: number, as?: { userId: number; keyId: number | null }): Record<string, string> {
  return {
    [INTERNAL_HEADER]: INTERNAL_TOKEN, [INTERNAL_TENANT_HEADER]: String(tenantId),
    ...(as ? { [INTERNAL_USER_HEADER]: String(as.userId), ...(as.keyId ? { [INTERNAL_KEY_HEADER]: String(as.keyId) } : {}) } : {}),
  };
}

/** 是不是伺服器自己發出的內部呼叫；是的話回傳租戶 id */
export function internalTenant(headers: Record<string, unknown>): number | null {
  const supplied = headers[INTERNAL_HEADER];
  if (typeof supplied !== "string" || supplied.length !== INTERNAL_TOKEN.length) return null;
  if (!timingSafeEqual(Buffer.from(supplied), Buffer.from(INTERNAL_TOKEN))) return null;
  const tenantId = Number(headers[INTERNAL_TENANT_HEADER]);
  return Number.isSafeInteger(tenantId) && tenantId > 0 ? tenantId : null;
}

/** 內部呼叫帶的使用者與金鑰（只在 internalTenant 通過後才讀） */
export function internalActor(headers: Record<string, unknown>): { userId: number | null; keyId: number | null } {
  const num = (v: unknown) => { const n = Number(v); return Number.isSafeInteger(n) && n > 0 ? n : null; };
  return { userId: num(headers[INTERNAL_USER_HEADER]), keyId: num(headers[INTERNAL_KEY_HEADER]) };
}
