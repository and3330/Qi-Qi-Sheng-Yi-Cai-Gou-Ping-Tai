/** 演練展示資料重置：在交易內清空＋寫入後強制回滾，不影響現有資料 */
import { db } from "@workspace/erp-db";
import { sql } from "drizzle-orm";
import { seedDemoDataInto } from "./demo-seed";

async function main() {
  try {
    await db.transaction(async (tx) => {
      const r0: any = await tx.execute(sql`SELECT tablename FROM pg_tables WHERE schemaname = 'public'`);
      const tables = (r0?.rows ?? [])
        .map((row: any) => String(row.tablename))
        .filter((t: string) => !["demo_meta", "__drizzle_migrations"].includes(t) && /^[a-z0-9_]+$/.test(t));
      await tx.execute(sql.raw(`TRUNCATE TABLE ${tables.map((t: string) => `"${t}"`).join(", ")} RESTART IDENTITY CASCADE`));
      await seedDemoDataInto(tx);
      const r: any = await tx.execute(sql`
        SELECT (SELECT count(*) FROM customers) c, (SELECT count(*) FROM sales_orders) so,
               (SELECT count(*) FROM invoices) inv, (SELECT count(*) FROM admin_users WHERE username='test') t,
               (SELECT count(*) FROM print_templates) pt
      `);
      console.log("SEED_RESULT", JSON.stringify(r.rows?.[0] ?? r));
      throw new Error("ROLLBACK_TEST");
    });
  } catch (e: any) {
    if (e.message === "ROLLBACK_TEST") {
      console.log("ROLLBACK_OK — 資料已還原");
      process.exit(0);
    }
    console.error("SEED_FAILED:", e.message);
    process.exit(1);
  }
}
void main();
