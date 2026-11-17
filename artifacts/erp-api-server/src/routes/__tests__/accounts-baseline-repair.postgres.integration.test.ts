import { realpathSync } from "node:fs";
import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import type { Server } from "node:http";
import express from "express";
import { drizzle } from "drizzle-orm/node-postgres";
// Test-only driver: the disposable runner supplies PostgreSQL; runtime DB initialization is never loaded.
// @ts-expect-error workspace database owns pg
import pg from "../../../../../lib/erp-db/node_modules/pg/lib/index.js";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const injected = vi.hoisted(() => ({
  db: null as any,
  scopedDb: () => null as any,
  runWithTenant: null as any,
}));
vi.mock("@workspace/erp-db", async () => ({
  ...await import("@workspace/erp-db/schema"),
  db: new Proxy({}, {
    get: (_target, key) => {
      const active = injected.scopedDb() ?? injected.db;
      const value = active[key];
      return typeof value === "function" ? value.bind(active) : value;
    },
  }),
  runWithTenant: (tenantId: number, fn: () => Promise<unknown>) => injected.runWithTenant(tenantId, fn),
}));

import accountsRouter from "../accounts";
import accountConfigurationRouter from "../account-configuration";
import { selectAccountingBaseline } from "../../lib/accounting-baseline";
import { runWithTenant } from "@workspace/erp-db";

const optedIn = process.env.CUSTOMER_POSTGRES_ACCEPTANCE === "1" &&
  !!process.env.CUSTOMER_TEST_PG_ROOT && !!process.env.CUSTOMER_TEST_PG_SOCKET;
const acceptance = optedIn ? describe : describe.skip;

