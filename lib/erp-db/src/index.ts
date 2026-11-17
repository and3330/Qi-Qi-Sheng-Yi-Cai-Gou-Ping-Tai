import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";
export type { PoolClient } from "pg";
import { AsyncLocalStorage } from "node:async_hooks";
import { randomBytes } from "node:crypto";
import * as schema from "./schema";
import { resolveRuntimeDatabaseUrl as resolveDatabaseUrl, runtimeDatabaseProvider } from "./runtime-connection.mjs";
import { sessionPoolOptions } from "./session-pool-options";
import { databasePhase, instrumentDatabasePool } from "./diagnostics";
export { resolveRuntimeDatabaseUrl as resolveDatabaseUrl, runtimeDatabaseProvider } from "./runtime-connection.mjs";

const { Pool } = pg;

/**
 * 七期網站：ERP 與商城共用同一個資料庫，ERP 的資料表放在獨立的 schema（預設 erp），
 * 不會跟商城 public 底下同名的資料表（suppliers、sales_orders…）互相干擾。
 * 每條連線一建立就設定 search_path，程式裡沒寫 schema 的 SQL 都會落在 erp。
 */
export const ERP_DB_SCHEMA = (process.env.ERP_DB_SCHEMA || "erp").replace(/[^a-z0-9_]/g, "") || "erp";
const SEARCH_PATH_SQL = `SET search_path TO "${ERP_DB_SCHEMA}", public`;
function withErpSearchPath(p: pg.Pool): pg.Pool {
  p.on("connect", (client) => {
    client.query(SEARCH_PATH_SQL).catch(() => { /* 連線壞掉時由下一個查詢回報錯誤 */ });
  });
  return p;
}

export const pool = withErpSearchPath(new Pool({
  connectionString: resolveDatabaseUrl(),
  ...(runtimeDatabaseProvider() === "supabase" ? { max: 4 } : {}),
}));
// Session writes must never queue behind account-row-lock holders in the
// business pool. Same resolver/database, separate bounded connection budget.
export const sessionPool = withErpSearchPath(new Pool({
  connectionString: resolveDatabaseUrl(),
  ...sessionPoolOptions(runtimeDatabaseProvider()),
}));
instrumentDatabasePool(pool, "owner");
instrumentDatabasePool(sessionPool, "session");

/** 未綁定租戶的原始連線（擁有者角色，會繞過 RLS，僅供啟動程序/全域表/登入前查詢使用） */
const baseDb = drizzle(pool, { schema });

type DB = NodePgDatabase<typeof schema>;

interface TenantContext {
  tenantId: number;
  db: DB;
  client: pg.PoolClient;
}

const tenantStorage = new AsyncLocalStorage<TenantContext>();

/**
 * 租戶專用連線池：使用不具 BYPASSRLS 的應用角色 erp_app 連線，RLS 才會真正生效。
 * （Neon 的資料庫擁有者角色天生帶有 BYPASSRLS，無法移除，因此必須以獨立角色連線。）
 * 密碼每次程序啟動時隨機重設，只存在記憶體中，不需要額外的 Secret。
 */
const APP_ROLE = "erp_app";
let appPoolPromise: Promise<pg.Pool> | null = null;

async function initAppPool(): Promise<pg.Pool> {
  if (runtimeDatabaseProvider() === "supabase") {
    // Role and grants are provisioned in an explicit external migration, never
    // startup DDL. Every lease assumes and verifies the restricted role below.
    return instrumentDatabasePool(withErpSearchPath(new Pool({ connectionString: resolveDatabaseUrl(), max: 8 })), "tenant");
  }
  const password = randomBytes(24).toString("base64url");
  const admin = await pool.connect();
  try {
    const { rows } = await admin.query("SELECT 1 FROM pg_roles WHERE rolname = $1", [APP_ROLE]);
    if (rows.length === 0) {
      await admin.query(`CREATE ROLE ${APP_ROLE} LOGIN NOBYPASSRLS NOCREATEDB NOCREATEROLE`);
    }
    await admin.query(`ALTER ROLE ${APP_ROLE} WITH LOGIN NOBYPASSRLS PASSWORD '${password.replace(/'/g, "''")}'`);
    // 權限授予（冪等）：現有與未來的資料表/序列
    // 七期網站：erp_app 只拿得到 ERP 自己的 schema，碰不到商城 public 底下的資料表
    const S = `"${ERP_DB_SCHEMA}"`;
    await admin.query(`GRANT USAGE ON SCHEMA ${S} TO ${APP_ROLE}`);
    await admin.query(`GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA ${S} TO ${APP_ROLE}`);
    await admin.query(`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA ${S} TO ${APP_ROLE}`);
    await admin.query(`ALTER DEFAULT PRIVILEGES IN SCHEMA ${S} GRANT ALL PRIVILEGES ON TABLES TO ${APP_ROLE}`);
    await admin.query(`ALTER DEFAULT PRIVILEGES IN SCHEMA ${S} GRANT USAGE, SELECT ON SEQUENCES TO ${APP_ROLE}`);
    await admin.query(`ALTER ROLE ${APP_ROLE} SET search_path TO ${S}, public`);
    // stripe-replit-sync 建立的 stripe schema（若存在）
    const stripeSchema = await admin.query("SELECT 1 FROM information_schema.schemata WHERE schema_name = 'stripe'");
    if (stripeSchema.rows.length > 0) {
      await admin.query(`GRANT USAGE ON SCHEMA stripe TO ${APP_ROLE}`);
      await admin.query(`GRANT SELECT ON ALL TABLES IN SCHEMA stripe TO ${APP_ROLE}`);
      await admin.query(`ALTER DEFAULT PRIVILEGES IN SCHEMA stripe GRANT SELECT ON TABLES TO ${APP_ROLE}`);
    }
  } finally {
    admin.release();
  }
  const url = new URL(resolveDatabaseUrl());
  url.username = APP_ROLE;
  url.password = password;
  const p = withErpSearchPath(new Pool({ connectionString: url.toString(), max: 20 }));
  instrumentDatabasePool(p, "tenant");
  // 驗證角色確實受 RLS 約束
  const probe = await p.connect();
  try {
    const { rows } = await probe.query("SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user");
    if (rows[0]?.rolbypassrls) throw new Error("erp_app role unexpectedly has BYPASSRLS — tenant isolation would be broken");
  } finally {
    probe.release();
  }
  return p;
}

