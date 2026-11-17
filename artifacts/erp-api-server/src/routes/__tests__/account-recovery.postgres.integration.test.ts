import { realpathSync } from "node:fs";
import { randomUUID } from "node:crypto";
import type { Server } from "node:http";
import express from "express";
import session from "express-session";
// Test-only driver import: never load database runtime / role initializer.
// @ts-expect-error workspace database owns pg
import pg from "../../../../../lib/erp-db/node_modules/pg/lib/index.js";
import { beforeAll, afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createRecoveryService, sendRecoveryEmail, validRecoveryPassword } from "../../lib/account-recovery";
import { createLockedAuth } from "../../lib/locked-auth";
import { createPgSessionStore } from "../../lib/session-store";
vi.mock("@workspace/erp-db", () => ({ pool: {} }));
vi.mock("../../lib/auth", () => ({ hashPassword: vi.fn(), verifyPassword: vi.fn() }));
import { createRecoveryRouter } from "../account-recovery";

const optedIn = process.env.CUSTOMER_POSTGRES_ACCEPTANCE === "1" && !!process.env.CUSTOMER_TEST_PG_ROOT && !!process.env.CUSTOMER_TEST_PG_SOCKET;
const acceptance = optedIn ? describe : describe.skip;
acceptance("account recovery in disposable PostgreSQL, mail mocked", () => {
  const schema = `recovery_${randomUUID().replaceAll("-", "")}`;
  const pool = new pg.Pool({ host: process.env.CUSTOMER_TEST_PG_SOCKET, port: Number(process.env.CUSTOMER_TEST_PG_PORT), database: "customer_router_acceptance", user: "customer_test_owner", options: `-c search_path=${schema}` });
  const send = vi.fn(async (_email: string, _token: string, _purpose: string) => {});
  const service = createRecoveryService({ pool, send, hashPassword: async (p) => `hash:${p}`, verifyPassword: async (p, h) => h === `hash:${p}` });
  const auth = createLockedAuth({ pool, hashPassword: async (p) => `hash:${p}`, verifyPassword: async (p, h) => h === `hash:${p}` });
  let server: Server;
  let url: string;
  beforeAll(async () => {
    const root = realpathSync(process.env.CUSTOMER_TEST_PG_ROOT!);
    expect(root.startsWith("/tmp/") || root.startsWith(realpathSync(process.env.TMPDIR || "/tmp") + "/")).toBe(true);
    expect(realpathSync(process.env.CUSTOMER_TEST_PG_SOCKET!).startsWith(root + "/")).toBe(true);
    await pool.query(`CREATE SCHEMA ${schema}`);
    await pool.query(`
      CREATE TABLE tenants(id integer PRIMARY KEY, company_code text UNIQUE);
      INSERT INTO tenants VALUES(1,'00123456'),(2,'00234567'),(3,NULL);
      CREATE TABLE admin_users(id integer PRIMARY KEY, tenant_id integer NOT NULL, username text NOT NULL, password_hash text NOT NULL, is_active boolean NOT NULL, updated_at timestamptz DEFAULT now(), UNIQUE(tenant_id,username));
      CREATE TABLE account_recovery_profiles(user_id integer PRIMARY KEY REFERENCES admin_users(id),tenant_id integer NOT NULL,recovery_email text NOT NULL,recovery_email_verified_at timestamptz);
      CREATE TABLE account_recovery_tokens(token_hash text PRIMARY KEY,user_id integer REFERENCES admin_users(id),tenant_id integer NOT NULL,purpose text NOT NULL,binding_hash text NOT NULL,expires_at timestamptz NOT NULL,UNIQUE(tenant_id,user_id,purpose));
      CREATE TABLE user_sessions(sid text PRIMARY KEY,sess json NOT NULL,expire timestamptz);
    `);
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      // Synthetic auth only in test, never production header auth.
      if (req.headers["x-test-user"]) (req as any).session = { user: { id: Number(req.headers["x-test-user"]), tenantId: Number(req.headers["x-test-tenant"] || 1) } };
      next();
    });
    app.use(createRecoveryRouter(service));
    server = app.listen(0, "127.0.0.1");
    await new Promise<void>((resolve) => server.once("listening", resolve));
    url = `http://127.0.0.1:${(server.address() as any).port}`;
  });
  afterAll(async () => {
    if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
    await pool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await pool.end();
  });
  beforeEach(async () => {
    send.mockReset();
    send.mockResolvedValue();
    await pool.query("TRUNCATE account_recovery_tokens,account_recovery_profiles,admin_users,user_sessions CASCADE");
    await pool.query("INSERT INTO admin_users VALUES (1,1,'alice','hash:old-password1',true,now()),(2,2,'bob','hash:bob-password1',true,now())");
  });
  const token = () => send.mock.calls.at(-1)![1];
  async function verified() {
    await service.enroll(1, 1, "alice@example.test", "old-password1");
    await service.consume(token(), "verify");
  }
  async function resetToken() { await verified(); await service.forgot("00123456", "alice"); return token(); }
  async function post(path: string, body: unknown, headers = {}) {
    if (path.endsWith("forgot-password")) body = { companyCode: "00123456", ...(body as object) };
    const response = await fetch(url + path, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) });
    return { status: response.status, body: await response.json() };
  }
  it("same case-sensitive username resolves only inside an explicitly mapped company", async () => {
    await pool.query("INSERT INTO admin_users VALUES (3,2,'alice','hash:company2-password1',true,now()),(4,3,'legacy','hash:old-password1',true,now())");
    const persist = vi.fn(async () => {});
    const cleanup = async () => {};
    expect(await auth.login(" 00123456 ", " alice ", "old-password1", persist, cleanup)).toMatchObject({ id: 1, tenant_id: 1, company_code: "00123456" });
    expect(await auth.login("00234567", "alice", "company2-password1", persist, cleanup)).toMatchObject({ id: 3, tenant_id: 2 });
    for (const [code, name, password] of [
      ["00234567", "alice", "old-password1"], ["00999999", "alice", "old-password1"],
      ["", "alice", "old-password1"], ["00123456", "Alice", "old-password1"],
      ["００１２３４５６", "alice", "old-password1"], ["00000000", "legacy", "old-password1"],
    ]) expect(await auth.login(code, name, password, persist, cleanup)).toBeNull();
    expect(persist).toHaveBeenCalledTimes(2);
    await expect(pool.query("INSERT INTO admin_users VALUES (5,1,'alice','hash:x',true,now())")).rejects.toMatchObject({ code: "23505" });
    await expect(pool.query("INSERT INTO tenants VALUES (4,'00123456')")).rejects.toMatchObject({ code: "23505" });
  });
  it("recovery never crosses companies with the same account name", async () => {
    await verified();
    await pool.query("INSERT INTO admin_users VALUES (3,2,'alice','hash:company2-password1',true,now()),(4,3,'legacy','hash:old-password1',true,now())");
    await service.enroll(3, 2, "company2@example.test", "company2-password1");
    await service.consume(token(), "verify");
    send.mockClear();
    await service.forgot("00234567", "alice");
    expect(send.mock.calls[0][0]).toBe("company2@example.test");
    const reset = token();
    await service.consume(reset, "reset", "new-password12");
    expect((await pool.query("SELECT password_hash FROM admin_users WHERE id=1")).rows[0].password_hash).toBe("hash:old-password1");
    send.mockClear();
    for (const code of ["", "00999999", "00000000"]) await service.forgot(code, code === "00000000" ? "legacy" : "alice");
    expect(send).not.toHaveBeenCalled();
    await service.forgot(" 00123456 ", " alice ");
    expect(send.mock.calls[0][0]).toBe("alice@example.test");
  });
  it("company-aware login does not depend on recovery tables", async () => {
    await pool.query("ALTER TABLE account_recovery_profiles RENAME TO unavailable_profiles");
    await pool.query("ALTER TABLE account_recovery_tokens RENAME TO unavailable_tokens");
    try {
      expect(await auth.login("00123456", "alice", "old-password1", async () => {}, async () => {})).toMatchObject({ id: 1, tenant_id: 1 });
    } finally {
      await pool.query("ALTER TABLE unavailable_profiles RENAME TO account_recovery_profiles");
      await pool.query("ALTER TABLE unavailable_tokens RENAME TO account_recovery_tokens");
    }
  });
  it("enrollment cannot cross user/tenant or bypass the current password", async () => {
    await expect(service.enroll(1, 2, "attacker@example.test", "old-password1")).rejects.toMatchObject({ status: 400 });
    await expect(service.enroll(1, 1, "attacker@example.test", "bob-password1")).rejects.toMatchObject({ status: 400 });
    expect(send).not.toHaveBeenCalled();
    expect((await pool.query("SELECT * FROM account_recovery_profiles")).rows).toHaveLength(0);
  });
  it("stores only hashed capabilities and requires verification", async () => {
    await service.enroll(1, 1, "alice@example.test", "old-password1");
    const t = token();
    const rows = (await pool.query("SELECT * FROM account_recovery_tokens")).rows;
    expect(JSON.stringify(rows)).not.toContain(t);
    expect(rows[0].token_hash).toHaveLength(64);
    await service.forgot("00123456", "alice");
    expect(send).toHaveBeenCalledTimes(1);
    await service.consume(t, "verify");
    await expect(service.consume(t, "verify")).rejects.toMatchObject({ status: 400 });
    expect(await service.get(1, 1)).toEqual({ email: "alice@example.test", verified: true });
  });
  it("reset revokes only this user's sessions and rejects replay", async () => {
    const t = await resetToken();
    await pool.query(`INSERT INTO user_sessions VALUES ('a','{"user":{"id":1,"tenantId":1}}',now()),('b','{"user":{"id":2,"tenantId":2}}',now())`);
    await service.consume(t, "reset", "new-password1");
    expect((await pool.query("SELECT sid FROM user_sessions")).rows).toEqual([{ sid: "b" }]);
    expect((await pool.query("SELECT password_hash FROM admin_users WHERE id=1")).rows[0].password_hash).toBe("hash:new-password1");
    await expect(service.consume(t, "reset", "other-password1")).rejects.toMatchObject({ status: 400 });
  });
  it("concurrent replay allows exactly one transaction", async () => {
    const t = await resetToken();
    const results = await Promise.allSettled([service.consume(t, "reset", "new-password1"), service.consume(t, "reset", "other-password1")]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);
  });
  it("login holds the credential row through session persistence so a racing reset revokes its session", async () => {
    const t = await resetToken();
    let releaseSave!: () => void;
    let saving!: () => void;
    const saveStarted = new Promise<void>((resolve) => { saving = resolve; });
    const gate = new Promise<void>((resolve) => { releaseSave = resolve; });
    const login = auth.login("00123456", "alice", "old-password1", async () => {
      saving(); await gate;
      await pool.query(`INSERT INTO user_sessions VALUES ('racing-login','{"user":{"id":1,"tenantId":1}}',now())`);
    }, async () => { await pool.query("DELETE FROM user_sessions WHERE sid='racing-login'"); });
    await saveStarted;
    let resetFinished = false;
    const reset = service.consume(t, "reset", "new-password1").then(() => { resetFinished = true; });
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(resetFinished).toBe(false);
    releaseSave();
    expect(await login).not.toBeNull();
    await reset;
    expect((await pool.query("SELECT * FROM user_sessions")).rows).toHaveLength(0);
    expect((await pool.query("SELECT password_hash FROM admin_users WHERE id=1")).rows[0].password_hash).toBe("hash:new-password1");
  });
  it("reset winning the row lock prevents stale login, legacy rehash and change-password overwrite", async () => {
    const t = await resetToken();
    const blocker = await pool.connect();
    await blocker.query("BEGIN");
    await blocker.query("SELECT id FROM admin_users WHERE id=1 FOR UPDATE");
    const reset = service.consume(t, "reset", "new-password1");
    // Deterministic gate: reset must actually be queued on the row lock before
    // login/change-password are started. No scheduling assumptions.
    for (let attempts = 0; ; attempts++) {
      const waits = await pool.query("SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE 'SELECT u.%FOR UPDATE OF u'");
      if (waits.rows[0].n > 0) break;
      if (attempts > 100) throw new Error("Reset did not reach account lock");
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    const persist = vi.fn(async () => {});
    const login = auth.login("00123456", "alice", "old-password1", persist, async () => {});
    const change = auth.changePassword(1, 1, "old-password1", "stale-password1");
    await blocker.query("COMMIT"); blocker.release();
    await reset;
    expect(await login).toBeNull();
    expect(await change).toBe(false);
    expect(persist).not.toHaveBeenCalled();
    expect((await pool.query("SELECT password_hash FROM admin_users WHERE id=1")).rows[0].password_hash).toBe("hash:new-password1");
  });
  it("partially failed session persistence is cleaned and legacy rehash rolls back", async () => {
    const upgrading = createLockedAuth({ pool, hashPassword: async () => "$2upgraded", verifyPassword: async () => true });
    await expect(upgrading.login("00123456", "alice", "old-password1", async () => {
      await pool.query(`INSERT INTO user_sessions VALUES ('failed-login','{"user":{"id":1,"tenantId":1}}',now())`);
      throw new Error("Simulated save failure");
    }, async () => { await pool.query("DELETE FROM user_sessions WHERE sid='failed-login'"); })).rejects.toThrow();
    expect((await pool.query("SELECT * FROM user_sessions")).rows).toHaveLength(0);
    expect((await pool.query("SELECT password_hash FROM admin_users WHERE id=1")).rows[0].password_hash).toBe("hash:old-password1");
  });
  it("commit failure also destroys an already persisted session", async () => {
    const failingPool = {
      async connect() {
        const c = await pool.connect();
        return {
          query: (sql: string | { text: string }, values?: unknown[]) => {
            if ((typeof sql === "string" ? sql : sql.text) === "COMMIT") return Promise.reject(new Error("Simulated commit failure"));
            return c.query(sql, values);
          },
          release: () => c.release(),
        };
      },
    };
    const failing = createLockedAuth({ pool: failingPool as any, hashPassword: async () => "$2upgrade", verifyPassword: async () => true });
    await expect(failing.login("00123456", "alice", "old-password1", async () => {
      await pool.query(`INSERT INTO user_sessions VALUES ('commit-failed','{"user":{"id":1,"tenantId":1}}',now())`);
    }, async () => { await pool.query("DELETE FROM user_sessions WHERE sid='commit-failed'"); })).rejects.toThrow("Simulated commit failure");
    expect((await pool.query("SELECT * FROM user_sessions")).rows).toHaveLength(0);
    expect((await pool.query("SELECT password_hash FROM admin_users WHERE id=1")).rows[0].password_hash).toBe("hash:old-password1");
  });
  it("forgot database lock wait is bounded and leaves no token or orphan transaction", async () => {
    await verified();
    send.mockClear();
    const blocker = await pool.connect();
    await blocker.query("BEGIN");
    await blocker.query("SELECT id FROM admin_users WHERE id=1 FOR UPDATE");
    const started = performance.now();
    try {
      await expect(service.forgot("00123456", "alice")).rejects.toThrow();
      expect(performance.now() - started).toBeLessThan(1_200);
      expect(send).not.toHaveBeenCalled();
    } finally { await blocker.query("ROLLBACK"); blocker.release(); }
    expect((await pool.query("SELECT * FROM account_recovery_tokens")).rows).toHaveLength(0);
  });
  it.each([false, true])("pool-size same-user logins complete with real session save (multiple companies: %s)", async (mixedCompanies) => {
    if (mixedCompanies) await pool.query("INSERT INTO admin_users VALUES (3,2,'alice','hash:old-password1',true,now())");
    const reset = await resetToken();
    const config = { host: process.env.CUSTOMER_TEST_PG_SOCKET, port: Number(process.env.CUSTOMER_TEST_PG_PORT), database: "customer_router_acceptance", user: "customer_test_owner", options: `-c search_path=${schema}`, connectionTimeoutMillis: 1_000 };
    const authPool = new pg.Pool({ ...config, max: 4 });
    const sessions = new pg.Pool({ ...config, max: 2, statement_timeout: 2_000, query_timeout: 2_500 });
    const store = createPgSessionStore(sessions, () => {}, false);
    let unlock!: () => void;
    const barrier = new Promise<void>((resolve) => { unlock = resolve; });
    const saturated = createLockedAuth({
      pool: authPool,
      verifyPassword: async (p, h) => { await barrier; return h === `hash:${p}`; },
      hashPassword: async (p) => `hash:${p}`,
    });
    const app = express();
    app.use(session({ store, secret: "isolated-test-only-not-production", resave: false, saveUninitialized: false }));
    app.post("/login", async (req, res) => {
      try {
        const user = await saturated.login(req.query.company === "2" ? "00234567" : "00123456", "alice", "old-password1", async (u) => {
          await new Promise<void>((resolve, reject) => req.session.regenerate((error) => error ? reject(error) : resolve()));
          req.session.user = { id: u.id, tenantId: u.tenant_id, username: "alice", displayName: "Test", role: "admin" };
          await new Promise<void>((resolve, reject) => req.session.save((error) => error ? reject(error) : resolve()));
        }, async () => {
          await new Promise<void>((resolve) => req.session.destroy(() => resolve()));
        });
        res.status(user ? 200 : 401).json({ ok: !!user });
      } catch { res.status(503).json({ error: "unavailable" }); }
    });
    const listener = app.listen(0, "127.0.0.1");
    await new Promise<void>((resolve) => listener.once("listening", resolve));
    try {
      const endpoint = `http://127.0.0.1:${(listener.address() as any).port}/login`;
      const requests = Array.from({ length: 4 }, (_, i) => fetch(endpoint + (mixedCompanies && i % 2 ? "?company=2" : ""), { method: "POST", signal: AbortSignal.timeout(8_000) }));
      for (let i = 0; ; i++) {
        if (authPool.totalCount === 4 && authPool.idleCount === 0) break;
        if (i > 50) throw new Error("Auth pool did not saturate");
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      expect(authPool.idleCount).toBe(0);
      unlock();
      const responses = await Promise.all(requests);
      expect(responses.map((response) => response.status)).toEqual([200, 200, 200, 200]);
      expect((await pool.query("SELECT * FROM user_sessions")).rows).toHaveLength(4);
      await service.consume(reset, "reset", "new-password1");
      expect((await pool.query("SELECT * FROM user_sessions")).rows).toHaveLength(mixedCompanies ? 2 : 0);
    } finally {
      unlock();
      await new Promise<void>((resolve) => listener.close(() => resolve()));
      await store.close();
      await sessions.end();
      await authPool.end();
    }
  }, 15_000);
  it("login pool acquisition and row lock waits have bounded failures", async () => {
    const config = { host: process.env.CUSTOMER_TEST_PG_SOCKET, port: Number(process.env.CUSTOMER_TEST_PG_PORT), database: "customer_router_acceptance", user: "customer_test_owner", options: `-c search_path=${schema}`, max: 1 };
    const tiny = new pg.Pool(config);
    const held = await tiny.connect();
    const bounded = createLockedAuth({ pool: tiny, verifyPassword: async () => true, hashPassword: async () => "$2hash" });
    let started = performance.now();
    await expect(bounded.login("00123456", "alice", "old-password1", async () => {}, async () => {})).rejects.toThrow("connection deadline");
    expect(performance.now() - started).toBeLessThan(1_400);
    held.release();
    // Let the timed-out acquisition release its late connection.
    await new Promise((resolve) => setTimeout(resolve, 10));
    await tiny.end();
    const blocker = await pool.connect();
    await blocker.query("BEGIN");
    await blocker.query("SELECT id FROM admin_users WHERE id=1 FOR UPDATE");
    started = performance.now();
    try {
      await expect(auth.login("00123456", "alice", "old-password1", async () => {}, async () => {})).rejects.toThrow();
      expect(performance.now() - started).toBeLessThan(2_000);
    } finally { await blocker.query("ROLLBACK"); blocker.release(); }
  }, 5_000);
  it("expiry, password change and email change revoke outstanding capabilities", async () => {
    let t = await resetToken();
    await pool.query("UPDATE account_recovery_tokens SET expires_at=now()-interval '1 minute'");
    await expect(service.consume(t, "reset", "new-password1")).rejects.toMatchObject({ status: 400 });
    await service.forgot("00123456", "alice"); t = token();
    await pool.query("UPDATE admin_users SET password_hash='hash:changed-password1' WHERE id=1");
    await expect(service.consume(t, "reset", "new-password1")).rejects.toMatchObject({ status: 400 });
    await service.forgot("00123456", "alice"); t = token();
    await service.enroll(1, 1, "changed@example.test", "changed-password1");
    await expect(service.consume(t, "reset", "new-password1")).rejects.toMatchObject({ status: 400 });
  });
  it("new issuance invalidates the previous token and purpose cannot be swapped", async () => {
    await service.enroll(1, 1, "alice@example.test", "old-password1");
    const previous = token();
    await service.enroll(1, 1, "alice@example.test", "old-password1");
    await expect(service.consume(previous, "verify")).rejects.toMatchObject({ status: 400 });
    await expect(service.consume(token(), "reset", "new-password1")).rejects.toMatchObject({ status: 400 });
  });
  it("forgot response hides missing, inactive, unenrolled and mail failure; ignores arbitrary recipients", async () => {
    const missing = await post("/admin/forgot-password", { username: "missing" });
    const unenrolled = await post("/admin/forgot-password", { username: "bob" });
    await verified(); send.mockClear();
    const enrolled = await post("/admin/forgot-password", { username: "alice", email: "attacker@example.test" });
    expect(send.mock.calls[0][0]).toBe("alice@example.test");
    send.mockRejectedValue(new Error("secret mail provider details"));
    const failed = await post("/admin/forgot-password", { username: "alice" });
    await pool.query("UPDATE admin_users SET is_active=false WHERE id=1");
    const inactive = await post("/admin/forgot-password", { username: "alice" });
    expect([unenrolled, enrolled, failed, inactive]).toEqual([missing, missing, missing, missing]);
    expect((await pool.query("SELECT * FROM account_recovery_tokens")).rows).toHaveLength(0);
  }, 45_000);
  it("session guard returns JSON; enrollment binds to session not body", async () => {
    expect((await post("/admin/recovery-email", {})).status).toBe(401);
    const result = await post("/admin/recovery-email", { userId: 2, tenantId: 2, email: "alice@example.test", currentPassword: "old-password1" }, { "x-test-user": "1" });
    expect(result.status).toBe(200);
    expect((await pool.query("SELECT user_id,tenant_id FROM account_recovery_profiles")).rows).toEqual([{ user_id: 1, tenant_id: 1 }]);
  });
  it("failed verification email is explicit and its token cannot be used", async () => {
    send.mockRejectedValue(new Error("provider details must not leak"));
    await expect(service.enroll(1, 1, "alice@example.test", "old-password1")).rejects.toMatchObject({ status: 503 });
    expect((await pool.query("SELECT * FROM account_recovery_tokens")).rows).toHaveLength(0);
    expect(await service.get(1, 1)).toEqual({ email: "alice@example.test", verified: false });
  });
  it("schema failure is clean 503, never SQL or parameters", async () => {
    await pool.query("ALTER TABLE account_recovery_profiles RENAME TO unavailable_profiles");
    try {
      const result = await post("/admin/forgot-password", { username: "schema-test" });
      expect(result.status).toBe(503);
      expect(JSON.stringify(result.body)).not.toMatch(/SELECT|schema-test|relation|password/i);
    } finally { await pool.query("ALTER TABLE unavailable_profiles RENAME TO account_recovery_profiles"); }
  }, 10_000);
  it("missing token schema produces identical 503 before account lookup", async () => {
    await verified();
    await pool.query("ALTER TABLE account_recovery_tokens RENAME TO unavailable_tokens");
    try {
      const existing = await post("/admin/forgot-password", { username: "alice" });
      const absent = await post("/admin/forgot-password", { username: "another-missing-user" });
      expect(existing.status).toBe(503);
      expect(absent).toEqual(existing);
    } finally { await pool.query("ALTER TABLE unavailable_tokens RENAME TO account_recovery_tokens"); }
  }, 20_000);
  it("forgot latency is identity-independent for delayed mail, timeout, absence and inactive accounts", async () => {
    // Distinct identifiers avoid the earlier HTTP limiter counters.
    await pool.query("INSERT INTO admin_users VALUES (3,1,'timed','hash:old-password1',true,now()),(4,1,'inactive','hash:old-password1',false,now())");
    await service.enroll(3, 1, "timed@example.test", "old-password1");
    await service.consume(token(), "verify");
    send.mockImplementation(async () => { await new Promise((resolve) => setTimeout(resolve, 1_000)); });
    async function timed(username: string) {
      const start = performance.now();
      const result = await post("/admin/forgot-password", { username });
      return { elapsed: performance.now() - start, result };
    }
    const delayed = await Promise.all([timed("timed"), timed("timing-absent"), timed("inactive")]);
    send.mockImplementation(async (_email, _token, _purpose, signal?: AbortSignal) => {
      await new Promise<void>((_resolve, reject) => signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true }));
    });
    const failed = await timed("timed");
    for (const measurement of [...delayed, failed]) {
      expect(measurement.result).toEqual(delayed[0].result);
      expect(measurement.elapsed).toBeGreaterThanOrEqual(5_950);
      expect(measurement.elapsed).toBeLessThan(6_800);
    }
    expect((await pool.query("SELECT * FROM account_recovery_tokens WHERE user_id=3")).rows).toHaveLength(0);
  }, 20_000);
});

