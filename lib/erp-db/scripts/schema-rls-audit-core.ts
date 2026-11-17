import { createHash } from "node:crypto";
import { resolveDatabaseUrl } from "../src/connection.mjs";
import { is } from "drizzle-orm";
import { getTableConfig, PgTable } from "drizzle-orm/pg-core";

export const AUDIT_FORMAT = "erp-schema-rls-audit/v1";
export const RLS_EXCLUDED_TABLES = new Set([
  "user_sessions",
  "insurance_brackets",
  "tenants",
  "credit_transactions",
  "admin_users",
  "account_recovery_tokens",
  "account_recovery_profiles",
  "api_keys",
]);
export const REQUIRED_OPERATION_TABLES = [
  "ecpay_invoice_allowances",
  "ecpay_invoice_issue_requests",
] as const;

/*
 * This is deliberately one read-only SELECT so it can be pasted unchanged into
 * the platform executeSql production reader.  Its result contains only public
 * catalog metadata.  The md5 is an identity for that metadata snapshot, not for
 * a database, server, credential, or permission to publish.
 */
export const PUBLIC_CATALOG_AUDIT_SQL = String.raw`
WITH
tables AS (
  SELECT c.oid, c.relname AS name, c.relrowsecurity AS rls, c.relforcerowsecurity AS force_rls
  FROM pg_catalog.pg_class c
  JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
),
columns AS (
  SELECT t.name AS table_name, a.attname AS name,
         pg_catalog.format_type(a.atttypid, a.atttypmod) AS type,
         a.attnotnull AS not_null,
         CASE
           WHEN d.adbin IS NULL THEN NULL
           WHEN regexp_replace(lower(pg_catalog.pg_get_expr(d.adbin, d.adrelid)),
                  '[[:space:]()]', '', 'g')
                = 'current_setting''app.tenant_id''::text::integer'
             THEN 'tenant-current-setting'
           ELSE 'other'
         END AS default_expr,
         CASE WHEN d.adbin IS NULL THEN NULL
              ELSE md5(pg_catalog.pg_get_expr(d.adbin, d.adrelid)) END AS default_digest
  FROM tables t
  JOIN pg_catalog.pg_attribute a ON a.attrelid = t.oid AND a.attnum > 0 AND NOT a.attisdropped
  LEFT JOIN pg_catalog.pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
),
policies AS (
  SELECT schemaname, tablename AS table_name, policyname AS name, permissive, roles, cmd,
         qual AS using_expr, with_check AS check_expr
  FROM pg_catalog.pg_policies
  WHERE schemaname = 'public'
),
unique_keys AS (
  SELECT t.name AS table_name, i.relname AS name, x.indisprimary AS is_primary,
         x.indpred IS NOT NULL AS partial, x.indexprs IS NOT NULL AS expression,
         x.indnatts > x.indnkeyatts AS has_include,
         CASE WHEN x.indpred IS NULL THEN NULL
              ELSE md5(pg_catalog.pg_get_expr(x.indpred, x.indrelid)) END AS predicate_digest,
         ARRAY(
           SELECT a.attname
           FROM unnest(x.indkey::smallint[]) WITH ORDINALITY k(attnum, ordinality)
           JOIN pg_catalog.pg_attribute a ON a.attrelid = t.oid AND a.attnum = k.attnum
           WHERE k.ordinality <= x.indnkeyatts
           ORDER BY k.ordinality
         ) AS columns
  FROM tables t
  JOIN pg_catalog.pg_index x ON x.indrelid = t.oid AND x.indisunique AND x.indisvalid
  JOIN pg_catalog.pg_class i ON i.oid = x.indexrelid
),
doc AS (
  SELECT jsonb_build_object(
    'format', 'erp-public-catalog/v1',
    'tables', COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'name', name, 'rls', rls, 'forceRls', force_rls
    ) ORDER BY name) FROM tables), '[]'::jsonb),
    'columns', COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'table', table_name, 'name', name, 'type', type, 'notNull', not_null,
      'default', default_expr, 'defaultDigest', default_digest
    ) ORDER BY table_name, name) FROM columns), '[]'::jsonb),
    'policies', COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'table', table_name, 'name', name, 'permissive', permissive, 'roles', roles,
      'command', cmd, 'using', using_expr, 'check', check_expr
    ) ORDER BY table_name, name) FROM policies), '[]'::jsonb),
    'uniqueKeys', COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'table', table_name, 'name', name, 'columns', columns, 'primary', is_primary,
      'partial', partial, 'expression', expression, 'hasInclude', has_include,
      'predicateDigest', predicate_digest
    ) ORDER BY table_name, name) FROM unique_keys), '[]'::jsonb),
    'erpAppRole', COALESCE((SELECT jsonb_build_object(
      'exists', true, 'superuser', rolsuper, 'bypassRls', rolbypassrls
    ) FROM pg_catalog.pg_roles WHERE rolname = 'erp_app'),
    jsonb_build_object('exists', false, 'superuser', false, 'bypassRls', false))
  ) AS value
)
SELECT 'erp-public-catalog-fingerprint/v1' AS format,
       md5(value::text) AS fingerprint,
       value AS catalog
FROM doc
`.trim();

