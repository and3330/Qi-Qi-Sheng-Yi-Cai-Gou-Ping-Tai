/**
 * 單據列印的版面設定（視覺化編輯器存的就是這份設定，不用寫 HTML）。
 * 每種單據有一份預設版面；「系統管理 › 列印模板」可以另存版面並設為預設。
 */

export type PrintDocType = "Quotation" | "SalesOrder" | "DeliveryNote";

export const PRINT_DOC_TYPES: { value: PrintDocType; label: string; module: string }[] = [
  { value: "Quotation", label: "報價單", module: "Sales" },
  { value: "SalesOrder", label: "銷貨單", module: "Sales" },
  { value: "DeliveryNote", label: "出貨單", module: "Sales" },
];

export interface PrintFieldSetting { key: string; label: string; visible: boolean }

export interface PrintLayout {
  paper: "A4" | "A5" | "Letter";
  orientation: "portrait" | "landscape";
  /** 標題文字，{公司} 會換成公司名稱 */
  titleText: string;
  accentColor: string;
  fontSize: "small" | "normal" | "large";
  showCompanyBlock: boolean;
  customerFields: PrintFieldSetting[];
  companyFields: PrintFieldSetting[];
  showTotalBar: boolean;
  showExtraFields: boolean;
  columns: PrintFieldSetting[];
  showTerms: boolean;
  footerText: string;
  showSignatures: boolean;
  signatureLabels: string;
}

export interface PrintData {
  docNumber: string;
  title?: string;
  customer: { name?: string; taxId?: string; phone?: string; address?: string; contact?: string };
  company: { name?: string; taxId?: string; address?: string; contact?: string; tel?: string };
  /** 單頭可印的欄位值，key 對應 customerFields 的 key */
  fields: Record<string, string | null | undefined>;
  items: { code?: string; name: string; qty: number; unit?: string; unitPrice: number; amount: number; summary?: string }[];
  totals: { subtotal: number; tax: number; grand: number; taxIncluded: boolean };
  terms?: string;
  extraRows?: { label: string; value: string }[];
}

const f = (key: string, label: string, visible = true): PrintFieldSetting => ({ key, label, visible });

/** 每種單據的單頭可選欄位（順序就是預設的排列） */
export const DOC_HEADER_FIELDS: Record<PrintDocType, PrintFieldSetting[]> = {
  Quotation: [
    f("docNumber", "報價單號碼"), f("date", "報價日期", false), f("customerName", "客戶名"), f("customerTaxId", "統編"),
    f("customerPhone", "TEL"), f("customerAddress", "客戶地址", false), f("title", "標題"), f("validUntil", "有效期間"),
    f("project", "專案", false),
  ],
  SalesOrder: [
    f("docNumber", "訂單編號"), f("date", "訂單日期"), f("customerName", "客戶"), f("customerTaxId", "統編"),
    f("customerPhone", "TEL", false), f("customerAddress", "客戶地址", false), f("title", "標題"), f("handler", "承辦人"),
    f("project", "專案", false), f("deliveryDate", "預計交貨日", false), f("courseStartDate", "開課日期"), f("courseEndDate", "課程截止日"),
    f("caseTime", "上課時間"), f("coursePeriod", "課程期數", false), f("teacher", "老師", false),
  ],
  DeliveryNote: [
    f("docNumber", "出貨單號"), f("date", "出貨日期"), f("customerName", "客戶"), f("customerTaxId", "統編", false),
    f("customerPhone", "聯繫方式"), f("customerAddress", "送貨地址"), f("salesOrder", "銷貨單號"), f("handler", "承辦人"),
    f("warehouse", "發貨倉庫", false), f("project", "專案", false),
  ],
};

export const COMPANY_FIELDS: PrintFieldSetting[] = [
  f("companyName", "公司名稱"), f("companyTaxId", "統一編號"), f("companyAddress", "地址"), f("companyContact", "承辦人"), f("companyTel", "TEL"),
];

export const ITEM_COLUMNS: PrintFieldSetting[] = [
  f("index", "#", false), f("code", "品項編碼"), f("name", "品項名稱[規格]"), f("qty", "數量(包含單位)"),
  f("unitPrice", "單價"), f("amount", "小計"), f("summary", "摘要"),
];

