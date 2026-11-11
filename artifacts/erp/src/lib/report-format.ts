/**
 * 報表金額的統一寫法（會計慣例）：
 * 千分位、不逐格加幣別符號（單位寫在報表抬頭）、負數用括號、需要時零顯示成「–」。
 */
export function fmtMoney(value: number | string | null | undefined, dashZero = false): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return "–";
  const rounded = Math.round(n);
  if (rounded === 0) return dashZero ? "–" : "0";
  const text = Math.abs(rounded).toLocaleString("zh-TW");
  return rounded < 0 ? `(${text})` : text;
}

/** 數量：最多兩位小數，千分位 */
export function fmtQty(value: number | string | null | undefined): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return "–";
  return n.toLocaleString("zh-TW", { maximumFractionDigits: 2 });
}
