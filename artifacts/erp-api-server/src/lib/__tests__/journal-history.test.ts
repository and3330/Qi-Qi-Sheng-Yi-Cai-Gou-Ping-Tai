import { describe, expect, it } from "vitest";
import { journalHistoryRows, pickAutoActor, reversalOriginalId } from "../journal-history";

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

describe("單據自動開的分錄：寫出當時是誰操作的", () => {
  const entry = { entryNumber: "JE-202611-0041", createdAt: at(9) };
  const log = (userName: string | null, seconds: number, documentNumber: string | null, newValues: unknown = {}) =>
    ({ userName, createdAt: new Date(new Date(at(9)).getTime() + seconds * 1000).toISOString(), documentNumber, newValues });

  it("有提到原單號的那一筆優先，就算同一時間還有別人在操作", () => {
    expect(pickAutoActor(entry, "RC-202611-0001", [log("小明", 0.2, "SO-1"), log("會計小美", 0.4, "RC-202611-0001")])).toBe("會計小美");
    expect(pickAutoActor(entry, "PRQ-202611-0029", [log("老闆", 0.3, null, { documentNumber: "PRQ-202611-0029", status: "Approved" })])).toBe("老闆");
  });
  it("沒有提到單號，但那幾秒只有一個人在操作：就是他", () => {
    expect(pickAutoActor(entry, "RC-1", [log("會計小美", 0.5, null)])).toBe("會計小美");
  });
  it("同時有兩個人、又對不到單號：寧可不寫", () => {
    expect(pickAutoActor(entry, "RC-1", [log("小明", 0.2, null), log("小美", 0.4, null)])).toBeNull();
  });
  it("太早、太晚、或系統自己的紀錄不算", () => {
    expect(pickAutoActor(entry, "RC-1", [log("小明", -5, "RC-1"), log("小美", 45, "RC-1"), log("system", 0.2, "RC-1"), log(null, 0.2, "RC-1")])).toBeNull();
  });
  it("API 金鑰寫成看得懂的名字", () => {
    expect(pickAutoActor(entry, "RC-1", [log("apikey:大主管", 0.2, "RC-1")])).toBe("API 金鑰「大主管」");
  });
  it("H 那一行：寫人名和是哪張單開的；查不到人就老實寫查不到", () => {
    expect(journalHistoryRows({ id: 1, ...entry }, [], null, { source: "收付款單 RC-202611-0001", actor: "會計小美" })[0])
      .toEqual({ at: at(9), user: "會計小美", action: "新增", detail: "收付款單 RC-202611-0001 入帳時自動開立" });
    expect(journalHistoryRows({ id: 1, ...entry }, [], null, { source: "付款申請 PRQ-1", actor: null })[0])
      .toMatchObject({ user: "系統自動產生", detail: "付款申請 PRQ-1 入帳時自動開立（查不到當時是誰操作的）" });
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
