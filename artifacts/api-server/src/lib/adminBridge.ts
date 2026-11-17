import { randomBytes, timingSafeEqual } from "node:crypto";
import type { Request } from "express";
import { ADMIN_API_CATALOG, type AdminEndpoint } from "./adminApiCatalog.generated";

/**
 * AI 助理與 Bot 的「後台通用工具」用的橋接。
 *
 * 作法：通用工具不另外寫一套商業邏輯，而是由伺服器自己呼叫自己的後台 API
 * （http://127.0.0.1:PORT/api/...），並帶上「這次是替哪一位後台人員執行」。
 * 好處是權限、檢查、紀錄全部沿用原本的後台 API，不會出現第二套規則。
 *
 * 身份怎麼決定：
 * - 查詢：用金鑰所屬的後台人員（或正在跟 AI 助理對話的人）的身份
 * - 會改資料的操作：一律先存成待確認，由後台人員按下確認後，用「按確認的那個人」的身份執行
 *
 * 安全：內部呼叫要帶一組只存在這個程序記憶體裡的隨機密碼（每次啟動都不同），
 * 外面的請求不可能知道，所以無法冒用這條路。
 */
const BRIDGE_TOKEN = randomBytes(32).toString("hex");
export const BRIDGE_TOKEN_HEADER = "x-qiqi-internal-bridge";
export const BRIDGE_MEMBER_HEADER = "x-qiqi-internal-member";

/** 這個請求是不是伺服器自己發的內部呼叫；是的話回傳要代表的後台人員編號 */
export function bridgeMemberId(req: Request): number | null {
  const supplied = req.headers[BRIDGE_TOKEN_HEADER];
  if (typeof supplied !== "string" || supplied.length !== BRIDGE_TOKEN.length) return null;
  if (!timingSafeEqual(Buffer.from(supplied), Buffer.from(BRIDGE_TOKEN))) return null;
  const id = Number(req.headers[BRIDGE_MEMBER_HEADER]);
  return Number.isInteger(id) && id > 0 ? id : null;
}

export class BridgeError extends Error {}

/**
 * 不開放給 AI 的功能：
 * - /admin/mcp：金鑰管理與「確認／拒絕」本身（AI 不能替自己按確認）
 * - /admin/assistant、/admin/cmo/chat：AI 對話本身
 * - /newsletter/api-keys：會產生金鑰
 * - OAuth 回呼、取消訂閱：給瀏覽器用的網址
 */
const BLOCKED: RegExp[] = [
  /^\/admin\/mcp(\/|$)/, /^\/admin\/assistant(\/|$)/, /^\/admin\/cmo\/chat(\/|$)/,
  /^\/newsletter\/api-keys(\/|$)/, /oauth/i, /^\/newsletter\/unsubscribe/, /^\/admin\/ai-credits\/checkout/,
];
/** 請求內容裡不允許出現的欄位（密碼、金鑰一律由人在後台處理） */
const FORBIDDEN_FIELDS = /^(password|newPassword|passwordHash|apiKey|secret|token)$/i;

const isBlocked = (path: string): boolean => BLOCKED.some((re) => re.test(path));
const toPattern = (path: string): RegExp =>
  new RegExp("^" + path.split("/").map((seg) => (seg.startsWith(":") ? "[^/]+" : seg.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))).join("/") + "$");

const USABLE: Array<AdminEndpoint & { pattern: RegExp }> = ADMIN_API_CATALOG
  .filter((e) => !isBlocked(e.path))
  .map((e) => ({ ...e, pattern: toPattern(e.path) }));

export function findEndpoint(method: string, path: string): AdminEndpoint | null {
  const m = String(method || "").toUpperCase();
  return USABLE.find((e) => e.method === m && e.pattern.test(path)) ?? null;
}

/** 列出可用的後台功能（可用關鍵字篩選：路徑、說明、分類都會比對） */
export function listEndpoints(keyword?: string) {
  const k = String(keyword ?? "").trim().toLowerCase();
  const rows = USABLE.filter((e) => !k || `${e.path} ${e.summary} ${e.tag}`.toLowerCase().includes(k));
  return {
    total: USABLE.length,
    matched: rows.length,
    endpoints: rows.map((e) => ({
      method: e.method, path: e.path, description: e.summary || undefined,
      use: e.method === "GET" ? "admin_get" : "admin_write（要後台人員確認）",
    })),
  };
}

