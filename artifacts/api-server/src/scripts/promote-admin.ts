/**
 * 將既有會員升級為管理員（種子方式）。
 *
 * 用法（在 repo 根目錄執行）：
 *   pnpm --filter @workspace/api-server exec tsx src/scripts/promote-admin.ts <email 或 clerk user id>
 */
import { eq, or } from "drizzle-orm";
import { db, membersTable } from "@workspace/db";

const identifier = process.argv[2]?.trim();
if (!identifier) {
  console.error("用法: tsx src/scripts/promote-admin.ts <email 或 clerk user id>");
  process.exit(1);
}

const [updated] = await db
  .update(membersTable)
  .set({ role: "admin" })
  .where(
    or(
      eq(membersTable.email, identifier.toLowerCase()),
      eq(membersTable.clerkUserId, identifier),
    ),
  )
  .returning();

if (!updated) {
  console.error(`找不到會員: ${identifier}`);
  process.exit(1);
}
console.log(`已將 ${updated.name} (id=${updated.id}) 升級為管理員`);
process.exit(0);
