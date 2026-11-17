/**
 * Produce an explicitly reviewed, new-target-only Supabase migration.
 * No connections, secrets, production writes, or runtime imports.
 * Input is `drizzle-kit export` output, NOT an arbitrary migration.
 */
import assert from "node:assert/strict";

const excluded = new Set([
  "user_sessions", "insurance_brackets", "tenants", "credit_transactions",
  "admin_users", "account_recovery_tokens", "account_recovery_profiles", "api_keys",
]);
const quote = (name) => {
  assert.match(name, /^[a-z][a-z0-9_]*$/);
  return `"${name}"`;
};

export function buildSupabaseBootstrap(exportedSql) {
  assert.equal(typeof exportedSql, "string");
  assert.ok(!/(?:^|;)\s*(?:DROP|TRUNCATE|DELETE|INSERT|UPDATE)\b/im.test(exportedSql), "Only fresh schema exports accepted");
  const matches = [...exportedSql.matchAll(/CREATE TABLE "([a-z][a-z0-9_]*)" \(\n([\s\S]*?)\n\);/g)];
  assert.ok(matches.length > 0, "No exported tables");
  const names = matches.map((match) => match[1]);
  assert.equal(new Set(names).size, names.length, "Duplicate table names");
  const tables = matches.map((match) => ({
    name: match[1],
    columns: [...match[2].matchAll(/^[ \t]*"([a-z][a-z0-9_]*)"\s/gm)].map((column) => column[1]),
    tenantScoped: /^[ \t]*"tenant_id"\s/m.test(match[2]) && !excluded.has(match[1]),
  }));
  assert.ok(names.includes("ai_actions") && names.includes("ai_draft_documents"));
  // Drizzle describes AI policies, but other ERP policies are maintained separately.
  const exportedPolicies = new Set([...exportedSql.matchAll(/CREATE POLICY "tenant_isolation" ON "([a-z][a-z0-9_]*)"/g)].map((match) => match[1]));
  for (const name of exportedPolicies) {
    assert.ok(tables.find((table) => table.name === name)?.tenantScoped, "Unexpected exported policy");
  }
  const rlsSql = tables.map(({ name, tenantScoped }) => {
    const table = `public.${quote(name)}`;
    // Supabase event triggers may enable RLS on every new table. Preserve the
    // ERP's pre-login/shared-table semantics; client grants remain revoked.
    if (!tenantScoped) return `ALTER TABLE ${table} DISABLE ROW LEVEL SECURITY;`;
    const statements = [
      `ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY;`,
      `ALTER TABLE ${table} FORCE ROW LEVEL SECURITY;`,
    ];
    if (!exportedPolicies.has(name)) {
      statements.push(`CREATE POLICY tenant_isolation ON ${table} FOR ALL TO public USING (tenant_id = current_setting('app.tenant_id')::integer) WITH CHECK (tenant_id = current_setting('app.tenant_id')::integer);`);
    }
    return statements.join("\n");
  }).join("\n");
  const guard = `DO $bootstrap_guard$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('r','p','v','m','S','f'))
  THEN RAISE EXCEPTION 'Supabase bootstrap requires an empty public schema'; END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='erp_app')
  THEN RAISE EXCEPTION 'Existing erp_app role requires manual review'; END IF;
END $bootstrap_guard$;`;
  const permissions = `
CREATE ROLE erp_app NOLOGIN NOBYPASSRLS NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION;
GRANT erp_app TO postgres;
GRANT USAGE ON SCHEMA public TO erp_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO erp_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO erp_app;
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon, authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON TABLES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon, authenticated;`;
  return { tables, sql: `${guard}\n${exportedSql}\n${rlsSql}\n${permissions}\n` };
}
