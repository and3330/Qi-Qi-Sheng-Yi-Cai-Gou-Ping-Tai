import { describe, expect, it } from "vitest";
import { splitDescription } from "../journal-kind";

describe("日記帳說明拆成單號、客戶、摘要", () => {
  it("Ecount 搬來的分錄", () => {
    expect(splitDescription("Ecount 2026/11/13-1｜臺北市立大學附設實驗國民小學｜材料費用-魔術")).toEqual({
      sourceNumber: "2026/11/13-1", party: "臺北市立大學附設實驗國民小學", summary: "材料費用-魔術",
    });
  });
  it("客戶空白時客戶是 null", () => {
    expect(splitDescription("Ecount 2026/11/30-1｜｜結轉").party).toBeNull();
  });
  it("新系統自己開的分錄，摘要就是整段說明", () => {
    expect(splitDescription("收款 RC-202611-0001")).toEqual({ sourceNumber: null, party: null, summary: "收款 RC-202611-0001" });
    expect(splitDescription(null).summary).toBe("");
  });
});
