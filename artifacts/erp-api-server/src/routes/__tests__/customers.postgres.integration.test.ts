import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { realpathSync, statSync } from "node:fs";
import type { Server } from "node:http";
import path from "node:path";
import express from "express";
import { drizzle } from "drizzle-orm/node-postgres";
// pg is owned by @workspace/erp-db. Importing its package entry directly avoids
// importing @workspace/erp-db's runtime initializer, which rotates erp_app.
// @ts-expect-error Test-only import from the workspace database package.
import pg from "../../../../../lib/erp-db/node_modules/pg/lib/index.js";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

type TenantStore = { tenantId: number };
type QueryError = Error & { code?: string; cause?: { code?: string } };

const injected = vi.hoisted(() => ({
  transaction: null as null | ((callback: (tx: unknown) => Promise<unknown>) => Promise<unknown>),
}));

vi.mock("@workspace/erp-db", async () => {
  const schema = await import("@workspace/erp-db/schema");
  return {
    ...schema,
    db: {
      transaction(callback: (tx: unknown) => Promise<unknown>) {
        if (!injected.transaction) throw new Error("tenant context missing");
        return injected.transaction(callback);
      },
    },
  };
});

import customersRouter from "../customers";

const optedIn =
  process.env.CUSTOMER_POSTGRES_ACCEPTANCE === "1" &&
  Boolean(process.env.CUSTOMER_TEST_PG_ROOT) &&
  Boolean(process.env.CUSTOMER_TEST_PG_SOCKET);

const acceptance = optedIn ? describe : describe.skip;

