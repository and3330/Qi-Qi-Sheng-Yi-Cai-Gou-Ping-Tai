import { describe, expect, it } from "vitest";
import { atVendor, buildMaterials, closeOut, consumptionFor, feeFor, remainingToIssue, unitCostOf } from "../subcontract";

const bom = [
  { itemId: 1, itemName: "木塊", unit: "個", quantity: 4 },
  { itemId: 2, itemName: "漆", unit: "ml", quantity: 30 },
  { itemId: 1, itemName: "木塊", unit: "個", quantity: 2 },
];

describe("外包單材料需求", () => {
  it("依物料清單與數量算需求，同品項合併", () => {
    const materials = buildMaterials(bom, 2, 10);
    expect(materials).toHaveLength(2);
    expect(materials[0]).toMatchObject({ itemId: 1, perUnit: 3, requiredQty: 30, issuedQty: 0 });
    expect(materials[1]).toMatchObject({ itemId: 2, perUnit: 15, requiredQty: 150 });
  });
  it("物料清單基數是 0 時當成 1，數量 0 的材料略過", () => {
    expect(buildMaterials([{ itemId: 1, itemName: "A", unit: "", quantity: 2 }, { itemId: 2, itemName: "B", unit: "", quantity: 0 }], 0, 5))
      .toEqual([expect.objectContaining({ itemId: 1, perUnit: 2, requiredQty: 10 })]);
  });
});

describe("外包單收貨耗用", () => {
  const materials = buildMaterials(bom, 2, 10).map(m => ({ ...m, issuedQty: m.itemId === 1 ? 30 : 60 }));
  it("代工廠手上的料夠就照用量耗用", () => {
    const usage = consumptionFor(materials, 4);
    expect(usage.shortages).toEqual([]);
    expect(usage.lines).toEqual([{ itemId: 1, itemName: "木塊", quantity: 12 }, { itemId: 2, itemName: "漆", quantity: 60 }]);
  });
  it("不夠時列出缺料", () => {
    const usage = consumptionFor(materials, 5);
    expect(usage.shortages).toEqual([{ itemName: "漆", need: 75, have: 60 }]);
  });
  it("在代工廠的數量扣掉已耗用、已退回、已損耗", () => {
    expect(atVendor({ ...materials[0], consumedQty: 12, returnedQty: 3, lossQty: 1 })).toBe(14);
    expect(remainingToIssue({ ...materials[1] })).toBe(90);
    expect(remainingToIssue({ ...materials[0], issuedQty: 35 })).toBe(0);
  });
});

describe("加工費", () => {
  it("應稅另加 5%", () => expect(feeFor(10, 33.33, true)).toEqual({ net: 333.3, tax: 16.67, total: 349.97 }));
  it("免稅沒有稅額", () => expect(feeFor(10, 50, false)).toEqual({ net: 500, tax: 0, total: 500 }));
  it("單位成本＝（材料＋加工費）÷ 已交回數量", () => {
    expect(unitCostOf(1200, 500, 10)).toBe(170);
    expect(unitCostOf(1200, 500, 0)).toBe(0);
  });
});

describe("外包單結案", () => {
  const materials = buildMaterials(bom, 2, 10).map(m => ({ ...m, issuedQty: m.itemId === 1 ? 32 : 150, consumedQty: m.itemId === 1 ? 30 : 150 }));
  it("退回的記退回，其餘算損耗", () => {
    expect(closeOut(materials, [{ itemId: 1, quantity: 1.5 }])).toEqual({ error: null, lines: [{ itemId: 1, itemName: "木塊", returnQty: 1.5, lossQty: 0.5 }] });
  });
  it("沒有剩料就沒有明細", () => expect(closeOut(materials.map(m => ({ ...m, issuedQty: m.consumedQty })), []).lines).toEqual([]));
  it("退回超過對方手上的數量會擋", () => expect(closeOut(materials, [{ itemId: 1, quantity: 3 }]).error).toContain("只剩 2"));
  it("不在材料裡的品項、負數會擋", () => {
    expect(closeOut(materials, [{ itemId: 9, quantity: 1 }]).error).toContain("不在這張外包單");
    expect(closeOut(materials, [{ itemId: 1, quantity: -1 }]).error).toContain("負數");
  });
});
