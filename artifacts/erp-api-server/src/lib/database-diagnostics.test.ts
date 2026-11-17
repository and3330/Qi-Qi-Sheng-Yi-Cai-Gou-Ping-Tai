import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import {
  databaseDiagnosticsEnabled, databasePhase, instrumentDatabasePool, withDatabaseTimings,
  type DatabaseTimings,
} from "@workspace/erp-db/diagnostics";

const context = (): DatabaseTimings => ({ phases: {}, pools: {} });
function fixture(kind: "tenant" | "session" = "tenant") {
  const client = {
    query: vi.fn((...args: any[]) => {
      const callback = args.at(-1);
      if (typeof callback === "function") {
        queueMicrotask(() => callback(null, { rows: [1] }));
        return undefined;
      }
      if (typeof args[0]?.submit === "function") return args[0];
      return Promise.resolve({ rows: [1] });
    }),
  };
  const pool = Object.assign(new EventEmitter(), {
    totalCount: 1, idleCount: 0, waitingCount: 2,
    connect: vi.fn((callback?: (...args: any[]) => void) => {
      if (callback) { queueMicrotask(() => callback(null, client, () => {})); return undefined; }
      return Promise.resolve(client);
    }),
  });
  instrumentDatabasePool(pool, kind);
  pool.emit("connect", client);
  return { pool, client };
}

describe("sanitized database timing observation", () => {
  it("records checkout and SQL separately without retaining sensitive arguments or results", async () => {
    const { pool, client } = fixture();
    const timings = context();
    await withDatabaseTimings(timings, async () => {
      expect(await pool.connect()).toBe(client);
      expect(await client.query("secret SQL", ["password", "customer"])).toEqual({ rows: [1] });
      await databasePhase("tenant_setup", () => client.query("sensitive setup"));
    });
    expect(timings.phases.tenant_checkout?.count).toBe(1);
    expect(timings.phases.tenant_sql?.count).toBe(1);
    expect(timings.phases.tenant_setup?.count).toBe(1);
    expect(timings.pools.tenant?.waiting).toBe(2);
    expect(JSON.stringify(timings)).not.toMatch(/secret|password|customer|sensitive/);
  });

  it("preserves pg callback checkout, release, query result and return value", async () => {
    const { pool, client } = fixture("session");
    const timings = context();
    await withDatabaseTimings(timings, () => new Promise<void>((resolve, reject) => {
      expect(pool.connect((error: unknown, leased: typeof client, release: () => void) => {
        if (error) { reject(error); return; }
        expect(leased).toBe(client);
        expect(typeof release).toBe("function");
        const returned = leased.query("private", (err: unknown, result: unknown) => {
          expect(err).toBeNull();
          expect(result).toEqual({ rows: [1] });
          release(); resolve();
        });
        expect(returned).toBeUndefined();
      })).toBeUndefined();
    }));
    expect(timings.phases.session_checkout?.count).toBe(1);
    expect(timings.phases.session_sql?.count).toBe(1);
  });

  it("does not share request contexts or collect outside a request", async () => {
    const { client } = fixture();
    await client.query("outside");
    const a = context(), b = context();
    await Promise.all([
      withDatabaseTimings(a, () => client.query("A")),
      withDatabaseTimings(b, () => client.query("B")),
    ]);
    expect(a.phases.tenant_sql?.count).toBe(1);
    expect(b.phases.tenant_sql?.count).toBe(1);
  });

  it("propagates errors unchanged and records only error counts", async () => {
    const timings = context();
    const error = new Error("password and connection string must never be recorded");
    await expect(withDatabaseTimings(timings, () =>
      databasePhase("tenant_role", () => Promise.reject(error)))).rejects.toBe(error);
    expect(timings.phases.tenant_role?.errors).toBe(1);
    expect(timings.phases.tenant_role?.count).toBe(1);
    expect(JSON.stringify(timings)).not.toContain("password");
  });

  it("leaves streaming query objects untouched", () => {
    const { client } = fixture();
    const query = { submit() {} };
    expect(withDatabaseTimings(context(), () => client.query(query))).toBe(query);
  });

  it("defaults production off; development on; production requires explicit opt-in", () => {
    const oldNode = process.env.NODE_ENV, oldFlag = process.env.ERP_DB_DIAGNOSTICS;
    try {
      process.env.NODE_ENV = "production"; delete process.env.ERP_DB_DIAGNOSTICS;
      expect(databaseDiagnosticsEnabled()).toBe(false);
      process.env.NODE_ENV = "development";
      expect(databaseDiagnosticsEnabled()).toBe(true);
      process.env.NODE_ENV = "production"; process.env.ERP_DB_DIAGNOSTICS = "1";
      expect(databaseDiagnosticsEnabled()).toBe(true);
    } finally {
      if (oldNode === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = oldNode;
      if (oldFlag === undefined) delete process.env.ERP_DB_DIAGNOSTICS; else process.env.ERP_DB_DIAGNOSTICS = oldFlag;
    }
  });
});
