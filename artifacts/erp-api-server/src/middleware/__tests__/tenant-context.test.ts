import { beforeEach, describe, expect, it, vi } from "vitest";

const { runWithTenant } = vi.hoisted(() => ({
  runWithTenant: vi.fn(),
}));

vi.mock("@workspace/erp-db", () => ({ runWithTenant }));

import { tenantContext } from "../tenant-context";

function mockRes() {
  const listeners = new Map<string, () => void>();
  const res: any = {
    statusCode: 0,
    body: undefined,
    status: vi.fn((code: number) => { res.statusCode = code; return res; }),
    json: vi.fn((body: unknown) => { res.body = body; return res; }),
    on: vi.fn((event: string, callback: () => void) => { listeners.set(event, callback); return res; }),
  };
  return { res, listeners };
}

describe("tenantContext", () => {
  beforeEach(() => {
    runWithTenant.mockReset();
    runWithTenant.mockImplementation((_tenantId: number, callback: () => Promise<void>) => callback());
  });

  it("拒絕不同租戶的 session 與 API key 混用", () => {
    const { res } = mockRes();
    const next = vi.fn();

    tenantContext({
      session: { user: { tenantId: 1 } },
      apiKey: { tenantId: 2 },
    } as any, res, next);

    expect(res.statusCode).toBe(403);
    expect(res.body).toEqual({ error: "租戶憑證不一致" });
    expect(runWithTenant).not.toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });

  it("相同租戶的 session 與 API key 可共用租戶上下文", () => {
    const { res, listeners } = mockRes();
    const next = vi.fn(() => listeners.get("finish")?.());
    const req: any = {
      session: { user: { tenantId: 3 } },
      apiKey: { tenantId: 3 },
    };

    tenantContext(req, res, next);

    expect(req.tenantId).toBe(3);
    expect(runWithTenant).toHaveBeenCalledWith(3, expect.any(Function));
    expect(next).toHaveBeenCalledOnce();
  });
});