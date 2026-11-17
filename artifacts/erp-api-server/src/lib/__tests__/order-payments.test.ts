import { describe, expect, it } from "vitest";
import { allocateAdvance, orderOutstanding } from "../order-payments";

describe("訂金分配到發票", () => {
  it("依發票先後順序分配，分不完的留在訂單上", () => {
    const allocation = allocateAdvance(50000, [
      { id: 2, total: 40000, settled: 0 },
      { id: 1, total: 30000, settled: 0 },
    ]);
    expect(allocation.get(1)).toBe(30000);
    expect(allocation.get(2)).toBe(20000);
  });

  it("發票已經被沖銷的部分不重複分配", () => {
    const allocation = allocateAdvance(50000, [{ id: 1, total: 30000, settled: 25000 }, { id: 2, total: 10000, settled: 10000 }]);
    expect(allocation.get(1)).toBe(5000);
    expect(allocation.has(2)).toBe(false);
  });

  it("沒有訂金或沒有發票時不分配", () => {
    expect(allocateAdvance(0, [{ id: 1, total: 100, settled: 0 }]).size).toBe(0);
    expect(allocateAdvance(500, []).size).toBe(0);
  });

  it("金額有小數時不產生誤差", () => {
    const allocation = allocateAdvance(100.1, [{ id: 1, total: 33.37, settled: 0 }, { id: 2, total: 100, settled: 0 }]);
    expect(allocation.get(1)).toBe(33.37);
    expect(allocation.get(2)).toBe(66.73);
  });
});

describe("訂單未收（未付）餘額", () => {
  it("總額扣掉直接核對訂單的金額與發票已沖銷金額", () => {
    expect(orderOutstanding(100000, { advance: 30000, settled: 20000, paid: 50000 })).toBe(50000);
    expect(orderOutstanding(100000, undefined)).toBe(100000);
  });

  it("不會出現負數", () => {
    expect(orderOutstanding(100, { advance: 150, settled: 0, paid: 150 })).toBe(0);
  });
});
