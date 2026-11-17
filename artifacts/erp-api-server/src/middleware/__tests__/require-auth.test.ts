import { describe, it, expect, vi } from "vitest";
import { requireAuth, requireRole, sessionOnly } from "../require-auth";

function mockRes() {
  const res: any = { statusCode: 0, body: undefined };
  res.status = vi.fn((c: number) => { res.statusCode = c; return res; });
  res.json = vi.fn((b: unknown) => { res.body = b; return res; });
  return res;
}

const run = (mw: any, req: any) => {
  const res = mockRes();
  const next = vi.fn();
  mw(req, res, next);
  return { res, next };
};

describe("requireAuth", () => {
  it("未登入且無 API key → 401", () => {
    const { res, next } = run(requireAuth, { session: {} });
    expect(res.statusCode).toBe(401);
    expect(next).not.toHaveBeenCalled();
  });

  it("已登入 session → 放行", () => {
    const { next } = run(requireAuth, { session: { user: { role: "admin", tenantId: 1 } } });
    expect(next).toHaveBeenCalled();
  });

  it("有效 API key → 放行", () => {
    const { next } = run(requireAuth, { apiKeyAuth: true, apiKey: { permissions: "read", tenantId: 1 } });
    expect(next).toHaveBeenCalled();
  });

  it("缺少租戶範圍的舊 session → 401", () => {
    const { res, next } = run(requireAuth, { session: { user: { role: "admin" } } });
    expect(res.statusCode).toBe(401);
    expect(next).not.toHaveBeenCalled();
  });

  it("缺少租戶範圍的 API key → 401", () => {
    const { res, next } = run(requireAuth, { apiKeyAuth: true, apiKey: { permissions: "read" } });
    expect(res.statusCode).toBe(401);
    expect(next).not.toHaveBeenCalled();
  });
});

describe("requireRole", () => {
  const guard = requireRole("owner", "admin");

  it("未登入 → 401", () => {
    const { res, next } = run(guard, { session: {} });
    expect(res.statusCode).toBe(401);
    expect(next).not.toHaveBeenCalled();
  });

  it("缺少租戶範圍的 admin API key → 401", () => {
    const { res, next } = run(guard, { apiKeyAuth: true, apiKey: { permissions: "admin" } });
    expect(res.statusCode).toBe(401);
    expect(next).not.toHaveBeenCalled();
  });

  it("read API key → 403（不得存取角色保護端點）", () => {
    const { res, next } = run(guard, { apiKeyAuth: true, apiKey: { permissions: "read", tenantId: 1 } });
    expect(res.statusCode).toBe(403);
    expect(next).not.toHaveBeenCalled();
  });

  it("readwrite API key → 403（不得存取角色保護端點）", () => {
    const { res, next } = run(guard, { apiKeyAuth: true, apiKey: { permissions: "readwrite", tenantId: 1 } });
    expect(res.statusCode).toBe(403);
    expect(next).not.toHaveBeenCalled();
  });

  it("admin 權限 API key → 放行", () => {
    const { next } = run(guard, { apiKeyAuth: true, apiKey: { permissions: "admin", tenantId: 1 } });
    expect(next).toHaveBeenCalled();
  });

  it("角色不符的 session → 403", () => {
    const { res, next } = run(guard, { session: { user: { role: "employee", tenantId: 1 } } });
    expect(res.statusCode).toBe(403);
    expect(next).not.toHaveBeenCalled();
  });

  it("符合角色的 session → 放行", () => {
    const { next } = run(guard, { session: { user: { role: "admin", tenantId: 1 } } });
    expect(next).toHaveBeenCalled();
  });

  it("super_admin session → 放行", () => {
    const { next } = run(guard, { session: { user: { role: "super_admin", tenantId: 1 } } });
    expect(next).toHaveBeenCalled();
  });
});

describe("sessionOnly（/admin、/backup、/api-keys）", () => {
  it("任何 API key（含 admin 權限）→ 403", () => {
    for (const permissions of ["read", "readwrite", "admin"]) {
      const { res, next } = run(sessionOnly, { apiKeyAuth: true, apiKey: { permissions } });
      expect(res.statusCode).toBe(403);
      expect(next).not.toHaveBeenCalled();
    }
  });

  it("無 API key 的請求 → 交由後續守衛處理", () => {
    const { next } = run(sessionOnly, { session: {} });
    expect(next).toHaveBeenCalled();
  });
});
