import { describe, expect, it } from "vitest";
import { changeReviewBlock, changeReviewerRoles } from "../change-review";
import { isUnlock, lockLabel, monthEnd } from "../period-lock";

describe("異動申請誰可以審（老闆 2026-11-16）", () => {
  const byStaff = { requestedBy: "amy", requestedRole: "viewer" };
  const byFinance = { requestedBy: "trista", requestedRole: "finance_admin" };
  it("一般人送的：財務或超級管理員其一", () => {
    expect(changeReviewBlock({ username: "trista", role: "finance_admin" }, byStaff)).toBeNull();
    expect(changeReviewBlock({ username: "acc", role: "accountant" }, byStaff)).toBeNull();
    expect(changeReviewBlock({ username: "boss", role: "super_admin" }, byStaff)).toBeNull();
    expect(changeReviewBlock({ username: "m", role: "manager" }, byStaff)).toMatch(/財務或超級管理員/);
    expect(changeReviewBlock({ username: "a", role: "admin" }, byStaff)).toMatch(/財務或超級管理員/);
  });
  it("財務送的：只能給超級管理員；也不能審自己", () => {
    expect(changeReviewBlock({ username: "acc", role: "accountant" }, byFinance)).toMatch(/超級管理員/);
    expect(changeReviewBlock({ username: "boss", role: "owner" }, byFinance)).toBeNull();
    expect(changeReviewBlock({ username: "trista", role: "super_admin" }, byFinance)).toMatch(/自己/);
  });
  it("通知對象跟著規則走", () => {
    expect(changeReviewerRoles("accountant")).toEqual(["super_admin", "owner"]);
    expect(changeReviewerRoles("viewer")).toEqual(["finance_admin", "accountant", "super_admin", "owner"]);
  });
});

describe("按月鎖帳", () => {
  it("往後推是鎖帳，往回改或取消才是解鎖", () => {
    expect(isUnlock("2026-10-31", "2026-11-30")).toBe(false);
    expect(isUnlock("2026-10-31", "2026-09-30")).toBe(true);
    expect(isUnlock("2026-10-31", null)).toBe(true);
    expect(isUnlock(null, "2026-10-31")).toBe(false);
  });
  it("月底顯示成「幾月底」", () => {
    expect(lockLabel("2026-10-31")).toBe("2026 年 10 月底");
    expect(lockLabel("2026-02-28")).toBe("2026 年 2 月底");
    expect(lockLabel("2026-10-15")).toBe("2026-10-15");
    expect(lockLabel(null)).toBe("未關帳");
    expect(monthEnd("2026-02")).toBe("2026-02-28");
    expect(monthEnd("2028-02")).toBe("2028-02-29");
  });
});

describe("審核人改了什麼", () => {
  it("一般欄位和明細逐行列出", async () => {
    const { payloadDiff } = await import("../change-review");
    expect(payloadDiff({ description: "舊", lines: [{ debit: 100, credit: 0 }] }, { description: "新", lines: [{ debit: 120, credit: 0 }] }))
      .toBe("說明：舊 → 新；第 1 行借方：100 → 120");
    expect(payloadDiff({ a: 1 }, { a: 1 })).toBe("");
  });
});
