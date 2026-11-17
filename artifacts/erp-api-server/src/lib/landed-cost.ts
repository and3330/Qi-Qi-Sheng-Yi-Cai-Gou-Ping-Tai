/**
 * 進貨附加費用（集運費、運費、關稅…）怎麼攤進商品成本（純計算）。
 * 依各品項的進貨金額比例分攤；每個品項分到的部分，
 * 還在庫的比例加到存貨成本，已經賣掉的比例記成銷貨成本。最後一項吸收尾差。
 */
const round2 = (n: number): number => Math.round((Number(n) || 0) * 100) / 100;

export interface LandedShare { itemId: number; share: number; toInventory: number; toCogs: number }

export function landedCostShares(
  netAmount: number,
  lines: Array<{ itemId: number; quantity: number; amount: number }>,
  stockByItem: Map<number, number>,
): { items: LandedShare[]; toInventory: number; toCogs: number } {
  // 同一個品項出現多列先合併
  const merged = new Map<number, { quantity: number; amount: number }>();
  for (const line of lines) {
    const current = merged.get(line.itemId) || { quantity: 0, amount: 0 };
    merged.set(line.itemId, { quantity: current.quantity + line.quantity, amount: current.amount + line.amount });
  }
  const entries = [...merged.entries()];
  const totalAmount = entries.reduce((sum, [, v]) => sum + v.amount, 0);
  const totalQuantity = entries.reduce((sum, [, v]) => sum + v.quantity, 0);
  let remaining = round2(netAmount);
  const items: LandedShare[] = entries.map(([itemId, v], index) => {
    // 進貨金額都是 0（例如贈品）時改用數量比例
    const ratio = totalAmount > 0 ? v.amount / totalAmount : totalQuantity > 0 ? v.quantity / totalQuantity : 0;
    const share = index === entries.length - 1 ? remaining : round2(netAmount * ratio);
    remaining = round2(remaining - share);
    const inStock = Math.max(0, Math.min(stockByItem.get(itemId) ?? 0, v.quantity));
    const toInventory = v.quantity > 0 ? round2(share * (inStock / v.quantity)) : 0;
    return { itemId, share, toInventory, toCogs: round2(share - toInventory) };
  });
  return { items, toInventory: round2(items.reduce((s, i) => s + i.toInventory, 0)), toCogs: round2(items.reduce((s, i) => s + i.toCogs, 0)) };
}
