import { sql } from "drizzle-orm";
import { entrySummary, requestLines } from "./voucher-entry-text";

/**
 * 系統流程自動產生的分錄，摘要原本只寫單號（「自動分錄 - 付款申請 PRQ-202611-0026 付款」），
 * 對帳的人看不出付給誰、付什麼。這裡依分錄編號尾巴的來源代碼回頭查來源單據，
 * 改成跟 Ecount 一樣的「對象｜摘要」：對象放客戶或廠商名稱，摘要放單據上寫的備註或品項，
 * 單號另外存成「來源單據」，在總分類帳點日期就能連過去。
 */
export interface AutoEntryText { party: string; summary: string; sourceLabel: string; sourceNumber: string; sourceUrl: string | null }

const KEY = /-(PQV|PQ|SO|SFP|SFV|SF|SR|PRR|ADV|DN|SC|RB|I|W)(\d+)(?:-([A-Z0-9]+))?$/;

export function parseAutoKey(entryNumber: string | null | undefined): { prefix: string; id: number; suffix: string | null } | null {
  const m = KEY.exec(entryNumber || "");
  return m ? { prefix: m[1], id: Number(m[2]), suffix: m[3] ?? null } : null;
}

const rowsOf = (r: any): any[] => (Array.isArray(r) ? r : r?.rows ?? []);
const clean = (s: unknown) => (typeof s === "string" ? s.replace(/\s+/g, " ").trim() : "");
/** 品項名稱：取第一項，多項時加「等 N 項」 */
function itemsText(items: unknown): string {
  const list = Array.isArray(items) ? items : [];
  const first = list.map((i: any) => clean(i?.productName || i?.description || i?.name || i?.itemName)).find(Boolean);
  if (!first) return "";
  return list.length > 1 ? `${first} 等 ${list.length} 項` : first;
}
/**
 * 付款申請的備註整理成一句摘要。員工自己送的申請，備註是系統組的：
 * 「類別｜申請人 某某（…）」＋每行「・品項　金額」＋說明；整理成「品項、品項 說明」。
 * 老闆 2026-11-15：申請類型不放進日記帳摘要。摘要裡不留「｜」，因為「｜」是用來分開對象和摘要的。
 */
export function remarksSummary(remarks: unknown): string {
  const text = typeof remarks === "string" ? remarks.trim() : "";
  if (!text) return "";
  const rows = text.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  const head = /^(.+?)｜申請人\s/.exec(rows[0] || "");
  if (head) {
    const items = rows.filter(r => r.startsWith("・")).map(r => r.slice(1).replace(/[\s　]+[\d,.]+$/, "").trim()).filter(Boolean);
    const note = rows.slice(1).filter(r => !r.startsWith("・")).join(" ");
    return [items.join("、"), note].filter(Boolean).join(" ").replace(/｜/g, "／");
  }
  return rows.join(" ").replace(/｜/g, "／");
}

const INVOICE_LABEL: Record<string, string> = { Sales: "銷貨", Purchase: "進貨", "Credit Note": "銷貨折讓", "Debit Note": "進貨折讓" };

/** 查不到或查詢出錯都回 null：摘要只是文字，絕不能因此讓入帳失敗 */
export async function autoEntryText(executor: any, entryNumber: string | null | undefined): Promise<AutoEntryText | null> {
  try { return await lookup(executor, entryNumber); } catch { return null; }
}

