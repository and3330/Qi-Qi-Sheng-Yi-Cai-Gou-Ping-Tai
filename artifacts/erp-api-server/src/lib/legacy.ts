/**
 * 從舊系統（Ecount）搬過來的歷史單據。
 *
 * 這些單據直接放在現行的單據表裡（銷貨單清單裡就看得到舊銷貨單），用 orderSource = "ecount" 辨識。
 * 它們的帳已經由舊系統的會計傳票搬進來了，所以：
 *   - 不再自動認列營收、不再扣庫存（否則會重複入帳）
 *   - 不能修改、刪除、建立出貨單（唯讀）
 *   - 舊系統沒開過發票的可以補開發票（老闆 2026-11-18），補開的發票只是稅務憑證，不再入帳
 *   - 搬進來之前已經收到的錢記在 extraFields.legacyPaid，未收金額＝總額 − legacyPaid − 之後在新系統收的錢
 */
export const LEGACY_SOURCE = "ecount";

export const isLegacySource = (source: unknown): boolean => source === LEGACY_SOURCE;

export const LEGACY_READONLY_MESSAGE = "這是從舊系統（Ecount）搬過來的歷史單據，帳已經入過了，不能刪除或出貨（標題、專案、備註可以用「編輯」補；舊系統沒開過發票的可以補開）。要收款請直接開收款單沖這張單";

/**
 * 報價單、採購單、進貨單沒有 orderSource 欄位，改用 extraFields.legacy = true 辨識歷史單。
 */
export const isLegacyDoc = (extraFields: unknown): boolean =>
  !!extraFields && typeof extraFields === "object" && (extraFields as Record<string, unknown>).legacy === true;

export const LEGACY_DOC_READONLY_MESSAGE = "這是從舊系統（Ecount）搬過來的歷史單據，不能刪除、作廢，也不能往下轉單或開發票（帳已經入過了）；專案、備註這類資料可以用「編輯」補";

const cut = (value: unknown, max: number): string => String(value ?? "").trim().slice(0, max);
const positiveId = (value: unknown): number | null => (Number.isInteger(Number(value)) && Number(value) > 0 ? Number(value) : null);
const money = (value: unknown): number => Math.round((Number(value) || 0) * 100) / 100;

export interface LegacyHeader {
  number: string; date: string; partyId: number; total: number;
  projectId: number | null; departmentId: number | null; warehouseId: number | null;
  remarks: string | null; title: string | null; staff: string;
  /** 建立時間用單據日期，清單才會照原本的先後排 */
  createdAt: Date;
  extraFields: Record<string, unknown>;
  lines: any[];
}

/** 歷史單匯入共用的表頭檢查。回傳錯誤訊息（字串）或整理好的表頭 */
export function readLegacyHeader(d: any, index: number, partyKey: "customerId" | "supplierId"): LegacyHeader | string {
  const number = cut(d?.number, 60), date = String(d?.date ?? "");
  const partyId = positiveId(d?.[partyKey]);
  const total = money(d?.totalAmount);
  if (!number || !partyId || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Number(d?.totalAmount))) {
    return `第 ${index + 1} 張的單號、${partyKey === "customerId" ? "客戶" : "供應商"}、日期或金額不正確`;
  }
  return {
    number, date, partyId, total,
    projectId: positiveId(d.projectId), departmentId: positiveId(d.departmentId), warehouseId: positiveId(d.warehouseId),
    remarks: cut(d.remarks, 2000) || null, title: cut(d.title, 300) || null, staff: cut(d.legacyStaff, 60),
    createdAt: new Date(`${date}T00:00:00+08:00`),
    extraFields: { legacy: true, legacySource: LEGACY_SOURCE, legacyDocNumber: cut(d.legacyDocNumber, 80), legacyStaff: cut(d.legacyStaff, 60), ...(d.legacyNote ? { legacyNote: cut(d.legacyNote, 500) } : {}) },
    lines: (Array.isArray(d.items) ? d.items : []).slice(0, 500),
  };
}