export function defaultLayout(docType: PrintDocType): PrintLayout {
  return {
    paper: "A4",
    orientation: "portrait",
    titleText: `{公司}　${PRINT_DOC_TYPES.find(d => d.value === docType)?.label ?? "單據"}`,
    accentColor: "#000000",
    fontSize: "normal",
    showCompanyBlock: true,
    customerFields: DOC_HEADER_FIELDS[docType].map(x => ({ ...x })),
    companyFields: COMPANY_FIELDS.map(x => ({ ...x })),
    showTotalBar: true,
    showExtraFields: true,
    columns: ITEM_COLUMNS.map(x => ({ ...x })),
    showTerms: true,
    footerText: "",
    showSignatures: false,
    signatureLabels: "客戶簽章、公司簽章",
  };
}

/** 存起來的設定可能是舊版或缺欄位：用預設補齊，並保留使用者排的順序 */
export function normalizeLayout(docType: PrintDocType, raw: unknown): PrintLayout {
  const base = defaultLayout(docType);
  if (!raw || typeof raw !== "object") return base;
  const r = raw as Partial<PrintLayout>;
  const mergeList = (saved: unknown, defaults: PrintFieldSetting[]) => {
    if (!Array.isArray(saved)) return defaults;
    const known = new Map(defaults.map(d => [d.key, d]));
    const out: PrintFieldSetting[] = [];
    for (const s of saved as PrintFieldSetting[]) {
      const d = s && known.get(s.key);
      if (!d) continue;
      out.push({ key: d.key, label: typeof s.label === "string" && s.label.trim() ? s.label : d.label, visible: s.visible !== false });
      known.delete(d.key);
    }
    return [...out, ...known.values()];
  };
  const pick = <K extends keyof PrintLayout>(k: K, ok: (v: unknown) => boolean) => (ok(r[k]) ? (r[k] as PrintLayout[K]) : base[k]);
  const isStr = (v: unknown) => typeof v === "string";
  const isBool = (v: unknown) => typeof v === "boolean";
  return {
    paper: pick("paper", v => v === "A4" || v === "A5" || v === "Letter"),
    orientation: pick("orientation", v => v === "portrait" || v === "landscape"),
    titleText: pick("titleText", isStr),
    accentColor: pick("accentColor", v => typeof v === "string" && /^#[0-9a-fA-F]{6}$/.test(v)),
    fontSize: pick("fontSize", v => v === "small" || v === "normal" || v === "large"),
    showCompanyBlock: pick("showCompanyBlock", isBool),
    customerFields: mergeList(r.customerFields, base.customerFields),
    companyFields: mergeList(r.companyFields, base.companyFields),
    showTotalBar: pick("showTotalBar", isBool),
    showExtraFields: pick("showExtraFields", isBool),
    columns: mergeList(r.columns, base.columns),
    showTerms: pick("showTerms", isBool),
    footerText: pick("footerText", isStr),
    showSignatures: pick("showSignatures", isBool),
    signatureLabels: pick("signatureLabels", isStr),
  };
}

const esc = (v: unknown) => String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const num = (n: unknown) => { const v = Number(n); return !Number.isFinite(v) || v === 0 ? "" : v.toLocaleString("zh-TW"); };

export function renderPrintHtml(docType: PrintDocType, data: PrintData, layout: PrintLayout, opts: { forPreview?: boolean } = {}): string {
  const docLabel = PRINT_DOC_TYPES.find(d => d.value === docType)?.label || "";
  const accent = layout.accentColor || "#000000";
  const baseSize = layout.fontSize === "small" ? 11.5 : layout.fontSize === "large" ? 14.5 : 13;
  const title = (layout.titleText || `{公司}　${docLabel}`).split("{公司}").join(data.company.name || "");
  const priceLabel = data.totals.taxIncluded ? "含稅" : "未稅";

  const values: Record<string, string> = {
    docNumber: data.docNumber,
    customerName: data.customer.name || "",
    customerTaxId: data.customer.taxId || "",
    customerPhone: data.customer.phone || "",
    customerAddress: data.customer.address || "",
    title: data.title || "",
    companyName: data.company.name || "",
    companyTaxId: data.company.taxId || "",
    companyAddress: data.company.address || "",
    companyContact: data.company.contact || "",
    companyTel: data.company.tel || "",
    ...Object.fromEntries(Object.entries(data.fields).map(([k, v]) => [k, v == null ? "" : String(v)])),
  };
  const headTable = (list: PrintFieldSetting[]) => {
    const rows = list.filter(x => x.visible).map(x => `<tr><td class="lbl">${esc(x.label)}</td><td>${esc(values[x.key])}</td></tr>`).join("");
    return rows ? `<table>${rows}</table>` : "";
  };
  const left = headTable(layout.customerFields);
  const right = layout.showCompanyBlock ? headTable(layout.companyFields) : "";

  const cols = layout.columns.filter(c => c.visible);
  const colLabel = (c: PrintFieldSetting) => (c.key === "unitPrice" || c.key === "amount") && !/[（(]/.test(c.label) ? `${c.label}(${priceLabel})` : c.label;
  const widths: Record<string, string> = { index: "36px", code: "100px", qty: "100px", unitPrice: "90px", amount: "100px", summary: "150px" };
  const cell = (key: string, it: PrintData["items"][number], i: number) => {
    switch (key) {
      case "index": return `<td class="c">${i + 1}</td>`;
      case "code": return `<td class="c">${esc(it.code)}</td>`;
      case "name": return `<td>${esc(it.name)}</td>`;
      case "qty": return `<td class="c">${it.qty ? `${esc(Number(it.qty).toLocaleString("zh-TW"))}${esc(it.unit || "")}` : ""}</td>`;
      case "unitPrice": return `<td class="r">${num(it.unitPrice)}</td>`;
      case "amount": return `<td class="r">${num(it.amount)}</td>`;
      case "summary": return `<td>${esc(it.summary)}</td>`;
      default: return "<td></td>";
    }
  };
  const itemRows = data.items.map((it, i) => `<tr>${cols.map(c => cell(c.key, it, i)).join("")}</tr>`).join("");
  const g = data.totals.grand;
  const totalBar = layout.showTotalBar ? `<div class="total-bar"><span>${esc(docLabel)}金額：${g.toLocaleString("zh-TW")}</span><span>${data.totals.taxIncluded
    ? `( ${g.toLocaleString("zh-TW")} ) / 包含營業稅`
    : `未稅 ${data.totals.subtotal.toLocaleString("zh-TW")} + 稅 ${data.totals.tax.toLocaleString("zh-TW")} = ${g.toLocaleString("zh-TW")}`}</span></div>` : "";
  const extra = layout.showExtraFields && data.extraRows && data.extraRows.length > 0
    ? `<div class="extra">${data.extraRows.map(r => `<div><span class="k">${esc(r.label)}：</span>${esc(r.value)}</div>`).join("")}</div>` : "";
  const terms = layout.showTerms && data.terms ? `<div class="notes">${esc(data.terms)}</div>` : "";
  const footer = layout.footerText ? `<div class="footer">${esc(layout.footerText)}</div>` : "";
  const sigs = layout.showSignatures
    ? `<div class="sigs">${layout.signatureLabels.split(/[、,，]/).map(s => s.trim()).filter(Boolean).map(s => `<div class="sig"><div class="line"></div><div>${esc(s)}</div></div>`).join("")}</div>` : "";
  const pageSize = `${layout.paper} ${layout.orientation}`;

  return `<!DOCTYPE html>
<html lang="zh-TW"><head><meta charset="utf-8" />
<title>${esc(title)} - ${esc(data.docNumber)}</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: "Noto Sans TC", "Microsoft JhengHei", "PingFang TC", sans-serif; color: #000; margin: 0; padding: ${opts.forPreview ? "20px" : "24px"}; font-size: ${baseSize}px; background: #fff; }
  .sheet { max-width: ${layout.orientation === "landscape" ? "1080px" : "780px"}; margin: 0 auto; }
  h1 { text-align: center; font-size: ${baseSize + 7}px; font-weight: 700; text-decoration: underline; margin: 0 0 16px; color: ${accent}; }
  .head { display: flex; gap: 12px; margin-bottom: 12px; }
  .head > div { flex: 1; }
  .head table { border-collapse: collapse; width: 100%; }
  .head td { border: 1px solid #000; padding: 4px 8px; }
  .head td.lbl { background: ${accent === "#000000" ? "#f0f0f0" : accent + "1f"}; font-weight: 700; text-align: center; white-space: nowrap; width: 96px; }
  .total-bar { border: 2px solid ${accent}; display: flex; justify-content: space-between; gap: 12px; padding: 6px 12px; font-weight: 700; margin: 12px 0; font-size: ${baseSize + 1}px; }
  table.items { border-collapse: collapse; width: 100%; }
  table.items th, table.items td { border: 1px solid #000; padding: 5px 8px; }
  table.items th { background: ${accent === "#000000" ? "#f0f0f0" : accent + "1f"}; font-weight: 700; text-align: center; }
  td.c { text-align: center; } td.r { text-align: right; }
  .notes { margin-top: 16px; white-space: pre-wrap; font-size: ${baseSize - 1}px; }
  .footer { margin-top: 14px; white-space: pre-wrap; font-size: ${baseSize - 1}px; color: #333; border-top: 1px solid #ccc; padding-top: 8px; }
  .extra { display: grid; grid-template-columns: 1fr 1fr; gap: 4px 24px; margin: 0 0 12px; font-size: ${baseSize - 1}px; }
  .extra .k { font-weight: 700; }
  .sigs { display: flex; gap: 40px; justify-content: flex-end; margin-top: 40px; }
  .sig { width: 180px; text-align: center; font-size: ${baseSize - 1}px; }
  .sig .line { border-bottom: 1px solid #000; height: 48px; margin-bottom: 4px; }
  @media print { body { padding: 0; } @page { size: ${pageSize}; margin: 15mm; } }
</style></head>
<body><div class="sheet">
  <h1>${esc(title)}</h1>
  ${left || right ? `<div class="head">${left ? `<div>${left}</div>` : ""}${right ? `<div>${right}</div>` : ""}</div>` : ""}
  ${totalBar}
  ${extra}
  <table class="items">
    <thead><tr>${cols.map(c => `<th${widths[c.key] ? ` style="width:${widths[c.key]}"` : ""}>${esc(colLabel(c))}</th>`).join("")}</tr></thead>
    <tbody>${itemRows}</tbody>
  </table>
  ${terms}
  ${footer}
  ${sigs}
</div></body></html>`;
}

/** 預覽用的範例資料 */
export function samplePrintData(docType: PrintDocType): PrintData {
  return {
    docNumber: docType === "Quotation" ? "QT-20261115-001" : docType === "DeliveryNote" ? "DN-20261115-001" : "SO-20261115-001",
    title: "115(上) 範例國小 課後社團",
    customer: { name: "範例國民小學", taxId: "12345678", phone: "02-1234-5678", address: "新北市板橋區範例路 1 號" },
    company: { name: "範例股份有限公司", taxId: "00000000", address: "新北市板橋區範例路 2 號", contact: "王小明", tel: "02-0000-0000" },
    fields: {
      date: "2026-11-15", validUntil: "2026-12-15", project: "校園社團", handler: "謝孟軒", deliveryDate: "2026-12-01",
      salesOrder: "SO-20261115-001", warehouse: "總倉",
      courseStartDate: "2026-09-01", courseEndDate: "2027-01-15", caseTime: "1600-1730", coursePeriod: "115上", teacher: "王老師",
    },
    items: [
      { code: "C-001", name: "魔術社團課程", qty: 18, unit: "堂", unitPrice: 1500, amount: 27000, summary: "每週三" },
      { code: "M-010", name: "教材包", qty: 25, unit: "份", unitPrice: 300, amount: 7500, summary: "" },
    ],
    totals: { subtotal: 34500, tax: 0, grand: 34500, taxIncluded: true },
    terms: "報價有效期限：30天\n付款方式：月結30天",
    extraRows: [{ label: "上課週數", value: "18" }],
  };
}

/** 讀這種單據的預設版面（列印模板頁設為「預設」的那份）；沒有就用系統預設 */
export async function fetchDefaultLayout(docType: PrintDocType): Promise<PrintLayout> {
  try {
    const res = await fetch(`/erp-api/print-templates?documentType=${docType}&status=Active`);
    if (!res.ok) return defaultLayout(docType);
    const rows = (await res.json()) as any[];
    const chosen = rows.find(r => r.isDefault === "Yes" && r.layout) || rows.find(r => r.layout);
    return normalizeLayout(docType, chosen?.layout);
  } catch {
    return defaultLayout(docType);
  }
}

export function openPrintWindow(html: string, autoPrint: boolean) {
  const w = window.open("", "_blank", "width=900,height=1000");
  if (!w) return;
  w.document.write(html + (autoPrint ? "<script>window.onload=function(){window.print();}</script>" : ""));
  w.document.close();
}
