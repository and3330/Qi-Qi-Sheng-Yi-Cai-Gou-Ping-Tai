import { existsSync } from "node:fs";
import path from "node:path";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { pool, ERP_DB_SCHEMA } from "@workspace/erp-db";
import { logger } from "./logger";

/**
 * 七期網站：ERP 啟動時自己把資料表建好、補齊。
 *
 * 為什麼放在伺服器裡：Replit 正式環境是直接執行 `node dist/index.mjs`，
 * 而且 ERP 的資料表放在獨立的 schema（預設 erp），不在 Replit 發布時自動比對的範圍內。
 * 所以由伺服器啟動時依序套用 lib/erp-db/drizzle 底下的遷移檔，
 * 每個檔只會套用一次（紀錄在 erp.__drizzle_migrations）。
 *
 * ERP 的資料表結構之後有更新時：在 lib/erp-db 執行 `pnpm run generate` 產生新的遷移檔，
 * 一起提交，上線後就會自動套用。
 */

/** 沒有租戶概念、或登入前就要查的資料表，不套租戶隔離（與公司 ERP 的 apply-rls 相同） */
const RLS_EXCLUDED = new Set([
  "user_sessions", "insurance_brackets", "tenants", "credit_transactions", "admin_users",
  "account_recovery_tokens", "account_recovery_profiles", "api_keys", "__drizzle_migrations",
]);

function findMigrationsDir(): string | null {
  const entry = process.argv[1] ? path.dirname(path.resolve(process.argv[1])) : null;
  const candidates = [
    entry ? path.resolve(entry, "../../../lib/erp-db/drizzle") : null,
    path.resolve(process.cwd(), "lib/erp-db/drizzle"),
    path.resolve(process.cwd(), "../../lib/erp-db/drizzle"),
  ];
  for (const dir of candidates) {
    if (dir && existsSync(path.join(dir, "meta", "_journal.json"))) return dir;
  }
  return null;
}

/** 有 tenant_id 欄位的資料表一律強制租戶隔離（可重複執行） */
async function applyTenantRls(): Promise<number> {
  const client = await pool.connect();
  try {
    const { rows } = await client.query(
      `SELECT c.relname AS table, c.relrowsecurity AS enabled, c.relforcerowsecurity AS forced,
              EXISTS (SELECT 1 FROM pg_policies p WHERE p.schemaname = $1 AND p.tablename = c.relname AND p.policyname = 'tenant_isolation') AS has_policy
         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = $1 AND c.relkind = 'r'
          AND EXISTS (SELECT 1 FROM information_schema.columns col
                       WHERE col.table_schema = $1 AND col.table_name = c.relname AND col.column_name = 'tenant_id')`,
      [ERP_DB_SCHEMA],
    );
    const pending = rows.filter((r) => !RLS_EXCLUDED.has(r.table) && !(r.enabled && r.forced && r.has_policy));
    if (pending.length === 0) return 0;
    await client.query("BEGIN");
    try {
      for (const { table, has_policy } of pending) {
        const t = `"${ERP_DB_SCHEMA}"."${String(table).replace(/"/g, '""')}"`;
        await client.query(`ALTER TABLE ${t} ENABLE ROW LEVEL SECURITY`);
        await client.query(`ALTER TABLE ${t} FORCE ROW LEVEL SECURITY`);
        if (!has_policy) {
          await client.query(
            `CREATE POLICY tenant_isolation ON ${t}
               USING (tenant_id = (current_setting('app.tenant_id'::text))::integer)
               WITH CHECK (tenant_id = (current_setting('app.tenant_id'::text))::integer)`,
          );
        }
      }
      await client.query("COMMIT");
    } catch (e) {
      await client.query("ROLLBACK").catch(() => {});
      throw e;
    }
    return pending.length;
  } finally {
    client.release();
  }
}

export async function bootstrapErpSchema(): Promise<void> {
  if (process.env["SKIP_ERP_SCHEMA_BOOTSTRAP"] === "true") {
    logger.warn("已設定 SKIP_ERP_SCHEMA_BOOTSTRAP，略過 ERP 資料表檢查");
    return;
  }
  const dir = findMigrationsDir();
  if (!dir) throw new Error("找不到 lib/erp-db/drizzle，無法建立 ERP 資料表");
  const started = Date.now();
  await pool.query(`CREATE SCHEMA IF NOT EXISTS "${ERP_DB_SCHEMA}"`);
  await migrate(drizzle(pool), { migrationsFolder: dir, migrationsSchema: ERP_DB_SCHEMA, migrationsTable: "__drizzle_migrations" });
  const rls = await applyTenantRls();
  logger.info({ schema: ERP_DB_SCHEMA, rlsApplied: rls, ms: Date.now() - started }, "ERP 資料表已就緒");
}
