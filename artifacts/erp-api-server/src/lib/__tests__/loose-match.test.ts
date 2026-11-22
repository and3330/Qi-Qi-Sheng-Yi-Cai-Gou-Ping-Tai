import { describe, expect, it } from "vitest";
import { looseFilter, loosePattern, looseScore } from "../loose-match";

describe("用相近的意思找名稱", () => {
  it("簡稱找得到全名", () => {
    expect(looseScore("樂善國小", "桃園市龜山區樂善國民小學")).toBeGreaterThan(0);
    expect(looseScore("昌平國小", "新北市新莊區昌平國民小學")).toBeGreaterThan(0);
    expect(looseScore("育邦", "育邦文化教育科技股份有限公司")).toBeGreaterThan(0);
    expect(looseScore("北市大附小", "臺北市立大學附設實驗國民小學")).toBeGreaterThan(0);
  });

  it("不相干的不會中", () => {
    expect(looseScore("樂善國小", "新北市新莊區昌平國民小學")).toBe(0);
    expect(looseScore("樂善國小", "臺北市立大學附設實驗國民小學")).toBe(0);
    expect(looseScore("樂善國小", "新和國小")).toBe(0);
    expect(looseScore("國", "樂善國民小學")).toBeGreaterThan(0); // 一個字只做整段包含
    expect(looseScore("善樂", "樂善國民小學")).toBe(0);          // 順序不對不算
  });

  it("越像的排越前面：完全相同 > 整段包含 > 照順序出現", () => {
    const exact = looseScore("樂善國小", "樂善國小");
    const contains = looseScore("樂善國小", "桃園市樂善國小");
    const loose = looseScore("樂善國小", "桃園市龜山區樂善國民小學");
    expect(exact).toBeGreaterThan(contains);
    expect(contains).toBeGreaterThan(loose);
  });

  it("公司字尾、空白、括號不影響", () => {
    expect(looseScore("育邦文化教育科技", "育邦文化教育科技股份有限公司")).toBe(100);
    expect(looseScore("ABC 股份有限公司", "abc")).toBe(100);
  });

  it("清單篩選：只留相近的，並照相近程度排；都不像就回空的", () => {
    const rows = [
      { orderNumber: "EC-1", customerName: "新北市新莊區昌平國民小學" },
      { orderNumber: "EC-2", customerName: "桃園市龜山區樂善國民小學" },
      { orderNumber: "EC-3", customerName: "樂善國小" },
    ];
    expect(looseFilter("樂善國小", rows).map(r => r.orderNumber)).toEqual(["EC-3", "EC-2"]);
    expect(looseFilter("不存在的學校", rows)).toEqual([]);
    expect(looseFilter("EC-2", rows).map(r => r.orderNumber)).toEqual(["EC-2"]);
  });

  it("資料庫用的樣式：每個字中間可以夾別的字，萬用字元先拿掉", () => {
    expect(loosePattern("樂善國小")).toBe("%樂%善%國%小%");
    expect(loosePattern("50%_off")).toBe("%5%0%o%f%f%");
    expect(loosePattern("  ")).toBeNull();
  });
});
