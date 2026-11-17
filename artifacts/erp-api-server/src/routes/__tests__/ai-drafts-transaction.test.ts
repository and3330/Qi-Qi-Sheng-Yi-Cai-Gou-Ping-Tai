import { describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";

const fake = vi.hoisted(() => ({ queries: [] as string[] }));
// No database sockets: exercise the real Drizzle transaction/savepoint and ALS
// adapter against a recording pg client, not a transaction implementation mock.
vi.mock("../../../../../lib/erp-db/src/connection.mjs", () => ({
  resolveDatabaseUrl: () => "postgresql://test:test@invalid.example/test",
}));
vi.mock("../../../../../lib/erp-db/node_modules/pg/esm/index.mjs", () => {
  class Pool {
    // The real pg Pool is an EventEmitter; the timing diagnostics subscribe to "connect".
    on() { return this; }
    async connect() {
      return {
        release() {},
        async query(query: string | { text: string }) {
          const text = typeof query === "string" ? query : query.text;
          fake.queries.push(text);
          if (text.includes("FROM pg_roles WHERE rolname = $1")) return { rows: [{ rolname: "erp_app" }] };
          if (text.includes("rolbypassrls")) return { rows: [{ rolbypassrls: false }] };
          return { rows: [] };
        },
      };
    }
  }
  return { default: { Pool } };
});

import { currentTenantId, db, runInTenantTransaction, runWithTenant } from "../../../../../lib/erp-db/src";

describe("opt-in tenant transaction adapter (no network)", () => {
  it("fails closed without tenant context", async () => {
    await expect(runInTenantTransaction(async () => 1)).rejects.toThrow("Tenant context required");
  });

  it("uses savepoints for unchanged route transactions and restores outer scope", async () => {
    await runWithTenant(7, async () => {
      fake.queries.length = 0;
      await runInTenantTransaction(async () => {
        expect(currentTenantId()).toBe(7);
        await db.execute(sql`select 'locked draft'`);
        await db.transaction(async tx => { await tx.execute(sql`select 'create route'`); });
        await db.execute(sql`select 'confirmed update'`);
      });
      expect(fake.queries).toEqual([
        "begin", "select 'locked draft'", "savepoint sp1",
        "select 'create route'", "release savepoint sp1", "select 'confirmed update'", "commit",
      ]);
      fake.queries.length = 0;
      await db.transaction(async tx => { await tx.execute(sql`select 'normal route'`); });
      expect(fake.queries).toEqual(["begin", "select 'normal route'", "commit"]);
    });
    expect(currentTenantId()).toBeNull();
  });

  it("keeps the outer lock transaction until failure rolls back all route writes", async () => {
    await runWithTenant(7, async () => {
      fake.queries.length = 0;
      await expect(runInTenantTransaction(async () => {
        await db.transaction(async tx => { await tx.execute(sql`select 'created'`); });
        throw new Error("confirmation failed");
      })).rejects.toThrow("confirmation failed");
      expect(fake.queries).toEqual([
        "begin", "savepoint sp1", "select 'created'", "release savepoint sp1", "rollback",
      ]);
    });
  });
});
