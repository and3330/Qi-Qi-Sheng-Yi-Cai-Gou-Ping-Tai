/**
 * AI 客服知識庫 — 冪等資料庫遷移。
 * 執行方式：pnpm --filter @workspace/db run migrate:ai-knowledge
 */
import pg from "pg";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}

const client = new pg.Client({ connectionString });
await client.connect();
try {
  await client.query("BEGIN");
  await client.query(`
    CREATE TABLE IF NOT EXISTS ai_knowledge (
      id serial PRIMARY KEY,
      title text NOT NULL,
      category text NOT NULL,
      content text NOT NULL,
      is_active boolean NOT NULL DEFAULT true,
      created_at timestamp NOT NULL DEFAULT now(),
      updated_at timestamp NOT NULL DEFAULT now()
    )
  `);
  await client.query(
    "CREATE INDEX IF NOT EXISTS ai_knowledge_active_idx ON ai_knowledge (is_active)",
  );
  await client.query("COMMIT");
  console.log("migrate-ai-knowledge: done");
} catch (err) {
  await client.query("ROLLBACK");
  console.error("migrate-ai-knowledge: FAILED —", err.message);
  process.exitCode = 1;
} finally {
  await client.end();
}