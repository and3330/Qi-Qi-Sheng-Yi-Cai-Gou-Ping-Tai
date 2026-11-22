import { describe, expect, it } from "vitest";
import { judgeRequest } from "./admin-guard";
import { MAX_ACTIONS, NO_ACTIONS, parseAgentConfig, type AgentActions } from "./agent-caps";

const judge = (actions: AgentActions, method: string, path: string, body?: unknown) => judgeRequest(method, path, body, { actions });
const review: AgentActions = { reverse: "review", pay: "review", delete: "review", approve: "review" };

describe("每把金鑰各自的 AI 助理設定", () => {
  it("沒設定或亂填的一律當成最保守的", () => {
    expect(parseAgentConfig(null)).toEqual({ enabled: false, role: "readonly", actions: NO_ACTIONS });
    expect(parseAgentConfig({ enabled: "yes", role: "root", actions: { reverse: "always", pay: "direct" } }))
      .toEqual({ enabled: false, role: "readonly", actions: { ...NO_ACTIONS, pay: "direct" } });
    expect(parseAgentConfig({ enabled: true, role: "admin", actions: MAX_ACTIONS })).toEqual({ enabled: true, role: "admin", actions: MAX_ACTIONS });
  });

  it("都不開放時，跟原本一樣四類都擋", () => {
    for (const [m, p, b] of [["POST", "/journal-entries/5/reverse", {}], ["POST", "/vouchers", { voucherType: "付款單" }], ["DELETE", "/customers/1", undefined], ["PATCH", "/leaves/1/approve", {}]] as const) {
      const v = judge(NO_ACTIONS, m, p, b);
      expect(v.allowed).toBe(false);
      expect(!v.allowed && v.review).toBeFalsy();
    }
  });

  it("設成要人核准：不執行，回報要送審，而且說是哪一類", () => {
    expect(judge(review, "POST", "/journal-entries/5/reverse", {})).toMatchObject({ allowed: false, review: true, category: "reverse" });
    expect(judge(review, "POST", "/payment-requests/3/void", {})).toMatchObject({ allowed: false, review: true, category: "reverse" });
    expect(judge(review, "PATCH", "/sales-orders/3", { status: "Cancelled" })).toMatchObject({ allowed: false, review: true, category: "reverse" });
    expect(judge(review, "POST", "/vouchers", { voucherType: "付款單" })).toMatchObject({ allowed: false, review: true, category: "pay" });
    expect(judge(review, "PATCH", "/payment-requests/9", { status: "Paid" })).toMatchObject({ allowed: false, review: true, category: "pay" });
    expect(judge(review, "DELETE", "/customers/1")).toMatchObject({ allowed: false, review: true, category: "delete" });
    expect(judge(review, "PATCH", "/leaves/1/approve", {})).toMatchObject({ allowed: false, review: true, category: "approve" });
  });

  it("設成直接生效：放行", () => {
    expect(judge(MAX_ACTIONS, "POST", "/journal-entries/5/reverse", {}).allowed).toBe(true);
    expect(judge(MAX_ACTIONS, "POST", "/vouchers", { voucherType: "付款單" }).allowed).toBe(true);
    expect(judge(MAX_ACTIONS, "DELETE", "/customers/1").allowed).toBe(true);
    expect(judge(MAX_ACTIONS, "PATCH", "/payment-requests/9", { status: "Approved" }).allowed).toBe(true);
  });

  it("一個請求踩到兩類：有一類不可以就不可以", () => {
    const mixed: AgentActions = { reverse: "direct", pay: "deny", delete: "direct", approve: "direct" };
    const v = judge(mixed, "POST", "/service-fees/2/pay", { status: "Cancelled" });
    expect(v.allowed).toBe(false);
    expect(!v.allowed && v.review).toBeFalsy();
  });

  it("開到最大也不開放的：帳號、金鑰、備份、系統設定、關帳年結、信用額度放行、審批匣、歷史匯入", () => {
    for (const [m, p] of [["POST", "/api-keys"], ["PATCH", "/api-keys/1"], ["POST", "/admin/users"], ["POST", "/users"], ["POST", "/backup/run"], ["PUT", "/accounting-settings"],
      ["PATCH", "/roles/1"], ["POST", "/journal-entries/year-close"], ["POST", "/accounting-periods/close"], ["POST", "/legacy-documents/import"], ["PATCH", "/approval-requests/7"]] as const) {
      expect(judge(MAX_ACTIONS, m, p, {}).allowed, `${m} ${p}`).toBe(false);
    }
    expect(judge(MAX_ACTIONS, "PATCH", "/sales-orders/1", { status: "Confirmed", overrideCreditLimit: true }).allowed).toBe(false);
    // 送出審批申請（不是核准）仍然可以
    expect(judge(MAX_ACTIONS, "POST", "/approval-requests", {}).allowed).toBe(true);
  });

  it("入帳、申請付款、收款本來就可以，不受這些設定影響", () => {
    for (const actions of [NO_ACTIONS, review, MAX_ACTIONS]) {
      expect(judge(actions, "POST", "/journal-entries", { lines: [] }).allowed).toBe(true);
      expect(judge(actions, "POST", "/payment-requests", { amount: 100 }).allowed).toBe(true);
      expect(judge(actions, "POST", "/vouchers", { voucherType: "收款單" }).allowed).toBe(true);
    }
  });
});
