import { pool, runtimeDatabaseProvider } from "@workspace/erp-db";

/** Explicit human-admin restore only, never startup or ordinary request handling.
 * Supabase enables RLS when tables are recreated; --no-acl also omits app grants.
 */
export const SUPABASE_RESTORE_ACCESS_SQL = `
DO $access$
DECLARE r record;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='erp_app'
      AND NOT rolbypassrls AND NOT rolsuper) THEN
    RAISE EXCEPTION 'Restricted application role required';
  END IF;
  FOR r IN
    SELECT c.relname AS name, EXISTS(
      SELECT 1 FROM pg_attribute a WHERE a.attrelid=c.oid
        AND a.attname='tenant_id' AND NOT a.attisdropped
    ) AS scoped
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relkind='r'
  LOOP
    IF r.scoped AND r.name NOT IN (
      'user_sessions','insurance_brackets','tenants','credit_transactions',
      'admin_users','account_recovery_tokens','account_recovery_profiles','api_keys'
    ) THEN
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',r.name);
      EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY',r.name);
      IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public'
          AND tablename=r.name AND policyname='tenant_isolation') THEN
        EXECUTE format('CREATE POLICY tenant_isolation ON public.%I USING
          (tenant_id = current_setting(''app.tenant_id'')::integer) WITH CHECK
          (tenant_id = current_setting(''app.tenant_id'')::integer)',r.name);
      ELSE
        EXECUTE format('ALTER POLICY tenant_isolation ON public.%I USING
          (tenant_id = current_setting(''app.tenant_id'')::integer) WITH CHECK
          (tenant_id = current_setting(''app.tenant_id'')::integer)',r.name);
      END IF;
    ELSIF r.name IN (
      'user_sessions','insurance_brackets','tenants','credit_transactions',
      'admin_users','account_recovery_tokens','account_recovery_profiles','api_keys'
    ) THEN
      EXECUTE format('ALTER TABLE public.%I DISABLE ROW LEVEL SECURITY',r.name);
    END IF;
  END LOOP;
END $access$;
GRANT USAGE ON SCHEMA public TO erp_app;
GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO erp_app;
GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA public TO erp_app;
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon,authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon,authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon,authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon,authenticated;
`;

export async function restoreSupabaseAccess() {
  if (runtimeDatabaseProvider() !== "supabase") throw new Error("External restore access requires Supabase");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(SUPABASE_RESTORE_ACCESS_SQL);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally { client.release(); }
}