async function lookup(executor: any, entryNumber: string | null | undefined): Promise<AutoEntryText | null> {
  const key = parseAutoKey(entryNumber);
  if (!key) return null;
  const one = async (q: ReturnType<typeof sql>) => rowsOf(await executor.execute(q))[0] ?? null;
  const { prefix, id, suffix } = key;

  if (prefix === "PQ" || prefix === "PQV") {
    const r = await one(sql`SELECT p.request_number, p.party_type, p.remarks, p.metadata, p.amount, COALESCE(c.name, s.name, '') AS party
      FROM payment_requests p LEFT JOIN customers c ON c.id = p.customer_id LEFT JOIN suppliers s ON s.id = p.supplier_id WHERE p.id = ${id}`);
    if (!r) return null;
    const verb = String(r.party_type).toLowerCase() === "customer" ? "收款" : "付款";
    // 「我的申請」每一行有自己的付款對象和摘要：整張的摘要是各行摘要接起來，對象只有一個人時才放
    const lines = requestLines(typeof r.metadata === "string" ? JSON.parse(r.metadata) : r.metadata, Number(r.amount));
    const payees = [...new Set(lines.map(l => l.payee))];
    const base = (lines.length > 0 ? entrySummary(lines.map(l => l.summary), null, "") : remarksSummary(r.remarks)) || `${verb} ${r.request_number}`;
    return { party: lines.length > 0 ? (payees.length === 1 ? payees[0] : "") : clean(r.party), summary: prefix === "PQV" ? `作廢${verb}：${base}` : base, sourceLabel: "付款申請", sourceNumber: r.request_number, sourceUrl: `/accounting/payment-requests?open=${id}` };
  }
  if (prefix === "I" || prefix === "W") {
    const r = await one(sql`SELECT i.invoice_number, i.invoice_type, i.gov_invoice_number, i.items, i.write_off_reason, COALESCE(c.name, s.name, '') AS party
      FROM invoices i LEFT JOIN customers c ON c.id = i.customer_id LEFT JOIN suppliers s ON s.id = i.supplier_id WHERE i.id = ${id}`);
    if (!r) return null;
    const label = INVOICE_LABEL[r.invoice_type] ?? "發票";
    const what = itemsText(r.items);
    const summary = prefix === "W"
      ? `呆帳沖銷${clean(r.write_off_reason) ? `：${clean(r.write_off_reason)}` : ""}`
      : `${label}${what ? ` ${what}` : ""}${r.gov_invoice_number ? `（發票 ${r.gov_invoice_number}）` : ""}`;
    return { party: clean(r.party), summary, sourceLabel: "發票", sourceNumber: r.invoice_number, sourceUrl: `/accounting/invoices?search=${encodeURIComponent(r.invoice_number)}` };
  }
  if (prefix === "SO") {
    const r = await one(sql`SELECT o.order_number, o.items, o.remarks, COALESCE(c.name, '') AS party FROM sales_orders o LEFT JOIN customers c ON c.id = o.customer_id WHERE o.id = ${id}`);
    if (!r) return null;
    return { party: clean(r.party), summary: `銷貨 ${itemsText(r.items) || clean(r.remarks) || r.order_number}（未開發票）`, sourceLabel: "銷貨單", sourceNumber: r.order_number, sourceUrl: `/sales/orders/${id}` };
  }
  if (prefix === "SR" || prefix === "PRR") {
    const r = prefix === "SR"
      ? await one(sql`SELECT x.return_number AS no, x.reason, x.remarks, x.items, COALESCE(c.name, '') AS party FROM sales_returns x LEFT JOIN customers c ON c.id = x.customer_id WHERE x.id = ${id}`)
      : await one(sql`SELECT x.return_number AS no, x.reason, x.remarks, x.items, COALESCE(s.name, '') AS party FROM purchase_returns x LEFT JOIN suppliers s ON s.id = x.supplier_id WHERE x.id = ${id}`);
    if (!r) return null;
    const label = prefix === "SR" ? "銷貨退回" : "採購退回";
    const cancel = suffix === "C" || suffix === "VC" ? "取消" : "";
    const why = clean(r.reason) || clean(r.remarks) || itemsText(r.items);
    return { party: clean(r.party), summary: `${cancel}${label}${why ? `：${why}` : ""}`, sourceLabel: label, sourceNumber: r.no, sourceUrl: prefix === "SR" ? "/sales/returns" : "/purchasing/returns" };
  }
  if (prefix === "ADV") {
    const r = await one(sql`SELECT advance_number, party_name, kind, description FROM advances WHERE id = ${id}`);
    if (!r) return null;
    const label = r.kind === "loan" ? "借款" : "代墊款";
    const what = clean(r.description) ? `：${clean(r.description)}` : "";
    const summary = suffix?.startsWith("R") ? `${label}還款` : suffix?.startsWith("V") ? `作廢${label}${what}` : `${label}${what}`;
    return { party: clean(r.party_name), summary, sourceLabel: label, sourceNumber: r.advance_number, sourceUrl: "/accounting/advances" };
  }
  if (prefix === "SF" || prefix === "SFP" || prefix === "SFV") {
    const r = await one(sql`SELECT fee_number, payee_name, description FROM service_fees WHERE id = ${id}`);
    if (!r) return null;
    const what = clean(r.description) || "服務費";
    const summary = prefix === "SFP" ? `支付服務費：${what}` : prefix === "SFV" ? `作廢服務費：${what}` : what;
    return { party: clean(r.payee_name), summary, sourceLabel: "服務費", sourceNumber: r.fee_number, sourceUrl: null };
  }
  // 出貨單、盤點單、員工請款單：摘要在建立分錄時就寫好了，這裡只提供「來源單據」讓總分類帳能顯示單號、點過去
  if (prefix === "DN") {
    const r = await one(sql`SELECT note_number FROM delivery_notes WHERE id = ${id}`);
    return r ? { party: "", summary: "", sourceLabel: "出貨單", sourceNumber: r.note_number, sourceUrl: "/sales/delivery-notes" } : null;
  }
  if (prefix === "SC") {
    const r = await one(sql`SELECT count_number FROM stock_counts WHERE id = ${id}`);
    return r ? { party: "", summary: "", sourceLabel: "盤點單", sourceNumber: r.count_number, sourceUrl: "/inventory/stock-counts" } : null;
  }
  if (prefix === "RB") {
    const r = await one(sql`SELECT voucher_number FROM vouchers WHERE id = ${id}`);
    return r ? { party: "", summary: "", sourceLabel: "請款單", sourceNumber: r.voucher_number, sourceUrl: "/accounting/reimbursement" } : null;
  }
  return null;
}

