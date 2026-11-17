import { describe, expect, it } from "vitest";
import { entrySummary, itemsSummary, partyLineText, requestLines, voidLineText, voucherHistoryRows } from "../voucher-entry-text";

describe("其他單據的摘要：作廢、品名", () => {
  it("作廢那一行：對象保留，摘要前面加「作廢」；不重複加", () => {
    expect(voidLineText("101文具天堂｜11月文具 A4紙")).toBe("101文具天堂｜作廢 11月文具 A4紙");
    expect(voidLineText("盤盈 A4紙")).toBe("作廢 盤盈 A4紙");
    expect(voidLineText("甲｜作廢 X")).toBe("甲｜作廢 X");
    expect(voidLineText("")).toBe("作廢");
  });
  it("品名：第一個，多項加「等 N 項」", () => {
    expect(itemsSummary(["A4紙", "原子筆", " "])).toBe("A4紙 等 2 項");
    expect(itemsSummary(["A4紙"])).toBe("A4紙");
    expect(itemsSummary([])).toBe("");
  });
});

describe("收款單、付款單、申請單：每一行的摘要就是日記帳的摘要", () => {
  it("一行是「客戶/供應商｜摘要」，摘要裡的｜換掉", () => {
    expect(partyLineText("台灣歐力士", "60-39 租金", "付款")).toBe("台灣歐力士｜60-39 租金");
    expect(partyLineText("", "", "收款")).toBe("收款");
    expect(partyLineText("甲", "A｜B", "付款")).toBe("甲｜A／B");
  });

  it("整張分錄說明：各行摘要去重接起來，沒填才用備註，再沒有用單號", () => {
    expect(entrySummary(["材料費", "材料費", "車馬費"], "備註", "收款單 RC-1")).toBe("材料費、車馬費");
    expect(entrySummary(["", " "], "備註", "收款單 RC-1")).toBe("備註");
    expect(entrySummary([], "", "收款單 RC-1")).toBe("收款單 RC-1");
  });

  it("申請單每一行：加起來等於申請金額才拆行，對不上就整張入帳", () => {
    const metadata = { lines: [{ payee: "王老師", summary: "講師費", amount: 6000 }, { payee: "李老師", summary: "講師費", amount: 4000 }] };
    expect(requestLines(metadata, 10000)).toHaveLength(2);
    expect(requestLines(metadata, 9000)).toEqual([]);
    expect(requestLines(null, 100)).toEqual([]);
    expect(requestLines({ lines: [{ payee: "a", summary: "b", amount: 0 }] }, 0)).toEqual([]);
  });
});

describe("收款單、付款單的 H：誰、什麼時候、做了什麼", () => {
  const at = "2026-11-15T08:00:00.000Z";
  it("新增、修改備註、作廢、刪除依序列出", () => {
    const rows = voucherHistoryRows({ createdAt: at }, [
      { action: "create", userName: "TRISTA", createdAt: at, oldValues: null, newValues: { status: "已過帳" } },
      { action: "update", userName: "老闆", createdAt: "2026-11-15T09:00:00.000Z", oldValues: { description: "舊" }, newValues: { description: "新" } },
      { action: "create", userName: "老闆", createdAt: "2026-11-15T10:00:00.000Z", oldValues: null, newValues: { status: "已作廢" } },
    ]);
    expect(rows.map(r => [r.user, r.action, r.detail])).toEqual([["TRISTA", "新增", ""], ["老闆", "修改", "備註：舊 → 新"], ["老闆", "作廢", ""]]);
  });

  it("搬過來的舊單沒有新增紀錄：用建立時間補一行", () => {
    expect(voucherHistoryRows({ createdAt: at, legacy: true }, [])).toEqual([{ at, user: "Ecount 匯入", action: "新增", detail: "" }]);
  });
});
