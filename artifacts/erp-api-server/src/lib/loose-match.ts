import { sql, type SQL } from "drizzle-orm";

/**
 * 用「意思相近」找名稱，不要求一字不差（老闆 2026-11-18：打「樂善國小」要找得到「桃園市龜山區樂善國民小學」）。
 *
 * 做法：關鍵字的每個字都照順序出現在名稱裡就算相近（樂…善…國…小），
 * 這樣簡稱、省略地名、省略「股份有限公司」「國民」這類字都對得上。
 * 完全相同 > 整段包含 > 照順序出現（中間跳過的字越少越前面）> 錯一兩個字。
 */
export const squashName = (value: string) => value.replace(/[\s()（）\-－·・,，.。]|股份有限公司|有限公司|企業社|工作室/g, "").toLocaleLowerCase();

function editDistance(a: string, b: string): number {
  const previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let diagonal = previous[0];
    previous[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const above = previous[j];
      previous[j] = Math.min(previous[j] + 1, previous[j - 1] + 1, diagonal + (a[i - 1] === b[j - 1] ? 0 : 1));
      diagonal = above;
    }
  }
  return previous[b.length];
}

/** needle 的每個字照順序出現在 text 裡時，回傳中間跳過了幾個字；對不上回傳 -1 */
function subsequenceGaps(needle: string, text: string): number {
  let at = text.indexOf(needle[0]);
  if (at < 0) return -1;
  // 從每一個可能的起點試，取跳過最少的
  let best = -1;
  for (let start = at; start >= 0; start = text.indexOf(needle[0], start + 1)) {
    let pos = start, gaps = 0, ok = true;
    for (let i = 1; i < needle.length; i++) {
      const next = text.indexOf(needle[i], pos + 1);
      if (next < 0) { ok = false; break; }
      gaps += next - pos - 1; pos = next;
    }
    if (ok && (best < 0 || gaps < best)) best = gaps;
    if (!ok) break;
  }
  return best;
}

/** 0＝不相近；越高越像（100 完全相同） */
export function looseScore(query: string, candidateText: string): number {
  const needle = squashName(query), candidate = squashName(candidateText);
  if (!needle || !candidate) return 0;
  if (candidate === needle) return 100;
  if (candidate.includes(needle)) return 90 - Math.min(30, candidate.length - needle.length);
  if (needle.includes(candidate) && candidate.length >= 2) return 70 - Math.min(30, needle.length - candidate.length);
  // 兩個字以上才比「照順序出現」，一個字太容易誤中
  if (needle.length >= 2) {
    const gaps = subsequenceGaps(needle, candidate);
    // 跳過的字不能比關鍵字本身多太多，不然「國小」會對到每一間學校以外的東西
    if (gaps >= 0 && gaps <= Math.max(4, needle.length * 2)) return 60 - Math.min(25, gaps * 3);
  }
  // 錯一兩個字也算相近，但只用在純文字的名稱：單號、編號、統編差一個數字就是另一張單，不能算
  if (needle.length >= 3 && !/[0-9]/.test(needle)) {
    const similarity = 1 - editDistance(candidate, needle) / Math.max(candidate.length, needle.length, 1);
    if (similarity >= 0.6) return similarity * 30;
  }
  return 0;
}

/** 一列資料裡任何一段文字跟關鍵字相近就算，回傳最高分 */
export function looseRowScore(query: string, row: unknown): number {
  let best = 0;
  const visit = (value: unknown, depth: number) => {
    if (best >= 100 || value == null) return;
    if (typeof value === "string") { if (value.length <= 200) best = Math.max(best, looseScore(query, value)); return; }
    if (depth >= 1 || typeof value !== "object" || Array.isArray(value)) return;
    for (const inner of Object.values(value as Record<string, unknown>)) visit(inner, depth + 1);
  };
  if (row && typeof row === "object") for (const value of Object.values(row as Record<string, unknown>)) visit(value, 0);
  return best;
}

/** 依關鍵字篩選並排序；一筆都對不上回空陣列（不亂猜） */
export function looseFilter<T>(query: string, rows: T[]): T[] {
  return rows.map(row => ({ row, score: looseRowScore(query, row) })).filter(e => e.score > 0).sort((a, b) => b.score - a.score).map(e => e.row);
}

/** 資料庫用：`%樂%善%國%小%`。只留文字與數字，最多 20 個字；LIKE 的萬用字元先拿掉 */
export function loosePattern(keyword: string): string | null {
  const chars = Array.from(squashName(keyword).replace(/[%_\\]/g, "")).slice(0, 20);
  return chars.length === 0 ? null : `%${chars.join("%")}%`;
}

/** 任一欄位跟關鍵字相近（整段包含，或每個字照順序出現） */
export function looseSqlMatch(keyword: string, columns: SQL[]): SQL | undefined {
  const pattern = loosePattern(keyword);
  if (!pattern || columns.length === 0) return undefined;
  return sql`(${sql.join(columns.map(column => sql`${column} ILIKE ${pattern}`), sql` OR `)})`;
}
