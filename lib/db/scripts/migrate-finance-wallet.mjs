/**
 * 財務、錢包與利潤模組 — 冪等資料庫遷移
 *
 * 建立錢包／分潤／支出相關資料表與欄位，可重複執行（IF NOT EXISTS）。
 * 執行方式（於 lib/db 目錄）： node scripts/migrate-finance-wallet.mjs
 * 或： pnpm --filter @workspace/db run migrate:finance-wallet
 */
import pg from "pg";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}

const statements = [
  // 會員錢包餘額（新欄位，含預設值，對既有資料安全）
  `ALTER TABLE members ADD COLUMN IF NOT EXISTS wallet_balance integer NOT NULL DEFAULT 0`,

  // 訂單項目成本快照（供損益報表的銷貨成本計算）
  `ALTER TABLE order_items ADD COLUMN IF NOT EXISTS unit_cost integer NOT NULL DEFAULT 0`,

  // 商品成本價（部分環境可能尚未有此欄位）
  `ALTER TABLE products ADD COLUMN IF NOT EXISTS cost_price integer NOT NULL DEFAULT 0`,

  // 既有訂單項目回填成本快照（僅回填仍為 0 者，冪等）
  `UPDATE order_items oi
     SET unit_cost = p.cost_price
    FROM products p
   WHERE oi.product_id = p.id
     AND oi.unit_cost = 0
     AND p.cost_price > 0`,

  // 錢包交易明細
  `CREATE TABLE IF NOT EXISTS wallet_transactions (
     id serial PRIMARY KEY,
     member_id integer NOT NULL REFERENCES members(id),
     type text NOT NULL,
     amount integer NOT NULL,
     balance_after integer NOT NULL,
     reason text,
     ref_no text,
     created_by integer,
     created_at timestamp NOT NULL DEFAULT now()
   )`,
  `CREATE INDEX IF NOT EXISTS wallet_transactions_member_id_idx
     ON wallet_transactions (member_id)`,

  // 分潤規則
  `CREATE TABLE IF NOT EXISTS profit_rules (
     id serial PRIMARY KEY,
     name text NOT NULL,
     tier text NOT NULL DEFAULT 'all',
     percent_bps integer NOT NULL,
     is_active boolean NOT NULL DEFAULT true,
     created_at timestamp NOT NULL DEFAULT now()
   )`,
  // 同一身份同時間只允許一條啟用中的規則（資料庫層強制，避免併發繞過）
  `CREATE UNIQUE INDEX IF NOT EXISTS profit_rules_one_active_per_tier
     ON profit_rules (tier) WHERE is_active = true`,

  // 分潤紀錄
  `CREATE TABLE IF NOT EXISTS profit_share_records (
     id serial PRIMARY KEY,
     order_id integer NOT NULL REFERENCES orders(id),
     order_no text NOT NULL,
     member_id integer NOT NULL REFERENCES members(id),
     rule_id integer,
     rule_name text NOT NULL,
     percent_bps integer NOT NULL,
     base_amount integer NOT NULL,
     amount integer NOT NULL,
     created_at timestamp NOT NULL DEFAULT now()
   )`,
  `CREATE INDEX IF NOT EXISTS profit_share_records_order_id_idx
     ON profit_share_records (order_id)`,
  `CREATE INDEX IF NOT EXISTS profit_share_records_member_id_idx
     ON profit_share_records (member_id)`,

  // 支出紀錄
  `CREATE TABLE IF NOT EXISTS expenses (
     id serial PRIMARY KEY,
     category text NOT NULL,
     title text NOT NULL,
     amount integer NOT NULL,
     note text,
     spent_at timestamp NOT NULL DEFAULT now(),
     created_by integer,
     created_at timestamp NOT NULL DEFAULT now()
   )`,
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
  console.log("migrate-finance-wallet: done");
} catch (err) {
  await client.query("ROLLBACK");
  console.error("migrate-finance-wallet: FAILED —", err.message);
  process.exitCode = 1;
} finally {
  await client.end();
}
