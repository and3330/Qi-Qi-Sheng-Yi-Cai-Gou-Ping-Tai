import { describe, expect, it, vi } from "vitest";

// 只驗證「對話入口在伺服器內部呼叫既有 AI 功能」這一段：路徑、方法、參數、身分與權限檢查。
// 用各功能在呼叫 AI 之前就會回覆的輸入檢查來觀察，所以不需要資料庫，也不會真的呼叫 AI。
vi.mock("@workspace/erp-db", () => ({ db: {}, pool: {}, currentTenantClient: () => null, customersTable: {}, projectsTable: {}, itemsTable: {} }));
vi.mock("../../lib/tenant-db", () => ({ tenantPool: { query: async () => ({ rows: [] }) } }));
vi.mock("../../middleware/module-guard", () => ({
  moduleGuard: (req: any, res: any, next: () => void) => {
    if (req.blockAll) { res.status(403).json({ error: "此模組未開放", code: "module_disabled" }); return; }
    next();
  },
}));

import { callFeature } from "../ai-chat";
import { formatAnswer } from "../../lib/ai-chat";

const request = (role: string | null, extra: Record<string, unknown> = {}) => ({
  session: role ? { user: { id: 1, role, tenantId: 2 } } : undefined,
  headers: {}, method: "POST", url: "/ai/chat", ...extra,
}) as any;

describe("AI 對話：內部呼叫既有功能", () => {
  it("POST 的內容有送到目標功能", async () => {
    const empty = await callFeature(request("owner"), "POST", "/ai/classify-complaint", { text: "" });
    expect(empty).toEqual({ status: 400, body: { error: "請輸入客訴內容" } });
    const tooLong = await callFeature(request("owner"), "POST", "/ai/classify-complaint", { text: "x".repeat(4001) });
    expect(tooLong.body.error).toContain("內容過長");
  });

  it("GET 的查詢參數有送到目標功能", async () => {
    const result = await callFeature(request("owner"), "GET", "/ai/monthly-report", { year: 1900, month: 13 });
    expect(result).toEqual({ status: 400, body: { error: "年份或月份無效" } });
  });

  it("沿用使用者自己的身分：沒有 AI 權限的角色照樣被擋", async () => {
    const denied = await callFeature(request("sales"), "POST", "/ai/classify-complaint", { text: "退費問題" });
    expect(denied.status).toBe(403);
    const anonymous = await callFeature(request(null), "POST", "/ai/classify-complaint", { text: "退費問題" });
    expect(anonymous.status).toBe(401);
  });

  it("被停用的功能在對話裡同樣不能用", async () => {
    const result = await callFeature(request("owner", { blockAll: true }), "POST", "/ai/ask", { question: "本月營收" });
    expect(result.status).toBe(403);
    expect(formatAnswer("query", result.status, result.body)).toMatchObject({ ok: false, text: expect.stringContaining("沒有開放") });
  });

  it("不存在的功能路徑回 404，不會卡住", async () => {
    const result = await callFeature(request("owner"), "POST", "/ai/does-not-exist", {});
    expect(result.status).toBe(404);
  });
});