export function describeEndpoint(method: string, path: string) {
  const e = findEndpoint(method, path);
  if (!e) throw new BridgeError("找不到這個功能，請先用 admin_list_endpoints 查可用的路徑");
  return {
    method: e.method, path: e.path, description: e.summary || undefined,
    parameters: e.parameters, body: e.body,
    use: e.method === "GET" ? "admin_get" : "admin_write（要後台人員確認）",
  };
}

function cleanPath(path: unknown): string {
  const p = String(path ?? "").trim();
  if (!p.startsWith("/") || p.includes("..") || p.includes("//") || /[?#\s\\]/.test(p) || p.length > 300)
    throw new BridgeError("path 格式不正確：要以 / 開頭，不要帶 ? 之後的查詢條件（查詢條件放在 query）");
  return p;
}

function assertNoSecrets(value: unknown, depth = 0): void {
  if (!value || typeof value !== "object" || depth > 8) return;
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (FORBIDDEN_FIELDS.test(k)) throw new BridgeError(`不能透過 AI 設定「${k}」這類密碼或金鑰欄位，請由人在後台操作`);
    assertNoSecrets(v, depth + 1);
  }
}

/** 送出前先檢查：功能存在、沒有被封鎖、內容沒有密碼金鑰。回傳整理過的請求 */
export function validateRequest(input: { method?: unknown; path?: unknown; query?: unknown; body?: unknown }, allow: "read" | "write") {
  const method = String(input.method ?? (allow === "read" ? "GET" : "")).toUpperCase();
  const path = cleanPath(input.path);
  if (allow === "read" && method !== "GET") throw new BridgeError("admin_get 只能查詢；要改資料請用 admin_write");
  if (allow === "write" && !["POST", "PUT", "PATCH", "DELETE"].includes(method)) throw new BridgeError("method 只能是 POST、PUT、PATCH、DELETE；查詢請用 admin_get");
  if (isBlocked(path)) throw new BridgeError("這個功能不開放給 AI，請由人在後台操作");
  const endpoint = findEndpoint(method, path);
  if (!endpoint) throw new BridgeError("找不到這個功能，請先用 admin_list_endpoints 查可用的路徑與方法");
  const query: Record<string, string> = {};
  if (input.query && typeof input.query === "object") {
    for (const [k, v] of Object.entries(input.query as Record<string, unknown>)) {
      if (v === undefined || v === null || typeof v === "object") continue;
      query[String(k).slice(0, 60)] = String(v).slice(0, 300);
    }
  }
  const body = input.body && typeof input.body === "object" ? input.body : undefined;
  assertNoSecrets(body);
  if (body && JSON.stringify(body).length > 100_000) throw new BridgeError("內容太大");
  return { method, path, query, body, description: endpoint.summary };
}

/** 以指定後台人員的身份，呼叫本機的後台 API */
export async function callAdminApi(
  request: { method: string; path: string; query?: Record<string, string>; body?: unknown },
  memberId: number,
): Promise<{ ok: boolean; status: number; data: unknown }> {
  const port = Number(process.env["PORT"]);
  if (!Number.isInteger(port) || port <= 0) throw new BridgeError("伺服器設定不完整，無法執行");
  const qs = new URLSearchParams(request.query ?? {}).toString();
  const response = await fetch(`http://127.0.0.1:${port}/api${request.path}${qs ? `?${qs}` : ""}`, {
    method: request.method,
    headers: {
      "content-type": "application/json",
      [BRIDGE_TOKEN_HEADER]: BRIDGE_TOKEN,
      [BRIDGE_MEMBER_HEADER]: String(memberId),
    },
    body: request.method === "GET" || request.body === undefined ? undefined : JSON.stringify(request.body),
    signal: AbortSignal.timeout(30_000),
  });
  const text = await response.text();
  let data: unknown;
  try { data = text ? JSON.parse(text) : null; } catch { data = text.slice(0, 500); }
  // 回覆太大時截斷，避免把整個資料表塞給模型
  const serialized = JSON.stringify(data) ?? "";
  if (serialized.length > 60_000) {
    data = Array.isArray(data)
      ? { truncated: true, total: data.length, note: "資料太多，只回前 50 筆；請用 query 篩選或分頁", items: data.slice(0, 50) }
      : { truncated: true, note: "回覆太大已截斷，請用 query 縮小範圍", preview: serialized.slice(0, 20_000) };
  }
  return { ok: response.ok, status: response.status, data };
}
