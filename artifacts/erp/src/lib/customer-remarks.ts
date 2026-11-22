/**
 * 客戶備註：一則一則記，每則開頭是日期，最新的排最上面，各則之間用一行橫線隔開。
 * （老闆 2026-11-22：照舊系統客戶卡的備註方式；開報價單、銷貨單、出貨單時要看得到，並可帶進單據備註）
 *
 * 資料仍存在客戶的「備註」欄位（純文字），所以舊資料不用搬，從 Ecount 搬來的備註也照樣看得到。
 */
export const REMARK_SEPARATOR = "------------------";

const WEEKDAYS = ["日", "一", "二", "三", "四", "五", "六"];
const pad = (n: number) => String(n).padStart(2, "0");

/** 2026/11/20(五) */
export function formatRemarkDate(date: Date): string {
  return `${date.getFullYear()}/${pad(date.getMonth() + 1)}/${pad(date.getDate())}(${WEEKDAYS[date.getDay()]})`;
}

/** 一行只有橫線（5 個以上的 - 或 ─）就是分隔線 */
const isSeparator = (line: string) => /^\s*[-─—]{5,}\s*$/.test(line);

/** 把備註拆成一則一則（依原本順序，第一則是最新的）；沒有分隔線時整段算一則 */
export function parseRemarkEntries(text: string | null | undefined): string[] {
  const entries: string[] = [];
  let current: string[] = [];
  const flush = () => {
    const entry = current.join("\n").trim();
    if (entry) entries.push(entry);
    current = [];
  };
  for (const line of String(text ?? "").replace(/\r\n?/g, "\n").split("\n")) {
    if (isSeparator(line)) flush();
    else current.push(line);
  }
  flush();
  return entries;
}

/** 在最上面加一則今天的備註；內容空白時原樣回傳 */
export function prependRemarkEntry(existing: string | null | undefined, content: string, date: Date = new Date()): string {
  const body = content.trim();
  if (!body) return String(existing ?? "");
  const entry = `${formatRemarkDate(date)} ${body}`;
  const rest = String(existing ?? "").replace(/^\s+/, "");
  return rest ? `${entry}\n${REMARK_SEPARATOR}\n${rest}` : entry;
}

/** 把一則客戶備註加到單據備註後面；已經有同樣內容就不重複加 */
export function appendToDocumentRemarks(documentRemarks: string | null | undefined, entry: string): string {
  const current = String(documentRemarks ?? "");
  const text = entry.trim();
  if (!text || current.includes(text)) return current;
  return current.trim() ? `${current.replace(/\s+$/, "")}\n${text}` : text;
}
