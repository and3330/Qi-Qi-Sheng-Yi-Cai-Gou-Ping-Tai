import test from "node:test";
import assert from "node:assert/strict";
import { buildSupabaseBootstrap } from "./supabase-bootstrap-plan.mjs";

const fresh = `CREATE TABLE "ai_actions" (
"id" serial PRIMARY KEY,
"tenant_id" integer NOT NULL
);
CREATE TABLE "ai_draft_documents" (
"id" serial PRIMARY KEY,
"tenant_id" integer NOT NULL
);
CREATE TABLE "customers" (
"id" serial PRIMARY KEY,
"tenant_id" integer NOT NULL
);
CREATE TABLE "admin_users" (
"id" serial PRIMARY KEY,
"tenant_id" integer NOT NULL
);
CREATE POLICY "tenant_isolation" ON "ai_actions" AS PERMISSIVE FOR ALL TO public USING (tenant_id=current_setting('app.tenant_id')::integer) WITH CHECK (tenant_id=current_setting('app.tenant_id')::integer);
`;
test("all scoped tables receive forced RLS and complete policies", () => {
  const plan = buildSupabaseBootstrap(fresh);
  assert.equal(plan.tables.length, 4);
  for (const table of ["ai_actions", "ai_draft_documents", "customers"]) {
    assert.ok(plan.sql.includes(`ALTER TABLE public."${table}" FORCE ROW LEVEL SECURITY;`));
  }
  assert.equal((plan.sql.match(/CREATE POLICY/g) || []).length, 3);
  assert.equal((plan.sql.match(/WITH CHECK/g) || []).length, 3);
  assert.ok(!plan.sql.includes('ALTER TABLE public."admin_users" FORCE'));
  assert.ok(plan.sql.includes('ALTER TABLE public."admin_users" DISABLE ROW LEVEL SECURITY;'));
});
test("fresh-target guard, non-login role and no anonymous table access", () => {
  const {sql} = buildSupabaseBootstrap(fresh);
  assert.match(sql, /requires an empty public schema/);
  assert.match(sql, /Existing erp_app role requires manual review/);
  assert.match(sql, /CREATE ROLE erp_app NOLOGIN NOBYPASSRLS NOSUPERUSER/);
  assert.match(sql, /REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon, authenticated/);
});
test("real Drizzle tab indentation preserves columns and tenant detection", () => {
  const plan = buildSupabaseBootstrap(fresh.replace(/^"/gm, '\t"'));
  assert.deepEqual(plan.tables[0].columns, ["id", "tenant_id"]);
  assert.equal(plan.tables.filter(table => table.tenantScoped).length, 3);
});
test("rejects data-changing input and missing or duplicate tables", () => {
  for (const statement of ["DROP TABLE x;", "TRUNCATE x;", "DELETE FROM x;", "INSERT INTO x VALUES (1);", "UPDATE x SET id=2;"]) {
    assert.throws(() => buildSupabaseBootstrap(fresh + statement));
  }
  assert.throws(() => buildSupabaseBootstrap(""));
  assert.throws(() => buildSupabaseBootstrap(fresh.replaceAll("ai_draft_documents", "unexpected")));
  assert.throws(() => buildSupabaseBootstrap(fresh + fresh));
});
