import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { logger } from "./logger";

/**
 * 伺服器啟動時要跑的資料庫遷移（順序固定，全部可重複執行）。
 *
 * 為什麼放在伺服器裡：Replit 正式環境是直接執行 `node dist/index.mjs`，
 * 不經過 package.json 的 start 指令，所以遷移不能只串在 start 裡，
 * 否則新版程式上線時正式資料庫會缺欄位。
 *
 * 新增遷移腳本時，把檔名加在這個清單最後面。
 */
const STARTUP_MIGRATIONS = [
  "migrate-erp-hr.mjs",
  "migrate-erp-document-creators.mjs",
  "migrate-social-marketing.mjs",
  "migrate-newsletter.mjs",
  "migrate-cmo.mjs",
  "migrate-content-revision-images.mjs",
  "migrate-ai-knowledge.mjs",
  "migrate-mcp.mjs",
  "migrate-ai-credits.mjs",
  "migrate-shop-account.mjs",
];

function findScriptsDir(): string | null {
  const entry = process.argv[1] ? path.dirname(path.resolve(process.argv[1])) : null;
  const candidates = [
    // dist/index.mjs → artifacts/api-server/dist → 專案根目錄
    entry ? path.resolve(entry, "../../../lib/db/scripts") : null,
    // 從專案根目錄啟動（Replit 正式環境）
    path.resolve(process.cwd(), "lib/db/scripts"),
    // 從 artifacts/api-server 啟動（pnpm run start）
    path.resolve(process.cwd(), "../../lib/db/scripts"),
  ];
  for (const dir of candidates) {
    if (dir && existsSync(path.join(dir, STARTUP_MIGRATIONS[0]!))) return dir;
  }
  return null;
}

function runScript(file: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [file], {
      cwd: path.dirname(file),
      env: process.env,
      stdio: "inherit",
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${path.basename(file)} 結束代碼 ${code}`));
    });
  });
}

/**
 * 依序執行遷移。任何一支失敗就丟出錯誤，讓伺服器不要帶著缺欄位的資料庫上線
 * （Replit 發布時新版啟動失敗會保留舊版）。
 * 設 SKIP_STARTUP_MIGRATIONS=true 可略過。
 */
export async function runStartupMigrations(): Promise<void> {
  if (process.env["SKIP_STARTUP_MIGRATIONS"] === "true") {
    logger.warn("已設定 SKIP_STARTUP_MIGRATIONS，略過啟動時的資料庫遷移");
    return;
  }
  const dir = findScriptsDir();
  if (!dir) {
    logger.error(
      "找不到 lib/db/scripts，無法執行資料庫遷移；若資料庫缺少新欄位，部分功能會出錯",
    );
    return;
  }
  const started = Date.now();
  for (const name of STARTUP_MIGRATIONS) {
    await runScript(path.join(dir, name));
  }
  logger.info(
    { count: STARTUP_MIGRATIONS.length, ms: Date.now() - started },
    "啟動時的資料庫遷移完成",
  );
}