export type ExpectedColumn = { name: string; type: string; notNull: boolean };
export type ExpectedTable = {
  name: string;
  columns: ExpectedColumn[];
  tenantScoped: boolean;
  tenantDefaultRequired: boolean;
  uniqueKeys: Array<{ columns: string[]; primary: boolean; partial: boolean }>;
};
export type ExpectedSchema = { tables: ExpectedTable[]; sourceFingerprint: string };

type Catalog = {
  format: string;
  tables: Array<{ name: string; rls: boolean; forceRls: boolean }>;
  columns: Array<{
    table: string; name: string; type: string; notNull: boolean;
    default: string | null; defaultDigest?: string | null;
  }>;
  policies: Array<{
    table: string; name: string; permissive: string | boolean; roles: string[];
    command: string; using: string | null; check: string | null;
  }>;
  uniqueKeys: Array<{
    table: string; name: string; columns: string[]; primary?: boolean;
    partial?: boolean; expression?: boolean; hasInclude?: boolean; predicateDigest?: string | null;
  }>;
  erpAppRole: { exists: boolean; superuser: boolean; bypassRls: boolean };
};
export type CatalogSnapshot = {
  format: string;
  fingerprint: string;
  catalog: Catalog;
};
export type AuditResult = {
  ok: boolean;
  format: typeof AUDIT_FORMAT;
  catalogFingerprint: string;
  schemaSourceFingerprint: string;
  issues: string[];
  notice: string;
};

