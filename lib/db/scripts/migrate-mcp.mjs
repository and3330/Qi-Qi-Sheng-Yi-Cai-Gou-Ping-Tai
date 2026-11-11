import pg from "pg";

// Bot 連線（MCP）：金鑰表，以及 AI 操作紀錄上標記「來自哪把金鑰、由誰確認」的欄位。
// 可重複執行；新欄位皆可為空，不影響既有的後台 AI 助理紀錄。
const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required");
const client = new pg.Client({ connectionString });
await client.connect();
try {
  await client.query(`
    CREATE TABLE IF NOT EXISTS mcp_api_keys (
      id serial PRIMARY KEY,
      name text NOT NULL,
      key_hash text NOT NULL UNIQUE,
      key_last_four text NOT NULL DEFAULT '',
      member_id integer NOT NULL REFERENCES members(id),
      is_active boolean NOT NULL DEFAULT true,
      last_used_at timestamp,
      created_at timestamp NOT NULL DEFAULT now()
    );
    ALTER TABLE IF EXISTS ai_action_logs ADD COLUMN IF NOT EXISTS mcp_key_id integer;
    ALTER TABLE IF EXISTS ai_action_logs ADD COLUMN IF NOT EXISTS confirmed_by integer;
    CREATE INDEX IF NOT EXISTS idx_ai_action_logs_mcp
      ON ai_action_logs(mcp_key_id, status)
      WHERE mcp_key_id IS NOT NULL;
  `);
  console.log("MCP migration complete");
} finally {
  await client.end();
}
