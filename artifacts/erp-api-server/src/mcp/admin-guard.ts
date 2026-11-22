/**
 * AI 全權身分的把關規則（純計算，不碰資料庫）。
 *
 * 原則：AI 可以查、可以建立與修改各模組的單據；但下面三種留給人：
 * 1) 讓錢真的出去的動作：付款、發薪、還款
 * 2) 作廢、取消、刪除（已入帳的單據會連帶沖帳）
 * 3) 帳號、金鑰、權限、備份、訂閱、關帳日這類系統設定
 */

import type { ActionCategory, AgentActions } from "./agent-caps";

/** review＝這把金鑰可以送出，但要人在 ERP 核准才生效 */
export type Verdict = { allowed: true } | { allowed: false; reason: string; category?: ActionCategory; review?: boolean };
const deny = (reason: string): Verdict => ({ allowed: false, reason });

/** 完全不開放（連查詢都不行）：帳號、金鑰、備份、訂閱、平台管理、登入 */
const CLOSED_PREFIXES = ["/admin", "/api-keys", "/backup", "/billing", "/platform", "/auth", "/public", "/stripe", "/mcp", "/external", "/ai-drafts", "/users"];
/** 只能查、不能改：權限、系統設定、排程、匯入匯出、外部串接的來源設定 */
const READ_ONLY_PREFIXES = [
  "/roles", "/menu-permissions", "/email-settings", "/accounting-settings", "/payroll-settings", "/scheduled-jobs",
  "/import-export", "/integrations/sources", "/accounts/configuration", "/insurance-brackets", "/batch", "/approval-workflows",
  "/email", "/data-sync", "/cm-life", "/noncodingai",
];
/** 路徑最後一段是這些動作的，一律留給人 */
const HUMAN_ACTIONS = /\/(void|void-ecpay|pay|repay|write-off|writeoff|cancel|close|reopen|year-close|reverse|approve|reject|unmatch|restore|reset|purge|backfill-journal-entries|confirm-not-issued)$/;
/** 其中可以依金鑰設定開放的三類；剩下的（關帳、年結、重設、清除、補分錄）不管怎麼設都留給人 */
const REVERSE_ACTIONS = /\/(void|void-ecpay|write-off|writeoff|cancel|reverse|unmatch|confirm-not-issued)$/;
const PAY_ACTIONS = /\/(pay|repay)$/;
const APPROVE_ACTIONS = /\/(approve|reject)$/;
const STATUS_CATEGORY: Record<string, ActionCategory> = {
  Paid: "pay", "已付款": "pay",
  Cancelled: "reverse", Canceled: "reverse", Voided: "reverse", Void: "reverse", WrittenOff: "reverse", Reversed: "reverse", "已作廢": "reverse", "已取消": "reverse",
  Approved: "approve", Rejected: "approve", "已核准": "approve",
};
/** 把狀態改成這些值，等於付款、作廢或核准 */
const HUMAN_STATUSES = new Set(["Paid", "Cancelled", "Canceled", "Voided", "Void", "Approved", "Rejected", "WrittenOff", "Reversed", "已付款", "已作廢", "已取消", "已核准"]);

const startsWith = (path: string, prefix: string) => path === prefix || path.startsWith(prefix + "/");

