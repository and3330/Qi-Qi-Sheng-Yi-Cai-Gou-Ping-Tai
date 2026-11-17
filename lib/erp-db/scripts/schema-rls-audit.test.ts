import assert from "node:assert/strict";
import test from "node:test";
import * as schema from "../src/schema/index.ts";
import {
  auditSnapshot,
  collectSnapshot,
  connectionConfig,
  expectedSchemaFromExports,
  PUBLIC_CATALOG_AUDIT_SQL,
  REQUIRED_OPERATION_TABLES,
} from "./schema-rls-audit-core.ts";

const expected = expectedSchemaFromExports(schema);
test("company identity requires nullable unique company codes and tenant-scoped accounts", () => {
  const tenants = expected.tables.find((table) => table.name === "tenants")!;
  const users = expected.tables.find((table) => table.name === "admin_users")!;
  assert.equal(tenants.columns.find((column) => column.name === "company_code")?.notNull, false);
  assert.ok(tenants.uniqueKeys.some((key) => key.columns.join(",") === "company_code"));
  assert.ok(users.uniqueKeys.some((key) => key.columns.join(",") === "tenant_id,username"));
  assert.equal(users.uniqueKeys.some((key) => key.columns.join(",") === "username"), false);
  const snapshot = compatibleSnapshot();
  snapshot.catalog.columns = snapshot.catalog.columns.filter((column) => column.table !== "tenants" || column.name !== "company_code");
  assert.equal(auditSnapshot(expected, snapshot).ok, false);
});

test("recovery auth tables are audited without changing the legacy admin shape", () => {
  const profiles = expected.tables.find((table) => table.name === "account_recovery_profiles")!;
  const tokens = expected.tables.find((table) => table.name === "account_recovery_tokens")!;
  assert.ok(profiles);
  assert.ok(tokens);
  assert.equal(profiles.tenantScoped, false); // pre-login, explicit tenant predicates
  assert.equal(tokens.tenantScoped, false);
  for (const name of ["token_hash", "user_id", "tenant_id", "purpose", "binding_hash", "expires_at"]) {
    assert.ok(tokens.columns.some((column) => column.name === name));
  }
  assert.ok(profiles.columns.some((column) => column.name === "recovery_email_verified_at"));
  assert.equal(expected.tables.find((table) => table.name === "admin_users")!.columns.some((column) => column.name === "recovery_email"), false);
  const snapshot = compatibleSnapshot();
  snapshot.catalog.tables = snapshot.catalog.tables.filter((table) => table.name !== "account_recovery_tokens");
  assert.ok(auditSnapshot(expected, snapshot).issues.some((issue) => issue.includes("account_recovery_tokens")));
});

function compatibleSnapshot() {
  const tables = expected.tables.map((table) => ({ name: table.name, rls: table.tenantScoped, forceRls: table.tenantScoped }));
  const columns = expected.tables.flatMap((table) => table.columns.map((column) => ({
    table: table.name,
    name: column.name,
    type: column.type,
    notNull: column.notNull,
    default: column.name === "tenant_id" && table.tenantDefaultRequired
      ? "tenant-current-setting" : null,
  })));
  const policies = expected.tables.filter((table) => table.tenantScoped).map((table) => ({
    table: table.name,
    name: "tenant_isolation",
    permissive: "PERMISSIVE",
    roles: ["public"],
    command: "ALL",
    using: "(tenant_id = (current_setting('app.tenant_id'::text))::integer)",
    check: "(tenant_id = (current_setting('app.tenant_id'::text))::integer)",
  }));
  const uniqueKeys = expected.tables.flatMap((table) => table.uniqueKeys.map((columns, index) => ({
    table: table.name, name: `key_${index}`, columns: columns.columns,
    primary: columns.primary, partial: columns.partial, expression: false, hasInclude: false,
    predicateDigest: columns.partial ? "00000000000000000000000000000000" : null,
  })));
  return {
    format: "erp-public-catalog-fingerprint/v1",
    fingerprint: "00000000000000000000000000000000",
    catalog: {
      format: "erp-public-catalog/v1", tables, columns, policies, uniqueKeys,
      erpAppRole: { exists: true, superuser: false, bypassRls: false },
    },
  };
}

