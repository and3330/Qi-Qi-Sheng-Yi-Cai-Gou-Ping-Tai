import { pool, integrationEventsTable, type IntegrationSource } from "@workspace/erp-db";
import { and, eq } from "drizzle-orm";
import { ingestEvents, type LegacyRef } from "./integration-ingest";

/**
 * 轉接：ERP 主動去外部網站「現有的資料出口」把資料抓回來，轉成標準格式後丟進收件匣。
 * 對方的程式完全不用改。之後對方如果改成自己推送標準格式，這裡就可以停用。
 */

type RawEvent = Record<string, unknown> & { _legacy?: LegacyRef };
export interface PullSummary { fetched: number; processed: number; failed: number; alreadyDone: number; skipped: number; errors: string[] }
interface Adapter {
  label: string;
  /** 需要的環境變數（金鑰放在 Replit 的 Secrets，不存資料庫）；同一個資料庫內讀取的來源不需要 */
  envKey?: string;
  fetch(range: { from?: string; to?: string }, ctx: { database: any; source: IntegrationSource }): Promise<{ events: RawEvent[]; skipped: number }>;
}

const dateOf = (value: unknown): string => String(value || "").slice(0, 10);
const money = (n: unknown): number => Math.round((Number(n) || 0) * 100) / 100;