describe("recovery password policy", () => {
  it("counts exact UTF-8 bytes and requires ASCII letters and digits", () => {
    expect(validRecoveryPassword("abcdefgh1")).toBe(false);
    expect(validRecoveryPassword("abcdefgh12")).toBe(true);
    expect(validRecoveryPassword("a1中中中中中中")).toBe(false);
    expect(validRecoveryPassword("a1中中中中中中中中")).toBe(true);
    expect(validRecoveryPassword("a1" + "中".repeat(23))).toBe(true);
    expect(validRecoveryPassword("a1" + "中".repeat(24))).toBe(false);
    expect(validRecoveryPassword("abcdefghij")).toBe(false);
    expect(validRecoveryPassword("1234567890")).toBe(false);
  });
  it("server mail uses verified sender and fixed canonical fragment links, with fetch mocked", async () => {
    const fetchMock = vi.fn(async () => ({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("RESEND_API_KEY", "test-only-not-a-real-key");
    try {
      await sendRecoveryEmail("alice@example.test", "testToken", "reset");
      const [endpoint, options] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
      const body = JSON.parse(options.body as string);
      expect(endpoint).toBe("https://api.resend.com/emails");
      expect(body.from).toBe("Yubon ERP <no-reply@yubonerp.com>");
      expect(body.to).toEqual(["alice@example.test"]);
      expect(body.html).toContain('https://yubonerp.com/app/reset-password#token=testToken');
      await sendRecoveryEmail("alice@example.test", "testToken", "verify");
      const verifyBody = JSON.parse((fetchMock.mock.calls[1] as unknown as [string, RequestInit])[1].body as string);
      expect(verifyBody.html).toContain('https://yubonerp.com/app/verify-recovery-email#token=testToken');
    } finally { vi.unstubAllGlobals(); vi.unstubAllEnvs(); }
  });
});