import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import pg from "pg";
import { resolveDatabaseSource, resolveDatabaseUrl } from "../src/connection.mjs";

const legacy = {
  PGHOST: "legacy.invalid", PGPORT: "5433", PGUSER: "legacy",
  PGPASSWORD: "test-only:p@ss", PGDATABASE: "local_db",
};
const canonical = "postgresql://test:only@canonical.invalid:5432/managed?sslmode=require";

test("canonical URL wins over every stale PG field without mutating environment", () => {
  const env = Object.freeze({ ...legacy, PGPORT: "invalid", PGSSLMODE: "disable", DATABASE_URL: canonical });
  assert.equal(resolveDatabaseSource(env), "url");
  assert.equal(resolveDatabaseUrl(env), canonical);
});

test("pg client construction cannot inherit stale destination port or TLS settings", () => {
  const savedPort = process.env.PGPORT;
  const savedSsl = process.env.PGSSLMODE;
  try {
    process.env.PGPORT = "9999";
    process.env.PGSSLMODE = "disable";
    // Construction only: never connect or send a query.
    const client = new pg.Client({
      connectionString: resolveDatabaseUrl({ DATABASE_URL: "postgres://test:only@canonical.invalid/managed" }),
    });
    assert.equal(client.connectionParameters.port, 5432);
    assert.equal(client.connectionParameters.host, "canonical.invalid");
    assert.ok(client.connectionParameters.ssl);
  } finally {
    if (savedPort === undefined) delete process.env.PGPORT; else process.env.PGPORT = savedPort;
    if (savedSsl === undefined) delete process.env.PGSSLMODE; else process.env.PGSSLMODE = savedSsl;
  }
});

test("complete PG fallback is used only when URL is absent", () => {
  assert.equal(resolveDatabaseSource(legacy), "pg");
  const url = new URL(resolveDatabaseUrl(legacy));
  assert.equal(url.hostname, legacy.PGHOST);
  assert.equal(decodeURIComponent(url.password), legacy.PGPASSWORD);
  assert.equal(url.searchParams.get("sslmode"), "require");
  assert.equal(new URL(resolveDatabaseUrl({ ...legacy, PGSSLMODE: "disable" })).searchParams.get("sslmode"), "disable");
});

test("missing secrets fail closed, without credential disclosure", () => {
  for (const env of [{}, { ...legacy, PGPASSWORD: "" }, { ...legacy, PGUSER: "" }]) {
    assert.throws(() => resolveDatabaseUrl(env), /configuration unavailable/);
  }
  for (const DATABASE_URL of ["secret-invalid", "postgres://test@host/db", "https://test:secret@host/db"]) {
    assert.throws(() => resolveDatabaseUrl({ ...legacy, DATABASE_URL }), (error) => {
      assert.equal(error.message, "Invalid DATABASE_URL: complete PostgreSQL credentials required");
      return true;
    });
  }
});

test("schema guard rejects non-development, deployment, force, and absent config before any connection", () => {
  const cases = [
    [{ NODE_ENV: "production" }, [], /NODE_ENV must be development/],
    [{ NODE_ENV: "development", REPLIT_ENVIRONMENT: "production" }, [], /deployment environments/],
    ...["REPLIT_DEPLOYMENT", "REPLIT_DEPLOYMENT_ID", "REPLIT_DEPLOYMENT_VERSION"].map((key) => [
      { NODE_ENV: "development", [key]: "true" }, [], /deployment environments/,
    ]),
    [{ NODE_ENV: "development" }, ["--force"], /force push is disabled/],
    [{ NODE_ENV: "development" }, ["--check-only"], /configuration unavailable or invalid/],
  ];
  for (const [env, args, expected] of cases) {
    const result = spawnSync(process.execPath, [
      new URL("./schema-push-guard.mjs", import.meta.url).pathname, ...args,
    ], { env, encoding: "utf8" });
    assert.equal(result.status, 1);
    assert.match(result.stderr, expected);
  }
});