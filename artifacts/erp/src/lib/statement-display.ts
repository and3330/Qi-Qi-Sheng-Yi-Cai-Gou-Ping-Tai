import { fmtMoney } from "./report-format";

/**
 * 財務報表的顯示選項（照 Ecount 資產負債表、損益表）：
 * 千單位＝金額除以 1,000 四捨五入；百分比＝佔基準（資產總計或營業收入）的比例。
 */
export function scaledMoney(value: number, thousand: boolean): string {
  return fmtMoney(thousand ? value / 1000 : value);
}

export function percentOf(value: number, base: number): string {
  if (!base) return "";
  const p = (value / base) * 100;
  if (Math.abs(p) < 0.005) return "0.00";
  return p.toFixed(2);
}
