import { describe, expect, it } from "vitest";
import { journalHistoryRows, reversalOriginalId } from "../journal-history";

const at = (h: number) => `2026-11-16T0${h}:00:00.000Z`;

describe("日記帳分錄的 H", () => {
  it("沖銷分錄的編號找得回原分錄", () => {
    expect(reversalOriginalId("JE-R16721-123456")).toBe(16721);
    expect(reversalOriginalId("JE-202611-0001")).toBeNull();
  });

  it("新增、修改說明、沖銷依時間列出", () => {
    const rows = journalHistoryRows({ id: 5, entryNumber: "JE-1", createdAt: at(1) }, [
      { action: "create", userName: "TRISTA", createdAt: at(1), oldValues: null, newValues: { id: 5 } },
      { action: "update", userName: "老闆", createdAt: at(2), oldValues: { description: "舊" }, newValues: { description: "新" } },
      { action: "create", userName: "老闆", createdAt: at(3), oldValues: null, newValues: { id: 9, entryNumber: "JE-R5-000001" } },
    ]);
    expect(rows.map(r => [r.user, r.action, r.detail])).toEqual([
      ["TRISTA", "新增", ""], ["老闆", "修改", "說明：舊 → 新"], ["老闆", "沖銷", "開了沖銷分錄 JE-R5-000001"],
    ]);
  });

  it("沖銷分錄：新增那一行寫是誰沖銷了哪一筆", () => {
    const log = { action: "create", userName: "老闆", createdAt: at(3), oldValues: null, newValues: { id: 9 } };
    expect(journalHistoryRows({ id: 9, entryNumber: "JE-R5-000001", createdAt: at(3) }, [], { log, originalNumber: "JE-1" }))
      .toEqual([{ at: at(3), user: "老闆", action: "新增", detail: "沖銷 JE-1" }]);
  });

  it("系統產生、Ecount 搬來的分錄沒有紀錄：用建立時間補一行", () => {
    expect(journalHistoryRows({ id: 1, entryNumber: "JE-1-PQ3", createdAt: at(1) }, [])[0]).toMatchObject({ user: "系統自動產生", action: "新增" });
    expect(journalHistoryRows({ id: 1, entryNumber: "X", createdAt: at(1), sourceNumber: "20261001-1" }, [])[0]).toMatchObject({ user: "Ecount 匯入" });
  });
});

describe("經過審核的修改、刪除也寫進 H", () => {
  it("顯示誰申請、誰核准、審核人改了什麼", () => {
    const rows = journalHistoryRows({ id: 5, entryNumber: "JE-1", createdAt: at(1) }, [
      { action: "create", userName: "TRISTA", createdAt: at(1), oldValues: null, newValues: { id: 5 } },
      { action: "update", userName: "boss", createdAt: at(2), oldValues: {}, newValues: { changeRequest: "CHG-202611-0001", kind: "edit", summary: "trista 申請、boss 核准" } },
    ]);
    expect(rows[1]).toMatchObject({ user: "boss", action: "修改（經審核）", detail: "trista 申請、boss 核准" });
  });
});
