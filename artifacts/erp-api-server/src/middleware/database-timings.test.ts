import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import { databasePhase } from "@workspace/erp-db/diagnostics";
const log = vi.hoisted(() => ({ info: vi.fn() }));
vi.mock("../lib/logger", () => ({ logger: log }));
import { databaseTimings } from "./database-timings";

afterEach(() => { vi.unstubAllEnvs(); log.info.mockClear(); });
describe("database timing middleware", () => {
  it("emits only sanitized numeric phases, once, with request correlation", async () => {
    vi.stubEnv("NODE_ENV", "development");
    const req = { path: "/api/customers/private-name", id: 12, method: "GET",
      headers: { authorization: "secret" }, query: { token: "private" } };
    const res = Object.assign(new EventEmitter(), { statusCode: 200 });
    await new Promise<void>(resolve => databaseTimings(req as any, res as any, () => {
      void databasePhase("tenant_setup", async () => {}).then(() => {
        res.emit("finish"); res.emit("close"); setImmediate(resolve);
      });
    }));
    expect(log.info).toHaveBeenCalledTimes(1);
    const record = log.info.mock.calls[0][0];
    expect(record).toMatchObject({ event: "db_request_timings", requestId: 12, statusCode: 200,
      phases: { tenant_setup: { count: 1, errors: 0 } } });
    expect(JSON.stringify(record)).not.toMatch(/private|secret|authorization|customers/);
  });

  it("does not instrument production by default or non-API requests", () => {
    vi.stubEnv("NODE_ENV", "production"); vi.stubEnv("ERP_DB_DIAGNOSTICS", "");
    const res = Object.assign(new EventEmitter(), { statusCode: 200 });
    const next = vi.fn();
    databaseTimings({ path: "/api/config" } as any, res as any, next);
    vi.stubEnv("NODE_ENV", "development");
    databaseTimings({ path: "/mcp" } as any, res as any, next);
    res.emit("finish");
    expect(next).toHaveBeenCalledTimes(2);
    expect(res.listenerCount("finish")).toBe(0);
    expect(log.info).not.toHaveBeenCalled();
  });
});
