// BI 指標真實 SQL 驗收：在拋棄式 PostgreSQL（私有 Unix socket、無 TCP）上以正式 drizzle schema
// 建表、套用租戶 RLS，再以非超級使用者連線執行 BI builders。結束即刪除整個資料目錄。
// 絕不讀取 DATABASE_URL / PG*，不碰任何既有資料庫。
import { mkdtemp, mkdir, appendFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

const OWNER = "bi_test_owner";
const DATABASE = "bi_acceptance";
const PORT = "55437";
const root = await mkdtemp(path.join(os.tmpdir(), "bi-pg-"));
const data = path.join(root, "data");
const socket = path.join(root, "socket");
const apiDir = path.resolve(import.meta.dirname, "..");
const dbDir = path.resolve(apiDir, "../../lib/db");

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
    const child = spawn(command, args, { cwd: options.cwd, env: options.env ?? isolatedEnv(), stdio: "inherit" });
    child.once("error", reject);
    child.once("exit", (code, signal) => (code === 0 ? resolve() : reject(new Error(`${command} exited with ${code ?? signal}`))));
  });
}

let started = false;
try {
  await mkdir(socket);
  await run("initdb", ["-D", data, "-U", OWNER, "--auth-local=trust", "--auth-host=reject", "--no-instructions"]);
  await appendFile(path.join(data, "postgresql.conf"), `
listen_addresses = ''
unix_socket_directories = '${socket.replaceAll("'", "''")}'
port = ${PORT}
`);
  await run("pg_ctl", ["-D", data, "-l", path.join(root, "pg.log"), "-w", "start"]);
  started = true;
  await run("createdb", ["-h", socket, "-p", PORT, "-U", OWNER, DATABASE]);
  // 正式 schema 原始碼 → 拋棄式資料庫（CLI 參數指定，不經 drizzle.config / DATABASE_URL）
  const url = `postgresql://${OWNER}@localhost/${DATABASE}?host=${encodeURIComponent(socket)}&port=${PORT}`;
  await run("pnpm", ["exec", "drizzle-kit", "push", "--force", "--dialect", "postgresql", "--schema", "./src/schema/index.ts", "--url", url], { cwd: dbDir });
  await run("pnpm", ["exec", "vitest", "run", "src/lib/bi/__tests__/bi.postgres.integration.test.ts"], {
    cwd: apiDir,
    env: isolatedEnv({
      BI_POSTGRES_ACCEPTANCE: "1",
      BI_TEST_PG_ROOT: root,
      BI_TEST_PG_SOCKET: socket,
      BI_TEST_PG_PORT: PORT,
      NODE_ENV: "test",
    }),
  });
} finally {
  if (started) await run("pg_ctl", ["-D", data, "-m", "immediate", "-w", "stop"]).catch(() => {});
  await rm(root, { recursive: true, force: true });
}
