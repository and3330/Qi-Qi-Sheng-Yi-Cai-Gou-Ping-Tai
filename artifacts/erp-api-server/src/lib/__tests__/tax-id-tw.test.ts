import { describe, expect, it } from "vitest";
import { isValidTaiwanTaxId } from "../tax-id-tw";

describe("Taiwan unified business number (統編) validation", () => {
  it.each([
    "22099131", // 台積電（sum 30，被 10 整除）
    "04595257", // sum 40
    " 22099131 ", // 前後空白先 trim
    "10458574", // 第 7 位為 7，僅 (sum+1) 可整除時有效
    "22099136", // sum 35：財政部 2023 起「被 5 整除」新規則
  ])("accepts valid tax ID %j", (id) => {
    expect(isValidTaiwanTaxId(id)).toBe(true);
  });

  it.each([
    "22099132", // 檢查碼錯誤 sum 31
    "10458573", // 第 7 位為 7，但 sum 與 sum+1 都不可整除
    "12345678",
  ])("rejects invalid checksum %j", (id) => {
    expect(isValidTaiwanTaxId(id)).toBe(false);
  });

  it.each(["2209913", "220991311", "", "        "])("rejects wrong length %j", (id) => {
    expect(isValidTaiwanTaxId(id)).toBe(false);
  });

  it.each(["2209 9131", "2209913A", "ABCDEFGH", "２２０９９１３１", "-2209913", "2209.131"])(
    "rejects whitespace, letters and non-ASCII digits %j",
    (id) => {
      expect(isValidTaiwanTaxId(id)).toBe(false);
    },
  );

  it("rejects non-string values", () => {
    for (const value of [22099131, null, undefined, {}, ["22099131"]]) {
      expect(isValidTaiwanTaxId(value)).toBe(false);
    }
  });
});
