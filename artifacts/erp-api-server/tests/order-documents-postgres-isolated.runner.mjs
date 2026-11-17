import { mkdtemp, mkdir, appendFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

const OWNER = "order_documents_test_owner";
const DATABASE = "order_documents_acceptance";
const PORT = "55433";
const root = await mkdtemp(path.join(os.tmpdir(), "order-documents-pg-"));
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
  await run("createdb", [
    "-h", socket,
    "-p", PORT,
    "-U", OWNER,
    DATABASE,
  ]);
  await run("pnpm", [
    "exec", "vitest", "run",
    "src/routes/__tests__/order-documents.postgres.integration.test.ts",
  ], {
    cwd: path.resolve(import.meta.dirname, ".."),
    env: isolatedEnv({
      ORDER_DOCUMENTS_POSTGRES_ACCEPTANCE: "1",
      ORDER_DOCUMENTS_TEST_PG_ROOT: root,
      ORDER_DOCUMENTS_TEST_PG_SOCKET: socket,
      ORDER_DOCUMENTS_TEST_PG_PORT: PORT,
      NODE_ENV: "test",
    }),
  });
} finally {
  if (started) {
    await run("pg_ctl", ["-D", data, "-m", "immediate", "-w", "stop"]).catch(() => {});
  }
  await rm(root, { recursive: true, force: true });
}