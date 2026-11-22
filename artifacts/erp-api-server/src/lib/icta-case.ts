/**
 * 銷貨單 → ICTA PRO 的講師案件（老闆 2026-11-16：銷貨單上按鈕手動送件）。
 * 這裡只做資料整理（不碰資料庫、不連線），方便測試。送出的格式對應 ICTA PRO 的 POST /api/partner/erp/cases。
 */
export interface IctaCasePayload {
  externalRef: string; title: string; startDate: string; endDate?: string; startTime?: string; endTime?: string;
  location: string; address?: string; sessions: number; sessionFee?: number; description?: string; semester?: string;
}
export type IctaCaseBuild = { ok: true; payload: IctaCasePayload } | { ok: false; error: string };

/** 存在銷貨單 extraFields.ictaCase 裡的送件紀錄 */
export interface IctaCaseRecord {
  id: number; status: string; statusLabel: string; teachers: Array<{ name: string; role?: string }>;
  sentAt: string; sentBy: string; checkedAt: string;
}

interface OrderLike {
  orderNumber: string; status: string; label?: string | null; orderDate?: string | null; deliveryDate?: string | null;
  courseStartDate?: string | null; courseEndDate?: string | null; caseTime?: string | null; classWeeks?: number | null;
  teacherFeePerSession?: string | number | null; coursePeriod?: string | null; remarks?: string | null;
  items?: unknown;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const day = (v: unknown): string => (typeof v === "string" && DATE.test(v.slice(0, 10)) ? v.slice(0, 10) : "");

/** 「13:30-15:00」「13:30~15:00」「1330-1500」→ 開始、結束時間；看不懂就不送時間 */
export function parseCaseTime(raw: unknown): { startTime?: string; endTime?: string } {
  if (typeof raw !== "string") return {};
  const found = [...raw.matchAll(/([01]?\d|2[0-3])[:：]?([0-5]\d)/g)].map(m => `${m[1].padStart(2, "0")}:${m[2]}`);
  if (found.length === 0) return {};
  return found.length >= 2 && found[1] > found[0] ? { startTime: found[0], endTime: found[1] } : { startTime: found[0] };
}

/** 可以送件的狀態：已成立的單才送，草稿和已取消的不送 */
export const ICTA_SENDABLE_STATUSES = ["Confirmed", "To Deliver", "Completed"];

export function salesOrderToIctaCase(order: OrderLike, customer: { name?: string | null; address?: string | null } | null): IctaCaseBuild {
  if (!ICTA_SENDABLE_STATUSES.includes(order.status)) return { ok: false, error: "銷貨單要先成立才能送件（草稿和已取消的單不能送）" };
  const startDate = day(order.courseStartDate) || day(order.deliveryDate);
  if (!startDate) return { ok: false, error: "請先在銷貨單填「課程開始日」（或交期），講師平台才知道哪一天要上課" };
  const location = (customer?.name || "").trim();
  if (!location) return { ok: false, error: "這張銷貨單沒有客戶，沒辦法告訴講師平台上課地點" };
  const endDate = day(order.courseEndDate);
  if (endDate && endDate < startDate) return { ok: false, error: "課程結束日比開始日早，請先修正銷貨單" };
  const items = Array.isArray(order.items) ? (order.items as Array<{ itemName?: string; quantity?: number }>) : [];
  const title = (order.label || "").trim() || items.map(i => i.itemName).filter(Boolean).slice(0, 2).join("、") || order.orderNumber;
  const fee = Math.round(Number(order.teacherFeePerSession) || 0);
  const lines = items.filter(i => i.itemName).map(i => `${i.itemName}${Number(i.quantity) > 0 ? ` × ${Number(i.quantity)}` : ""}`);
  const description = [order.remarks?.trim(), lines.length > 0 ? `品項：${lines.join("、")}` : "", `ERP 銷貨單 ${order.orderNumber}`].filter(Boolean).join("\n");
  return {
    ok: true,
    payload: {
      externalRef: order.orderNumber, title: title.slice(0, 200), startDate, ...(endDate ? { endDate } : {}), ...parseCaseTime(order.caseTime),
      location: location.slice(0, 200), ...(customer?.address?.trim() ? { address: customer.address.trim().slice(0, 300) } : {}),
      sessions: Math.max(1, Math.round(Number(order.classWeeks)) || 1), ...(fee > 0 ? { sessionFee: fee } : {}),
      description: description.slice(0, 2000), ...(order.coursePeriod?.trim() ? { semester: order.coursePeriod.trim().slice(0, 20) } : {}),
    },
  };
}

/** ICTA PRO 回傳的案件 → 存在銷貨單上的紀錄 */
export function ictaCaseRecord(remote: any, previous: IctaCaseRecord | null, actor: string, now = new Date().toISOString()): IctaCaseRecord {
  const teachers = Array.isArray(remote?.teachers) ? remote.teachers.filter((t: any) => t?.name).map((t: any) => ({ name: String(t.name).slice(0, 60), ...(t.role ? { role: String(t.role).slice(0, 20) } : {}) })) : [];
  return {
    id: Number(remote?.id) || previous?.id || 0, status: String(remote?.status || previous?.status || "pending"),
    statusLabel: String(remote?.statusLabel || remote?.status || "已送件").slice(0, 30), teachers,
    sentAt: previous?.sentAt ?? now, sentBy: previous?.sentBy ?? actor, checkedAt: now,
  };
}

/**
 * 對方的回覆是不是真的「收到案件」。
 * 講師平台還沒更新到有接收入口時，任何網址都會回首頁網頁（代碼 200），不能當成送件成功（2026-11-18 正式站實際發生）。
 */
export function ictaReplyProblem(contentType: string | null, data: unknown, expectCase: boolean): string | null {
  const notJson = !(contentType || "").toLowerCase().includes("json") || data == null || typeof data !== "object";
  if (notJson) return "講師平台回的是一般網頁，不是送件結果。對方可能還沒更新到能接收 ERP 送件的版本，請先請講師平台發布更新後再送";
  if (expectCase) {
    const id = Number((data as { case?: { id?: unknown } }).case?.id);
    if (!Number.isInteger(id) || id <= 0) return "講師平台沒有回傳案件編號，這次送件沒有成功，請稍後再試";
  }
  return null;
}

/** 連線網址：正式一定要 https；本機測試可以用 http://localhost */
export function ictaBaseUrlError(url: string): string | null {
  let parsed: URL;
  try { parsed = new URL(url); } catch { return "講師平台網址格式不正確，例如 https://icta-pro.com"; }
  const local = ["localhost", "127.0.0.1"].includes(parsed.hostname);
  if (parsed.protocol !== "https:" && !(local && parsed.protocol === "http:")) return "講師平台網址要用 https 開頭";
  if (parsed.username || parsed.password || parsed.search || parsed.hash) return "講師平台網址只要填到網域就好，例如 https://icta-pro.com";
  return null;
}