export function getAppPool(): Promise<pg.Pool> {
  if (!appPoolPromise) {
    appPoolPromise = initAppPool().catch((e) => {
      appPoolPromise = null; // 允許重試
      throw e;
    });
  }
  return appPoolPromise;
}

/** 取得目前請求的租戶 ID（不在租戶上下文中回傳 null） */
export function currentTenantId(): number | null {
  return tenantStorage.getStore()?.tenantId ?? null;
}

/** 取得目前租戶綁定的 pg client（供需要跑 raw SQL 的程式使用，RLS 生效） */
export function currentTenantClient(): pg.PoolClient | null {
  return tenantStorage.getStore()?.client ?? null;
}

const VERIFY_ROLE_SQL = "SELECT current_user AS name, rolbypassrls, rolsuper FROM pg_roles WHERE rolname=current_user";

/** 租戶連線必須是受 RLS 約束的 erp_app；不是就拒絕使用這條連線 */
function assertRestrictedRole(rows: Array<{ name?: string; rolbypassrls?: boolean; rolsuper?: boolean }> | undefined): void {
  const role = rows?.[0];
  if (role?.name !== APP_ROLE || role?.rolbypassrls !== false || role?.rolsuper !== false) {
    throw new Error("Supabase tenant role is not restricted");
  }
}

/**
 * 在指定租戶的上下文中執行 fn：
 * 從 erp_app（受 RLS 約束）連線池取出專屬連線、設定 app.tenant_id，
 * 執行完畢後重設並歸還連線。`db` Proxy 會自動路由到這條租戶連線。
 */
export async function runWithTenant<T>(tenantId: number, fn: () => Promise<T>): Promise<T> {
  if (!Number.isInteger(tenantId) || tenantId <= 0) throw new Error(`Invalid tenantId: ${tenantId}`);
  const existing = tenantStorage.getStore();
  if (existing && existing.tenantId === tenantId) return fn();
  const appPool = await databasePhase("tenant_pool_init", () => getAppPool());
  const client = await appPool.connect();
  let unsafeRole = false;
  try {
    if (runtimeDatabaseProvider() === "supabase") {
      unsafeRole = true;
      // 切換角色、驗證角色、綁定租戶三件事一次送出，只花一趟網路往返。
      // 資料庫與主機不在同一個地區時，每一趟往返都很貴；原本分三次送，每個請求白白多等兩趟。
      // tenantId 在函式開頭已驗證是正整數，可以安全地直接寫進 SQL（多句一起送時不能用參數）。
      const batched: unknown = await databasePhase("tenant_setup", () => client.query(
        `SET ROLE erp_app; ${VERIFY_ROLE_SQL}; SELECT set_config('app.tenant_id', '${tenantId}', false) AS tenant`,
      ));
      if (Array.isArray(batched) && batched.length === 3) {
        assertRestrictedRole(batched[1]?.rows);
        if (batched[2]?.rows?.[0]?.tenant !== String(tenantId)) throw new Error("Tenant context was not applied");
      } else {
        // 連線層沒有照預期回傳三個結果時，退回逐步執行；驗證一樣會做，只是比較慢
        await databasePhase("tenant_role", () => client.query("SET ROLE erp_app"));
        const { rows } = await databasePhase("tenant_verify", () => client.query(VERIFY_ROLE_SQL));
        assertRestrictedRole(rows);
        await databasePhase("tenant_setup", () => client.query("SELECT set_config('app.tenant_id', $1, false)", [String(tenantId)]));
      }
      unsafeRole = false;
    } else {
      await databasePhase("tenant_setup", () => client.query("SELECT set_config('app.tenant_id', $1, false)", [String(tenantId)]));
    }
    const scopedDb = drizzle(client, { schema });
    return await tenantStorage.run({ tenantId, db: scopedDb, client }, fn);
  } finally {
    try { await databasePhase("tenant_reset", () => client.query("SELECT set_config('app.tenant_id', '', false)")); } catch { /* connection may be broken */ }
    client.release(unsafeRole);
  }
}

/**
 * Opt-in atomic composition of existing tenant routes. Binding the proxy to the
 * transaction is essential: their db.transaction calls must create SAVEPOINTs,
 * not issue another BEGIN/COMMIT on the same PostgreSQL client.
 */
export async function runInTenantTransaction<T>(fn: () => Promise<T>): Promise<T> {
  const context = tenantStorage.getStore();
  if (!context) throw new Error("Tenant context required");
  return context.db.transaction(async (tx) =>
    tenantStorage.run({ ...context, db: tx }, fn),
  );
}

/**
 * `db`：在租戶上下文中自動使用該租戶的隔離連線；否則使用未綁定連線。
 * 既有程式碼（routes/lib）無需修改即可獲得租戶隔離。
 */
export const db: DB = new Proxy(baseDb as any, {
  get(_target, prop, _receiver) {
    const active: any = tenantStorage.getStore()?.db ?? baseDb;
    const value = active[prop];
    return typeof value === "function" ? value.bind(active) : value;
  },
}) as DB;

export * from "./schema";
