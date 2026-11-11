/**
 * 平台方手動補 AI 點數（例如贈送試用點數、補償）。後台沒有這個入口，只能用指令執行。
 *
 * 用法（在 repo 根目錄執行）：
 *   pnpm --filter @workspace/api-server exec tsx src/scripts/grant-ai-credits.ts <點數> <原因>
 */
import { addAiCredits } from "../lib/aiCredits";

const points = Number(process.argv[2]);
const reason = process.argv.slice(3).join(" ").trim();
if (!Number.isInteger(points) || points <= 0 || !reason) {
  console.error("用法: tsx src/scripts/grant-ai-credits.ts <點數（正整數）> <原因>");
  process.exit(1);
}

const result = await addAiCredits({ points, reason: `平台補點：${reason}` });
console.log(`已補 ${points} 點，目前餘額 ${result.balance} 點`);
process.exit(0);
