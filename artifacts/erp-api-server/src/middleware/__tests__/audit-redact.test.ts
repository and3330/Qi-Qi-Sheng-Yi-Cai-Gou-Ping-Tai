import { describe, expect, it, vi } from "vitest";

vi.mock("@workspace/erp-db", () => ({ db: {}, auditLogsTable: {} }));

import { redactSecrets, moduleForPath, capSize } from "../audit-logger";

describe("哪些異動要記", () => {
  it("原本漏掉的資料也會記", () => {
    expect(moduleForPath("/order-templates/3")).toBe("Sales");
    expect(moduleForPath("/quotation-templates/課程")).toBe("Sales");
    expect(moduleForPath("/item-categories")).toBe("Inventory");
    expect(moduleForPath("/settings/integrations/ecpay")).toBe("System");
    expect(moduleForPath("/teachers/9")).toBe("Projects");
  });
  it("沒列在對照表的新功能，也用網址第一段記下來", () => {
    expect(moduleForPath("/some-new-feature/1")).toBe("some-new-feature");
  });
  it("登入、AI 問答、預覽、公開報名、通知不算異動", () => {
    for (const p of ["/admin/login", "/admin/logout", "/ai/ask", "/integrations/channels/2/payouts/preview", "/public/signup", "/notifications/5", "/audit-logs"]) {
      expect(moduleForPath(p)).toBeNull();
    }
    expect(moduleForPath("/admin/users/4")).toBe("Admin");
  });
  it("太大的內容只留開頭", () => {
    expect(capSize({ a: 1 })).toEqual({ a: 1 });
    const big = capSize({ rows: "x".repeat(300_000) }) as any;
    expect(big.note).toContain("過大");
    expect(big.truncated.length).toBe(2000);
  });
});

describe("稽核紀錄的機密遮蔽", () => {
  it("密碼、金鑰、權杖不會被寫進紀錄", () => {
    const out = redactSecrets({
      id: 3, username: "wang", passwordHash: "x", password: "y",
      key: "erp_live_abc", apiKey: "k", smtpPassword: "p", resetToken: "t", displayName: "王小明",
    }) as Record<string, unknown>;
    expect(out).toMatchObject({ id: 3, username: "wang", displayName: "王小明" });
    for (const field of ["passwordHash", "password", "key", "apiKey", "smtpPassword", "resetToken"]) {
      expect(out[field]).toBe("〔已遮蔽〕");
    }
  });

  it("巢狀物件與陣列也會處理，一般欄位不受影響", () => {
    const out = redactSecrets({ user: { name: "a", secret: "s" }, items: [{ keyName: "報表用", token: "t" }] }) as any;
    expect(out.user).toEqual({ name: "a", secret: "〔已遮蔽〕" });
    expect(out.items[0]).toEqual({ keyName: "報表用", token: "〔已遮蔽〕" });
  });

  it("空值與非物件原樣回傳", () => {
    expect(redactSecrets(null)).toBeNull();
    expect(redactSecrets("text")).toBe("text");
  });
});
