// 在 drizzle push 之後重新套用租戶 RLS（drizzle push 會把 RLS 設定清掉）
// 冪等：可重複執行。
import pg from "pg";
import { resolveDatabaseUrl } from "../src/connection.mjs";

const EXCLUDED = new Set([
  "user_sessions",      // session store（無租戶概念）
  "insurance_brackets", // 全國勞健保級距（共用參考資料）
  "tenants",            // 租戶主檔（登入前需讀取）
  "credit_transactions",// 以程式碼過濾 tenant_id
  "admin_users",        // 登入前查詢，程式碼手動過濾
  "account_recovery_tokens", // pre-login capabilities; auth service enforces user + tenant
  "account_recovery_profiles", // pre-login recovery; auth service enforces user + tenant
  "api_keys",           // 驗證金鑰時查詢，程式碼手動過濾
]);

const pool = new pg.Pool({ connectionString: resolveDatabaseUrl() });
const client = await pool.connect();
try {
  const { rows } = await client.query(`
    SELECT c.relname AS table
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'r'
      AND EXISTS (
        SELECT 1 FROM information_schema.columns col
        WHERE col.table_schema = 'public' AND col.table_name = c.relname AND col.column_name = 'tenant_id'
      )
  `);
  await client.query("BEGIN");
  let applied = 0;
  for (const { table } of rows) {
    if (EXCLUDED.has(table)) continue;
    const t = client.escapeIdentifier ? client.escapeIdentifier(table) : `"${table}"`;
    await client.query(`ALTER TABLE ${t} ENABLE ROW LEVEL SECURITY`);
    await client.query(`ALTER TABLE ${t} FORCE ROW LEVEL SECURITY`);
    await client.query(`DROP POLICY IF EXISTS tenant_isolation ON ${t}`);
    await client.query(`
      CREATE POLICY tenant_isolation ON ${t}
      USING (tenant_id = (current_setting('app.tenant_id'::text))::integer)
      WITH CHECK (tenant_id = (current_setting('app.tenant_id'::text))::integer)
    `);
    applied++;
  }
  await client.query("COMMIT");
  console.log(`RLS applied to ${applied} tables`);
} catch (e) {
  await client.query("ROLLBACK").catch(() => {});
  console.error("apply-rls failed:", e.message);
  process.exit(1);
} finally {
  client.release();
  await pool.end();
}
