import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { createHmac, timingSafeEqual } from "node:crypto";
import { PDFDocument, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import subsetFont from "subset-font";
import { eq } from "drizzle-orm";
import { db, quotationsTable, customersTable, brandsTable, tenantsTable, currentTenantId } from "@workspace/erp-db";

/**
 * 報價單 PDF（伺服器端產生）。給 AI 或外部系統用：不用開瀏覽器就能拿到可以直接傳給客戶的檔案。
 * 字型用開放授權的 Noto Sans TC（思源黑體）。做法是先排版、記下用到哪些字，
 * 最後只把用到的字抽出來嵌進檔案，所以檔案只有幾十 KB。
 */

const require = createRequire(import.meta.url);
const REGULAR = "chinese-traditional-400-normal", BOLD = "chinese-traditional-700-normal";
const fontBytes = new Map<string, Buffer>();
function fontFile(name: string): Buffer {
  let bytes = fontBytes.get(name);
  if (!bytes) {
    bytes = readFileSync(require.resolve(`@fontsource/noto-sans-tc/files/noto-sans-tc-${name}.woff`));
    fontBytes.set(name, bytes);
  }
  return bytes;
}
/** 量字寬、查有沒有這個字用的字型物件（整個程序共用） */
const metrics = new Map<string, any>();
function metric(name: string): any {
  let font = metrics.get(name);
  if (!font) { font = (fontkit as any).create(fontFile(name)); metrics.set(name, font); }
  return font;
}

/** 主要字型沒有的字（全形標點、罕見字）去其他分片找；找過的記起來 */
const fallbackOf = new Map<number, string | null>();
let fallbackNames: string[] | null = null;
function findFallback(codePoint: number): string | null {
  if (fallbackOf.has(codePoint)) return fallbackOf.get(codePoint) ?? null;
  if (!fallbackNames) {
    fallbackNames = [];
    for (let n = 0; n < 130; n++) {
      try { metric(`${n}-400-normal`); fallbackNames.push(`${n}-400-normal`); } catch { /* 這個編號沒有檔案 */ }
    }
  }
  const hit = fallbackNames.find(name => metric(name).hasGlyphForCodePoint(codePoint)) ?? null;
  fallbackOf.set(codePoint, hit);
  return hit;
}

interface Run { text: string; font: string }
interface Op { page: PDFPage; runs: Run[]; x: number; y: number; size: number; color: [number, number, number] }
/** 排版過程的狀態：用到哪些字、要畫哪些字（最後才真的畫上去） */
interface Fonts { used: Map<string, Set<string>>; ops: Op[] }
const newFonts = (): Fonts => ({ used: new Map(), ops: [] });

/** 把一段字依「哪個字型有這個字」切成幾段；都沒有的字換成空白，不讓整份文件失敗 */
function runsOf(text: string, bold: boolean): Run[] {
  const primary = bold ? BOLD : REGULAR;
  const out: Run[] = [];
  for (const ch of String(text ?? "").replace(/[\r\n\t]+/g, " ")) {
    const cp = ch.codePointAt(0)!;
    let font = primary, char = ch;
    if (!metric(primary).hasGlyphForCodePoint(cp)) {
      const fallback = metric(REGULAR).hasGlyphForCodePoint(cp) ? REGULAR : findFallback(cp);
      if (fallback) font = fallback; else char = " ";
    }
    const last = out[out.length - 1];
    if (last && last.font === font) last.text += char; else out.push({ text: char, font });
  }
  return out;
}

function runWidth(run: Run, size: number): number {
  const font = metric(run.font);
  let units = 0;
  for (const ch of run.text) units += font.glyphForCodePoint(ch.codePointAt(0)!).advanceWidth;
  return (units / font.unitsPerEm) * size;
}

async function widthOf(_fonts: Fonts, text: string, size: number, bold = false): Promise<number> {
  return runsOf(text, bold).reduce((sum, run) => sum + runWidth(run, size), 0);
}

async function draw(page: PDFPage, fonts: Fonts, text: string, x: number, y: number, size: number, opts: { bold?: boolean; align?: "left" | "right"; color?: [number, number, number] } = {}): Promise<void> {
  const runs = runsOf(text, !!opts.bold);
  if (runs.length === 0) return;
  const start = opts.align === "right" ? x - runs.reduce((sum, run) => sum + runWidth(run, size), 0) : x;
  for (const run of runs) {
    let set = fonts.used.get(run.font);
    if (!set) { set = new Set(); fonts.used.set(run.font, set); }
    for (const ch of run.text) set.add(ch);
  }
  fonts.ops.push({ page, runs, x: start, y, size, color: opts.color ?? [0.1, 0.1, 0.12] });
}

/** 排版完成：每個字型只抽出用到的字嵌進檔案，再把所有文字畫上去 */
async function finalize(pdf: PDFDocument, fonts: Fonts): Promise<void> {
  pdf.registerFontkit(fontkit as any);
  const embedded = new Map<string, PDFFont>();
  for (const [name, chars] of fonts.used) {
    const subset = await subsetFont(fontFile(name), [...chars].join(""), { targetFormat: "truetype" });
    embedded.set(name, await pdf.embedFont(subset, { subset: false }));
  }
  for (const op of fonts.ops) {
    let cursor = op.x;
    const [r, g, b] = op.color;
    for (const run of op.runs) {
      const font = embedded.get(run.font)!;
      // 一個字一個字畫：整段一起畫的話，字型會依前後文把數字換成另一種字形，間距就跑掉了
      for (const ch of run.text) {
        if (ch !== " ") op.page.drawText(ch, { x: cursor, y: op.y, size: op.size, font, color: rgb(r, g, b) });
        cursor += runWidth({ text: ch, font: run.font }, op.size);
      }
    }
  }
}

/** 依寬度斷行（中文逐字斷） */
async function wrap(fonts: Fonts, text: string, size: number, maxWidth: number, maxLines = 6): Promise<string[]> {
  const lines: string[] = [];
  for (const paragraph of String(text || "").split(/\r?\n/)) {
    let line = "";
    for (const ch of paragraph) {
      if (line && (await widthOf(fonts, line + ch, size)) > maxWidth) { lines.push(line); line = ch; }
      else line += ch;
      if (lines.length >= maxLines) break;
    }
    if (lines.length >= maxLines) break;
    lines.push(line);
  }
  return lines.slice(0, maxLines);
}

const money = (n: unknown, currency = "TWD"): string => {
  const value = Math.round((Number(n) || 0) * 100) / 100;
  return `${currency === "TWD" ? "NT$" : currency + " "}${value.toLocaleString("en-US", { minimumFractionDigits: Number.isInteger(value) ? 0 : 2 })}`;
};

export interface QuotationPdf { bytes: Uint8Array; fileName: string; quotationNumber: string; customerName: string; customerEmail: string | null; grandTotal: number }

/** 產生一張報價單的 PDF。需要在租戶情境內呼叫 */
export async function buildQuotationPdf(quotationId: number): Promise<QuotationPdf> {
  const tenantId = currentTenantId();
  if (!tenantId) throw new Error("Tenant context required");
  const [quotation] = await db.select().from(quotationsTable).where(eq(quotationsTable.id, quotationId));
  if (!quotation) throw new Error("找不到報價單");
  const [customer] = quotation.customerId
    ? await db.select({ name: customersTable.name, taxId: customersTable.taxId, contactPerson: customersTable.contactPerson, phone: customersTable.phone, address: customersTable.address, email: customersTable.email }).from(customersTable).where(eq(customersTable.id, quotation.customerId))
    : [];
  const [brand] = quotation.brandId ? await db.select().from(brandsTable).where(eq(brandsTable.id, quotation.brandId)) : [];
  const [tenant] = await db.select({ name: tenantsTable.name, companyCode: tenantsTable.companyCode }).from(tenantsTable).where(eq(tenantsTable.id, tenantId));
  const seller = { name: brand?.name || tenant?.name || "", taxId: brand?.taxId || tenant?.companyCode || "", address: brand?.address || "", tel: brand?.tel || "" };
  const customerName = customer?.name || quotation.customerName || "";
  const items = (Array.isArray(quotation.items) ? quotation.items : []) as Array<Record<string, any>>;
  const currency = quotation.currency || "TWD";

  const pdf = await PDFDocument.create();
  pdf.setTitle(`報價單 ${quotation.quotationNumber}`);
  pdf.setAuthor(seller.name);
  const fonts = newFonts();
  const W = 595.28, H = 841.89, L = 48, R = W - 48;
  const gray: [number, number, number] = [0.42, 0.45, 0.5];
  let page = pdf.addPage([W, H]);
  let y = H - 56;

  await draw(page, fonts, seller.name, L, y, 16, { bold: true });
  await draw(page, fonts, quotation.title || "報價單", R, y - 2, 22, { bold: true, align: "right" });
  y -= 18;
  for (const line of [seller.taxId ? `統一編號 ${seller.taxId}` : "", seller.address, seller.tel ? `電話 ${seller.tel}` : ""].filter(Boolean)) {
    await draw(page, fonts, line, L, y, 9, { color: gray }); y -= 13;
  }
  y = Math.min(y, H - 100);
  page.drawLine({ start: { x: L, y }, end: { x: R, y }, thickness: 1, color: rgb(0.82, 0.84, 0.87) });
  y -= 22;

  const left = [["客戶", customerName], ["統一編號", customer?.taxId || ""], ["聯絡人", [customer?.contactPerson, customer?.phone].filter(Boolean).join("　")], ["地址", customer?.address || ""]].filter(row => row[1]);
  const right = [["報價單號", quotation.quotationNumber], ["報價日期", quotation.quotationDate], ["有效期限", quotation.validUntil || ""], ["報價人", [quotation.quoterName, quotation.quoterPhone].filter(Boolean).join("　")]].filter(row => row[1]);
  const top = y;
  for (const [label, value] of left) {
    await draw(page, fonts, label, L, y, 9, { color: gray });
    const lines = await wrap(fonts, value, 10.5, 230, 2);
    for (const line of lines) { await draw(page, fonts, line, L + 54, y, 10.5, { bold: label === "客戶" }); y -= 15; }
  }
  let yr = top;
  for (const [label, value] of right) {
    await draw(page, fonts, label, 360, yr, 9, { color: gray });
    await draw(page, fonts, value, 414, yr, 10.5); yr -= 15;
  }
  y = Math.min(y, yr) - 12;

  // 明細表
  const cols = { no: L + 6, name: L + 30, qty: 372, rate: 458, amount: R - 6 };
  const header = async () => {
    page.drawRectangle({ x: L, y: y - 6, width: R - L, height: 22, color: rgb(0.95, 0.96, 0.97) });
    await draw(page, fonts, "#", cols.no, y, 9, { bold: true });
    await draw(page, fonts, "品項", cols.name, y, 9, { bold: true });
    await draw(page, fonts, "數量", cols.qty, y, 9, { bold: true, align: "right" });
    await draw(page, fonts, "單價", cols.rate, y, 9, { bold: true, align: "right" });
    await draw(page, fonts, "金額", cols.amount, y, 9, { bold: true, align: "right" });
    y -= 24;
  };
  await header();
  let index = 0, subtotal = 0;
  for (const item of items) {
    index++;
    const quantity = Number(item.quantity ?? item.qty) || 0, rate = Number(item.rate ?? item.unitPrice) || 0;
    const amount = Number(item.amount ?? quantity * rate) || 0;
    subtotal += amount;
    const nameLines = await wrap(fonts, String(item.itemName || item.name || ""), 10, 250, 3);
    const noteLines = item.summary || item.description ? await wrap(fonts, String(item.summary || item.description), 8.5, 250, 2) : [];
    const rowHeight = nameLines.length * 14 + noteLines.length * 11 + 8;
    if (y - rowHeight < 150) { page = pdf.addPage([W, H]); y = H - 60; await header(); }
    await draw(page, fonts, String(index), cols.no, y, 9.5, { color: gray });
    await draw(page, fonts, `${quantity.toLocaleString("en-US")}${item.unit ? " " + item.unit : ""}`, cols.qty, y, 10, { align: "right" });
    await draw(page, fonts, money(rate, currency), cols.rate, y, 10, { align: "right" });
    await draw(page, fonts, money(amount, currency), cols.amount, y, 10, { align: "right" });
    for (const line of nameLines) { await draw(page, fonts, line, cols.name, y, 10); y -= 14; }
    for (const line of noteLines) { await draw(page, fonts, line, cols.name, y, 8.5, { color: gray }); y -= 11; }
    y -= 2;
    page.drawLine({ start: { x: L, y: y + 4 }, end: { x: R, y: y + 4 }, thickness: 0.5, color: rgb(0.9, 0.91, 0.93) });
    y -= 8;
  }

  // 合計
  const total = Number(quotation.totalAmount) || subtotal, tax = Number(quotation.taxAmount) || 0;
  const grandTotal = Number(quotation.grandTotal) || total + tax;
  y -= 6;
  const totals: Array<[string, string, boolean]> = quotation.taxIncluded
    ? [["合計（含稅）", money(grandTotal, currency), true], ["其中營業稅", money(tax, currency), false]]
    : [["小計", money(total, currency), false], ["營業稅", money(tax, currency), false], ["合計", money(grandTotal, currency), true]];
  for (const [label, value, strong] of totals) {
    await draw(page, fonts, label, 400, y, strong ? 11 : 10, { color: strong ? undefined : gray, bold: strong });
    await draw(page, fonts, value, cols.amount, y, strong ? 13 : 10, { align: "right", bold: strong });
    y -= strong ? 20 : 16;
  }

  for (const [label, body] of [["備註", quotation.notes], ["條款", quotation.terms]] as Array<[string, string | null]>) {
    if (!body || !body.trim()) continue;
    if (y < 120) { page = pdf.addPage([W, H]); y = H - 60; }
    y -= 8;
    await draw(page, fonts, label, L, y, 9, { bold: true, color: gray }); y -= 14;
    for (const line of await wrap(fonts, body, 9.5, R - L, 10)) { await draw(page, fonts, line, L, y, 9.5); y -= 13; }
  }
  const pages = pdf.getPages();
  for (const [i, each] of pages.entries()) {
    await draw(each, fonts, `${quotation.quotationNumber}　第 ${i + 1} / ${pages.length} 頁`, R, 32, 8, { align: "right", color: gray });
  }

  await finalize(pdf, fonts);
  return {
    bytes: await pdf.save(), fileName: `${quotation.quotationNumber}.pdf`, quotationNumber: quotation.quotationNumber,
    customerName, customerEmail: customer?.email || null, grandTotal,
  };
}

// ───────── 有期限的下載連結 ─────────
const secret = (): string => {
  const value = process.env.SESSION_SECRET;
  if (!value) throw new Error("下載連結無法產生：伺服器沒有設定簽章用的密鑰");
  return value;
};
const sign = (tenantId: number, quotationId: number, expires: number): string =>
  createHmac("sha256", secret()).update(`quotation-pdf:${tenantId}:${quotationId}:${expires}`).digest("hex");

/** 產生下載路徑（不含網域）。連結本身就是憑證：有期限、只能下載這一張 */
export function quotationPdfPath(tenantId: number, quotationId: number, ttlSeconds = 7 * 24 * 3600): { path: string; expiresAt: string } {
  const expires = Math.floor(Date.now() / 1000) + ttlSeconds;
  return {
    path: `/erp-api/public/quotation-pdf/${tenantId}/${quotationId}?exp=${expires}&sig=${sign(tenantId, quotationId, expires)}`,
    expiresAt: new Date(expires * 1000).toISOString(),
  };
}

export function verifyQuotationPdfLink(tenantId: number, quotationId: number, expires: number, signature: string): boolean {
  if (!Number.isSafeInteger(tenantId) || !Number.isSafeInteger(quotationId) || !Number.isSafeInteger(expires)) return false;
  if (expires < Math.floor(Date.now() / 1000)) return false;
  const expected = Buffer.from(sign(tenantId, quotationId, expires));
  const supplied = Buffer.from(String(signature || ""));
  return expected.length === supplied.length && timingSafeEqual(expected, supplied);
}
