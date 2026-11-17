// drizzle-kit 產生的外鍵會寫死 "public"."資料表"。七期網站的 ERP 資料表放在獨立的 schema，
// 所以把 schema 名稱拿掉，讓它跟著連線的 search_path 走。產生遷移檔之後一定要跑這支。
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const dir = join(dirname(fileURLToPath(import.meta.url)), "..", "drizzle");
let changed = 0;
for (const file of readdirSync(dir).filter((f) => f.endsWith(".sql"))) {
  const full = join(dir, file);
  const before = readFileSync(full, "utf8");
  const after = before.replaceAll('"public".', "");
  if (after !== before) { writeFileSync(full, after); changed++; }
}
console.log(`unqualify-migrations: ${changed} file(s) updated`);