async function getJson(url: string, headers: Record<string, string>): Promise<any> {
  const response = await fetch(url, { headers, signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`對方的資料出口回應 ${response.status}，請確認金鑰是否正確、對方網站是否正常`);
  return response.json();
}

// ───────── CM生活+ ─────────
const CM_BASE = "https://cmsedu-life.com/api/erp";
/** CM生活+ 的訂單類型對到標準格式的 type；對應設定裡的「訂單類型」就填這些 */
export const CM_ORDER_TYPES: Record<string, string> = { service: "服務訂單", course: "課程訂單", lecture: "活動／講座票券", product: "商品訂單", tutor: "家教訂單" };

/** 把 CM生活+ 出口的一張訂單轉成標準格式（純轉換，方便測試） */
export function cmOrderToEvent(o: any): RawEvent | null {
  const total = money(o?.amount?.final);
  if (!(total > 0)) return null;
  const quantity = Number(o.quantity) > 0 ? Number(o.quantity) : 1;
  const type = String(o.type || "course");
  return {
    source: "cm-life", kind: "order", externalId: String(o.id), occurredAt: dateOf(o.createdAt),
    data: {
      orderNumber: o.orderNumber || undefined, type,
      buyer: {
        externalId: o.buyer?.userId ? String(o.buyer.userId) : undefined,
        name: o.buyer?.name || o.attendee?.name || "CM生活+ 會員",
        email: o.buyer?.email || o.attendee?.email || undefined, phone: o.buyer?.phone || o.attendee?.phone || undefined,
        taxId: o.invoice?.taxId || undefined,
      },
      // 出口給的是折扣後的實付金額，直接當成這一筆的金額；商品編號用對方的商品 ID，設了品項對應就會扣庫存
      lines: [{ sku: o.itemId ? String(o.itemId) : undefined, name: `${CM_ORDER_TYPES[type] ?? type}：${o.itemName || ""}`.slice(0, 200), quantity, unitPrice: money(total / quantity), amount: total }],
      total, taxType: "taxable",
      payments: [{ method: o.payment?.provider || "online", amount: total }],
      invoiceNumber: o.invoice?.invoiceNumber || undefined,
      note: [o.coupon?.code ? `優惠券 ${o.coupon.code}` : "", o.amount?.pointsUsed ? `使用點數 ${o.amount.pointsUsed}` : ""].filter(Boolean).join("；") || undefined,
    },
    _legacy: { salesOrderNumber: `CM-O-${o.id}` },
  };
}

const cmAdapter: Adapter = {
  label: "CM生活+", envKey: "CM_LIFE_ERP_API_KEY",
  async fetch(range) {
    const headers = { "x-api-key": process.env.CM_LIFE_ERP_API_KEY || "" };
    const query = (extra: Record<string, string> = {}) => {
      const params = new URLSearchParams(extra);
      if (range.from) params.set("from", range.from);
      if (range.to) params.set("to", range.to);
      return params.toString();
    };
    const events: RawEvent[] = [];
    let skipped = 0;
    for (let page = 1; page <= 50; page++) {
      const body = await getJson(`${CM_BASE}/orders?${query({ page: String(page), pageSize: "500", status: "paid" })}`, headers);
      for (const order of body.data || []) { const event = cmOrderToEvent(order); if (event) events.push(event); else skipped++; }
      if (page >= (body.totalPages || 1) || !body.data || body.data.length === 0) break;
    }
    for (const e of (await getJson(`${CM_BASE}/expenses?${query()}`, headers)).data || []) {
      if (!(money(e.amount) > 0)) { skipped++; continue; }
      events.push({
        source: "cm-life", kind: "expense", externalId: `expense-${e.id}`, occurredAt: dateOf(e.date || e.createdAt),
        data: { type: String(e.categoryName || "其他"), description: `${e.categoryName || "費用"} ${e.description || e.note || ""}`.trim(), amount: money(e.amount), paid: true },
        _legacy: { journalEntryNumber: `JE-CM-E-${e.id}` },
      });
    }
    for (const a of (await getJson(`${CM_BASE}/ad-spend?${query()}`, headers)).data || []) {
      if (!(money(a.amount) > 0)) { skipped++; continue; }
      events.push({
        source: "cm-life", kind: "expense", externalId: `ad-${a.id}`, occurredAt: dateOf(a.date || a.createdAt),
        data: { type: "廣告", description: `廣告 ${a.channel || ""} ${a.note || ""}`.trim(), amount: money(a.amount), paid: true },
        _legacy: { journalEntryNumber: `JE-CM-A-${a.id}` },
      });
    }
    return { events, skipped };
  },
};

// ───────── AI 大學（noncodingai.com）─────────
const NCAI_BASE = "https://noncodingai.com/api/erp";
// 國外金流的訂單舊同步就不處理（另外入帳），這裡維持一樣
const NCAI_SKIP_GATEWAYS = new Set(["stripe", "airwallex"]);

/** 把 AI 大學出口的一張訂單轉成標準格式。對方的金額單位是「分」 */
export function ncaiOrderToEvent(o: any): RawEvent | null {
  if (o?.status !== "completed" || NCAI_SKIP_GATEWAYS.has(String(o.paymentGateway || "").toLowerCase())) return null;
  const total = money((Number(o.amount) || 0) / 100);
  if (!(total > 0)) return null;
  const fee = money((Number(o.channelFeeAmount) || 0) / 100);
  return {
    source: "ai-university", kind: "order", externalId: String(o.id), occurredAt: dateOf(o.createdAt),
    data: {
      type: String(o.orderType || "course"),
      buyer: { name: o.customerName || o.customerIdentifier || "AI 大學學員", email: o.customerEmail || undefined, phone: o.customerPhone || undefined },
      lines: [{ name: String(o.productName || "線上課程").slice(0, 200), quantity: 1, unitPrice: total, amount: total }],
      total, taxType: Number(o.taxAmount) > 0 ? "taxable" : "exempt",
      payments: [{ method: o.paymentGateway || "online", amount: total }],
      paymentFee: fee > 0 && fee < total ? fee : undefined,
      invoiceNumber: o.invoiceNo || undefined,
    },
    _legacy: { salesOrderNumber: `NCAI-O-${o.id}` },
  };
}

const ncaiAdapter: Adapter = {
  label: "AI 大學", envKey: "NONCODINGAI_ERP_API_KEY",
  async fetch() {
    const headers = { Authorization: `Bearer ${process.env.NONCODINGAI_ERP_API_KEY || ""}` };
    const all = async (path: string): Promise<any[]> => {
      const rows: any[] = [];
      for (let offset = 0; offset < 20_000; offset += 200) {
        const body = await getJson(`${NCAI_BASE}${path}?limit=200&offset=${offset}`, headers);
        rows.push(...(body.data || []));
        if (rows.length >= (body.pagination?.total ?? 0) || !body.data || body.data.length === 0) break;
      }
      return rows;
    };
    const events: RawEvent[] = [];
    let skipped = 0;
    for (const order of await all("/orders")) { const event = ncaiOrderToEvent(order); if (event) events.push(event); else skipped++; }
    for (const e of await all("/expenses")) {
      const amount = money((Number(e.amount) || 0) / 100);
      if (!(amount > 0)) { skipped++; continue; }
      events.push({
        source: "ai-university", kind: "expense", externalId: `expense-${e.id}`, occurredAt: dateOf(e.date || e.createdAt),
        data: { type: String(e.category || "其他"), description: `${e.category || "費用"} ${e.description || ""}`.trim(), amount, paid: true },
        _legacy: { journalEntryNumber: `JE-NCAI-E-${e.id}` },
      });
    }
    return { events, skipped };
  },
};

// ───────── 七期商城（同一個網站、同一個資料庫）─────────
/**
 * 七期生醫網站的商城訂單直接從同一個資料庫的 public schema 讀（商城的資料表），
 * 不經過任何對外 API，也不需要金鑰。
 * - 已付款（匯款／錢包：已付款、已出貨、已完成；貨到付款：已完成）的訂單 → 訂單
 * - 已經入帳過、之後被取消或退貨的訂單 → 退款
 */
export const QIQI_SHOP_SOURCE_CODE = "qiqi-shop";
const QIQI_PAYMENT_LABEL: Record<string, string> = { bank_transfer: "bank_transfer", cod: "cod", wallet: "member_wallet" };
const taipeiDate = (d: unknown): string => {
  const t = new Date(d as string);
  return Number.isNaN(t.getTime()) ? "" : new Date(t.getTime() + 8 * 3600_000).toISOString().slice(0, 10);
};

/** 把商城的一張訂單轉成標準格式（純轉換，方便測試）；還沒付款的回 null */
export function qiqiOrderToEvent(o: any, items: any[]): RawEvent | null {
  const paidStatuses = o.payment_method === "cod" ? ["completed"] : ["paid", "shipped", "completed"];
  if (!paidStatuses.includes(o.status)) return null;
  const total = money(o.total_amount);
  if (!(total > 0) || items.length === 0) return null;
  const lines = items.map((i) => ({
    sku: String(i.product_code || "") || undefined,
    name: `${i.product_name}${i.variant_name ? `（${i.variant_name}）` : ""}`.slice(0, 200),
    quantity: Number(i.quantity), unitPrice: money(i.unit_price), amount: money(Number(i.unit_price) * Number(i.quantity)),
  }));
  const subtotal = money(lines.reduce((sum, l) => sum + l.amount, 0));
  const discount = money(Math.max(0, subtotal - total));
  const shippingFee = money(Math.max(0, total - subtotal));
  return {
    source: QIQI_SHOP_SOURCE_CODE, kind: "order", externalId: String(o.id), occurredAt: taipeiDate(o.created_at),
    data: {
      orderNumber: o.order_no, type: "product",
      buyer: { externalId: String(o.member_id), name: o.member_name || o.receiver_name || "七期商城會員", email: o.member_email || undefined, phone: o.member_phone || o.receiver_phone || undefined },
      lines, shippingFee, discount, total, taxType: "taxable",
      payments: [{ method: QIQI_PAYMENT_LABEL[o.payment_method] ?? String(o.payment_method || "other"), amount: total }],
      note: [o.points_used > 0 ? `點數折抵 ${o.points_used}` : "", o.remit_last_five ? `匯款後五碼 ${o.remit_last_five}` : ""].filter(Boolean).join("；") || undefined,
    },
  };
}

const qiqiShopAdapter: Adapter = {
  label: "七期商城",
  async fetch(range, { database, source }) {
    const since = range.from ? new Date(Date.now() - 120 * 86_400_000).toISOString() : "1970-01-01";
    const { rows: orders } = await pool.query(
      `SELECT o.*, m.name AS member_name, m.email AS member_email, m.phone AS member_phone
         FROM public.orders o LEFT JOIN public.members m ON m.id = o.member_id
        WHERE o.created_at >= $1 ORDER BY o.id`, [since]);
    if (orders.length === 0) return { events: [], skipped: 0 };
    const { rows: items } = await pool.query(
      `SELECT * FROM public.order_items WHERE order_id = ANY($1::int[]) ORDER BY id`, [orders.map((o: any) => o.id)]);
    const itemsByOrder = new Map<number, any[]>();
    for (const i of items) itemsByOrder.set(i.order_id, [...(itemsByOrder.get(i.order_id) ?? []), i]);
    // 已經入帳的訂單：之後被取消或退貨要送退款
    const booked = new Set<string>((await database.select({ externalId: integrationEventsTable.externalId }).from(integrationEventsTable)
      .where(and(eq(integrationEventsTable.sourceId, source.id), eq(integrationEventsTable.kind, "order"), eq(integrationEventsTable.status, "processed"))))
      .map((r: { externalId: string }) => r.externalId));
    const events: RawEvent[] = [];
    let skipped = 0;
    for (const o of orders) {
      if ((o.status === "cancelled" || o.status === "returned") && booked.has(String(o.id))) {
        const amount = money(o.total_amount);
        events.push({
          source: QIQI_SHOP_SOURCE_CODE, kind: "refund", externalId: `refund-${o.id}`, occurredAt: taipeiDate(new Date()),
          data: { orderExternalId: String(o.id), amount, refundTo: [{ method: QIQI_PAYMENT_LABEL[o.payment_method] ?? "original", amount }], restock: [], reason: o.status === "returned" ? "商城訂單退貨" : "商城訂單取消" },
        });
        continue;
      }
      const event = qiqiOrderToEvent(o, itemsByOrder.get(o.id) ?? []);
      if (event) events.push(event); else skipped++;
    }
    return { events, skipped };
  },
};

/**
 * 來源代號 → 轉接。新增來源時代號要用這裡的字，才抓得到資料。
 * 七期網站只開七期商城；CM生活+、AI 大學是公司 ERP 的來源，這裡不連線。
 */
export const ADAPTERS: Record<string, Adapter> = { [QIQI_SHOP_SOURCE_CODE]: qiqiShopAdapter };
void cmAdapter; void ncaiAdapter;

export function adapterConfigured(adapter: Adapter): boolean {
  return !adapter.envKey || !!process.env[adapter.envKey];
}

export function adapterInfo(code: string): { canPull: boolean; configured: boolean; label?: string; envKey?: string } {
  const adapter = ADAPTERS[code];
  return adapter ? { canPull: true, configured: adapterConfigured(adapter), label: adapter.label, envKey: adapter.envKey } : { canPull: false, configured: false };
}

/** 去對方那邊抓資料並丟進收件匣 */
export async function pullSource(database: any, source: IntegrationSource, range: { from?: string; to?: string }, actor: string): Promise<PullSummary> {
  const adapter = ADAPTERS[source.code];
  if (!adapter) throw new Error(`來源「${source.name}」沒有可以主動抓資料的轉接，只能由對方系統送資料進來`);
  if (!adapterConfigured(adapter)) throw new Error(`還沒設定「${adapter.label}」的金鑰（環境變數 ${adapter.envKey}），請到 Replit 的 Secrets 設定`);
  if (!source.isActive) throw new Error(`來源「${source.name}」已停用`);
  const { events, skipped } = await adapter.fetch(range, { database, source });
  const summary: PullSummary = { fetched: events.length, processed: 0, failed: 0, alreadyDone: 0, skipped, errors: [] };
  // 分批處理，一批失敗不影響其他批
  for (let index = 0; index < events.length; index += 100) {
    const batch = events.slice(index, index + 100);
    const results = await ingestEvents(database, batch, { actor, legacy: raw => (raw as RawEvent)._legacy });
    for (const result of results) {
      if (result.duplicate && result.status === "processed") summary.alreadyDone++;
      else if (result.status === "processed") summary.processed++;
      else if (result.status === "ignored") summary.alreadyDone++;
      else { summary.failed++; if (summary.errors.length < 5 && result.error) summary.errors.push(`${result.externalId}：${result.error}`); }
    }
  }
  return summary;
}
