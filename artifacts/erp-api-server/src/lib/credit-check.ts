/** 信用額度檢查（純計算，不碰資料庫）：limit 沒設或 0 就是不限 */
export function creditCheck(limit: number | null | undefined, owed: number, orderAmount: number): { limited: boolean; ok: boolean; after: number; over: number } {
  const round2 = (n: number): number => Math.round((Number(n) || 0) * 100) / 100;
  const cap = Number(limit);
  const after = round2(owed + orderAmount);
  if (limit == null || !Number.isFinite(cap) || cap <= 0) return { limited: false, ok: true, after, over: 0 };
  const over = round2(after - cap);
  return { limited: true, ok: over <= 0.001, after, over: Math.max(0, over) };
}
