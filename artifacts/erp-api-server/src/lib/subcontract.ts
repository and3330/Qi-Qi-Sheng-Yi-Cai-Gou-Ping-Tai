import type { SubcontractMaterial } from "@workspace/erp-db";

/** 外包單（供料加工）的純計算：材料需求、交貨耗用、加工費、結案的退料與損耗 */

const round4 = (n: number): number => Math.round((Number(n) || 0) * 10000) / 10000;
const round2 = (n: number): number => Math.round((Number(n) || 0) * 100) / 100;

/** 依物料清單算出這張外包單要給代工廠的材料。同一個品項出現多列會合併。 */
export function buildMaterials(
  bomItems: Array<{ itemId: number; itemName: string; unit: string; quantity: number }>,
  bomQuantity: number,
  orderQuantity: number,
): SubcontractMaterial[] {
  const base = bomQuantity > 0 ? bomQuantity : 1;
  const merged = new Map<number, SubcontractMaterial>();
  for (const row of bomItems) {
    if (!(row.quantity > 0)) continue;
    const perUnit = row.quantity / base;
    const existing = merged.get(row.itemId);
    if (existing) existing.perUnit = round4(existing.perUnit + perUnit);
    else merged.set(row.itemId, { itemId: row.itemId, itemName: row.itemName, unit: row.unit || "", perUnit: round4(perUnit), requiredQty: 0, issuedQty: 0, consumedQty: 0, returnedQty: 0, lossQty: 0 });
  }
  return [...merged.values()].map(m => ({ ...m, requiredQty: round4(m.perUnit * orderQuantity) }));
}

/** 這項材料目前還有多少在代工廠手上 */
export function atVendor(m: SubcontractMaterial): number {
  return round4(m.issuedQty - m.consumedQty - m.returnedQty - m.lossQty);
}

/** 還要再發多少料才夠做完整張單（不會是負數） */
export function remainingToIssue(m: SubcontractMaterial): number {
  return Math.max(0, round4(m.requiredQty - m.issuedQty));
}

/**
 * 交回一批成品要耗用多少材料：每個成品的用量 × 這批數量。
 * 代工廠手上的料不夠時回傳缺料清單，由呼叫端擋下來（要先發料）。
 */
export function consumptionFor(materials: SubcontractMaterial[], receiveQty: number): {
  lines: Array<{ itemId: number; itemName: string; quantity: number }>;
  shortages: Array<{ itemName: string; need: number; have: number }>;
} {
  const lines: Array<{ itemId: number; itemName: string; quantity: number }> = [];
  const shortages: Array<{ itemName: string; need: number; have: number }> = [];
  for (const m of materials) {
    const need = round4(m.perUnit * receiveQty);
    if (need <= 0) continue;
    const have = atVendor(m);
    if (have + 0.0001 < need) shortages.push({ itemName: m.itemName, need, have });
    else lines.push({ itemId: m.itemId, itemName: m.itemName, quantity: need });
  }
  return { lines, shortages };
}

/** 加工費：未稅金額、營業稅（5%）、含稅合計 */
export function feeFor(quantity: number, unitFee: number, taxable: boolean): { net: number; tax: number; total: number } {
  const net = round2(quantity * unitFee);
  const tax = taxable ? round2(net * 0.05) : 0;
  return { net, tax, total: round2(net + tax) };
}

/**
 * 結案：代工廠手上剩下的料，退回多少就記退回，其餘算損耗。
 * 退回的數量不能超過對方手上的數量。
 */
export function closeOut(materials: SubcontractMaterial[], returns: Array<{ itemId: number; quantity: number }>): {
  lines: Array<{ itemId: number; itemName: string; returnQty: number; lossQty: number }>;
  error: string | null;
} {
  const returnById = new Map<number, number>();
  for (const r of returns) {
    if (!(r.quantity >= 0)) return { lines: [], error: "退回數量不能是負數" };
    returnById.set(r.itemId, round4((returnById.get(r.itemId) || 0) + r.quantity));
  }
  for (const itemId of returnById.keys()) {
    if (!materials.some(m => m.itemId === itemId)) return { lines: [], error: "退回的品項不在這張外包單的材料裡" };
  }
  const lines: Array<{ itemId: number; itemName: string; returnQty: number; lossQty: number }> = [];
  for (const m of materials) {
    const have = atVendor(m);
    const returnQty = returnById.get(m.itemId) || 0;
    if (returnQty > have + 0.0001) return { lines: [], error: `「${m.itemName}」在代工廠只剩 ${have}，不能退回 ${returnQty}` };
    const lossQty = Math.max(0, round4(have - returnQty));
    if (returnQty > 0 || lossQty > 0) lines.push({ itemId: m.itemId, itemName: m.itemName, returnQty, lossQty });
  }
  return { lines, error: null };
}

/** 單位成本（顯示用）：已算進成品的材料加上加工費，除以已交回的數量 */
export function unitCostOf(materialCost: number, feeAmount: number, receivedQuantity: number): number {
  return receivedQuantity > 0 ? round2((materialCost + feeAmount) / receivedQuantity) : 0;
}
