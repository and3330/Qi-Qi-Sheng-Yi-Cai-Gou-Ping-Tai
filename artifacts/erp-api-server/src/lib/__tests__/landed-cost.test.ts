import { describe, expect, it } from "vitest";
import { landedCostShares } from "../landed-cost";

describe("進貨附加費用分攤", () => {
  it("依進貨金額比例分攤，全部還在庫就全進存貨", () => {
    const result = landedCostShares(900, [{ itemId: 1, quantity: 100, amount: 3000 }, { itemId: 2, quantity: 50, amount: 1500 }], new Map([[1, 100], [2, 50]]));
    expect(result.items).toEqual([{ itemId: 1, share: 600, toInventory: 600, toCogs: 0 }, { itemId: 2, share: 300, toInventory: 300, toCogs: 0 }]);
    expect(result).toMatchObject({ toInventory: 900, toCogs: 0 });
  });
  it("已經賣掉的部分記成銷貨成本", () => {
    const result = landedCostShares(1000, [{ itemId: 1, quantity: 100, amount: 5000 }], new Map([[1, 40]]));
    expect(result).toMatchObject({ toInventory: 400, toCogs: 600 });
  });
  it("庫存比這批還多時最多只算這批的數量；尾差由最後一項吸收", () => {
    const result = landedCostShares(100, [{ itemId: 1, quantity: 1, amount: 1 }, { itemId: 2, quantity: 1, amount: 1 }, { itemId: 3, quantity: 1, amount: 1 }], new Map([[1, 99], [2, 1], [3, 1]]));
    expect(result.items.map(i => i.share)).toEqual([33.33, 33.33, 33.34]);
    expect(result.toInventory + result.toCogs).toBe(100);
  });
  it("同品項多列合併；金額都是 0 時用數量比例", () => {
    const result = landedCostShares(90, [{ itemId: 1, quantity: 2, amount: 0 }, { itemId: 1, quantity: 1, amount: 0 }, { itemId: 2, quantity: 6, amount: 0 }], new Map([[1, 3], [2, 0]]));
    expect(result.items).toEqual([{ itemId: 1, share: 30, toInventory: 30, toCogs: 0 }, { itemId: 2, share: 60, toInventory: 0, toCogs: 60 }]);
  });
});
