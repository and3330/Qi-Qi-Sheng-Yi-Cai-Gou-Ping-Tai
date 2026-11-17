/**
 * 已入帳單據的修改、作廢、取消要先送審（老闆 2026-11-16）。
 * 這裡只放規則（不碰資料庫，方便測試）：哪個網址、哪張表、什麼狀態算「已入帳」、哪些狀態變更是正常流程不用審。
 * 刪除不在這裡：已成立的單本來就不能刪，要用作廢／取消（那一步要審）。
 */
export interface PostedRule {
  method: "PATCH" | "PUT" | "POST";
  pattern: RegExp;         // 對 /api 之後的路徑；第一個括號是單據 id
  table: string;
  numberColumn: string;    // 單號欄位（固定字串，可以是 SQL 運算式）
  label: string;           // 單據名稱
  action: string;          // 這個動作叫什麼（修改、作廢…）
  /** 目前狀態是這些才算已入帳（沒寫＝不是草稿就算） */
  postedStatuses?: string[];
  /** 只改狀態、而且改成這些狀態，是正常往下走的流程，不用審 */
  passStatuses?: string[];
  /** 有寫的話：只有改到這些欄位才要審，其他照原本流程走（例如付款申請只審備註，核准、付款是它自己的流程） */
  gateFields?: string[];
}

const id = String.raw`(\d+)`;
export const POSTED_RULES: PostedRule[] = [
  { method: "PATCH", pattern: new RegExp(`^/invoices/${id}$`), table: "invoices", numberColumn: "invoice_number", label: "發票", action: "修改", passStatuses: ["Unpaid", "Overdue"] },
  { method: "POST", pattern: new RegExp(`^/invoices/${id}/write-off$`), table: "invoices", numberColumn: "invoice_number", label: "發票", action: "沖銷呆帳" },
  { method: "POST", pattern: new RegExp(`^/invoices/${id}/cancel-write-off$`), table: "invoices", numberColumn: "invoice_number", label: "發票", action: "取消沖銷呆帳" },
  { method: "POST", pattern: new RegExp(`^/invoices/${id}/void-ecpay$`), table: "invoices", numberColumn: "invoice_number", label: "發票", action: "作廢電子發票" },
  { method: "PATCH", pattern: new RegExp(`^/sales-orders/${id}$`), table: "sales_orders", numberColumn: "order_number", label: "銷貨單", action: "修改", postedStatuses: ["Confirmed", "To Deliver", "Completed"], passStatuses: ["To Deliver", "Completed"] },
  { method: "PATCH", pattern: new RegExp(`^/payment-requests/${id}$`), table: "payment_requests", numberColumn: "request_number", label: "付款申請", action: "修改", postedStatuses: ["Approved", "Paid"], gateFields: ["remarks"] },
  { method: "POST", pattern: new RegExp(`^/payment-requests/${id}/void$`), table: "payment_requests", numberColumn: "request_number", label: "付款申請", action: "作廢", postedStatuses: ["Paid"] },
  { method: "PATCH", pattern: new RegExp(`^/delivery-notes/${id}$`), table: "delivery_notes", numberColumn: "note_number", label: "出貨單", action: "修改", postedStatuses: ["Submitted", "Completed"], passStatuses: ["Completed"] },
  { method: "PATCH", pattern: new RegExp(`^/sales-returns/${id}$`), table: "sales_returns", numberColumn: "return_number", label: "銷貨退回", action: "修改", postedStatuses: ["Submitted", "Completed"] },
  { method: "PATCH", pattern: new RegExp(`^/purchase-returns/${id}$`), table: "purchase_returns", numberColumn: "return_number", label: "進貨退出", action: "修改", postedStatuses: ["Submitted", "Completed"] },
  { method: "PATCH", pattern: new RegExp(`^/purchase-receipts/${id}$`), table: "purchase_receipts", numberColumn: "receipt_number", label: "進貨單", action: "修改", postedStatuses: ["Submitted", "Completed"], passStatuses: ["Completed"] },
  { method: "POST", pattern: new RegExp(`^/purchase-receipts/${id}/landed-cost$`), table: "purchase_receipts", numberColumn: "receipt_number", label: "進貨單", action: "攤入附加費用", postedStatuses: ["Submitted", "Completed"] },
  { method: "POST", pattern: new RegExp(`^/advances/${id}/void$`), table: "advances", numberColumn: "advance_number", label: "預支單", action: "作廢", postedStatuses: ["Open", "Settled"] },
  { method: "PUT", pattern: new RegExp(`^/stock-counts/${id}$`), table: "stock_counts", numberColumn: "count_number", label: "盤點單", action: "修改", postedStatuses: ["Posted"] },
  { method: "POST", pattern: new RegExp(`^/stock-counts/${id}/cancel$`), table: "stock_counts", numberColumn: "count_number", label: "盤點單", action: "取消", postedStatuses: ["Posted"] },
  { method: "POST", pattern: new RegExp(`^/service-fees/${id}/void$`), table: "service_fees", numberColumn: "fee_number", label: "勞務報酬單", action: "作廢", postedStatuses: ["Confirmed", "Paid"] },
  { method: "PATCH", pattern: new RegExp(`^/assets/${id}$`), table: "assets", numberColumn: "asset_number", label: "固定資產", action: "修改", postedStatuses: ["Submitted", "In Use"] },
  { method: "POST", pattern: new RegExp(`^/assets/${id}/adjust-value$`), table: "assets", numberColumn: "asset_number", label: "固定資產", action: "調整價值", postedStatuses: ["Submitted", "In Use"] },
  { method: "PUT", pattern: new RegExp(`^/salary-slips/${id}/status$`), table: "salary_slips", numberColumn: "concat(year, '/', month, ' #', id)", label: "薪資單", action: "改狀態", postedStatuses: ["paid"] },
];

