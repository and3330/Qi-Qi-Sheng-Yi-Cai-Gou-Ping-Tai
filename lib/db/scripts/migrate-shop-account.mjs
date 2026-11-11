import pg from "pg";

// 商城修正：會員身份申請（審核後才給醫院／診所價）、匯款回報後五碼、
// 忘記密碼的重設連結、商城設定（匯款帳號）。可重複執行；新欄位皆可為空。
const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required");
const client = new pg.Client({ connectionString });
await client.connect();
try {
  await client.query(`
    ALTER TABLE IF EXISTS members ADD COLUMN IF NOT EXISTS requested_tier text;
    ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS remit_last_five text;
    ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS remit_reported_at timestamp;
    CREATE TABLE IF NOT EXISTS password_reset_tokens (
      id serial PRIMARY KEY,
      member_id integer NOT NULL REFERENCES members(id),
      token_hash text NOT NULL UNIQUE,
      expires_at timestamp NOT NULL,
      used_at timestamp,
      created_at timestamp NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_password_reset_member ON password_reset_tokens(member_id);
    CREATE TABLE IF NOT EXISTS shop_settings (
      key text PRIMARY KEY,
      value text NOT NULL DEFAULT '',
      updated_at timestamp NOT NULL DEFAULT now()
    );
  `);
  console.log("Shop account migration complete");
} finally {
  await client.end();
}