test("schema source extraction includes every operation table and menu tenant key", () => {
  const names = new Set(expected.tables.map((table) => table.name));
  for (const name of REQUIRED_OPERATION_TABLES) assert.ok(names.has(name));
  const menu = expected.tables.find((table) => table.name === "menu_permissions");
  assert.ok(menu?.columns.some((column) => column.name === "tenant_id"));
  assert.ok(menu?.uniqueKeys.some((key) => key.columns.join(",") === "tenant_id,path"));
  assert.equal(auditSnapshot(expected, compatibleSnapshot()).ok, true);
});

test("legacy snapshots are rejected", () => {
  const result = auditSnapshot(expected, { format: "legacy", fingerprint: "x", catalog: {} } as never);
  assert.equal(result.ok, false);
  assert.match(result.issues.join("\n"), /legacy/);
});

test("missing RLS, role bypass, and permissive policy are rejected", () => {
  const snapshot = compatibleSnapshot();
  const table = expected.tables.find((item) => item.tenantScoped)!;
  snapshot.catalog.tables.find((item) => item.name === table.name)!.rls = false;
  snapshot.catalog.erpAppRole.bypassRls = true;
  snapshot.catalog.policies.push({
    ...snapshot.catalog.policies.find((item) => item.table === table.name)!,
    name: "allow_everything", using: "true", check: "true",
  });
  const issues = auditSnapshot(expected, snapshot).issues.join("\n");
  assert.match(issues, /RLS not enabled/);
  assert.match(issues, /unsafe role attributes/);
  assert.match(issues, /unexpected policy count/);
});

test("missing operation table is rejected explicitly", () => {
  const snapshot = compatibleSnapshot();
  snapshot.catalog.tables = snapshot.catalog.tables.filter((table) => table.name !== REQUIRED_OPERATION_TABLES[0]);
  const issues = auditSnapshot(expected, snapshot).issues;
  assert.ok(issues.includes(`missing operation table: public.${REQUIRED_OPERATION_TABLES[0]}`));
});

test("connection precedence is canonical URL and explicit diagnostics retain PG access", () => {
  const env = {
    PGHOST: "private-host", PGUSER: "private-user", PGPASSWORD: "private-password",
    PGDATABASE: "erp", PGPORT: "6543", DATABASE_URL: "postgres://url-user:url-password@url-host:5432/erp?sslmode=require",
  };
  const before = { ...env };
  const config = connectionConfig(env);
  assert.equal(config.host, undefined);
  assert.equal(config.connectionString, env.DATABASE_URL);
  assert.deepEqual(env, before);
  assert.match(String(config.options), /default_transaction_read_only=on/);
  assert.equal(connectionConfig(env, "url").connectionString, env.DATABASE_URL);
  assert.equal(connectionConfig(env, "pg").host, env.PGHOST);
});

test("partial or global keys cannot satisfy tenant-scoped expected keys", () => {
  const snapshot = compatibleSnapshot();
  const menuKey = snapshot.catalog.uniqueKeys.find((key) => key.table === "menu_permissions")!;
  menuKey.partial = true;
  menuKey.predicateDigest = "11111111111111111111111111111111";
  snapshot.catalog.uniqueKeys.push({
    table: "menu_permissions", name: "unsafe_path", columns: ["path"],
    primary: false, partial: false, expression: false, hasInclude: false, predicateDigest: null,
  });
  const issues = auditSnapshot(expected, snapshot).issues.join("\n");
  assert.match(issues, /missing unique key: public\.menu_permissions\(tenant_id,path\)/);
  assert.match(issues, /unexpected global unique key: public\.menu_permissions\(path\)/);
});

