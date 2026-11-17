// Disposable Unix-socket PostgreSQL ONLY. No inherited database/app credentials.
import { mkdtemp, mkdir, appendFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";

const root = await mkdtemp(path.join(os.tmpdir(), "reset-empty-pg-"));
const data = path.join(root, "data");
const socket = path.join(root, "socket");
const owner = "reset_isolated_owner";
const port = "55439";
const token = randomUUID();
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
  !key.startsWith("PG") && !key.startsWith("REPLIT_DEPLOYMENT") &&
  !/(DATABASE|PASSWORD|SECRET|TOKEN|KEY)/i.test(key)));
env.NODE_ENV = "development";
env.REPLIT_ENVIRONMENT = "development";
function run(command, args, extra = {}, expected = 0) {
  const result = spawnSync(command, args, {
    env: { ...env, ...extra }, encoding: "utf8", maxBuffer: 16 * 1024 * 1024,
  });
  assert.equal(result.status, expected, `${command} failed (captured output suppressed)`);
  return result.stdout;
}
function sql(statement) {
  return run("psql", ["-X", "-h", socket, "-p", port, "-U", owner, "-d", "postgres",
    "-v", "ON_ERROR_STOP=1", "-tAc", statement]).trim();
}
let started = false;
try {
  await mkdir(socket);
  run("initdb", ["-D", data, "-U", owner, "--auth-local=trust", "--auth-host=reject", "--no-instructions"]);
  await appendFile(path.join(data, "postgresql.conf"),
    `\nlisten_addresses = ''\nunix_socket_directories = '${socket}'\nport = ${port}\n`);
  run("pg_ctl", ["-D", data, "-l", path.join(root, "postgres.log"), "-w", "start"]);
  started = true;
  const url = `postgresql://${owner}@localhost/postgres?host=${encodeURIComponent(socket)}&port=${port}`;
  const childEnv = { DATABASE_URL: url, BOOTSTRAP_ADMIN_PASSWORD: randomUUID() };
  const script = path.join(import.meta.dirname, "reset-development-empty.mjs");
  const args = [script, "--confirm-empty-development", "--verification-token", token];
  sql(`CREATE TABLE public.replit_reset_verification(token uuid PRIMARY KEY, created_at timestamptz NOT NULL DEFAULT now());
    INSERT INTO public.replit_reset_verification(token) VALUES ('${token}');
    CREATE TABLE public.customers(id integer PRIMARY KEY, name text);
    INSERT INTO public.customers VALUES(99, 'old development data');
    CREATE SCHEMA stripe; CREATE TABLE stripe.keep_me(id integer); INSERT INTO stripe.keep_me VALUES(47);
    CREATE SCHEMA drizzle; CREATE TABLE drizzle.__drizzle_migrations(id integer); INSERT INTO drizzle.__drizzle_migrations VALUES(51);`);
  run("node", args, { ...childEnv, NODE_ENV: "production" }, 1);
  run("node", args, { ...childEnv, REPLIT_DEPLOYMENT: "1" }, 1);
  run("node", args, { ...childEnv, BOOTSTRAP_ADMIN_PASSWORD: "" }, 1);
  run("node", [script, "--confirm-empty-development", "--verification-token", randomUUID()], childEnv, 1);
  assert.equal(sql("SELECT name FROM public.customers"), "old development data");
  // Cross-schema dependency must cause RESTRICT failure and preserve marker/data.
  sql("CREATE VIEW stripe.external_dependency AS SELECT * FROM public.customers");
  run("node", args, childEnv, 1);
  assert.equal(sql("SELECT count(*) FROM public.replit_reset_verification"), "1");
  assert.equal(sql("SELECT name FROM public.customers"), "old development data");
  sql("DROP VIEW stripe.external_dependency");
  // Force a late failure after DROP/CREATE to prove transaction rollback.
  sql(`CREATE FUNCTION public.isolated_reject_policy() RETURNS event_trigger LANGUAGE plpgsql AS
    $$ BEGIN RAISE EXCEPTION 'isolated policy failure'; END $$;
    CREATE EVENT TRIGGER isolated_reject_policy ON ddl_command_start WHEN TAG IN ('CREATE POLICY')
    EXECUTE FUNCTION public.isolated_reject_policy();`);
  run("node", args, childEnv, 1);
  assert.equal(sql("SELECT name FROM public.customers"), "old development data");
  assert.equal(sql("SELECT count(*) FROM public.replit_reset_verification"), "1");
  assert.equal(sql("SELECT count(*) FROM pg_roles WHERE rolname='erp_app'"), "0");
  sql("DROP EVENT TRIGGER isolated_reject_policy; DROP FUNCTION public.isolated_reject_policy()");
  // An unrelated editor-host value must not override the proven development marker.
  const output = run("node", args, { ...childEnv, REPLIT_ENVIRONMENT: "production" });
  assert.match(output, /Development reset committed/);
  assert.equal(sql("SELECT company_code || ':' || ai_credits || ':' || is_exempt FROM public.tenants"), "83483621:0:true");
  assert.equal(sql("SELECT username || ':' || role FROM public.admin_users"), "andy:owner");
  assert.equal(sql("SELECT to_regclass('public.replit_reset_verification') IS NULL"), "t");
  assert.equal(sql("SELECT id FROM stripe.keep_me"), "47");
  assert.equal(sql("SELECT id FROM drizzle.__drizzle_migrations"), "51");
  assert.equal(sql("SELECT count(*) FROM public.insurance_brackets"), "0");
  // Actual restricted-role RLS visibility and write rejection.
  sql(`SET app.tenant_id='1'; INSERT INTO public.customers(name) VALUES('isolation probe')`);
  assert.equal(sql("SET ROLE erp_app; SET app.tenant_id='2'; SELECT count(*) FROM public.customers").split("\n").at(-1), "0");
  assert.equal(sql("SET ROLE erp_app; SET app.tenant_id='1'; SELECT count(*) FROM public.customers").split("\n").at(-1), "1");
  run("psql", ["-X", "-h", socket, "-p", port, "-U", owner, "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-c",
    "SET ROLE erp_app; SET app.tenant_id='2'; INSERT INTO public.customers(tenant_id,name) VALUES(1,'denied')"], {}, 1);
  sql("DELETE FROM public.customers");
  run("node", args, childEnv, 1); // consumed marker prevents rerun
  // Existing restricted role gets grants but its login/password is not modified.
  sql(`CREATE TABLE public.replit_reset_verification(token uuid PRIMARY KEY, created_at timestamptz NOT NULL DEFAULT now());
    INSERT INTO public.replit_reset_verification(token) VALUES('${token}')`);
  run("node", args, childEnv);
  assert.equal(sql("SELECT rolcanlogin FROM pg_roles WHERE rolname='erp_app'"), "f");
  assert.equal(sql("SELECT id FROM stripe.keep_me"), "47");
  console.log("PASS: isolated guards, verification, cross-schema preservation, late rollback, fresh reset, consumed marker, reused role, RLS isolation.");
} finally {
  if (started) {
    spawnSync("pg_ctl", ["-D", data, "-m", "immediate", "-w", "stop"], { env, stdio: "ignore" });
  }
  await rm(root, { recursive: true, force: true });
}