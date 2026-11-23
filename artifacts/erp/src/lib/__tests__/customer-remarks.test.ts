import { describe, expect, it } from "vitest";
import {
  REMARK_SEPARATOR,
  appendToDocumentRemarks,
  formatRemarkDate,
  parseRemarkEntries,
  prependRemarkEntry,
} from "../customer-remarks";

describe("customer remarks", () => {
  it("formats the date with the weekday", () => {
    expect(formatRemarkDate(new Date(2026, 10, 20))).toBe("2026/11/20(五)");
  });

  it("splits entries on separator lines and keeps multi-line entries", () => {
    const text = "2026/11/20(五) 合併出貨\n------------------\n\n2026/09/29(二) 原收件電話\n   → 收件人直接寫長老尼\n-----\n2025.09.08 主要聯繫人";
    expect(parseRemarkEntries(text)).toEqual([
      "2026/11/20(五) 合併出貨",
      "2026/09/29(二) 原收件電話\n   → 收件人直接寫長老尼",
      "2025.09.08 主要聯繫人",
    ]);
  });

  it("treats old remarks without separators as a single entry", () => {
    expect(parseRemarkEntries("聯絡請找會計\n月結")).toEqual(["聯絡請找會計\n月結"]);
    expect(parseRemarkEntries("")).toEqual([]);
    expect(parseRemarkEntries(null)).toEqual([]);
  });

  it("puts a new dated entry on top", () => {
    const date = new Date(2026, 10, 22);
    expect(prependRemarkEntry("", "下次出貨 1/15", date)).toBe("2026/11/22(日) 下次出貨 1/15");
    const next = prependRemarkEntry("舊備註", "下次出貨 1/15", date);
    expect(next).toBe(`2026/11/22(日) 下次出貨 1/15\n${REMARK_SEPARATOR}\n舊備註`);
    expect(parseRemarkEntries(next)).toEqual(["2026/11/22(日) 下次出貨 1/15", "舊備註"]);
    expect(prependRemarkEntry("舊備註", "   ", date)).toBe("舊備註");
  });

  it("appends to document remarks without duplicating", () => {
    expect(appendToDocumentRemarks("", "合併出貨")).toBe("合併出貨");
    expect(appendToDocumentRemarks("黑貓宅配", "合併出貨")).toBe("黑貓宅配\n合併出貨");
    expect(appendToDocumentRemarks("黑貓宅配\n合併出貨", "合併出貨")).toBe("黑貓宅配\n合併出貨");
  });
});