export function matchPostedRule(method: string, path: string): { rule: PostedRule; id: number } | null {
  const m = method.toUpperCase();
  for (const rule of POSTED_RULES) {
    if (rule.method !== m) continue;
    const hit = rule.pattern.exec(path);
    if (hit) return { rule, id: Number(hit[1]) };
  }
  return null;
}

export function isPostedStatus(rule: PostedRule, status: unknown): boolean {
  const s = String(status ?? "");
  if (rule.postedStatuses) return rule.postedStatuses.includes(s);
  return s !== "" && s !== "Draft" && s !== "Cancelled";
}

/** 只改狀態、往下一步走（例如出貨單改成已完成）：正常流程，不用審 */
export function isNormalFlow(rule: PostedRule, body: unknown): boolean {
  if (!rule.passStatuses || !body || typeof body !== "object") return false;
  const keys = Object.keys(body as object).filter(k => (body as any)[k] !== undefined);
  return keys.length === 1 && keys[0] === "status" && rule.passStatuses.includes(String((body as any).status));
}

/** 送審時看得懂的「改之前」：把資料表欄位（snake_case）對到送來的欄位（camelCase） */
export function originalFor(row: Record<string, unknown>, body: unknown): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (!body || typeof body !== "object") return out;
  for (const key of Object.keys(body as object)) {
    const snake = key.replace(/[A-Z]/g, c => "_" + c.toLowerCase());
    if (snake in row) out[key] = row[snake];
    else if (key in row) out[key] = row[key];
  }
  return out;
}

const pad = (n: number) => String(n).padStart(2, "0");
/** 資料表裡的值和送來的值是不是同一個（空白和沒填算一樣；數字、日期不看寫法） */
export function sameValue(stored: unknown, sent: unknown): boolean {
  const empty = (v: unknown) => v == null || v === "";
  if (empty(stored) || empty(sent)) return empty(stored) && empty(sent);
  if (stored instanceof Date) {
    if (typeof sent !== "string" && !(sent instanceof Date)) return false;
    if (typeof sent === "string" && /^\d{4}-\d{2}-\d{2}$/.test(sent)) return sent === `${stored.getFullYear()}-${pad(stored.getMonth() + 1)}-${pad(stored.getDate())}`;
    return new Date(sent).getTime() === stored.getTime();
  }
  if (typeof stored === "object" || typeof sent === "object") return JSON.stringify(stored) === JSON.stringify(sent);
  if (typeof stored === "number" || typeof sent === "number") return Number(stored) === Number(sent);
  return String(stored) === String(sent);
}

const columnOf = (row: Record<string, unknown>, key: string): string | null => {
  const snake = key.replace(/[A-Z]/g, c => "_" + c.toLowerCase());
  return snake in row ? snake : key in row ? key : null;
};

/** 只留真的有改的欄位：編輯畫面會把整張表單送過來，沒改的不用審，核准時也不會把別人後來改的蓋回去 */
export function changedOnly(row: Record<string, unknown>, body: unknown): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (!body || typeof body !== "object") return out;
  for (const [key, value] of Object.entries(body as Record<string, unknown>)) {
    if (value === undefined) continue;
    const col = columnOf(row, key);
    if (col && sameValue(row[col], value)) continue;
    out[key] = value;
  }
  return out;
}

/** 送審之後單據又被改過的欄位（核准前檢查，避免用舊內容蓋掉新內容）。original 是送審當時存的「改之前」 */
export function driftedFields(row: Record<string, unknown>, original: Record<string, unknown> | null | undefined): string[] {
  const out: string[] = [];
  for (const [key, was] of Object.entries(original ?? {})) {
    const col = columnOf(row, key);
    if (col && !sameValue(row[col], was)) out.push(key);
  }
  return out;
}
