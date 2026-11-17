import { appendFile, mkdir, mkdtemp, rm } from "node:fs/promises";
import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";

const OWNER = "schema_audit_test_owner";
const DATABASE = "schema_audit_syntax";
const PORT = "55433";
const root = await mkdtemp(path.join(os.tmpdir(), "schema-audit-pg-"));
const data = path.join(root, "data");
const socket = path.join(root, "socket");

function cleanEnv(extra = {}) {
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
      env: options.env ?? cleanEnv(),
      stdio: options.capture ? ["ignore", "pipe", "pipe"] : "ignore",
    });
    let stdout = "";
    if (options.capture) child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.once("error", () => reject(new Error("isolated postgres smoke command failed")));
    child.once("exit", (code) => {
      if (options.accept?.includes(code)) resolve(stdout);
      else if (code === 0) resolve(stdout);
      else reject(new Error("isolated postgres smoke command failed"));
    });
  });
}

let started = false;
try {
  await mkdir(socket);
  await run("initdb", [
    "-D", data, "-U", OWNER, "--auth-local=trust", "--auth-host=reject", "--no-instructions",
  ]);
  await appendFile(path.join(data, "postgresql.conf"), `
listen_addresses = ''
unix_socket_directories = '${socket.replaceAll("'", "''")}'
port = ${PORT}
`);
  await run("pg_ctl", ["-D", data, "-w", "start"]);
  started = true;
  await run("psql", [
    "-h", socket, "-p", PORT, "-U", OWNER, "-d", "postgres",
    "-v", "ON_ERROR_STOP=1", "-c", `CREATE DATABASE ${DATABASE}`,
  ]);
  await run("psql", [
    "-h", socket, "-p", PORT, "-U", OWNER, "-d", DATABASE,
    "-v", "ON_ERROR_STOP=1",
    "-c", "CREATE ROLE erp_app NOLOGIN NOBYPASSRLS NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT",
  ]);

  const common = ["--import", "tsx", "scripts/schema-rls-audit.ts"];
  const pgOutput = await run("node", [...common, "--source=pg"], {
    cwd: path.resolve(import.meta.dirname, ".."),
    capture: true,
    accept: [1],
    env: cleanEnv({
      PGHOST: socket,
      PGPORT: PORT,
      PGUSER: OWNER,
      PGPASSWORD: "local-trust-placeholder",
      PGDATABASE: DATABASE,
      PGSSLMODE: "disable",
    }),
  });
  const url = new URL(`postgresql://${OWNER}@localhost/${DATABASE}`);
  url.searchParams.set("host", socket);
  url.searchParams.set("port", PORT);
  url.searchParams.set("sslmode", "disable");
  const urlOutput = await run("node", [...common, "--source=url"], {
    cwd: path.resolve(import.meta.dirname, ".."),
    capture: true,
    accept: [1],
    env: cleanEnv({ DATABASE_URL: url.toString() }),
  });
  const pgResult = JSON.parse(pgOutput);
  const urlResult = JSON.parse(urlOutput);
  if (!pgResult.catalogFingerprint || !urlResult.catalogFingerprint) {
    throw new Error("isolated postgres smoke returned no catalog row");
  }
  process.stdout.write(`${JSON.stringify({
    pg: { fingerprint: pgResult.catalogFingerprint, issues: pgResult.issues.length },
    url: { fingerprint: urlResult.catalogFingerprint, issues: urlResult.issues.length },
  })}\n`);
} finally {
  if (started) await run("pg_ctl", ["-D", data, "-m", "immediate", "-w", "stop"]).catch(() => undefined);
  await rm(root, { recursive: true, force: true });
}