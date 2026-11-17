import { describe, expect, it } from "vitest";
import { autoEntryText, applyAutoText, autoOrPlain, parseAutoKey, plainText, remarksSummary } from "../auto-entry-text";

const fakeDb = (row: Record<string, unknown> | null) => ({ execute: async () => ({ rows: row ? [row] : [] }) });

describe("系統分錄摘要改成「對象｜摘要」", () => {
  it("從分錄編號認出來源單據", () => {
    expect(parseAutoKey("JE-12345678901-PQ26")).toEqual({ prefix: "PQ", id: 26, suffix: null });
    expect(parseAutoKey("JE-12345678-I7")).toEqual({ prefix: "I", id: 7, suffix: null });
    expect(parseAutoKey("JE-1234-ADV3-R2")).toEqual({ prefix: "ADV", id: 3, suffix: "R2" });
    expect(parseAutoKey("JE-202611-0037")).toBeNull();
  });

  it("付款申請：對象是廠商，摘要用備註，單號放在來源", async () => {
    const t = await autoEntryText(fakeDb({ request_number: "PRQ-202611-0026", party_type: "supplier", remarks: "11 月講師費", party: "王小明" }), "JE-1-PQ26");
    expect(t).toMatchObject({ party: "王小明", summary: "11 月講師費", sourceNumber: "PRQ-202611-0026", sourceUrl: "/accounting/payment-requests?open=26" });
    const out = applyAutoText(t, "自動分錄 - 付款申請 PRQ-202611-0026 付款", [{ description: "PRQ-202611-0026 付款" }, { description: "" }]);
    expect(out.description).toBe("11 月講師費");
    expect(out.lines.map(l => l.description)).toEqual(["王小明｜11 月講師費", "王小明｜11 月講師費"]);
  });

  it("已經寫好、沒有單號的行（例如「盤盈 A4紙」）不被蓋掉；來源沒給摘要就整張不動", () => {
    const t = { party: "甲", summary: "銷貨 A4紙", sourceLabel: "發票", sourceNumber: "INV-0001", sourceUrl: null };
    const out = applyAutoText(t, "x", [{ description: "INV-0001 銷貨" }, { description: "盤盈 A4紙" }, { description: "自動分錄 - 什麼" }]);
    expect(out.lines.map(l => l.description)).toEqual(["甲｜銷貨 A4紙", "盤盈 A4紙", "甲｜銷貨 A4紙"]);
    expect(applyAutoText({ ...t, summary: "" }, "原說明", [{ description: "INV-0001" }])).toEqual({ description: "原說明", lines: [{ description: "INV-0001" }] });
  });

  it("沒有專屬寫法的系統分錄：拿掉「自動分錄 - 」和單號，只留內容", () => {
    expect(plainText("自動分錄 - 工單 WO-202611-0001 發料 A4紙 × 3")).toBe("工單 發料 A4紙 × 3");
    expect(plainText("自動分錄 - 作廢撥款 CP-202611-0002（沖回 JE-12345678-CP3）")).toBe("作廢撥款");
    expect(plainText("作廢沖銷 - 服務費 SF-202611-0001：打錯")).toBe("作廢 服務費：打錯");
    expect(plainText("USB-C 線 3D 列印")).toBe("USB-C 線 3D 列印");
    expect(plainText("自動分錄 - WO-1", "系統分錄")).toBe("系統分錄");
    const out = autoOrPlain(null, "自動分錄 - 工單 WO-202611-0001 完工入庫 × 5", [{ description: "WO-202611-0001 完工入庫" }, { description: "甲｜已寫好" }, { description: "" }]);
    expect(out.description).toBe("工單 完工入庫 × 5");
    expect(out.lines.map(l => l.description)).toEqual(["完工入庫", "甲｜已寫好", "工單 完工入庫 × 5"]);
  });

  it("出貨單、盤點單、請款單：只提供來源單號，摘要用建立時寫好的", async () => {
    expect(parseAutoKey("JE-12345678-DN7")).toEqual({ prefix: "DN", id: 7, suffix: null });
    expect(parseAutoKey("JE-12345678-DN7-V")).toEqual({ prefix: "DN", id: 7, suffix: "V" });
    expect(parseAutoKey("JE-12345678123-SC3")).toEqual({ prefix: "SC", id: 3, suffix: null });
    expect(parseAutoKey("JE-12345678-RB9")).toEqual({ prefix: "RB", id: 9, suffix: null });
    const t = await autoEntryText(fakeDb({ note_number: "DN-202611-0001" }), "JE-1-DN7");
    expect(t).toMatchObject({ summary: "", sourceLabel: "出貨單", sourceNumber: "DN-202611-0001" });
    expect(applyAutoText(t, "銷貨成本 A4紙", [{ description: "客戶甲｜銷貨成本 A4紙" }])).toEqual({ description: "銷貨成本 A4紙", lines: [{ description: "客戶甲｜銷貨成本 A4紙" }] });
  });

  it("沒填備註就寫「付款 單號」", async () => {
    const t = await autoEntryText(fakeDb({ request_number: "PRQ-1", party_type: "Customer", remarks: "", party: "甲" }), "JE-1-PQ1");
    expect(t?.summary).toBe("收款 PRQ-1");
  });

  it("員工送的付款申請，備註整理成「品項 說明」，不放申請類型", () => {
    expect(remarksSummary("專案雜費｜申請人 簡培芳（自己先墊，付給申請人）\n・測試　20,000\n測試講師費-ＸＸＸ")).toBe("測試 測試講師費-ＸＸＸ");
    expect(remarksSummary("交通費｜申請人 王小明\n・高鐵　1,490\n・計程車　300")).toBe("高鐵、計程車");
    expect(remarksSummary("11 月講師費")).toBe("11 月講師費");
    expect(remarksSummary("A｜B\nC")).toBe("A／B C");
  });

  it("申請單每一行各自付給不同的人：整張摘要是各行摘要，對象不止一人就不放；已寫好的行不被蓋掉", async () => {
    const metadata = { lines: [
      { payee: "王老師", summary: "暑期講師費 7/1-7/5", amount: 6000 },
      { payee: "李老師", summary: "暑期講師費 7/8-7/12", amount: 4000 },
    ] };
    const t = await autoEntryText(fakeDb({ request_number: "PRQ-9", party_type: "Supplier", remarks: "其他｜申請人 甲", metadata, amount: "10000", party: "王老師" }), "JE-1-PQ9");
    expect(t).toMatchObject({ party: "", summary: "暑期講師費 7/1-7/5、暑期講師費 7/8-7/12" });
    const out = applyAutoText(t, "x", [{ description: "王老師｜暑期講師費 7/1-7/5" }, { description: "PRQ-9 付款" }]);
    expect(out.lines.map(l => l.description)).toEqual(["王老師｜暑期講師費 7/1-7/5", "暑期講師費 7/1-7/5、暑期講師費 7/8-7/12"]);
  });

  it("查不到來源或查詢出錯：原樣不動", async () => {
    expect(await autoEntryText(fakeDb(null), "JE-1-PQ9")).toBeNull();
    expect(await autoEntryText({ execute: async () => { throw new Error("boom"); } }, "JE-1-PQ9")).toBeNull();
    expect(applyAutoText(null, "原說明", [{ description: "a" }])).toEqual({ description: "原說明", lines: [{ description: "a" }] });
  });
});
