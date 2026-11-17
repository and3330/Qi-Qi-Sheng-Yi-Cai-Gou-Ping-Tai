import { it, expect, vi } from "vitest";
import type { Request, Response } from "express";
import { migrationMaintenanceEnabled, migrationMaintenanceGate, migrationIdentityHandler } from "./migration-maintenance";

function request(path: string, method = "GET", authorization = "") {
  return { path, method, get: () => authorization } as unknown as Request;
}
function response() {
  return {
    statusCode: 200, payload: undefined as unknown,
    setHeader: vi.fn(),
    status(n: number) { this.statusCode = n; return this; },
    json(value: unknown) { this.payload = value; return this; },
    sendStatus(n: number) { this.statusCode = n; return this; },
  };
}
it("maintenance is opt-in and invalid settings fail closed", () => {
  expect(migrationMaintenanceEnabled({})).toBe(false);
  expect(migrationMaintenanceEnabled({ ERP_MIGRATION_MAINTENANCE: "true" })).toBe(true);
  expect(() => migrationMaintenanceEnabled({ ERP_MIGRATION_MAINTENANCE: "yes" })).toThrow();
});
it("without maintenance existing routes are unchanged", () => {
  const next = vi.fn();
  migrationMaintenanceGate({})(request("/api/vouchers", "POST"), response() as unknown as Response, next);
  expect(next).toHaveBeenCalledOnce();
});
it("maintenance blocks reads, writes, MCP and webhooks before side effects", () => {
  for (const path of ["/api/auth/login", "/api/notifications", "/api/vouchers", "/mcp", "/api/stripe/webhook"]) {
    for (const method of ["GET", "POST", "PATCH", "DELETE"]) {
      const next = vi.fn(); const res = response();
      migrationMaintenanceGate({ ERP_MIGRATION_MAINTENANCE: "true" })(request(path, method), res as unknown as Response, next);
      expect(res.statusCode).toBe(503);
      expect(next).not.toHaveBeenCalled();
    }
  }
});
it("maintenance health does not enter sessions or audit middleware", () => {
  const res = response(); const next = vi.fn();
  migrationMaintenanceGate({ ERP_MIGRATION_MAINTENANCE: "true" })(request("/api/healthz"), res as unknown as Response, next);
  expect(res.payload).toEqual({ status: "maintenance" }); expect(next).not.toHaveBeenCalled();
});
it("identity is maintenance-only and rejects missing/wrong bearer without a DB call", async () => {
  const read = vi.fn(async () => "a".repeat(32));
  for (const [env, token, status] of [
    [{ ERP_AI_KEY: "test-only" }, "Bearer test-only", 404],
    [{ ERP_MIGRATION_MAINTENANCE: "true" }, "", 503],
    [{ ERP_MIGRATION_MAINTENANCE: "true", ERP_AI_KEY: "test-only" }, "", 401],
    [{ ERP_MIGRATION_MAINTENANCE: "true", ERP_AI_KEY: "test-only" }, "Bearer other", 401],
  ] as const) {
    const res = response();
    await migrationIdentityHandler(read, env)(request("/api/migration/status", "GET", token), res as unknown as Response, vi.fn());
    expect(res.statusCode).toBe(status);
  }
  expect(read).not.toHaveBeenCalled();
});
it("identity returns a metadata fingerprint only and redacts errors", async () => {
  const env = { ERP_MIGRATION_MAINTENANCE: "true", ERP_AI_KEY: "test-only" };
  const res = response();
  await migrationIdentityHandler(async () => "a".repeat(32), env)(
    request("/api/migration/status", "GET", "Bearer test-only"), res as unknown as Response, vi.fn());
  expect(res.payload).toEqual({ maintenance: true, databaseFingerprint: "a".repeat(32) });
  const failed = response();
  await migrationIdentityHandler(async () => { throw new Error("private error"); }, env)(
    request("/api/migration/status", "GET", "Bearer test-only"), failed as unknown as Response, vi.fn());
  expect(failed.statusCode).toBe(503);
  expect(JSON.stringify(failed.payload)).not.toContain("private error");
});
it("identity supports replica catch-up and private-storage configuration proofs without raw locations", async () => {
  const env = { ERP_MIGRATION_MAINTENANCE: "true", ERP_AI_KEY: "test-only" };
  const res = response();
  await migrationIdentityHandler(async () => ({
    fingerprint: "a".repeat(32), readOnlyReplica: false,
    walPosition: "0/12ABCDE", storageFingerprint: "b".repeat(64),
  }), env)(request("/api/migration/status", "GET", "Bearer test-only"), res as unknown as Response, vi.fn());
  expect(res.payload).toEqual({
    maintenance: true, databaseFingerprint: "a".repeat(32),
    readOnlyReplica: false, walPosition: "0/12ABCDE", storageFingerprint: "b".repeat(64),
  });
});
