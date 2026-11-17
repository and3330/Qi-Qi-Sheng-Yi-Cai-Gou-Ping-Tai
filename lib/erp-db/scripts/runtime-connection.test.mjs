import test from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { runtimeDatabaseProvider, resolveRuntimeDatabaseUrl } from "../src/runtime-connection.mjs";

const ref = "kfmstyauifksaepahvrp";
const secret = `postgresql://postgres.${ref}:test-only@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres`;
const env = { ERP_DATABASE_PROVIDER: "supabase", SUPABASE_DATABASE_URL: secret };
test("adding the Supabase secret alone never switches the managed runtime", () => {
  const managed = "postgresql://test:only@managed.invalid:5432/db?sslmode=require";
  assert.equal(runtimeDatabaseProvider({ SUPABASE_DATABASE_URL: secret }), "replit");
  assert.equal(resolveRuntimeDatabaseUrl({ SUPABASE_DATABASE_URL: secret, DATABASE_URL: managed }), managed);
});
test("external opt-in pins session mode, verified TLS, and the user-provided public CA", () => {
  const url = new URL(resolveRuntimeDatabaseUrl(env));
  assert.equal(url.searchParams.get("sslmode"), "verify-full");
  assert.match(url.searchParams.get("sslrootcert"), /supabase-root-2021\.crt$/);
  const client = new pg.Client({ connectionString: url.toString() });
  assert.ok(client.connectionParameters.ssl.ca.includes("BEGIN CERTIFICATE"));
  assert.notEqual(client.connectionParameters.ssl.rejectUnauthorized, false);
});
test("bad external config fails closed without managed fallback or disclosure", () => {
  for (const value of [
    "", "not-a-url", secret.replace("5432", "6543"), secret.replace(ref, "wrongproject"),
    secret.replace("test-only", "[YOUR-PASSWORD]"), `${secret}?host=other.invalid`,
    `${secret}\n`, secret.replace("pooler.supabase.com", "pooler.supabase.com.attacker.invalid"),
  ]) {
    assert.throws(() => resolveRuntimeDatabaseUrl({ ...env, SUPABASE_DATABASE_URL: value, DATABASE_URL: secret }),
      error => error.message === "Invalid Supabase database configuration");
  }
  assert.throws(() => runtimeDatabaseProvider({ ERP_DATABASE_PROVIDER: "unknown" }), /Invalid ERP_DATABASE_PROVIDER/);
});
