/**
 * 社群行銷模組 — 冪等資料庫遷移
 *
 * 建立社群帳號、貼文與自動化設定資料表，可重複執行。
 * 執行方式：pnpm --filter @workspace/db run migrate:social-marketing
 */
import pg from "pg";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}

const statements = [
  `CREATE TABLE IF NOT EXISTS social_marketing_accounts (
     id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
     platform text NOT NULL,
     platform_account_id text NOT NULL,
     account_name text NOT NULL,
     account_type text NOT NULL DEFAULT 'page',
     access_token text NOT NULL,
     refresh_token text,
     token_expires_at timestamp,
     profile_image_url text,
     metadata jsonb,
     is_active boolean NOT NULL DEFAULT true,
     created_at timestamp NOT NULL DEFAULT now(),
     updated_at timestamp NOT NULL DEFAULT now(),
     CONSTRAINT uq_sma_platform_account UNIQUE (platform, platform_account_id)
   )`,
  `CREATE INDEX IF NOT EXISTS idx_sma_platform
     ON social_marketing_accounts (platform)`,
  `CREATE TABLE IF NOT EXISTS social_posts (
     id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
     content text NOT NULL,
     platforms text[] NOT NULL DEFAULT ARRAY[]::text[],
     hashtags text,
     image_urls text[] DEFAULT ARRAY[]::text[],
     scheduled_at timestamp,
     published_at timestamp,
     status text NOT NULL DEFAULT 'draft',
     platform_results jsonb,
     target_account_ids jsonb NOT NULL DEFAULT '{}'::jsonb,
     error_message text,
     created_at timestamp NOT NULL DEFAULT now(),
     updated_at timestamp NOT NULL DEFAULT now()
   )`,
  `CREATE INDEX IF NOT EXISTS idx_social_posts_status
     ON social_posts (status)`,
  `CREATE INDEX IF NOT EXISTS idx_social_posts_scheduled
     ON social_posts (scheduled_at)`,
  `ALTER TABLE social_posts
     ADD COLUMN IF NOT EXISTS target_account_ids jsonb NOT NULL DEFAULT '{}'::jsonb`,
  `CREATE TABLE IF NOT EXISTS marketing_automation_settings (
     id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
     key text NOT NULL UNIQUE,
     enabled boolean NOT NULL DEFAULT false,
     config jsonb,
     updated_at timestamp NOT NULL DEFAULT now()
   )`,
];

const client = new pg.Client({ connectionString });
await client.connect();
try {
  await client.query("BEGIN");
  for (const statement of statements) {
    await client.query(statement);
  }
  await client.query("COMMIT");
  console.log("migrate-social-marketing: done");
} catch (err) {
  await client.query("ROLLBACK");
  console.error("migrate-social-marketing: FAILED —", err.message);
  process.exitCode = 1;
} finally {
  await client.end();
}