test("default classification is exact and every default contributes a digest", () => {
  assert.match(PUBLIC_CATALOG_AUDIT_SQL, /= 'current_setting''app\.tenant_id''::text::integer'/);
  assert.match(PUBLIC_CATALOG_AUDIT_SQL, /defaultDigest/);
  assert.ok(PUBLIC_CATALOG_AUDIT_SQL.includes("md5(pg_catalog.pg_get_expr(d.adbin"));
  const snapshot = compatibleSnapshot();
  const tenant = snapshot.catalog.columns.find((column) => column.default === "tenant-current-setting")!;
  tenant.default = "other";
  assert.match(auditSnapshot(expected, snapshot).issues.join("\n"), /tenant default mismatch/);
});

test("type comparison ignores punctuation whitespace but preserves numeric precision and scale", () => {
  const numeric = expected.tables.flatMap((table) =>
    table.columns.map((column) => ({ table: table.name, column })),
  ).find(({ column }) => /^numeric\(\d+,\d+\)$/.test(column.type));
  assert.ok(numeric);

  const whitespaceSnapshot = compatibleSnapshot();
  const whitespaceColumn = whitespaceSnapshot.catalog.columns.find((column) =>
    column.table === numeric.table && column.name === numeric.column.name,
  )!;
  whitespaceColumn.type = numeric.column.type.replace(",", ", ");
  assert.equal(auditSnapshot(expected, whitespaceSnapshot).issues.some((issue) =>
    issue.includes(`${numeric.table}.${numeric.column.name}`)), false);

  const precisionSnapshot = compatibleSnapshot();
  const precisionColumn = precisionSnapshot.catalog.columns.find((column) =>
    column.table === numeric.table && column.name === numeric.column.name,
  )!;
  const match = numeric.column.type.match(/^numeric\((\d+),(\d+)\)$/)!;
  precisionColumn.type = `numeric(${match[1]},${Number(match[2]) + 1})`;
  assert.ok(auditSnapshot(expected, precisionSnapshot).issues.includes(
    `column type mismatch: public.${numeric.table}.${numeric.column.name}`,
  ));

  const timestamp = expected.tables.flatMap((table) =>
    table.columns.map((column) => ({ table: table.name, column })),
  ).find(({ column }) => /^timestamp(\(\d+\))? without time zone$/.test(column.type));
  assert.ok(timestamp);
  const canonicalTimestampSnapshot = compatibleSnapshot();
  const canonicalTimestamp = canonicalTimestampSnapshot.catalog.columns.find((column) =>
    column.table === timestamp.table && column.name === timestamp.column.name,
  )!;
  canonicalTimestamp.type = timestamp.column.type.replace(" without time zone", "");
  assert.equal(auditSnapshot(expected, canonicalTimestampSnapshot).issues.some((issue) =>
    issue.includes(`${timestamp.table}.${timestamp.column.name}`)), false);

  const timezoneMismatchSnapshot = compatibleSnapshot();
  const timezoneMismatch = timezoneMismatchSnapshot.catalog.columns.find((column) =>
    column.table === timestamp.table && column.name === timestamp.column.name,
  )!;
  timezoneMismatch.type = timestamp.column.type.replace("without time zone", "with time zone");
  assert.ok(auditSnapshot(expected, timezoneMismatchSnapshot).issues.includes(
    `column type mismatch: public.${timestamp.table}.${timestamp.column.name}`,
  ));
});

test("collector uses a read-only transaction and sanitizes raw failures", async () => {
  const calls: string[] = [];
  const good = {
    async connect() {},
    async query(sql: string) {
      calls.push(sql);
      return { rows: sql === PUBLIC_CATALOG_AUDIT_SQL ? [compatibleSnapshot()] : [] };
    },
    async end() {},
  };
  await collectSnapshot(good);
  assert.equal(calls[0], "BEGIN READ ONLY");
  assert.ok(calls.some((sql) => sql.includes("statement_timeout")));

  const secret = "postgres://private-user:private-password@private-host/database";
  const bad = {
    async connect() { throw new Error(secret); },
    async query() { return { rows: [] }; },
    async end() {},
  };
  await assert.rejects(collectSnapshot(bad), (error: Error) => {
    assert.equal(error.message, "read-only catalog audit failed");
    assert.equal(error.message.includes(secret), false);
    return true;
  });
});