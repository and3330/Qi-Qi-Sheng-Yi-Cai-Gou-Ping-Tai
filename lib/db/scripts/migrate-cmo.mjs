/**
 * AI CMO 智慧中控台 — 冪等資料庫遷移
 *
 * 建立 KPI 目標、每日報告與數據快照資料表，可重複執行。
 * 執行方式：pnpm --filter @workspace/db run migrate:cmo
 */
import pg from "pg";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}

const statements = [
  `CREATE TABLE IF NOT EXISTS cmo_goals (
     id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
     metric text NOT NULL,
     label text NOT NULL,
     target_value numeric(14,2) NOT NULL,
     current_value numeric(14,2) NOT NULL DEFAULT 0,
     unit text NOT NULL DEFAULT '',
     period text NOT NULL DEFAULT 'monthly',
     priority text NOT NULL DEFAULT 'medium',
     status text NOT NULL DEFAULT 'active',
     start_date date NOT NULL,
     end_date date NOT NULL,
     is_active boolean NOT NULL DEFAULT true,
     created_at timestamp NOT NULL DEFAULT now(),
     updated_at timestamp NOT NULL DEFAULT now()
   )`,
  `CREATE TABLE IF NOT EXISTS cmo_reports (
     id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
     report_date date NOT NULL,
     report_type text NOT NULL DEFAULT 'daily',
     summary text NOT NULL,
     kpi_snapshot jsonb,
     goal_progress jsonb,
     recommendations text,
     raw_data jsonb,
     created_at timestamp NOT NULL DEFAULT now()
   )`,
  `CREATE INDEX IF NOT EXISTS idx_cmo_reports_date
     ON cmo_reports (report_date)`,
  // daily 報告每日僅一筆（多實例競態下保證冪等）；manual 不受限
  `CREATE UNIQUE INDEX IF NOT EXISTS uq_cmo_reports_daily
     ON cmo_reports (report_date) WHERE report_type = 'daily'`,
  `CREATE TABLE IF NOT EXISTS cmo_metric_snapshots (
     id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
     snapshot_date date NOT NULL,
     data jsonb NOT NULL,
     created_at timestamp NOT NULL DEFAULT now(),
     CONSTRAINT uq_cmo_snapshot_date UNIQUE (snapshot_date)
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
  console.log("migrate-cmo: done");
} catch (err) {
  await client.query("ROLLBACK");
  console.error("migrate-cmo: FAILED —", err.message);
  process.exitCode = 1;
} finally {
  await client.end();
}