acceptance("account baseline repair in disposable PostgreSQL", () => {
  const schema = `baseline_${randomUUID().replaceAll("-", "")}`;
  const pool = new pg.Pool({
    host: process.env.CUSTOMER_TEST_PG_SOCKET,
    port: Number(process.env.CUSTOMER_TEST_PG_PORT),
    database: "customer_router_acceptance",
    user: "customer_test_owner",
    options: `-c search_path=${schema}`,
  });
  const scope = new AsyncLocalStorage<{ tenantId: number; db: ReturnType<typeof drizzle> }>();
  let server: Server;
  let url: string;

  beforeAll(async () => {
    const root = realpathSync(process.env.CUSTOMER_TEST_PG_ROOT!);
    expect(root.startsWith("/tmp/") || root.startsWith(realpathSync(process.env.TMPDIR || "/tmp") + "/")).toBe(true);
    expect(realpathSync(process.env.CUSTOMER_TEST_PG_SOCKET!).startsWith(root + "/")).toBe(true);
    injected.db = drizzle(pool);
    injected.scopedDb = () => scope.getStore()?.db;
    injected.runWithTenant = async (tenantId: number, fn: () => Promise<unknown>) => {
      if (scope.getStore()?.tenantId === tenantId) return fn();
      const client = await pool.connect();
      try {
        await client.query("SET ROLE erp_app");
        await client.query("SELECT set_config('app.tenant_id',$1,false)", [String(tenantId)]);
        return await scope.run({ tenantId, db: drizzle(client) }, fn);
      } finally {
        await client.query("RESET ROLE").catch(() => {});
        client.release();
      }
    };
    await pool.query(`
      CREATE SCHEMA ${schema};
      CREATE TABLE tenants(
        id serial PRIMARY KEY,name text NOT NULL,company_code text,status text NOT NULL DEFAULT 'active',
        is_exempt boolean NOT NULL DEFAULT false,trial_ends_at timestamptz,stripe_customer_id text,
        stripe_subscription_id text,ai_credits integer NOT NULL DEFAULT 10,contact_email text,
        created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE TABLE admin_users(
        tenant_id integer NOT NULL,id serial PRIMARY KEY,username text NOT NULL,password_hash text NOT NULL,
        display_name text NOT NULL,role text NOT NULL,is_active boolean NOT NULL DEFAULT true,employee_id integer,
        created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE TABLE accounts(
        tenant_id integer NOT NULL,id serial PRIMARY KEY,account_number text NOT NULL,account_name text NOT NULL,
        account_type text NOT NULL,parent_account_id integer,balance numeric(14,2) NOT NULL DEFAULT 0,
        is_group boolean NOT NULL DEFAULT false,cash_flow_category text,
        created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE(tenant_id,account_number)
      );
      CREATE TABLE audit_logs(
        tenant_id integer NOT NULL,id serial PRIMARY KEY,action text NOT NULL,module text NOT NULL,
        document_type text,document_id integer,document_number text,user_id text,user_name text,ip_address text,
        old_values jsonb,new_values jsonb,description text,created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE TABLE journal_entries(id serial PRIMARY KEY,tenant_id integer NOT NULL,memo text);
      CREATE TABLE invoices(id serial PRIMARY KEY,tenant_id integer NOT NULL,number text);
      GRANT USAGE ON SCHEMA ${schema} TO erp_app;
      GRANT ALL ON ALL TABLES IN SCHEMA ${schema} TO erp_app;
      GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA ${schema} TO erp_app;
    `);
    for (const table of ["admin_users", "accounts", "audit_logs", "journal_entries", "invoices"]) {
      await pool.query(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY;
        CREATE POLICY tenant_isolation ON ${table}
        USING (tenant_id=current_setting('app.tenant_id')::integer)
        WITH CHECK (tenant_id=current_setting('app.tenant_id')::integer)`);
    }

    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      if (req.headers["x-test-key"]) {
        Object.assign(req, { apiKeyAuth: true, apiKey: { tenantId: 1, permissions: "admin" } });
      }
      if (req.headers["x-test-user"]) {
        (req as any).session = {
          user: {
            id: Number(req.headers["x-test-user"]),
            tenantId: Number(req.headers["x-test-tenant"] || 1),
            role: String(req.headers["x-test-session-role"] || "owner"),
            companyCode: String(req.headers["x-test-company"] || "83483621"),
          },
        };
      }
      next();
    });
    app.use((req, res, next) => {
      const tenantId = Number((req as any).session?.user?.tenantId ?? (req as any).apiKey?.tenantId);
      if (!Number.isInteger(tenantId)) { next(); return; }
      runWithTenant(tenantId, () => new Promise<void>((resolve) => {
        res.once("finish", resolve);
        res.once("close", resolve);
        next();
      })).catch(next);
    });
    app.use(accountConfigurationRouter);
    app.use(accountsRouter);
    app.use((_error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
      res.status(500).json({ error: "transaction failed" });
    });
    server = app.listen(0, "127.0.0.1");
    await new Promise<void>(resolve => server.once("listening", resolve));
    url = `http://127.0.0.1:${(server.address() as any).port}`;
  });

  beforeEach(async () => {
    await pool.query("TRUNCATE tenants,admin_users,accounts,audit_logs,journal_entries,invoices RESTART IDENTITY");
    await pool.query(`
      INSERT INTO tenants(id,name,company_code,is_exempt) VALUES
        (1,'主公司','83483621',true),(2,'german','12345678',false),(3,'ICTA','82289803',false);
      SELECT setval(pg_get_serial_sequence('tenants','id'),3,true);
      INSERT INTO admin_users(tenant_id,id,username,password_hash,display_name,role,is_active) VALUES
        (1,1,'owner','x','Owner','owner',true),
        (1,2,'admin','x','Admin','admin',true),
        (1,3,'inactive','x','Inactive','owner',false),
        (2,4,'other','x','Other','owner',true),
        (1,5,'super','x','Super','super_admin',true);
      SELECT setval(pg_get_serial_sequence('admin_users','id'),5,true);
      INSERT INTO journal_entries(tenant_id,memo) VALUES(1,'preserve journal');
      INSERT INTO invoices(tenant_id,number) VALUES(1,'INV-PRESERVE');
    `);
  });

  afterAll(async () => {
    if (server) await new Promise<void>(resolve => server.close(() => resolve()));
    await pool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await pool.end();
  });

  async function request(method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
    const response = await fetch(url + path, {
      method,
      headers: { "content-type": "application/json", ...headers },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: response.status, body: await response.json() as any };
  }
  const owner = { "x-test-user": "1" };
  async function preview() {
    return request("GET", "/accounts/baseline-repair/preview", undefined, owner);
  }
  async function apply(fingerprint: string) {
    return request("POST", "/accounts/baseline-repair/apply", {
      fingerprint,
      confirmation: "補齊育邦會計科目",
    }, owner);
  }

  it("rejects anonymous, API key, wrong role, inactive user and wrong tenant without baseline data", async () => {
    const attempts = [
      await request("GET", "/accounts/baseline-repair/preview"),
      await request("GET", "/accounts/baseline-repair/preview", undefined, { "x-test-key": "1" }),
      await request("GET", "/accounts/baseline-repair/preview", undefined, { "x-test-user": "2" }),
      await request("GET", "/accounts/baseline-repair/preview", undefined, { "x-test-user": "3" }),
      await request("GET", "/accounts/baseline-repair/preview", undefined, { "x-test-user": "4", "x-test-tenant": "2" }),
    ];
    expect(attempts.map(item => item.status)).toEqual([401, 403, 403, 403, 403]);
    for (const attempt of attempts) {
      expect(attempt.body).not.toHaveProperty("missing");
      expect(JSON.stringify(attempt.body)).not.toContain("國泰板橋");
    }
    expect((await request("GET", "/accounts/baseline-repair/preview", undefined, {
      "x-test-user": "5",
      "x-test-session-role": "viewer",
    })).status).toBe(200);
    await pool.query("UPDATE tenants SET company_code='00000000' WHERE id=1");
    const wrongCompany = await request("GET", "/accounts/baseline-repair/preview", undefined, owner);
    expect(wrongCompany.status).toBe(403);
    expect(wrongCompany.body).not.toHaveProperty("missing");
    expect((await pool.query("SELECT * FROM accounts")).rows).toHaveLength(0);
  });

  it("rejects stale previews and structural conflicts without inserts or audit", async () => {
    await pool.query("INSERT INTO accounts(tenant_id,account_number,account_name,account_type,is_group) VALUES(1,'1','自訂根','Asset',true)");
    const first = await preview();
    await pool.query("UPDATE accounts SET balance=123 WHERE tenant_id=1 AND account_number='1'");
    expect((await apply(first.body.fingerprint)).status).toBe(409);
    expect((await pool.query("SELECT count(*)::int AS count FROM accounts")).rows[0].count).toBe(1);
    expect((await pool.query("SELECT * FROM audit_logs")).rows).toHaveLength(0);

    await pool.query("UPDATE accounts SET account_type='Liability' WHERE tenant_id=1 AND account_number='1'");
    const conflicted = await preview();
    expect(conflicted.body.conflicts).toHaveLength(1);
    expect((await apply(conflicted.body.fingerprint)).status).toBe(409);
    expect((await pool.query("SELECT count(*)::int AS count FROM accounts")).rows[0].count).toBe(1);
    expect((await pool.query("SELECT * FROM audit_logs")).rows).toHaveLength(0);
  });

  it("repairs idempotently while preserving existing account and accounting documents", async () => {
    await pool.query(`
      INSERT INTO accounts(tenant_id,account_number,account_name,account_type,balance,is_group,cash_flow_category)
      VALUES(1,'1','保留自訂根名稱','Asset',987.65,true,'cash')
    `);
    const before = (await pool.query("SELECT * FROM accounts WHERE account_number='1'")).rows[0];
    const first = await preview();
    expect(first.body).toMatchObject({ tenantId: 1, companyCode: "83483621", total: 476, existing: 1 });
    expect(await apply(first.body.fingerprint)).toMatchObject({
      status: 200,
      body: { inserted: 475, existing: 1 },
    });
    expect((await pool.query("SELECT * FROM accounts WHERE account_number='1'")).rows[0]).toEqual(before);
    expect((await pool.query("SELECT count(*)::int AS count FROM accounts WHERE tenant_id=1")).rows[0].count).toBe(476);
    expect((await pool.query("SELECT memo FROM journal_entries")).rows).toEqual([{ memo: "preserve journal" }]);
    expect((await pool.query("SELECT number FROM invoices")).rows).toEqual([{ number: "INV-PRESERVE" }]);
    expect((await pool.query("SELECT action,module,document_type FROM audit_logs")).rows).toEqual([{
      action: "create", module: "accounting", document_type: "account_baseline_repair",
    }]);

    const second = await preview();
    expect(second.body).toMatchObject({ existing: 476, missing: [], conflicts: [] });
    expect(await apply(second.body.fingerprint)).toMatchObject({
      status: 200,
      body: { inserted: 0, existing: 476 },
    });
    expect((await pool.query("SELECT count(*)::int AS count FROM accounts")).rows[0].count).toBe(476);
  });

  it("rolls back every account insert when the same-transaction audit write fails", async () => {
    await pool.query("ALTER TABLE audit_logs ADD CONSTRAINT reject_repair_audit CHECK(module <> 'accounting')");
    try {
      const snapshot = await preview();
      expect((await apply(snapshot.body.fingerprint)).status).toBe(500);
      expect((await pool.query("SELECT * FROM accounts")).rows).toHaveLength(0);
      expect((await pool.query("SELECT * FROM audit_logs")).rows).toHaveLength(0);
      expect((await pool.query("SELECT memo FROM journal_entries")).rows).toEqual([{ memo: "preserve journal" }]);
      expect((await pool.query("SELECT number FROM invoices")).rows).toEqual([{ number: "INV-PRESERVE" }]);
    } finally {
      await pool.query("ALTER TABLE audit_logs DROP CONSTRAINT reject_repair_audit");
    }
  });

  const configuration = {
    version: 1, companyCode: "83483621",
    accounts: [
      { accountNumber: "001.0", accountName: "指定銀行", accountType: "Asset", parentCode: "001", isGroup: false, cashFlowCategory: "cash" },
      { accountNumber: "001", accountName: "資產", accountType: "Asset", parentCode: null, isGroup: true, cashFlowCategory: null },
      { accountNumber: "001-1", accountName: "其他存款", accountType: "Asset", parentCode: "001", isGroup: false, cashFlowCategory: null },
    ],
  };
  async function configPreview(data: unknown = configuration, headers: Record<string, string> = owner) {
    return request("POST", "/accounts/configuration/preview", data, headers);
  }
  async function configImport(fingerprint: string, data: unknown = configuration) {
    return request("POST", "/accounts/configuration/import", { configuration: data, fingerprint, confirmation: "新增缺少科目" }, owner);
  }
  it("exports only current tenant configuration, excluding balances and database identities", async () => {
    await pool.query(`INSERT INTO accounts(tenant_id,account_number,account_name,account_type,balance,is_group)
      VALUES(1,'001','育邦資產','Asset',123.45,true),(2,'999','他公司名稱','Asset',9,false)`);
    const exported = await request("GET", "/accounts/configuration/export", undefined, owner);
    expect(exported.status).toBe(200);
    expect(exported.body).toEqual({ version: 1, companyCode: "83483621", accounts: [{
      accountNumber: "001", accountName: "育邦資產", accountType: "Asset", parentCode: null, isGroup: true, cashFlowCategory: null,
    }] });
    expect(JSON.stringify(exported.body)).not.toMatch(/balance|tenantId|parentAccountId|他公司/);
  });
  it("blocks keys, inactive users, revoked roles, extra data and cross-company uploads", async () => {
    expect((await request("POST", "/accounts/configuration/preview", configuration)).status).toBe(401);
    expect((await request("POST", "/accounts/configuration/preview", configuration, { "x-test-key": "1" })).status).toBe(403);
    expect((await configPreview(configuration, { "x-test-user": "3" })).status).toBe(403);
    await pool.query("UPDATE admin_users SET role='viewer' WHERE id=1");
    expect((await configPreview()).status).toBe(403);
    await pool.query("UPDATE admin_users SET role='owner' WHERE id=1");
    expect((await configPreview({ ...configuration, companyCode: "12345678" })).status).toBe(403);
    expect((await configPreview({ ...configuration, accounts: [{ ...configuration.accounts[0], balance: 500 }] })).status).toBe(400);
    expect((await configPreview(configuration, { "x-test-user": "4", "x-test-tenant": "2", "x-test-company": "12345678" })).status).toBe(403);
    expect((await pool.query("SELECT * FROM accounts")).rows).toHaveLength(0);
  });
  it("imports out-of-order hierarchies with new IDs, preserving accounting data and idempotency", async () => {
    await pool.query(`INSERT INTO accounts(tenant_id,id,account_number,account_name,account_type,balance,is_group,cash_flow_category)
      VALUES(1,50,'001','保留既有根名稱','Asset',987.65,true,'operating');
      SELECT setval(pg_get_serial_sequence('accounts','id'),50,true)`);
    const before = (await pool.query("SELECT * FROM accounts")).rows[0];
    const snapshot = await configPreview();
    expect(snapshot.body).toMatchObject({ total: 3, existing: 1, conflicts: [] });
    expect((await pool.query("SELECT * FROM accounts")).rows).toHaveLength(1);
    expect(await configImport(snapshot.body.fingerprint)).toMatchObject({ status: 200, body: { inserted: 2, existing: 1 } });
    expect((await pool.query("SELECT * FROM accounts WHERE id=50")).rows[0]).toEqual(before);
    const children = (await pool.query("SELECT parent_account_id,cash_flow_category,balance FROM accounts WHERE account_number='001.0'")).rows;
    expect(children).toEqual([{ parent_account_id: 50, cash_flow_category: "cash", balance: "0.00" }]);
    expect((await pool.query("SELECT memo FROM journal_entries")).rows).toEqual([{ memo: "preserve journal" }]);
    expect((await pool.query("SELECT number FROM invoices")).rows).toEqual([{ number: "INV-PRESERVE" }]);
    const second = await configPreview();
    expect(await configImport(second.body.fingerprint)).toMatchObject({ status: 200, body: { inserted: 0, existing: 3 } });
    expect((await pool.query("SELECT * FROM audit_logs WHERE document_type='account_configuration_import'")).rows).toHaveLength(1);
  });
  it("aborts stale previews and any structural conflict without partial import", async () => {
    const empty = await configPreview();
    await pool.query(`INSERT INTO accounts(tenant_id,account_number,account_name,account_type,is_group) VALUES(1,'001','根','Asset',true)`);
    expect((await configImport(empty.body.fingerprint)).status).toBe(409);
    await pool.query("UPDATE accounts SET is_group=false WHERE account_number='001'");
    const conflicted = await configPreview();
    expect(conflicted.body.conflicts.length).toBeGreaterThan(0);
    expect((await configImport(conflicted.body.fingerprint)).status).toBe(409);
    expect((await pool.query("SELECT * FROM accounts")).rows).toHaveLength(1);
  });
  it("rolls back an entire configuration import if audit insertion fails", async () => {
    await pool.query("ALTER TABLE audit_logs ADD CONSTRAINT reject_config_audit CHECK(module <> 'accounting')");
    try {
      const snapshot = await configPreview();
      expect((await configImport(snapshot.body.fingerprint)).status).toBe(500);
      expect((await pool.query("SELECT * FROM accounts")).rows).toHaveLength(0);
      expect((await pool.query("SELECT * FROM audit_logs")).rows).toHaveLength(0);
    } finally { await pool.query("ALTER TABLE audit_logs DROP CONSTRAINT reject_config_audit"); }
  });
  it("supports the complete 476-account source chart as a portable configuration", async () => {
    const source = selectAccountingBaseline("yubang-83483621");
    const data = {
      version: 1, companyCode: "83483621",
      accounts: source.map(row => ({
        accountNumber: row.code, accountName: row.displayName, accountType: row.accountType,
        parentCode: row.parentCode, isGroup: row.isGroup, cashFlowCategory: null,
      })).reverse(),
    };
    const snapshot = await configPreview(data);
    expect(snapshot.body).toMatchObject({ total: 476, existing: 0, conflicts: [] });
    expect(await configImport(snapshot.body.fingerprint, data)).toMatchObject({ status: 200, body: { inserted: 476, existing: 0 } });
    const exported = await request("GET", "/accounts/configuration/export", undefined, owner);
    expect(exported.body.accounts).toHaveLength(476);
    expect(exported.body.accounts.filter((row: any) => row.isGroup)).toHaveLength(106);
    for (const expected of data.accounts) {
      expect(exported.body.accounts).toContainEqual(expected);
    }
    const exportedPreview = await configPreview(exported.body);
    expect(exportedPreview.body).toMatchObject({ total: 476, existing: 476, missing: [], conflicts: [], warnings: [] });
  });
});