/** 歷史採購單、進貨單的明細：一律不動庫存（isVirtual），金額是換算成台幣後的含稅金額 */
export function legacyStockLines(lines: any[]): any[] {
  return lines.map(line => ({
    itemId: positiveId(line?.itemId), itemCode: cut(line?.itemCode, 60) || null, itemName: cut(line?.itemName, 300),
    specification: cut(line?.specification, 200) || null, summary: cut(line?.summary, 300) || null,
    quantity: Number(line?.quantity) || 0, rate: Number(line?.rate) || 0, amount: money(line?.amount), isVirtual: true,
    ...(line?.originalCurrency ? { originalCurrency: cut(line.originalCurrency, 10), originalAmount: money(line.originalAmount), originalRate: Number(line.originalExchangeRate) || null } : {}),
  }));
}

export const legacyImportError = (err: any): string =>
  /[㐀-鿿]/.test(err?.message || "") ? err.message : "寫入失敗，請確認客戶／供應商、專案、倉庫都存在";

/**
 * 收款單、付款單（傳票）沒有額外欄位，歷史單的標記放在明細上（items[].legacy = true）。
 * 歷史傳票的帳已經在舊系統搬來的分錄裡，所以它自己不產生分錄（journalEntryId 是空的），
 * 只在明細上記著對應的那張舊分錄（legacyJournalEntryId），用來顯示收款帳戶。
 */
export const isLegacyVoucher = (items: unknown): boolean =>
  Array.isArray(items) && items.some(item => !!item && typeof item === "object" && (item as Record<string, unknown>).legacy === true);

export const legacyVoucherJournalId = (items: unknown): number | null => {
  if (!Array.isArray(items)) return null;
  for (const item of items) {
    const id = Number((item as Record<string, unknown> | null)?.legacyJournalEntryId);
    if (Number.isInteger(id) && id > 0) return id;
  }
  return null;
};

export const LEGACY_VOUCHER_READONLY_MESSAGE = "這是從舊系統（Ecount）搬過來的歷史收款紀錄，帳已經入過了，不能作廢或刪除（說明可以改）";

/**
 * 老闆 2026-11-15：每張單都要能編輯。歷史單可以改「不影響帳」的欄位（標題、專案、部門、備註、承辦人、課程資訊…），
 * 金額、品項、狀態、客戶不能改，也不能刪——那些已經在舊系統的帳裡，改了單據就跟帳對不起來。
 */
export const LEGACY_SALES_EDITABLE = new Set([
  "label", "remarks", "projectId", "departmentId", "handlerId", "deliveryDate", "dateDetails",
  "classWeeks", "courseStartDate", "courseEndDate", "caseTime", "coursePeriod",
  "teacherCode", "teacherFeePerSession", "teacherMaterialFeeMethod", "warehouseCode", "invoiceTaxId", "invoiceTitle",
  // 分類（套用的模板）與模板欄位：只是說明性資料，不影響帳；歷史標記（legacy…）會保留
  "templateId", "extraFields",
]);
/** 已成立（不是草稿）的一般銷貨單也可以改的欄位：不含專案與部門（那兩個會牽動已經開出去的發票與分錄） */
export const CONFIRMED_SALES_EDITABLE = new Set([...LEGACY_SALES_EDITABLE].filter(key => key !== "projectId" && key !== "departmentId"));

export const LEGACY_EDIT_LIMIT_MESSAGE = "這是從舊系統（Ecount）搬過來的歷史單據：可以改標題、專案、部門、備註這類資料，但金額、品項、狀態、客戶不能改（帳已經入過了）";

/** 更新歷史單的額外欄位時，保留歷史標記（legacy…），不能被畫面送來的內容蓋掉 */
export function keepLegacyFields(existing: unknown, incoming: unknown): Record<string, unknown> {
  const kept = Object.fromEntries(Object.entries((existing && typeof existing === "object" ? existing : {}) as Record<string, unknown>).filter(([key]) => key.startsWith("legacy")));
  const next = Object.fromEntries(Object.entries((incoming && typeof incoming === "object" ? incoming : {}) as Record<string, unknown>).filter(([key]) => !key.startsWith("legacy")));
  return { ...next, ...kept };
}
