import type { BracketRowInput } from "@/lib/api";

/**
 * 民國 115 年（2026）1 月 1 日起適用的投保級距。
 * 來源：「2026年勞健保保費及勞退提繳三合一費用對照參考用表」。
 *
 * 表上所有級距的投保金額（含部分工時的低級距），由小到大。
 * 三種保險用的是同一串金額，只是上下限不同：
 * - 勞保：11,100 ～ 45,800
 * - 健保：29,500 ～ 313,000
 * - 勞退：1,500 ～ 150,000
 */
export const BRACKET_YEAR_LABEL = "2026（民國 115 年）";

const AMOUNTS = [
  1500, 3000, 4500, 6000, 7500, 8700, 9900, 11100, 12540, 13500, 15840, 16500, 17280, 17880, 19047, 20008,
  21009, 22000, 23100, 24000, 25250, 26400, 27600, 28590,
  29500, 30300, 31800, 33300, 34800, 36300, 38200, 40100, 42000, 43900, 45800, 48200, 50600, 53000, 55400,
  57800, 60800, 63800, 66800, 69800, 72800, 76500, 80200, 83900, 87600, 92100, 96600, 101100, 105600, 110100,
  115500, 120900, 126300, 131700, 137100, 142500, 147900, 150000,
  156400, 162800, 169200, 175600, 182000, 189500, 197000, 204500, 212000, 219500, 228200, 236900, 245600,
  254300, 263000, 273000, 283000, 293000, 303000, 313000,
];

const RANGE: Record<"labor" | "health" | "pension", { min: number; max: number }> = {
  labor: { min: 11100, max: 45800 },
  health: { min: 29500, max: 313000 },
  pension: { min: 1500, max: 150000 },
};

/**
 * 某一種保險的級距表。
 * 每一級涵蓋「上一級金額 + 1」到「這一級金額」的薪資；最高一級沒有上限。
 */
export function officialBrackets(type: "labor" | "health" | "pension"): BracketRowInput[] {
  const { min, max } = RANGE[type];
  const amounts = AMOUNTS.filter((amount) => amount >= min && amount <= max);
  return amounts.map((amount, index) => ({
    minSalary: index === 0 ? 0 : amounts[index - 1] + 1,
    maxSalary: index === amounts.length - 1 ? null : amount,
    insuredAmount: amount,
  }));
}
