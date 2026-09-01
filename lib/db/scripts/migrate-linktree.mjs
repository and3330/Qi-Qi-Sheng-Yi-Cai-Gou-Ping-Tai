/**
 * 會員 Linktree 連結頁 — 冪等資料庫遷移
 * 執行： pnpm --filter @workspace/db run migrate:linktree
 */
import pg from "pg";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}

const statements = [
  `CREATE TABLE IF NOT EXISTS member_links (
     id serial PRIMARY KEY,
     member_id integer NOT NULL REFERENCES members(id) ON DELETE CASCADE,
     title text NOT NULL,
     subtitle text,
     url text NOT NULL,
     icon text,
     link_type text NOT NULL DEFAULT 'link',
     sort_order integer NOT NULL DEFAULT 0,
     is_active boolean NOT NULL DEFAULT true,
     created_at timestamp NOT NULL DEFAULT now()
   )`,
  `CREATE INDEX IF NOT EXISTS idx_member_links_member ON member_links (member_id)`,
  `ALTER TABLE member_links ADD COLUMN IF NOT EXISTS is_blocked boolean NOT NULL DEFAULT false`,
  `CREATE TABLE IF NOT EXISTS member_linktree_settings (
     id serial PRIMARY KEY,
     member_id integer NOT NULL REFERENCES members(id) ON DELETE CASCADE,
     bio text,
     subtitle text,
     theme text NOT NULL DEFAULT 'default',
     background_color text,
     button_color text,
     button_text_color text,
     button_style text NOT NULL DEFAULT 'rounded',
     show_avatar boolean NOT NULL DEFAULT true,
     custom_title text
   )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS uq_member_linktree_settings_member
     ON member_linktree_settings (member_id)`,
];

const client = new pg.Client({ connectionString });
await client.connect();
try {
  await client.query("BEGIN");
  for (const stmt of statements) {
    await client.query(stmt);
    console.log("OK:", stmt.trim().split("\n")[0]);
  }
  await client.query("COMMIT");
  console.log("migrate-linktree: done");
} catch (err) {
  await client.query("ROLLBACK");
  console.error("migrate-linktree: FAILED —", err.message);
  process.exitCode = 1;
} finally {
  await client.end();
}