const normalizedType = (value: string) => value.toLowerCase()
  .replace(/^serial$/, "integer")
  .replace(/^bigserial$/, "bigint")
  .replace(/^smallserial$/, "smallint")
  .replace(/^varchar/, "character varying")
  .replace(/\s+/g, " ")
  .replace(/\s*,\s*/g, ",")
  .replace(/\s+\(/g, "(")
  .replace(/\(\s+/g, "(")
  .replace(/\s+\)/g, ")")
  .trim()
  .replace(/^timestamp(\(\d+\))?$/, "timestamp$1 without time zone")
  .replace(/^time(\(\d+\))?$/, "time$1 without time zone");

function uniqueKeyColumns(config: ReturnType<typeof getTableConfig>): ExpectedTable["uniqueKeys"] {
  const result: ExpectedTable["uniqueKeys"] = [];
  for (const key of config.primaryKeys) result.push({ columns: key.columns.map((column) => column.name), primary: true, partial: false });
  for (const key of config.uniqueConstraints) result.push({ columns: key.columns.map((column) => column.name), primary: false, partial: false });
  for (const index of config.indexes) {
    if (!index.config.unique) continue;
    const names = index.config.columns.map((column) => "name" in column ? column.name : undefined);
    if (names.every((name): name is string => Boolean(name))) {
      result.push({ columns: names, primary: false, partial: Boolean(index.config.where) });
    }
  }
  for (const column of config.columns) {
    if (column.isUnique) result.push({ columns: [column.name], primary: false, partial: false });
    if (column.primary) result.push({ columns: [column.name], primary: true, partial: false });
  }
  return dedupeKeys(result);
}

const dedupeKeys = (keys: ExpectedTable["uniqueKeys"]) =>
  [...new Map(keys.map((key) => [`${key.primary}:${key.partial}:${key.columns.join("\0")}`, key])).values()]
    .sort((a, b) => a.columns.join("\0").localeCompare(b.columns.join("\0")));

export function expectedSchemaFromExports(schemaExports: Record<string, unknown>): ExpectedSchema {
  const found = new Map<string, ExpectedTable>();
  for (const value of Object.values(schemaExports)) {
    if (!is(value, PgTable)) continue;
    const config = getTableConfig(value);
    if (found.has(config.name)) continue;
    const tenant = config.columns.find((column) => column.name === "tenant_id");
    const tenantScoped = Boolean(tenant) && !RLS_EXCLUDED_TABLES.has(config.name);
    found.set(config.name, {
      name: config.name,
      columns: config.columns.map((column) => ({
        name: column.name,
        type: normalizedType(column.getSQLType()),
        notNull: column.notNull,
      })).sort((a, b) => a.name.localeCompare(b.name)),
      tenantScoped,
      tenantDefaultRequired: tenantScoped && typeof tenant?.default === "object",
      uniqueKeys: uniqueKeyColumns(config),
    });
  }
  const tables = [...found.values()].sort((a, b) => a.name.localeCompare(b.name));
  const sourceFingerprint = createHash("sha256").update(JSON.stringify(tables)).digest("hex");
  return { tables, sourceFingerprint };
}

function isTenantExpression(value: string | null): boolean {
  if (!value) return false;
  const compact = value.toLowerCase().replace(/[\s()]/g, "");
  return compact === "tenant_id=current_setting'app.tenant_id'::text::integer";
}

function hasCurrentTenantDefault(value: string | null): boolean {
  return value === "tenant-current-setting";
}

const sameColumns = (a: string[], b: string[]) =>
  a.length === b.length && a.every((value, index) => value === b[index]);

export function auditSnapshot(expected: ExpectedSchema, snapshot: CatalogSnapshot): AuditResult {
  const issues: string[] = [];
  const catalog = snapshot?.catalog;
  if (snapshot?.format !== "erp-public-catalog-fingerprint/v1"
      || !/^[a-f0-9]{32}$/.test(snapshot?.fingerprint ?? "")
      || catalog?.format !== "erp-public-catalog/v1"
      || !Array.isArray(catalog.tables) || !Array.isArray(catalog.columns)) {
    issues.push("legacy or unsupported catalog snapshot format");
    return result(expected, snapshot?.fingerprint ?? "unavailable", issues);
  }

  const actualTables = new Map(catalog.tables.map((table) => [table.name, table]));
  const actualColumns = new Map(catalog.columns.map((column) => [`${column.table}\0${column.name}`, column]));
  for (const table of expected.tables) {
    const actualTable = actualTables.get(table.name);
    if (!actualTable) {
      issues.push(`missing table: public.${table.name}`);
      continue;
    }
    for (const column of table.columns) {
      const actual = actualColumns.get(`${table.name}\0${column.name}`);
      if (!actual) {
        issues.push(`missing column: public.${table.name}.${column.name}`);
      } else {
        if (normalizedType(actual.type) !== column.type) issues.push(`column type mismatch: public.${table.name}.${column.name}`);
        if (actual.notNull !== column.notNull) issues.push(`column nullability mismatch: public.${table.name}.${column.name}`);
      }
    }
    if (!table.tenantScoped) continue;
    const tenantColumn = actualColumns.get(`${table.name}\0tenant_id`);
    if (!tenantColumn || normalizedType(tenantColumn.type) !== "integer" || !tenantColumn.notNull) {
      issues.push(`unsafe tenant column: public.${table.name}.tenant_id`);
    } else if (table.tenantDefaultRequired && !hasCurrentTenantDefault(tenantColumn.default)) {
      issues.push(`tenant default mismatch: public.${table.name}.tenant_id`);
    }
    if (!actualTable.rls || !actualTable.forceRls) issues.push(`RLS not enabled and forced: public.${table.name}`);

    const policies = catalog.policies.filter((policy) => policy.table === table.name);
    if (policies.length !== 1) issues.push(`unexpected policy count: public.${table.name}`);
    const policy = policies.find((item) => item.name === "tenant_isolation");
    const permissive = policy?.permissive === true || policy?.permissive === "PERMISSIVE";
    const publicOnly = policy?.roles?.length === 1 && policy.roles[0].toLowerCase() === "public";
    if (!policy || !permissive || !publicOnly || policy.command !== "ALL"
        || !isTenantExpression(policy.using) || !isTenantExpression(policy.check)) {
      issues.push(`unsafe tenant policy: public.${table.name}`);
    }

    const actualKeys = catalog.uniqueKeys.filter((key) => key.table === table.name);
    for (const key of table.uniqueKeys) {
      if (!actualKeys.some((actual) =>
        !actual.expression && !actual.hasInclude
        && Boolean(actual.primary) === key.primary
        && Boolean(actual.partial) === key.partial
        && sameColumns(actual.columns, key.columns))) {
        issues.push(`missing unique key: public.${table.name}(${key.columns.join(",")})`);
      }
    }
    for (const actual of actualKeys) {
      if (actual.primary && sameColumns(actual.columns, ["id"])) continue;
      const expectedExact = table.uniqueKeys.some((key) =>
        key.primary === Boolean(actual.primary) && key.partial === Boolean(actual.partial)
        && sameColumns(key.columns, actual.columns));
      if (!expectedExact && table.tenantScoped && !actual.columns.includes("tenant_id")) {
        issues.push(`unexpected global unique key: public.${table.name}(${actual.columns.join(",")})`);
      }
    }
  }
  for (const operationTable of REQUIRED_OPERATION_TABLES) {
    if (!actualTables.has(operationTable)) issues.push(`missing operation table: public.${operationTable}`);
  }
  if (!catalog.erpAppRole?.exists) issues.push("required role missing: erp_app");
  else if (catalog.erpAppRole.superuser || catalog.erpAppRole.bypassRls) issues.push("unsafe role attributes: erp_app");
  return result(expected, snapshot.fingerprint, [...new Set(issues)].sort());
}

function result(expected: ExpectedSchema, fingerprint: string, issues: string[]): AuditResult {
  return {
    ok: issues.length === 0,
    format: AUDIT_FORMAT,
    catalogFingerprint: fingerprint,
    schemaSourceFingerprint: expected.sourceFingerprint,
    issues,
    notice: "Matching fingerprints do not prove database identity or authorization to publish.",
  };
}

export type ConnectionSource = "auto" | "pg" | "url";

export function connectionConfig(env: NodeJS.ProcessEnv, source: ConnectionSource = "auto"): Record<string, unknown> {
  if (source === "auto") {
    return {
      connectionString: resolveDatabaseUrl(env),
      application_name: "erp_schema_rls_audit",
      options: "-c default_transaction_read_only=on -c statement_timeout=15000 -c lock_timeout=3000",
    };
  }
  if (source !== "url" && env.PGHOST && env.PGUSER && env.PGPASSWORD && env.PGDATABASE) {
    return {
      host: env.PGHOST,
      port: env.PGPORT ? Number(env.PGPORT) : 5432,
      user: env.PGUSER,
      password: env.PGPASSWORD,
      database: env.PGDATABASE,
      ssl: env.PGSSLMODE === "disable" ? false : { rejectUnauthorized: false },
      application_name: "erp_schema_rls_audit",
      options: "-c default_transaction_read_only=on -c statement_timeout=15000 -c lock_timeout=3000",
    };
  }
  if (source !== "pg" && env.DATABASE_URL) {
    return {
      connectionString: resolveDatabaseUrl({ DATABASE_URL: env.DATABASE_URL }),
      application_name: "erp_schema_rls_audit",
      options: "-c default_transaction_read_only=on -c statement_timeout=15000 -c lock_timeout=3000",
    };
  }
  throw new Error("database configuration unavailable");
}

type QueryClient = {
  connect(): Promise<unknown>;
  query(sql: string): Promise<{ rows: unknown[] }>;
  end(): Promise<void>;
};

export async function collectSnapshot(client: QueryClient): Promise<CatalogSnapshot> {
  try {
    await client.connect();
    await client.query("BEGIN READ ONLY");
    await client.query("SET LOCAL statement_timeout = '15s'");
    await client.query("SET LOCAL lock_timeout = '3s'");
    const response = await client.query(PUBLIC_CATALOG_AUDIT_SQL);
    await client.query("COMMIT");
    if (response.rows.length !== 1) throw new Error("invalid catalog response");
    return response.rows[0] as CatalogSnapshot;
  } catch {
    await client.query("ROLLBACK").catch(() => undefined);
    throw new Error("read-only catalog audit failed");
  } finally {
    await client.end().catch(() => undefined);
  }
}