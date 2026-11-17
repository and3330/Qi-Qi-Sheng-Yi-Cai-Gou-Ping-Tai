// Explicit operator-only destructive tool. Never import the application's DB initializer.
import pg from "pg";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";

const dbRoot = path.resolve(import.meta.dirname, "..");
const requireApi = createRequire(path.resolve(dbRoot, "../../artifacts/api-server/package.json"));
const bcrypt = requireApi("bcryptjs");
const quote = (value) => `"${value.replaceAll('"', '""')}"`;
const fail = (message) => { throw new Error(message); };
let client;
let stage = "guard";
try {
  const args = process.argv.slice(2);
  if (args.length !== 3 || args[0] !== "--confirm-empty-development" ||
      args[1] !== "--verification-token" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(args[2])) {
    fail("explicit confirmation and UUID verification token required");
  }
  // REPLIT_ENVIRONMENT is an undocumented host value, not a deployment signal.
  // Development intent and the locked platform-written marker remain mandatory.
  if (process.env.NODE_ENV !== "development" ||
      Object.keys(process.env).some((key) => key.startsWith("REPLIT_DEPLOYMENT") && process.env[key])) fail("development only");
  if (!process.env.DATABASE_URL) fail("managed DATABASE_URL required");
  const url = new URL(process.env.DATABASE_URL);
  if (!["postgres:", "postgresql:"].includes(url.protocol)) fail("invalid database protocol");
  if (!process.env.BOOTSTRAP_ADMIN_PASSWORD ||
      Buffer.byteLength(process.env.BOOTSTRAP_ADMIN_PASSWORD) > 72) fail("bootstrap password required (maximum 72 bytes)");

  // Schema export is offline: never load drizzle.config.ts or inherit database credentials.
  stage = "offline schema export";
  const exportEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
    !key.startsWith("PG") && !/(DATABASE|PASSWORD|SECRET|TOKEN|KEY)/i.test(key)));
  const result = spawnSync("pnpm", ["exec", "drizzle-kit", "export", "--dialect=postgresql",
    "--schema=./src/schema/index.ts"], {
    cwd: dbRoot, env: exportEnv, encoding: "utf8", maxBuffer: 16 * 1024 * 1024,
  });
  if (result.status !== 0 || !result.stdout.startsWith("CREATE TABLE ")) fail("offline export failed");
  const schemaSql = result.stdout;
  const tables = [...schemaSql.matchAll(/^CREATE TABLE "(?:(?:public)"\.")?([^"]+)" \(/gm)].map((m) => m[1]).sort();
  if (new Set(tables).size !== tables.length ||
      !["tenants", "admin_users", "user_sessions"].every((t) => tables.includes(t))) fail("unexpected schema export");
  // user_sessions is already in the current Drizzle export (connect-pg-simple schema).
  // Reuse the canonical exclusions without executing apply-rls.mjs (it opens its own connection).
  const rlsSource = await readFile(path.join(dbRoot, "scripts/apply-rls.mjs"), "utf8");
  const exclusionBlock = rlsSource.match(/const EXCLUDED = new Set\(\[([\s\S]*?)\]\);/);
  if (!exclusionBlock || !rlsSource.includes("current_setting('app.tenant_id'::text)")) fail("RLS source changed; review required");
  const excluded = new Set([...exclusionBlock[1].matchAll(/^\s*"([^"]+)"/gm)].map((m) => m[1]));
  if (!excluded.has("tenants") || !excluded.has("admin_users")) fail("RLS exclusions changed");
  stage = "password hashing";
  const hash = await bcrypt.hash(process.env.BOOTSTRAP_ADMIN_PASSWORD, 12);

  // This is the ONLY connection source. No arguments, PG fallback, or runtime imports.
  stage = "managed source verification";
  client = new pg.Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 15000 });
  await client.connect();
  await client.query("BEGIN");
  await client.query("SET LOCAL lock_timeout = '10s'");
  await client.query("SET LOCAL statement_timeout = '120s'");
  await client.query("SET LOCAL search_path = public, pg_catalog");
  await client.query("SELECT pg_advisory_xact_lock(83483621, 1)");
  await client.query("LOCK TABLE public.replit_reset_verification IN ACCESS EXCLUSIVE MODE");
  const marker = await client.query("SELECT token::text FROM public.replit_reset_verification");
  if (marker.rows.length !== 1 || marker.rows[0].token !== args[2]) fail("verification mismatch");
  stage = "catalog safety checks";
  const existing = await client.query(`SELECT c.relname, c.relkind FROM pg_class c
    JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relkind IN ('r','p','v','m','f') ORDER BY c.relname`);
  if (existing.rows.some((r) => r.relkind !== "r" ||
      (!tables.includes(r.relname) && r.relname !== "replit_reset_verification"))) fail("unexpected public relations");
  const roles = await client.query("SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname='erp_app'");
  if (roles.rows.some((r) => r.rolsuper || r.rolbypassrls)) fail("unsafe existing application role");
  // Explicit multi-table RESTRICT drop: internal FKs are handled together; any external
  // schema/view/extension dependencies abort, rather than cascading into stripe/metadata.
  stage = "transactional replacement";
  await client.query(`DROP TABLE ${existing.rows.map((r) => `public.${quote(r.relname)}`).join(", ")} RESTRICT`);
  await client.query(schemaSql);
  await client.query("SET LOCAL app.tenant_id = '1'");
  await client.query(`INSERT INTO public.tenants
    (name, company_code, status, is_exempt, ai_credits)
    VALUES ('主公司', '83483621', 'active', true, 0)`);
  await client.query(`INSERT INTO public.admin_users
    (tenant_id, username, password_hash, display_name, role, is_active)
    VALUES (1, 'andy', $1, 'andy', 'owner', true)`, [hash]);
  stage = "RLS and application grants";
  if (!roles.rows.length) {
    await client.query("CREATE ROLE erp_app NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOINHERIT");
  }
  await client.query("GRANT USAGE ON SCHEMA public TO erp_app");
  await client.query("GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO erp_app");
  await client.query("GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO erp_app");
  const tenantTables = await client.query(`SELECT table_name FROM information_schema.columns
    WHERE table_schema='public' AND column_name='tenant_id' ORDER BY table_name`);
  let policies = 0;
  for (const { table_name: table } of tenantTables.rows) {
    if (excluded.has(table)) continue;
    await client.query(`ALTER TABLE public.${quote(table)} ENABLE ROW LEVEL SECURITY`);
    await client.query(`ALTER TABLE public.${quote(table)} FORCE ROW LEVEL SECURITY`);
    await client.query(`CREATE POLICY tenant_isolation ON public.${quote(table)}
      USING (tenant_id = (current_setting('app.tenant_id'::text))::integer)
      WITH CHECK (tenant_id = (current_setting('app.tenant_id'::text))::integer)`);
    policies++;
  }
  stage = "precommit validation";
  const finalTables = await client.query(`SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename`);
  if (JSON.stringify(finalTables.rows.map((r) => r.tablename)) !== JSON.stringify(tables)) fail("table set mismatch");
  for (const table of tables) {
    // row_security=off makes unexpected RLS filtering fail rather than hide leftover rows.
    await client.query("SET LOCAL row_security = off");
    const { rows } = await client.query(`SELECT count(*)::int AS n FROM public.${quote(table)}`);
    if (rows[0].n !== (["tenants", "admin_users"].includes(table) ? 1 : 0)) fail("nonempty business table");
  }
  const tenant = await client.query(`SELECT 1 FROM public.tenants WHERE id=1 AND name='主公司'
    AND company_code='83483621' AND status='active' AND is_exempt=true AND ai_credits=0
    AND stripe_customer_id IS NULL AND stripe_subscription_id IS NULL AND trial_ends_at IS NULL`);
  const admin = await client.query(`SELECT password_hash FROM public.admin_users WHERE id=1
    AND tenant_id=1 AND username='andy' AND role='owner' AND is_active=true AND employee_id IS NULL`);
  if (tenant.rowCount !== 1 || admin.rowCount !== 1 ||
      !await bcrypt.compare(process.env.BOOTSTRAP_ADMIN_PASSWORD, admin.rows[0].password_hash)) fail("identity mismatch");
  const protections = await client.query(`SELECT count(*)::int AS n FROM pg_class c
    JOIN pg_namespace n ON n.oid=c.relnamespace
    JOIN pg_policy p ON p.polrelid=c.oid AND p.polname='tenant_isolation'
    WHERE n.nspname='public' AND c.relrowsecurity AND c.relforcerowsecurity`);
  if (protections.rows[0].n !== policies) fail("RLS validation failed");
  await client.query("COMMIT");
  console.log(`Development reset committed: ${tables.length} current-schema tables; one tenant, one owner; all other tables empty; ${policies} forced RLS policies. Verification marker consumed.`);
} catch {
  if (client) await client.query("ROLLBACK").catch(() => {});
  // Deliberately never expose driver messages, connection strings, query parameters or hashes.
  console.error(`Development reset refused or rolled back at stage: ${stage}. No diagnostic secrets emitted.`);
  process.exitCode = 1;
} finally {
  if (client) await client.end().catch(() => {});
}