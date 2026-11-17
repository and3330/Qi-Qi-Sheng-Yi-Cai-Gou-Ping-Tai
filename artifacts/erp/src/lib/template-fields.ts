/** 訂單模板的自訂欄位：報價單、銷售訂單、採購單共用的小工具 */

export interface TemplateField {
  name: string;
  label: string;
  type: string;
  required?: boolean;
  options?: string[];
  defaultValue?: string;
}

const isEmpty = (v: unknown) => v === undefined || v === null || String(v).trim() === "";

/** 標示必填但還沒填的欄位名稱 */
export function missingTemplateFields(schema: TemplateField[] | null | undefined, values: Record<string, unknown> | null | undefined): string[] {
  if (!Array.isArray(schema)) return [];
  return schema.filter((f) => f.required && isEmpty(values?.[f.name])).map((f) => f.label || f.name);
}

/** 選了模板後，帶入欄位設定的預設值 */
export function templateDefaults(schema: TemplateField[] | null | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!Array.isArray(schema)) return out;
  for (const f of schema) if (!isEmpty(f.defaultValue)) out[f.name] = String(f.defaultValue);
  return out;
}

/** 列印或檢視用：把已填的自訂欄位轉成「名稱＋內容」；模板不在了就直接用欄位代碼當名稱，資料不會消失 */
const LEGACY_LABELS: Record<string, string> = { legacyDocNumber: "Ecount 原單號" };

/** 複製單據時用：拿掉歷史單的標記，複製出來的是一張正常的新單 */
export function withoutLegacyFields<T extends Record<string, unknown>>(values: T | null | undefined): Record<string, unknown> {
  return Object.fromEntries(Object.entries(values || {}).filter(([key]) => !key.startsWith("legacy")));
}

export function extraFieldRows(schema: TemplateField[] | null | undefined, values: Record<string, unknown> | null | undefined): { label: string; value: string }[] {
  if (!values || typeof values !== "object") return [];
  const known = Array.isArray(schema) ? schema : [];
  const rows = known.filter((f) => !isEmpty(values[f.name])).map((f) => ({ label: f.label || f.name, value: String(values[f.name]) }));
  const knownNames = new Set(known.map((f) => f.name));
  for (const [key, v] of Object.entries(values)) {
    // 舊系統搬來的歷史單在這裡放了內部用的標記（legacy…），列印時只顯示看得懂的那一項
    if (key.startsWith("legacy")) { if (LEGACY_LABELS[key] && !isEmpty(v)) rows.push({ label: LEGACY_LABELS[key], value: String(v) }); continue; }
    if (!knownNames.has(key) && !isEmpty(v) && typeof v !== "object") rows.push({ label: key, value: String(v) });
  }
  return rows;
}

export type TemplateDocKind = "sales" | "purchase";
export interface TemplateMeta {
  /** 這個模板用在哪種單據：銷售（報價、銷售訂單）、採購，或兩者都可以 */
  appliesTo: "sales" | "purchase" | "both";
  /** 單據裡有這些分類的品項時，自動帶出這個模板 */
  itemGroups: string[];
}
interface TemplateLike { id: number; name: string; fieldSchema?: unknown; defaultValues?: unknown }

/** 模板的適用範圍設定；舊模板沒有設定時視為兩種單據都能用、不綁品項 */
export function templateMeta(template: { defaultValues?: unknown } | null | undefined): TemplateMeta {
  const raw = (template?.defaultValues as { __meta?: Partial<TemplateMeta> } | null | undefined)?.__meta;
  const appliesTo = raw?.appliesTo === "sales" || raw?.appliesTo === "purchase" ? raw.appliesTo : "both";
  const itemGroups = Array.isArray(raw?.itemGroups) ? raw!.itemGroups.filter((g): g is string => typeof g === "string" && g !== "") : [];
  return { appliesTo, itemGroups };
}

export function templateAppliesTo(template: { defaultValues?: unknown }, kind: TemplateDocKind): boolean {
  const { appliesTo } = templateMeta(template);
  return appliesTo === "both" || appliesTo === kind;
}

/** 單據裡的品項分類對得上哪個模板；對不上回傳 null */
export function suggestTemplateForGroups<T extends TemplateLike>(templates: T[], groups: (string | null | undefined)[]): T | null {
  const present = new Set(groups.filter(Boolean) as string[]);
  if (present.size === 0) return null;
  return templates.find((t) => templateMeta(t).itemGroups.some((g) => present.has(g))) || null;
}

/** 報價類別：內建的幾種加上使用者自己建的 */
export const DEFAULT_QUOTATION_CATEGORIES = ["校園", "活動", "課程", "居家服務", "商城", "其他"];

export function mergeCategories(custom: (string | null | undefined)[]): string[] {
  const out = [...DEFAULT_QUOTATION_CATEGORIES];
  for (const c of custom) if (c && !out.includes(c)) out.push(c);
  return out;
}
