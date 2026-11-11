import pg from "pg";

// AI 點數：餘額帳戶（單一列）與異動紀錄。可重複執行。
const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required");
const client = new pg.Client({ connectionString });
await client.connect();
try {
  await client.query(`
    CREATE TABLE IF NOT EXISTS ai_credit_account (
      id integer PRIMARY KEY,
      balance integer NOT NULL DEFAULT 0,
      updated_at timestamp NOT NULL DEFAULT now()
    );
    INSERT INTO ai_credit_account (id, balance) VALUES (1, 0) ON CONFLICT (id) DO NOTHING;
    CREATE TABLE IF NOT EXISTS ai_credit_transactions (
      id serial PRIMARY KEY,
      delta integer NOT NULL,
      balance_after integer NOT NULL,
      reason text NOT NULL,
      stripe_ref text,
      member_id integer,
      created_at timestamp NOT NULL DEFAULT now()
    );
    CREATE UNIQUE INDEX IF NOT EXISTS uq_ai_credit_tx_stripe_ref
      ON ai_credit_transactions(stripe_ref)
      WHERE stripe_ref IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_ai_credit_tx_created
      ON ai_credit_transactions(created_at DESC);
  `);
  console.log("AI credits migration complete");
} finally {
  await client.end();
}
