import { afterEach, describe, expect, it, vi } from "vitest";
import { createLockedAuth } from "../locked-auth";
import { authConnectionTimeoutMs, reportAuthFailure } from "../auth-diagnostics";

afterEach(() => vi.useRealTimers());

function fixture(delay = 0, timeoutMs = 10_000) {
  const user = { id: 1, tenant_id: 1, company_code: "00123456", username: "alice",
    password_hash: "$2fake", display_name: "Test", role: "owner", employee_id: null, is_active: true };
  const client = {
    release: vi.fn(),
    query: vi.fn(async (config: { text: string; values: unknown[]; query_timeout: number }) => {
      if (config.text.startsWith("SELECT u.*")) return { rows: [user], rowCount: 1 };
      return { rows: [], rowCount: 1 };
    }),
  };
  const pool = { connect: vi.fn(() => new Promise<typeof client>(resolve => setTimeout(() => resolve(client), delay))) };
  const persist = vi.fn(async () => {});
  const cleanup = vi.fn(async () => {});
  const report = vi.fn();
  const verifyPassword = vi.fn(async () => true);
  const auth = createLockedAuth({
    pool: pool as any, verifyPassword, hashPassword: async () => "$2updated", connectionTimeoutMs: timeoutMs,
  });
  const login = () => auth.login("00123456", "alice", "synthetic-test-password", persist, cleanup, report);
  return { user, client, pool, persist, cleanup, report, verifyPassword, auth, login };
}

describe("authentication connection deadline and sanitized failures", () => {
  it("uses 10 seconds for Supabase but leaves managed connections at one second", () => {
    expect(authConnectionTimeoutMs("supabase")).toBe(10_000);
    expect(authConnectionTimeoutMs("replit")).toBe(1_000);
  });

  it("allows a 1.5 second connection without relaxing query/lock/statement budgets", async () => {
    vi.useFakeTimers();
    const f = fixture(1_500);
    const result = f.login();
    await vi.advanceTimersByTimeAsync(1_001);
    expect(f.persist).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(499);
    expect(await result).toBe(f.user);
    expect(f.persist).toHaveBeenCalledTimes(1);
    expect(f.client.release).toHaveBeenCalledExactlyOnceWith();
    expect(f.report).not.toHaveBeenCalled();
    expect(f.client.query.mock.calls.every(([config]) => config.query_timeout === 3_000)).toBe(true);
    expect(f.client.query.mock.calls[1][0].text).toContain("lock_timeout='1500ms'");
    expect(f.client.query.mock.calls[1][0].text).toContain("statement_timeout='2500ms'");
  });

  it("times out at ten seconds and releases a connection arriving afterward without using it", async () => {
    vi.useFakeTimers();
    const f = fixture(12_000);
    const rejected = expect(f.login()).rejects.toThrow("Authentication connection deadline");
    await vi.advanceTimersByTimeAsync(9_999);
    expect(f.report).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await rejected;
    expect(f.report).toHaveBeenCalledExactlyOnceWith({ stage: "acquire", reason: "connection_deadline" });
    await vi.advanceTimersByTimeAsync(2_000);
    expect(f.client.release).toHaveBeenCalledTimes(1);
    expect(f.client.query).not.toHaveBeenCalled();
    expect(f.persist).not.toHaveBeenCalled();
  });

  it("retains the one-second default for existing callers", async () => {
    vi.useFakeTimers();
    const f = fixture();
    const auth = createLockedAuth({ pool: { connect: () => new Promise(() => {}) } as any,
      verifyPassword: f.verifyPassword, hashPassword: async () => "$2updated" });
    const rejected = expect(auth.login("00123456", "alice", "synthetic", f.persist, f.cleanup, f.report))
      .rejects.toThrow("Authentication connection deadline");
    await vi.advanceTimersByTimeAsync(1_000);
    await rejected;
  });

  it("still rejects a wrong password without persisting a session", async () => {
    vi.useFakeTimers();
    const f = fixture();
    f.verifyPassword.mockResolvedValue(false);
    const result = f.login();
    await vi.advanceTimersByTimeAsync(0);
    expect(await result).toBeNull();
    expect(f.persist).not.toHaveBeenCalled();
    expect(f.report).not.toHaveBeenCalled();
  });

  it("reports session persistence failures and preserves rollback/cleanup", async () => {
    vi.useFakeTimers();
    const f = fixture();
    const error = Object.assign(new Error("secret session / SQL / credentials"), { code: "ETIMEDOUT" });
    f.persist.mockRejectedValue(error);
    const rejected = expect(f.login()).rejects.toBe(error);
    await vi.advanceTimersByTimeAsync(0);
    await rejected;
    expect(f.report).toHaveBeenCalledExactlyOnceWith({ stage: "session_persist", reason: "ETIMEDOUT" });
    expect(f.client.release).toHaveBeenCalledExactlyOnceWith(true);
    expect(f.client.query.mock.calls.at(-1)?.[0].text).toBe("ROLLBACK");
    expect(f.cleanup).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(f.report.mock.calls)).not.toMatch(/secret|SQL|credentials/);
  });

  it("reports a SQL lock failure separately from checkout or session errors", async () => {
    vi.useFakeTimers();
    const f = fixture();
    const error = Object.assign(new Error("private query values"), { code: "55P03" });
    f.client.query.mockImplementation(async config => {
      if (config.text.startsWith("SELECT u.*")) throw error;
      return { rows: [], rowCount: 1 };
    });
    const rejected = expect(f.login()).rejects.toBe(error);
    await vi.advanceTimersByTimeAsync(0);
    await rejected;
    expect(f.report).toHaveBeenCalledExactlyOnceWith({ stage: "user_lookup", reason: "55P03" });
    expect(f.cleanup).not.toHaveBeenCalled();
  });

  it("logs only allowlisted categories even for wrapped or hostile errors; logging cannot break auth", () => {
    const report = vi.fn();
    reportAuthFailure(report, "acquire", { code: "postgresql://secret", message: "password" });
    expect(report).toHaveBeenLastCalledWith({ stage: "acquire", reason: "other" });
    reportAuthFailure(report, "user_lookup", { cause: { code: "42P01", query: "private" } });
    expect(report).toHaveBeenLastCalledWith({ stage: "user_lookup", reason: "42P01" });
    expect(JSON.stringify(report.mock.calls)).not.toMatch(/postgresql|secret|password|private/);
    expect(() => reportAuthFailure(() => { throw new Error("sink"); }, "begin", null)).not.toThrow();
  });
});