acceptance("customer POST against isolated PostgreSQL RLS tables", () => {
  const { Pool } = pg;
  const pool = new Pool({
    host: process.env.CUSTOMER_TEST_PG_SOCKET,
    port: Number(process.env.CUSTOMER_TEST_PG_PORT),
    database: "customer_router_acceptance",
    user: "customer_test_owner",
  });
  const tenantScope = new AsyncLocalStorage<TenantStore>();
  const schemaName = `customer_acceptance_${randomUUID().replaceAll("-", "")}`;
  const quotedSchema = `"${schemaName}"`;
  const tenantA = 910_001;
  const tenantB = 910_002;

  let server: Server;
  let baseUrl: string;
  let originalRelations: Array<{ name: string; oid: string | null }>;

  async function transaction(callback: (tx: unknown) => Promise<unknown>): Promise<unknown> {
    const tenantId = tenantScope.getStore()?.tenantId;
    if (!tenantId) throw new Error("tenant context missing");

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL ROLE erp_app");
      await client.query("SELECT set_config('search_path', $1, true)", [quotedSchema]);
      await client.query("SELECT set_config('app.tenant_id', $1, true)", [String(tenantId)]);
      const tx = drizzle(client);
      const result = await callback(tx);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async function asTenant<T>(
    tenantId: number | null,
    operation: (client: any) => Promise<T>,
  ): Promise<T> {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL ROLE erp_app");
      await client.query("SELECT set_config('search_path', $1, true)", [quotedSchema]);
      if (tenantId !== null) {
        await client.query("SELECT set_config('app.tenant_id', $1, true)", [String(tenantId)]);
      }
      return await operation(client);
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  }

  async function postCustomer(
    tenantId: number | null,
    name: string,
    sessionTenantId: number | null = tenantId,
  ) {
    const headers: Record<string, string> = {
      "content-type": "application/json",
      "x-test-auth": "1",
    };
    if (tenantId !== null) headers["x-test-tenant"] = String(tenantId);
    if (sessionTenantId !== null) headers["x-test-session-tenant"] = String(sessionTenantId);
    return fetch(`${baseUrl}/customers`, {
      method: "POST",
      headers,
      // Codes are unique per name: POST /customers now rejects same-tenant duplicate codes (409).
      body: JSON.stringify({ name, customerCode: `CODE-${tenantId ?? "missing"}-${name}` }),
    });
  }

  beforeAll(async () => {
    const root = realpathSync(process.env.CUSTOMER_TEST_PG_ROOT!);
    const socket = realpathSync(process.env.CUSTOMER_TEST_PG_SOCKET!);
    if (path.dirname(socket) !== root || path.basename(socket) !== "socket") {
      throw new Error("Dedicated test socket is outside the runner-controlled directory");
    }
    const socketFile = path.join(socket, `.s.PGSQL.${process.env.CUSTOMER_TEST_PG_PORT}`);
    if (!statSync(socketFile).isSocket()) {
      throw new Error("Dedicated test PostgreSQL Unix socket is unavailable");
    }

    const admin = await pool.connect();
    try {
      const context = await admin.query(`
        SELECT current_database(),
               current_user,
               pg_has_role(current_user, 'erp_app', 'SET') AS can_set_role,
               (SELECT rolbypassrls FROM pg_roles WHERE rolname = 'erp_app') AS app_bypasses_rls,
               (SELECT rolsuper FROM pg_roles WHERE rolname = 'erp_app') AS app_is_superuser,
               (SELECT rolcanlogin FROM pg_roles WHERE rolname = 'erp_app') AS app_can_login
      `) as { rows: Array<{
        current_database: string;
        current_user: string;
        can_set_role: boolean;
        app_bypasses_rls: boolean;
        app_is_superuser: boolean;
        app_can_login: boolean;
      }> };
      const row = context.rows[0];
      if (
        row?.current_database !== "customer_router_acceptance" ||
        row.current_user !== "customer_test_owner" ||
        !row.can_set_role ||
        row.app_bypasses_rls ||
        row.app_is_superuser ||
        row.app_can_login
      ) {
        throw new Error("Disposable database or restricted erp_app role validation failed");
      }

      // Disposable public sentinels prove that search_path scoping neither
      // replaces nor writes similarly named pre-existing tables.
      await admin.query("CREATE TABLE public.customers (marker text PRIMARY KEY)");
      await admin.query("CREATE TABLE public.activities (marker text PRIMARY KEY)");
      await admin.query("INSERT INTO public.customers VALUES ('original-customer-table')");
      await admin.query("INSERT INTO public.activities VALUES ('original-activity-table')");
      const snapshot = await admin.query(`
        SELECT name, to_regclass(name)::oid::text AS oid
        FROM (VALUES ('public.customers'), ('public.activities')) AS relations(name)
        ORDER BY name
      `) as { rows: Array<{ name: string; oid: string | null }> };
      originalRelations = snapshot.rows;

      await admin.query(`CREATE SCHEMA ${quotedSchema}`);
      await admin.query(`
        CREATE TABLE ${quotedSchema}.customers (
          tenant_id integer NOT NULL DEFAULT current_setting('app.tenant_id')::integer,
          id serial PRIMARY KEY,
          customer_code text,
          name text NOT NULL,
          short_name text,
          email text,
          phone text,
          mobile text,
          contact_person text,
          sales_person text,
          address text,
          city text,
          country text,
          tax_id text,
          category text DEFAULT '一般客戶',
          created_at timestamptz NOT NULL DEFAULT now(),
          updated_at timestamptz NOT NULL DEFAULT now()
        )
      `);
      await admin.query(`
        CREATE TABLE ${quotedSchema}.activities (
          tenant_id integer NOT NULL DEFAULT current_setting('app.tenant_id')::integer,
          id serial PRIMARY KEY,
          type text NOT NULL,
          title text NOT NULL,
          description text NOT NULL CHECK (description NOT LIKE '%force-activity-failure%'),
          module text NOT NULL,
          created_at timestamptz NOT NULL DEFAULT now()
        )
      `);
      for (const table of ["customers", "activities"]) {
        await admin.query(`ALTER TABLE ${quotedSchema}.${table} ENABLE ROW LEVEL SECURITY`);
        await admin.query(`ALTER TABLE ${quotedSchema}.${table} FORCE ROW LEVEL SECURITY`);
        await admin.query(`
          CREATE POLICY tenant_isolation ON ${quotedSchema}.${table}
          USING (tenant_id = current_setting('app.tenant_id')::integer)
          WITH CHECK (tenant_id = current_setting('app.tenant_id')::integer)
        `);
      }
      await admin.query(`GRANT USAGE ON SCHEMA ${quotedSchema} TO erp_app`);
      await admin.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA ${quotedSchema} TO erp_app`);
      await admin.query(`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA ${quotedSchema} TO erp_app`);
    } finally {
      admin.release();
    }

    injected.transaction = transaction;
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      const sessionTenantId = Number(req.header("x-test-session-tenant"));
      if (req.header("x-test-auth") === "1") {
        (req as any).session = {
          user: {
            id: 1,
            role: "admin",
            ...(Number.isInteger(sessionTenantId) && sessionTenantId > 0
              ? { tenantId: sessionTenantId }
              : {}),
          },
        };
      }
      const tenantId = Number(req.header("x-test-tenant"));
      if (Number.isInteger(tenantId) && tenantId > 0) {
        tenantScope.run({ tenantId }, next);
      } else {
        next();
      }
    });
    app.use(customersRouter);
    server = await new Promise<Server>((resolve) => {
      const listening = app.listen(0, "127.0.0.1", () => resolve(listening));
    });
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Test server did not bind");
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    injected.transaction = null;
    if (server) {
      await new Promise<void>((resolve, reject) =>
        server.close(error => error ? reject(error) : resolve()),
      );
    }

    const admin = await pool.connect();
    try {
      await admin.query(`DROP SCHEMA IF EXISTS ${quotedSchema} CASCADE`);
      const snapshot = await admin.query(`
        SELECT name, to_regclass(name)::oid::text AS oid
        FROM (VALUES ('public.customers'), ('public.activities')) AS relations(name)
        ORDER BY name
      `) as { rows: Array<{ name: string; oid: string | null }> };
      expect(snapshot.rows).toEqual(originalRelations);
      const sentinels = await admin.query(`
        SELECT 'customers' AS name, marker FROM public.customers
        UNION ALL
        SELECT 'activities' AS name, marker FROM public.activities
        ORDER BY name
      `);
      expect(sentinels.rows).toEqual([
        { name: "activities", marker: "original-activity-table" },
        { name: "customers", marker: "original-customer-table" },
      ]);
    } finally {
      admin.release();
      await pool.end();
    }
  });

  it("returns INSERT RETURNING and creates the activity in the same tenant", async () => {
    const response = await postCustomer(tenantA, "Tenant A customer");
    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({
      tenantId: tenantA,
      name: "Tenant A customer",
      totalOrders: 0,
      totalSpent: 0,
    });

    await asTenant(tenantA, async client => {
      const customer = await client.query("SELECT tenant_id, name FROM customers");
      const activity = await client.query("SELECT tenant_id, title, description FROM activities");
      expect(customer.rows).toEqual([{ tenant_id: tenantA, name: "Tenant A customer" }]);
      expect(activity.rows).toEqual([{
        tenant_id: tenantA,
        title: "New Customer",
        description: "Tenant A customer added as customer",
      }]);
    });
  });

  it("rolls the customer back when its activity insert fails", async () => {
    const response = await postCustomer(tenantA, "force-activity-failure");
    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toMatchObject({ code: "DATABASE_ERROR" });

    await asTenant(tenantA, async client => {
      const result = await client.query(
        "SELECT count(*)::integer AS count FROM customers WHERE name = $1",
        ["force-activity-failure"],
      );
      expect(result.rows[0].count).toBe(0);
    });
  });

  it("isolates two tenants and rejects cross-tenant writes", async () => {
    const response = await postCustomer(tenantB, "Tenant B customer");
    expect(response.status).toBe(201);

    await asTenant(tenantB, async client => {
      const own = await client.query("SELECT name FROM customers ORDER BY name");
      expect(own.rows).toEqual([{ name: "Tenant B customer" }]);
      await expect(client.query(
        "INSERT INTO customers (tenant_id, name) VALUES ($1, $2)",
        [tenantA, "cross-tenant write"],
      )).rejects.toMatchObject({ code: "42501" });
    });

    await asTenant(tenantA, async client => {
      const other = await client.query(
        "SELECT name FROM customers WHERE tenant_id = $1",
        [tenantB],
      );
      expect(other.rows).toEqual([]);
    });

    await asTenant(tenantB, async client => {
      const hiddenUpdate = await client.query(
        "UPDATE customers SET name = $1 WHERE tenant_id = $2",
        ["cross-tenant update", tenantA],
      );
      const hiddenDelete = await client.query(
        "DELETE FROM customers WHERE tenant_id = $1",
        [tenantA],
      );
      expect(hiddenUpdate.rowCount).toBe(0);
      expect(hiddenDelete.rowCount).toBe(0);
    });

    await expect(asTenant(tenantB, client => client.query(
      "UPDATE customers SET tenant_id = $1 WHERE tenant_id = $2",
      [tenantA, tenantB],
    ))).rejects.toMatchObject({ code: "42501" });
  });

  it("rejects same-tenant duplicates (trimmed name, tax ID, code) but allows them across tenants", async () => {
    const post = (tenantId: number, body: Record<string, unknown>) => fetch(`${baseUrl}/customers`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-test-auth": "1", "x-test-tenant": String(tenantId), "x-test-session-tenant": String(tenantId) },
      body: JSON.stringify(body),
    });
    expect((await post(tenantA, { name: "  Dedup Co  ", taxId: " 22099131 ", customerCode: " DEDUP-1 " })).status).toBe(201);
    for (const [body, field] of [
      [{ name: "Dedup Co" }, "name"],
      [{ name: "Other Co", taxId: "22099131" }, "taxId"],
      [{ name: "Other Co", customerCode: "DEDUP-1" }, "customerCode"],
    ] as const) {
      const response = await post(tenantA, body);
      expect(response.status).toBe(409);
      expect(((await response.json()) as any).field).toBe(field);
    }
    expect((await post(tenantA, { name: "Bad Tax Co", taxId: "22099132" })).status).toBe(400);
    expect((await post(tenantB, { name: "Dedup Co", taxId: "22099131", customerCode: "DEDUP-1" })).status).toBe(201);
    await asTenant(tenantA, async client => {
      const rows = await client.query("SELECT name, tax_id, customer_code FROM customers WHERE tax_id = '22099131'");
      expect(rows.rows).toEqual([{ name: "Dedup Co", tax_id: "22099131", customer_code: "DEDUP-1" }]);
    });
  });

  it("fails closed when tenant context is missing", async () => {
    // Keep valid tenant-bound credentials while deliberately omitting the
    // AsyncLocalStorage context so this continues to exercise DB fail-closed.
    const response = await postCustomer(null, "missing context", tenantA);
    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toMatchObject({ code: "DATABASE_ERROR" });

    await expect(asTenant(null, client => client.query("SELECT * FROM customers")))
      .rejects.toSatisfy((error: QueryError) =>
        ["22P02", "42704"].includes(error.code ?? error.cause?.code ?? ""),
      );
  });
});