export function normalizePath(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  let path = raw.trim().split("?")[0];
  if (path.startsWith("/api/")) path = path.slice(4);
  if (!path.startsWith("/") || path.length > 300) return null;
  // 不接受跳目錄、雙斜線、編碼字元或控制字元：路徑只會原樣轉給既有的 /api 路由
  if (path.includes("..") || path.includes("//") || /[%\\\s#]/.test(path)) return null;
  return path.replace(/\/+$/, "") || null;
}

/**
 * humanConfirmed：ERP 內建的 AI 對話用。操作會先列給登入的使用者看、由本人按下確認才執行，
 * 所以付款、作廢、取消、核准、刪除這些「留給人」的動作可以放行（帳號金鑰區與系統設定仍然不開放）。
 */
export function judgeRequest(method: string, path: string, body: unknown, options: { humanConfirmed?: boolean; actions?: AgentActions } = {}): Verdict {
  /** 四類「留給人」的動作：照這把金鑰的設定決定 不可以／送審／直接 */
  const gated = (category: ActionCategory, reason: string): Verdict => {
    const mode = options.actions?.[category] ?? "deny";
    if (mode === "direct") return { allowed: true };
    if (mode === "review") return { allowed: false, review: true, category, reason: "這個動作要人在 ERP 核准才會生效" };
    return { allowed: false, category, reason };
  };
  const verb = method.toUpperCase();
  if (!["GET", "POST", "PATCH", "PUT", "DELETE"].includes(verb)) return deny("不支援的操作方式");
  if (CLOSED_PREFIXES.some(prefix => startsWith(path, prefix))) return deny("這一區（帳號、金鑰、備份、訂閱）只能由人在 ERP 操作");
  if (verb === "GET") return { allowed: true };
  // 歷史單匯入是搬家工具專用（直接寫入歷史資料、不產生分錄），AI 不論哪種身分都不能用
  if (/\/legacy-import$/.test(path) || path === "/legacy-documents/import") return deny("歷史資料匯入只能由搬家工具執行，AI 不能使用");

  if (READ_ONLY_PREFIXES.some(prefix => startsWith(path, prefix))) return deny("權限與系統設定只能查詢，修改請由人在 ERP 操作");
  if (options.humanConfirmed) return { allowed: true };
  // 審批匣（含異動申請）一定要人按：不然設成「要人核准」的金鑰可以自己核准自己送的申請
  if (startsWith(path, "/approval-requests") && verb !== "POST") return deny("審批一定要由人在 ERP 按核准或駁回");
  // 先把四類全部判斷完：同一個請求可能同時踩到兩類（例如付款單），任何一類不行就不行，其次才是送審
  const hits: Verdict[] = [];
  const consider = (v: Verdict) => { if (!v.allowed) hits.push(v); };
  const settle = (): Verdict => hits.find(v => !v.allowed && !v.review) ?? hits[0] ?? { allowed: true };

  if (verb === "DELETE") consider(gated("delete", "刪除請由人在 ERP 操作"));
  if (HUMAN_ACTIONS.test(path)) {
    if (REVERSE_ACTIONS.test(path)) consider(gated("reverse", "沖銷、作廢、取消要由人在 ERP 按下確認"));
    else if (PAY_ACTIONS.test(path)) consider(gated("pay", "付款、還款要由人在 ERP 按下確認"));
    else if (APPROVE_ACTIONS.test(path)) consider(gated("approve", "核准、駁回要由人在 ERP 按下確認"));
    else return deny("關帳、年結、重設這類動作要由人在 ERP 按下確認");
  }

  const data = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const status = typeof data.status === "string" ? data.status : null;
  if (status && HUMAN_STATUSES.has(status)) consider(gated(STATUS_CATEGORY[status] ?? "approve", `把狀態改成「${status}」等於付款、作廢或核准，要由人在 ERP 操作`));
  if (data.overrideCreditLimit !== undefined) return deny("超過信用額度的放行只能由老闆或財務本人操作");

  // 付款單會讓帳上的錢出去：請改用付款草稿，由人確認
  if (startsWith(path, "/vouchers") && verb === "POST" && data.voucherType === "付款單") {
    consider(gated("pay", "付款單要由人確認：請改用 create_document_draft（doc_type=payment）建立付款草稿"));
  }
  // 薪資單：可以建立與試算，不能直接發
  if (startsWith(path, "/salary-slips") && /(submit|post|pay|generate-payment)/.test(path)) consider(gated("pay", "發薪要由人在 ERP 操作"));
  return settle();
}

/** 回應太大時截短：清單最多回 100 筆，避免把整個資料表塞給 AI */
export function trimResult(data: unknown, maxRows = 100): { data: unknown; truncated: boolean; total?: number } {
  if (Array.isArray(data) && data.length > maxRows) return { data: data.slice(0, maxRows), truncated: true, total: data.length };
  if (data && typeof data === "object") {
    for (const key of ["data", "rows", "items"]) {
      const list = (data as Record<string, unknown>)[key];
      if (Array.isArray(list) && list.length > maxRows) {
        return { data: { ...(data as object), [key]: list.slice(0, maxRows) }, truncated: true, total: list.length };
      }
    }
  }
  return { data, truncated: false };
}
