import { AsyncLocalStorage } from "node:async_hooks";
import { performance } from "node:perf_hooks";

type Phase = "session_checkout" | "session_sql" | "owner_checkout" | "owner_sql"
  | "tenant_pool_init" | "tenant_checkout" | "tenant_role" | "tenant_verify"
  | "tenant_setup" | "tenant_sql" | "tenant_reset";
type Metric = { count: number; totalMs: number; maxMs: number; errors: number };
export type DatabaseTimings = {
  phases: Partial<Record<Phase, Metric>>;
  pools: Partial<Record<"session" | "owner" | "tenant", { total: number; idle: number; waiting: number }>>;
};
const storage = new AsyncLocalStorage<DatabaseTimings>();
const phaseStorage = new AsyncLocalStorage<Phase>();

export function databaseDiagnosticsEnabled() {
  return process.env.NODE_ENV === "development" || process.env.ERP_DB_DIAGNOSTICS === "1";
}

export function withDatabaseTimings<T>(timings: DatabaseTimings, fn: () => T): T {
  return storage.run(timings, fn);
}

function timer(phase: Phase) {
  const timings = storage.getStore();
  if (!timings) return (_error?: unknown) => {};
  const start = performance.now();
  let finished = false;
  return (error?: unknown) => {
    if (finished) return;
    finished = true;
    const elapsed = performance.now() - start;
    const metric = timings.phases[phase] ??= { count: 0, totalMs: 0, maxMs: 0, errors: 0 };
    metric.count++;
    metric.totalMs += elapsed;
    metric.maxMs = Math.max(metric.maxMs, elapsed);
    if (error) metric.errors++;
  };
}

export async function databasePhase<T>(phase: Phase, fn: () => Promise<T>): Promise<T> {
  const finish = timer(phase);
  try {
    return await phaseStorage.run(phase, fn);
  } catch (error) {
    finish(true);
    throw error;
  } finally {
    finish();
  }
}

/**
 * Observe pg without logging SQL/parameters/errors or changing return values.
 * Callback and Promise overloads are preserved; streamed Query objects pass through.
 * Checkout includes queueing + establishing a connection (not queueing alone).
 */
export function instrumentDatabasePool(pool: any, kind: "session" | "owner" | "tenant") {
  const checkout = pool.connect;
  pool.connect = function (...args: any[]) {
    const context = storage.getStore();
    if (!context) return checkout.apply(this, args);
    const snapshot = () => {
      const previous = context.pools[kind];
      context.pools[kind] = {
        total: Math.max(previous?.total ?? 0, pool.totalCount),
        idle: pool.idleCount,
        waiting: Math.max(previous?.waiting ?? 0, pool.waitingCount),
      };
    };
    const finish = timer(`${kind}_checkout`);
    const callback = args[0];
    try {
      if (typeof callback === "function") {
        args[0] = function (this: unknown, error: unknown, ...rest: any[]) {
          snapshot();
          finish(error);
          return callback.call(this, error, ...rest);
        };
        const result = checkout.apply(this, args);
        snapshot();
        return result;
      }
      const result = checkout.apply(this, args);
      snapshot();
      return result.then((client: unknown) => {
        snapshot(); finish(); return client;
      }, (error: unknown) => {
        snapshot(); finish(true); throw error;
      });
    } catch (error) {
      finish(true);
      throw error;
    }
  };
  pool.on("connect", (client: any) => {
    const query = client.query;
    client.query = function (...args: any[]) {
      if (!storage.getStore() || typeof args[0]?.submit === "function") {
        return query.apply(this, args);
      }
      const phase = phaseStorage.getStore();
      // Explicit tenant setup phases are already timed by databasePhase.
      const finish = phase && phase !== "tenant_sql"
        ? (_error?: unknown) => {} : timer(`${kind}_sql`);
      const index = typeof args.at(-1) === "function" ? args.length - 1 : -1;
      try {
        if (index >= 0) {
          const callback = args[index];
          args[index] = function (this: unknown, error: unknown, ...rest: any[]) {
            finish(error);
            return callback.call(this, error, ...rest);
          };
          return query.apply(this, args);
        }
        const result = query.apply(this, args);
        if (result && typeof result.then === "function") {
          return result.then((value: unknown) => { finish(); return value; },
            (error: unknown) => { finish(true); throw error; });
        }
        finish();
        return result;
      } catch (error) {
        finish(true);
        throw error;
      }
    };
  });
  return pool;
}
