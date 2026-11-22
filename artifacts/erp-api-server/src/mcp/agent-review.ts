import { db } from "@workspace/erp-db";
import { registerLateChangeHandler, submitChangeRequest } from "../lib/change-requests";
import { issueReplayToken, REPLAY_HEADER } from "../middleware/posted-change-guard";
import { describeEndpoint } from "../lib/api-catalog";
import { internalHeaders } from "../lib/internal-auth";
import { logger } from "../lib/logger";
import { ACTION_LABELS, type ActionCategory, type AgentContext } from "./agent-caps";

/**
 * AI 金鑰設成「要人核准」的動作（沖銷、作廢、付款、刪除、核准）：
 * 不執行，改存成一張異動申請。財務或超級管理員在 ERP 核准後，
 * 系統用核准人的登入身分把同一個請求送出去，所以原本的檢查（關帳月份、狀態、角色）全部照走。
 */
export const AGENT_TARGET = "agent_request";

const port = () => process.env["PORT"];
const NUMBER_KEYS = ["entryNumber", "voucherNumber", "requestNumber", "orderNumber", "invoiceNumber", "quotationNumber", "receiptNumber", "noteNumber", "returnNumber", "advanceNumber", "feeNumber", "assetNumber", "name"];
const AMOUNT_KEYS = ["totalAmount", "amount", "totalDebit", "grandTotal"];

/** 這個請求動到哪一張單：先把那張單讀出來，審核的人才看得懂（讀不到就只列路徑） */
async function describeTarget(tenantId: number, path: string): Promise<{ id: number | null; number: string | null; original: Record<string, unknown> | null }> {
  const parts = path.split("/").filter(Boolean);
  const at = parts.findIndex(p => /^\d+$/.test(p));
  if (at < 0) return { id: null, number: null, original: null };
  const id = Number(parts[at]);
  try {
    const r = await fetch(`http://127.0.0.1:${port()}/api/${parts.slice(0, at + 1).join("/")}`, { headers: internalHeaders(tenantId), signal: AbortSignal.timeout(15_000) });
    if (!r.ok) return { id, number: null, original: null };
    const doc: any = await r.json();
    const number = NUMBER_KEYS.map(k => doc?.[k]).find(v => typeof v === "string" && v) ?? null;
    const amountKey = AMOUNT_KEYS.find(k => doc?.[k] != null);
    const original: Record<string, unknown> = {};
    for (const k of ["status", "description", "remarks", "entryDate", "voucherDate", "orderDate", "invoiceDate", "requestDate", "customerName", "supplierName", "payee"]) if (doc?.[k] != null && doc[k] !== "") original[k] = doc[k];
    if (amountKey) original.amount = doc[amountKey];
    return { id, number, original: Object.keys(original).length ? original : null };
  } catch { return { id, number: null, original: null }; }
}

export async function submitAgentReview(tenantId: number, agent: AgentContext, category: ActionCategory, request: { method: string; path: string; query?: Record<string, unknown>; body?: Record<string, unknown> }, reason: string) {
  const target = await describeTarget(tenantId, request.path);
  const what = describeEndpoint(request.method, request.path.replace(/\/\d+(?=\/|$)/g, "/:id"));
  const label = what.label || what.description || ACTION_LABELS[category];
  const { changeRequest } = await submitChangeRequest(db, {
    kind: "action", targetType: AGENT_TARGET, targetId: target.id, targetNumber: target.number ?? `${request.method} ${request.path}`,
    title: `AI 助理「${agent.keyName}」申請：${label}${target.number ? ` ${target.number}` : ""}`,
    payload: { method: request.method, path: request.path, query: request.query ?? {}, body: request.body ?? {}, category },
    original: target.original, reason, allowParallel: true, neverAutoApply: true,
  }, { username: `AI:${agent.keyName}`.slice(0, 80), role: null });
  return changeRequest;
}

/**
 * 員工用 ERP 裡的 AI 助理開收款單（老闆 2026-11-18）：先不入帳，送給財務確認「錢真的收到了」。
 * 財務核准後，系統用財務的身分把同一張收款單開出來，入帳、關帳月份、沖帳的檢查全部照走。
 */
export async function submitStaffReceiptReview(
  requester: { username: string; displayName?: string; role: string | null },
  body: Record<string, unknown>,
  summary: { customerName: string | null; amount: number },
  via: "AI 助理" | "我的申請" = "AI 助理",
) {
  const who = requester.displayName || requester.username;
  const { changeRequest } = await submitChangeRequest(db, {
    kind: "action", targetType: AGENT_TARGET, targetId: null, targetNumber: "新收款單",
    title: `${who} 透過${via}申請收款單：${summary.customerName ?? "客戶"} ${summary.amount.toLocaleString("zh-TW")} 元（請確認款項已入帳）`,
    payload: { method: "POST", path: "/vouchers", query: {}, body, category: "pay" },
    original: {
      ...(summary.customerName ? { customerName: summary.customerName } : {}), amount: summary.amount,
      ...(typeof body.voucherDate === "string" ? { voucherDate: body.voucherDate } : {}),
      ...(typeof body.description === "string" && body.description ? { description: body.description } : {}),
    },
    reason: `員工透過${via}開立，請財務確認款項確實入帳後再核准`, allowParallel: true, neverAutoApply: true,
  }, { username: requester.username.slice(0, 80), role: requester.role });
  return changeRequest;
}

export { needsReceiptReview } from "./receipt-review-rule";

registerLateChangeHandler(AGENT_TARGET, async (_tx, cr, ctx) => {
  const p = (cr.payload ?? {}) as { method?: string; path?: string; query?: Record<string, unknown>; body?: unknown };
  if (!p.method || !p.path || !p.path.startsWith("/")) throw Object.assign(new Error("異動申請內容不完整，無法執行"), { status: 400 });
  if (!ctx.cookie) throw Object.assign(new Error("請從網頁登入後再核准"), { status: 400 });
  const url = new URL(`/api${p.path}`, `http://127.0.0.1:${port()}`);
  for (const [k, v] of Object.entries(p.query ?? {})) url.searchParams.set(k, String(v));
  // 這張申請已經有人審過：已入帳單據的送審關卡這一次放行，不要再開第二張申請
  const token = issueReplayToken(p.method, p.path);
  const r = await fetch(url, { method: p.method, headers: { "content-type": "application/json", cookie: ctx.cookie, [REPLAY_HEADER]: token }, body: p.method === "GET" ? undefined : JSON.stringify(p.body ?? {}) });
  if (r.status >= 400) {
    const data: any = await r.json().catch(() => ({}));
    logger.warn({ changeRequest: cr.requestNumber, status: r.status }, "agent request replay failed");
    throw Object.assign(new Error(`執行失敗：${data?.error || data?.message || r.statusText}`), { status: 400 });
  }
  return `已${cr.title}`;
});
