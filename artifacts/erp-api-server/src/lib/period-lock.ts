/** 按月鎖帳：關帳日只往前推（鎖）可以直接做；往回改或取消（解鎖）要送審 */

/** 從 from 改成 to 算不算解鎖：原本有關帳日，新的比較早或取消 */
export function isUnlock(from: string | null, to: string | null): boolean {
  if (!from) return false;
  return !to || to < from;
}

/** 2026-10-31 → 「2026 年 10 月底」；月中的日期照寫；null → 「未關帳」 */
export function lockLabel(date: string | null): string {
  if (!date) return "未關帳";
  const [y, m, d] = date.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return d === last ? `${y} 年 ${m} 月底` : date;
}

/** 某個月的月底日期，例如 2026-10 → 2026-10-31 */
export function monthEnd(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  return `${y}-${String(m).padStart(2, "0")}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, "0")}`;
}
