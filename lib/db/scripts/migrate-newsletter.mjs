/**
 * 電子報模組 — 冪等資料庫遷移
 *
 * 建立寄件域名、API 金鑰、訂閱者、活動、發送記錄、自動序列與序列步驟/入列
 * 等資料表，可重複執行。
 * 執行方式：pnpm --filter @workspace/db run migrate:newsletter
 */
import pg from "pg";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}

const statements = [
  `CREATE TABLE IF NOT EXISTS newsletter_domains (
     id serial PRIMARY KEY,
     domain text NOT NULL UNIQUE,
     resend_domain_id text,
     status text NOT NULL DEFAULT 'pending',
     dns_records jsonb,
     created_at timestamp NOT NULL DEFAULT now()
   )`,

  `CREATE TABLE IF NOT EXISTS newsletter_api_keys (
     id serial PRIMARY KEY,
     name text NOT NULL,
     key_hash text NOT NULL UNIQUE,
     key_last_four text NOT NULL DEFAULT '',
     permissions text NOT NULL DEFAULT 'full',
     is_active boolean NOT NULL DEFAULT true,
     last_used_at timestamp,
     created_at timestamp NOT NULL DEFAULT now()
   )`,
  // 舊版曾使用明文 key 欄位；若存在則移除，改用 key_hash。
  `ALTER TABLE newsletter_api_keys DROP COLUMN IF EXISTS key`,
  `ALTER TABLE newsletter_api_keys ADD COLUMN IF NOT EXISTS key_hash text`,
  `ALTER TABLE newsletter_api_keys ADD COLUMN IF NOT EXISTS key_last_four text NOT NULL DEFAULT ''`,
  `DELETE FROM newsletter_api_keys WHERE key_hash IS NULL`,
  `ALTER TABLE newsletter_api_keys ALTER COLUMN key_hash SET NOT NULL`,
  `CREATE UNIQUE INDEX IF NOT EXISTS newsletter_api_keys_key_hash_unique
     ON newsletter_api_keys (key_hash)`,

  `CREATE TABLE IF NOT EXISTS newsletter_subscribers (
     id serial PRIMARY KEY,
     email text NOT NULL UNIQUE,
     name text,
     tags jsonb NOT NULL DEFAULT '[]'::jsonb,
     status text NOT NULL DEFAULT 'subscribed',
     source text NOT NULL DEFAULT 'manual',
     unsubscribe_token text,
     created_at timestamp NOT NULL DEFAULT now(),
     updated_at timestamp NOT NULL DEFAULT now()
   )`,
  `ALTER TABLE newsletter_subscribers ADD COLUMN IF NOT EXISTS unsubscribe_token text`,
  // 為既有列補上不可猜測的隨機權杖，避免 NOT NULL 約束失敗
  `UPDATE newsletter_subscribers SET unsubscribe_token = encode(gen_random_bytes(24), 'hex')
     WHERE unsubscribe_token IS NULL`,
  `ALTER TABLE newsletter_subscribers ALTER COLUMN unsubscribe_token SET NOT NULL`,
  `CREATE UNIQUE INDEX IF NOT EXISTS newsletter_subscribers_unsubscribe_token_unique
     ON newsletter_subscribers (unsubscribe_token)`,
  `CREATE INDEX IF NOT EXISTS idx_newsletter_subscribers_status
     ON newsletter_subscribers (status)`,

  `CREATE TABLE IF NOT EXISTS newsletter_campaigns (
     id serial PRIMARY KEY,
     name text NOT NULL,
     subject text NOT NULL,
     from_email text NOT NULL,
     html_content text NOT NULL DEFAULT '',
     tag_filter text,
     status text NOT NULL DEFAULT 'draft',
     scheduled_at timestamp,
     sent_at timestamp,
     recipient_count integer NOT NULL DEFAULT 0,
     sent_count integer NOT NULL DEFAULT 0,
     failed_count integer NOT NULL DEFAULT 0,
     created_at timestamp NOT NULL DEFAULT now(),
     updated_at timestamp NOT NULL DEFAULT now()
   )`,
  `CREATE INDEX IF NOT EXISTS idx_newsletter_campaigns_status
     ON newsletter_campaigns (status, scheduled_at)`,

  `CREATE TABLE IF NOT EXISTS newsletter_send_logs (
     id serial PRIMARY KEY,
     campaign_id integer REFERENCES newsletter_campaigns(id),
     sequence_step_id integer,
     subscriber_id integer,
     email text NOT NULL,
     subject text,
     status text NOT NULL DEFAULT 'sent',
     error text,
     sent_at timestamp NOT NULL DEFAULT now()
   )`,
  `CREATE INDEX IF NOT EXISTS idx_newsletter_send_logs_campaign
     ON newsletter_send_logs (campaign_id)`,
  `CREATE INDEX IF NOT EXISTS idx_newsletter_send_logs_sent_at
     ON newsletter_send_logs (sent_at)`,

  `CREATE TABLE IF NOT EXISTS newsletter_sequences (
     id serial PRIMARY KEY,
     name text NOT NULL,
     description text,
     from_email text,
     is_active boolean NOT NULL DEFAULT false,
     flow_data jsonb,
     created_at timestamp NOT NULL DEFAULT now(),
     updated_at timestamp NOT NULL DEFAULT now()
   )`,

  `CREATE TABLE IF NOT EXISTS newsletter_sequence_steps (
     id serial PRIMARY KEY,
     sequence_id integer NOT NULL REFERENCES newsletter_sequences(id),
     step_order integer NOT NULL DEFAULT 1,
     delay_days integer NOT NULL DEFAULT 0,
     subject text NOT NULL,
     html_content text NOT NULL DEFAULT '',
     created_at timestamp NOT NULL DEFAULT now()
   )`,
  `CREATE INDEX IF NOT EXISTS idx_newsletter_sequence_steps_seq
     ON newsletter_sequence_steps (sequence_id, step_order)`,

  `CREATE TABLE IF NOT EXISTS newsletter_sequence_enrollments (
     id serial PRIMARY KEY,
     sequence_id integer NOT NULL REFERENCES newsletter_sequences(id),
     subscriber_id integer NOT NULL REFERENCES newsletter_subscribers(id),
     current_step integer NOT NULL DEFAULT 0,
     status text NOT NULL DEFAULT 'active',
     next_send_at timestamp,
     failed_attempts integer NOT NULL DEFAULT 0,
     last_error text,
     enrolled_at timestamp NOT NULL DEFAULT now(),
     completed_at timestamp
   )`,
  `ALTER TABLE newsletter_sequence_enrollments ADD COLUMN IF NOT EXISTS failed_attempts integer NOT NULL DEFAULT 0`,
  `ALTER TABLE newsletter_sequence_enrollments ADD COLUMN IF NOT EXISTS last_error text`,
  `CREATE UNIQUE INDEX IF NOT EXISTS uq_newsletter_enrollment
     ON newsletter_sequence_enrollments (sequence_id, subscriber_id)`,
  `CREATE INDEX IF NOT EXISTS idx_newsletter_enrollments_due
     ON newsletter_sequence_enrollments (status, next_send_at)`,
];

const client = new pg.Client({ connectionString });
await client.connect();
try {
  await client.query("BEGIN");
  await client.query(`CREATE EXTENSION IF NOT EXISTS pgcrypto`);
  for (const statement of statements) {
    await client.query(statement);
  }
  await client.query("COMMIT");
  console.log("migrate-newsletter: done");
} catch (err) {
  await client.query("ROLLBACK");
  console.error("migrate-newsletter: FAILED —", err.message);
  process.exitCode = 1;
} finally {
  await client.end();
}
