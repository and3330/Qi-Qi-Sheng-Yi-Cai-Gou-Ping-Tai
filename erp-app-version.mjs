// 打包時算出這一版的版本號，前端與後端共用。
// 格式：最後一筆提交的日期（台北時間）＋提交編號前 7 碼，例如 2026.11.14-b044ca7。
// 拿不到 git 資訊時（例如打包環境沒有 .git）退回用打包時間，至少看得出是哪一次打包。
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));

function git(args) {
  try {
    return execFileSync("git", args, { cwd: root, stdio: ["ignore", "pipe", "ignore"], timeout: 5000 }).toString().trim();
  } catch {
    return "";
  }
}

function taipeiParts(date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(date);
  const pick = (type) => parts.find(p => p.type === type)?.value ?? "00";
  return { date: `${pick("year")}.${pick("month")}.${pick("day")}`, time: `${pick("hour")}${pick("minute")}` };
}

export function appVersion() {
  const builtAt = new Date();
  const commit = git(["rev-parse", "--short=7", "HEAD"]);
  const committedAt = git(["log", "-1", "--format=%cI"]);
  const built = taipeiParts(builtAt);
  const version = commit && committedAt
    ? `${taipeiParts(new Date(committedAt)).date}-${commit}`
    : `${built.date}-${built.time}`;
  return { version, commit: commit || null, builtAt: builtAt.toISOString() };
}