/**
 * 這一行要不要換成「對象｜摘要」：空白、或還是舊式寫單號的（「INV-0001 銷貨」「自動分錄 - …」）才換。
 * 已經寫好的摘要（有「｜」，或像「盤盈 A4紙 3 個」這種沒有單號的說明）保留原樣。
 */
function isNumberStyle(text: string | undefined, sourceNumber: string): boolean {
  const d = (text || "").trim();
  if (!d) return true;
  if (d.includes("｜")) return false;
  return d.startsWith("自動分錄") || (!!sourceNumber && d.includes(sourceNumber)) || /[A-Z]{2,}-?\d{3,}/.test(d);
}

/**
 * 沒有專屬寫法的系統分錄（工單、外包、金流撥款、外部訂單…）：把舊式說明整理成摘要——
 * 拿掉「自動分錄 - 」和單號（單號已經在分錄編號裡，總分類帳會顯示成來源單號）。
 * 例：「自動分錄 - 工單 WO-202611-0001 發料 A4紙 × 3」→「工單 發料 A4紙 × 3」
 */
export function plainText(text: unknown, fallback = ""): string {
  const s = (typeof text === "string" ? text : "")
    .replace(/^自動分錄\s*-\s*/, "")
    .replace(/^作廢沖銷\s*-\s*/, "作廢 ")
    .replace(/\b(?:JE|[A-Z]{2,})-[A-Z0-9-]*\d[A-Z0-9-]*/g, "")
    .replace(/[（(]\s*(?:沖回|發票)?\s*[)）]/g, "")
    .replace(/\s+([，、：）)])/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
  return s || fallback;
}

/** postAutoJournal 用：有來源摘要就換成「對象｜摘要」，沒有就把舊式說明整理成不帶單號的摘要 */
export function autoOrPlain<L extends { description?: string }>(text: AutoEntryText | null, description: string, lines: L[]): { description: string; lines: L[] } {
  if (text?.summary) return applyAutoText(text, description, lines);
  const summary = plainText(description, "系統分錄");
  return { description: summary.slice(0, 300), lines: lines.map(l => (l.description || "").includes("｜") ? l : ({ ...l, description: plainText(l.description, summary).slice(0, 200) })) };
}

/** 有對到來源單據時，把整張分錄的說明換成摘要、每一行換成「對象｜摘要」；對不到、或來源沒有提供摘要就原樣不動 */
export function applyAutoText<L extends { description?: string }>(text: AutoEntryText | null, description: string, lines: L[]): { description: string; lines: L[] } {
  if (!text || !text.summary) return { description, lines };
  const lineText = text.party ? `${text.party}｜${text.summary}` : text.summary;
  return { description: text.summary.slice(0, 300), lines: lines.map(l => isNumberStyle(l.description, text.sourceNumber) ? ({ ...l, description: lineText.slice(0, 200) }) : l) };
}
