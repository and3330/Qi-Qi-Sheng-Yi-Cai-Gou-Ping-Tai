import { mkdtemp, mkdir, appendFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

const OWNER = "customer_test_owner";
const DATABASE = "customer_router_acceptance";
const PORT = "55432";
const root = await mkdtemp(path.join(os.tmpdir(), "customer-pg-"));
const data = path.join(root, "data");
const socket = path.join(root, "socket");

function isolatedEnv(extra = {}) {
  const env = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (key === "DATABASE_URL" || key.startsWith("PG")) continue;
    env[key] = value;
  }
  return { ...env, ...extra };
}

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env ?? isolatedEnv(),
      stdio: options.stdio ?? "inherit",
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} exited with ${code ?? signal}`));
    });
  });
}

let started = false;
try {
  await mkdir(socket);
  await run("initdb", [
    "-D", data,
    "-U", OWNER,
    "--auth-local=trust",
    "--auth-host=reject",
    "--no-instructions",
  ]);
  await appendFile(path.join(data, "postgresql.conf"), `
listen_addresses = ''
unix_socket_directories = '${socket.replaceAll("'", "''")}'
port = ${PORT}
`);
  await run("pg_ctl", ["-D", data, "-w", "start"]);
  started = true;

  await run("psql", [
    "-h", socket,
    "-p", PORT,
    "-U", OWNER,
    "-d", "postgres",
    "-v", "ON_ERROR_STOP=1",
    "-c", `CREATE DATABASE ${DATABASE}`,
  ]);
  await run("psql", [
    "-h", socket,
    "-p", PORT,
    "-U", OWNER,
    "-d", DATABASE,
    "-v", "ON_ERROR_STOP=1",
    "-c", "CREATE ROLE erp_app NOLOGIN NOBYPASSRLS NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT",
  ]);

  await run("pnpm", [
    "exec", "vitest", "run",
    ...(process.argv.includes("--auth-only") ? [
      "src/routes/__tests__/account-recovery.postgres.integration.test.ts",
    ] : process.argv.includes("--baseline-repair-only") ? [
      "src/routes/__tests__/accounts-baseline-repair.postgres.integration.test.ts",
    ] : process.argv.includes("--company-provision-only") ? [
      "src/routes/__tests__/company-provision.postgres.integration.test.ts",
    ] : [
      "src/routes/__tests__/customers.postgres.integration.test.ts",
      "src/routes/__tests__/account-recovery.postgres.integration.test.ts",
      "src/routes/__tests__/company-provision.postgres.integration.test.ts",
      "src/routes/__tests__/accounts-baseline-repair.postgres.integration.test.ts",
    ]),
  ], {
    cwd: path.resolve(import.meta.dirname, ".."),
    env: isolatedEnv({
      CUSTOMER_POSTGRES_ACCEPTANCE: "1",
      CUSTOMER_TEST_PG_ROOT: root,
      CUSTOMER_TEST_PG_SOCKET: socket,
      CUSTOMER_TEST_PG_PORT: PORT,
      NODE_ENV: "test",
    }),
  });
} finally {
  if (started) {
    await run("pg_ctl", ["-D", data, "-m", "immediate", "-w", "stop"]).catch(() => {});
  }
  await rm(root, { recursive: true, force: true });
}