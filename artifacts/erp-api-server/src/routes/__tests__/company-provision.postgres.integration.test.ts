import { realpathSync } from "node:fs";
import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import type { Server } from "node:http";
import express from "express";
import { drizzle } from "drizzle-orm/node-postgres";
// Test-only driver: no application DB initialization.
// @ts-expect-error workspace database owns pg
import pg from "../../../../../lib/erp-db/node_modules/pg/lib/index.js";
import { beforeAll, afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const injected = vi.hoisted(() => ({ db: null as any, pool: null as any, scopedDb: () => null as any, runWithTenant: null as any }));
vi.mock("@workspace/erp-db", async () => ({
  ...await import("@workspace/erp-db/schema"),
  db: new Proxy({}, { get: (_t, key) => {
    const active = injected.scopedDb() ?? injected.db;
    const value = active[key];
    return typeof value === "function" ? value.bind(active) : value;
  } }),
  pool: {
    connect: () => injected.pool.connect(),
    query: (...args: unknown[]) => injected.pool.query(...args),
  },
  runWithTenant: (id: number, fn: () => Promise<unknown>) => injected.runWithTenant(id, fn),
}));
vi.mock("../../lib/auth", () => ({ hashPassword: async (p: string) => `hash:${p}` }));
import { provisionTenant } from "../../lib/tenant-provision";
import { createLockedAuth } from "../../lib/locked-auth";
import platformRouter from "../platform";
import { runWithTenant } from "@workspace/erp-db";

const acceptance = process.env.CUSTOMER_POSTGRES_ACCEPTANCE === "1" && process.env.CUSTOMER_TEST_PG_ROOT && process.env.CUSTOMER_TEST_PG_SOCKET ? describe : describe.skip;
acceptance("company provisioning and authoritative platform mapping in isolated PostgreSQL", () => {
  const schema = `company_${randomUUID().replaceAll("-", "")}`;
  const pool = new pg.Pool({ host: process.env.CUSTOMER_TEST_PG_SOCKET, port: Number(process.env.CUSTOMER_TEST_PG_PORT), database: "customer_router_acceptance", user: "customer_test_owner", options: `-c search_path=${schema}` });
  const scope = new AsyncLocalStorage<{ tenantId: number; db: ReturnType<typeof drizzle> }>();
  let server: Server;
  let url: string;
  beforeAll(async () => {
    const root = realpathSync(process.env.CUSTOMER_TEST_PG_ROOT!);
    expect(root.startsWith("/tmp/") || root.startsWith(realpathSync(process.env.TMPDIR || "/tmp") + "/")).toBe(true);
    expect(realpathSync(process.env.CUSTOMER_TEST_PG_SOCKET!).startsWith(root + "/")).toBe(true);
    injected.pool = pool;
    injected.db = drizzle(pool);
    injected.scopedDb = () => scope.getStore()?.db;
    // Mirror production's context-sensitive proxy using a real NOBYPASSRLS
    // connection. Never import the runtime role initializer in isolated tests.
    injected.runWithTenant = async (tenantId: number, fn: () => Promise<unknown>) => {
      if (scope.getStore()?.tenantId === tenantId) return fn();
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query("SET LOCAL ROLE erp_app");
        await client.query("SELECT set_config('app.tenant_id',$1,true)", [String(tenantId)]);
        const result = await scope.run({ tenantId, db: drizzle(client) }, fn);
        await client.query("COMMIT");
        return result;
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally { client.release(); }
    };
    await pool.query(`CREATE SCHEMA ${schema};
      CREATE TABLE tenants(id serial PRIMARY KEY,name text NOT NULL,company_code text UNIQUE,status text DEFAULT 'trialing',is_exempt boolean DEFAULT false,trial_ends_at timestamptz,stripe_customer_id text,stripe_subscription_id text,ai_credits integer DEFAULT 10,contact_email text,created_at timestamptz DEFAULT now(),updated_at timestamptz DEFAULT now());
      CREATE TABLE admin_users(id serial PRIMARY KEY,tenant_id integer NOT NULL,username text NOT NULL,password_hash text NOT NULL,display_name text NOT NULL,role text DEFAULT 'admin',is_active boolean DEFAULT true,employee_id integer,created_at timestamptz DEFAULT now(),updated_at timestamptz DEFAULT now(),UNIQUE(tenant_id,username));
      CREATE TABLE accounts(tenant_id integer NOT NULL,id serial PRIMARY KEY,account_number text,account_name text,account_type text,parent_account_id integer,balance numeric DEFAULT 0,is_group boolean DEFAULT false,cash_flow_category text,created_at timestamptz DEFAULT now(),updated_at timestamptz DEFAULT now());
      CREATE TABLE menu_permissions(tenant_id integer NOT NULL,path text,roles text[],updated_at timestamptz DEFAULT now());
      CREATE TABLE accounting_settings(tenant_id integer NOT NULL,id serial PRIMARY KEY,lock_date text,updated_at timestamptz DEFAULT now());
      CREATE TABLE warehouses(tenant_id integer NOT NULL,id serial PRIMARY KEY,name text NOT NULL,location text,is_active boolean NOT NULL DEFAULT true,created_at timestamptz NOT NULL DEFAULT now());
      CREATE TABLE audit_logs(tenant_id integer,action text,module text,document_type text,document_id integer,user_id text,user_name text,old_values text,new_values text,description text);
      CREATE TABLE user_sessions(sid text PRIMARY KEY,sess json,expire timestamptz);
      GRANT USAGE ON SCHEMA ${schema} TO erp_app;
      GRANT ALL ON ALL TABLES IN SCHEMA ${schema} TO erp_app;
      GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA ${schema} TO erp_app;
    `);
    for (const table of ["accounts", "menu_permissions", "accounting_settings"]) {
      await pool.query(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY;
        CREATE POLICY tenant_isolation ON ${table} USING (tenant_id=current_setting('app.tenant_id')::integer) WITH CHECK (tenant_id=current_setting('app.tenant_id')::integer)`);
    }
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      // Test harness only; real platform role/session/tenant guards remain active.
      if (req.headers["x-test-role"]) (req as any).session = { user: { id: 1, tenantId: Number(req.headers["x-test-tenant"] || 1), role: req.headers["x-test-role"] } };
      next();
    });
    app.use(platformRouter);
    server = app.listen(0, "127.0.0.1");
    await new Promise<void>((resolve) => server.once("listening", resolve));
    url = `http://127.0.0.1:${(server.address() as any).port}`;
  });
  beforeEach(async () => {
    await pool.query("TRUNCATE tenants,admin_users,accounts,menu_permissions,accounting_settings,audit_logs,user_sessions RESTART IDENTITY");
  });
  afterAll(async () => {
    if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
    await pool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await pool.end();
  });
  const input = (companyCode: string) => ({ companyCode, companyName: "Synthetic", contactEmail: "owner@example.test", username: " owner ", password: "password123", displayName: "Owner" });
  async function patch(id: number, body: object, role = "super_admin", tenantId = 1) {
    const response = await fetch(`${url}/platform/tenants/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json", "x-test-role": role, "x-test-tenant": String(tenantId) }, body: JSON.stringify(body) });
    return { status: response.status, body: await response.json() };
  }
  it("allows the same trimmed account in different companies and serializes duplicate-company signup", async () => {
    const [a, b] = await Promise.all([provisionTenant(input(" 00123456 ")), provisionTenant(input("00234567"))]);
    expect(a.tenant.companyCode).toBe("00123456");
    expect(a.tenant.id).not.toBe(b.tenant.id);
    expect((await pool.query(
      "SELECT count(*)::int AS count FROM accounts WHERE tenant_id=$1",
      [a.tenant.id],
    )).rows).toEqual([{ count: 476 }]);
    expect((await pool.query(
      "SELECT account_number,account_name FROM accounts WHERE tenant_id=$1 AND account_number IN ('1113','1113.0','1119','1119.0','1120') ORDER BY account_number",
      [a.tenant.id],
    )).rows).toEqual([
      { account_number: "1113", account_name: "銀行存款-主要帳戶" },
      { account_number: "1113.0", account_name: "銀行存款-專用帳戶" },
      { account_number: "1119", account_name: "代管銀行存款-第一帳戶" },
      { account_number: "1119.0", account_name: "代管銀行存款-專用帳戶" },
      { account_number: "1120", account_name: "代管銀行存款-第二帳戶" },
    ]);
    expect((await pool.query(
      "SELECT id FROM accounts WHERE tenant_id=$1 AND account_name ~ '(國泰板橋|土地東板橋|國際兒童才藝協會|詠勝教育|安廷|弘晉|猛璋|應收帳款測試)'",
      [a.tenant.id],
    )).rows).toHaveLength(0);
    expect((await pool.query("SELECT username FROM admin_users")).rows).toEqual([{ username: "owner" }, { username: "owner" }]);
    const attempts = await Promise.allSettled([provisionTenant(input("00345678")), provisionTenant(input("00345678"))]);
    expect(attempts.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(attempts.find((r) => r.status === "rejected")).toMatchObject({ reason: { statusCode: 409 } });
    expect((await pool.query("SELECT * FROM tenants")).rows).toHaveLength(3);
    expect((await pool.query("SELECT * FROM admin_users")).rows).toHaveLength(3);
    await expect(provisionTenant(input("1234567"))).rejects.toMatchObject({ statusCode: 400 });
  });
  it("rolls back company, owner and copied business data when final initialization fails", async () => {
    await pool.query("INSERT INTO accounts(tenant_id,account_number,account_name,account_type) VALUES (1,'1000','Synthetic template','asset')");
    await pool.query("INSERT INTO menu_permissions(tenant_id,path,roles) VALUES (1,'/test',ARRAY['owner'])");
    await pool.query("ALTER TABLE accounting_settings ADD CONSTRAINT fail_initialization CHECK(tenant_id < 0)");
    try {
      await expect(provisionTenant(input("00123456"))).rejects.toThrow();
      for (const table of ["tenants", "admin_users", "accounting_settings"]) expect((await pool.query(`SELECT * FROM ${table}`)).rows).toHaveLength(0);
      for (const table of ["accounts", "menu_permissions"]) expect((await pool.query(`SELECT tenant_id FROM ${table}`)).rows).toEqual([{ tenant_id: 1 }]);
    } finally { await pool.query("ALTER TABLE accounting_settings DROP CONSTRAINT fail_initialization"); }
  });
  it("provisions atomically from an existing signed-in tenant RLS context without writing to that tenant", async () => {
    await pool.query("INSERT INTO tenants(name,company_code) VALUES ('Template','00111111'),('Signed in','00222222')");
    await pool.query("INSERT INTO accounts(tenant_id,account_number,account_name,account_type) VALUES (1,'1000','Template account','asset'),(2,'2000','Existing account','liability')");
    await pool.query("INSERT INTO menu_permissions(tenant_id,path,roles) VALUES (1,'/template',ARRAY['owner']),(2,'/existing',ARRAY['admin'])");
    await pool.query("INSERT INTO accounting_settings(tenant_id,lock_date) VALUES (2,'2026-01-01')");
    const prior = new Map<string, unknown>();
    for (const table of ["accounts", "menu_permissions", "accounting_settings"]) {
      prior.set(table, (await pool.query(`SELECT * FROM ${table} WHERE tenant_id=2`)).rows);
    }
    const result = await runWithTenant(2, async () => {
      // Prove the existing context really is a restricted tenant connection.
      const visible = await injected.scopedDb().select().from((await import("@workspace/erp-db/schema")).accountsTable);
      expect(visible.map((row: { tenantId: number }) => row.tenantId)).toEqual([2]);
      const created = await provisionTenant(input("00333333"));
      expect(scope.getStore()?.tenantId).toBe(2);
      return created;
    });
    expect(result.tenant.id).not.toBe(2);
    expect((await pool.query("SELECT tenant_id FROM admin_users WHERE id=$1", [result.adminUserId])).rows).toEqual([{ tenant_id: result.tenant.id }]);
    expect((await pool.query("SELECT count(*)::int AS count FROM accounts WHERE tenant_id=$1", [result.tenant.id])).rows).toEqual([{ count: 476 }]);
    expect((await pool.query("SELECT account_number FROM accounts WHERE tenant_id=$1 AND account_number='1000'", [result.tenant.id])).rows).toHaveLength(0);
    expect((await pool.query("SELECT path FROM menu_permissions WHERE tenant_id=$1", [result.tenant.id])).rows).toEqual([{ path: "/template" }]);
    expect((await pool.query("SELECT tenant_id FROM accounting_settings WHERE tenant_id=$1", [result.tenant.id])).rows).toEqual([{ tenant_id: result.tenant.id }]);
    await pool.query(`ALTER TABLE accounting_settings ADD CONSTRAINT fail_context_signup CHECK(tenant_id <= ${result.tenant.id})`);
    try {
      await expect(runWithTenant(2, () => provisionTenant(input("00444444")))).rejects.toThrow();
      expect((await pool.query("SELECT id FROM tenants WHERE company_code='00444444'")).rows).toHaveLength(0);
      expect((await pool.query("SELECT * FROM admin_users")).rows).toHaveLength(1);
      for (const table of ["accounts", "menu_permissions", "accounting_settings"]) {
        expect((await pool.query(`SELECT * FROM ${table} WHERE tenant_id=2`)).rows).toEqual(prior.get(table));
        expect((await pool.query(`SELECT tenant_id FROM ${table} WHERE tenant_id NOT IN (1,2,$1)`, [result.tenant.id])).rows).toHaveLength(0);
      }
    } finally { await pool.query("ALTER TABLE accounting_settings DROP CONSTRAINT fail_context_signup"); }
  });
  it("company-code edits wait for login persistence then invalidate its old-identity session", async () => {
    const { tenant } = await provisionTenant(input("00123456"));
    let verified!: () => void;
    const ready = new Promise<void>((resolve) => { verified = resolve; });
    let unlock!: () => void;
    const barrier = new Promise<void>((resolve) => { unlock = resolve; });
    const auth = createLockedAuth({ pool, hashPassword: async (p) => `hash:${p}`, verifyPassword: async (p, h) => { verified(); await barrier; return h === `hash:${p}`; } });
    const login = auth.login("00123456", "owner", "password123", async (u) => {
      await pool.query("INSERT INTO user_sessions VALUES ('racing',$1,now())", [JSON.stringify({ user: { id: u.id, tenantId: u.tenant_id, companyCode: u.company_code } })]);
    }, async () => { await pool.query("DELETE FROM user_sessions WHERE sid='racing'"); });
    await ready;
    let edited = false;
    const edit = patch(tenant.id, { companyCode: "00345678" }).then((result) => { edited = true; return result; });
    try {
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(edited).toBe(false);
    } finally { unlock(); }
    expect(await login).not.toBeNull();
    expect((await edit).status).toBe(200);
    expect((await pool.query("SELECT * FROM user_sessions")).rows).toHaveLength(0);
    expect(await auth.login("00123456", "owner", "password123", async () => {}, async () => {})).toBeNull();
    expect(await auth.login("00345678", "owner", "password123", async () => {}, async () => {})).toMatchObject({ tenant_id: tenant.id });
  });
  it("enrolls legacy mappings explicitly, rejects invalid/duplicate codes, audits and revokes only affected sessions", async () => {
    await pool.query("INSERT INTO tenants(name,company_code) VALUES ('Legacy',NULL),('Other','00234567')");
    await pool.query("INSERT INTO user_sessions VALUES ('a','{\"user\":{\"id\":1,\"tenantId\":1}}',now()),('b','{\"user\":{\"id\":2,\"tenantId\":2}}',now())");
    const listing = await fetch(`${url}/platform/tenants`, { headers: { "x-test-role": "super_admin" } });
    expect((await listing.json() as Array<{ companyCode: string | null }>)[0]).toMatchObject({ companyCode: null });
    for (const code of [12345678, null, "", "1234567", "００１２３４５６"]) expect((await patch(1, { companyCode: code })).status).toBe(400);
    expect((await patch(1, { companyCode: "00123456" }, "admin")).status).toBe(403);
    expect((await patch(1, { companyCode: "00123456" }, "super_admin", 2)).status).toBe(403);
    expect((await patch(1, { companyCode: "00234567" })).status).toBe(409);
    expect((await pool.query("SELECT * FROM user_sessions")).rows).toHaveLength(2);
    expect(await patch(1, { companyCode: " 00123456 ", isExempt: true })).toMatchObject({ status: 200, body: { companyCode: "00123456", isExempt: true } });
    expect((await pool.query("SELECT sid FROM user_sessions")).rows).toEqual([{ sid: "b" }]);
    expect((await pool.query("SELECT * FROM audit_logs")).rows).toHaveLength(1);
    expect((await patch(1, { isExempt: false })).body).toMatchObject({ companyCode: "00123456", isExempt: false });
  });
});