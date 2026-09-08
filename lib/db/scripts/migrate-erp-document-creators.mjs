/**
 * ERP 單據製單人欄位 — 冪等遷移。
 *
 * 保留既有 created_by 稽核欄位；歷史單據的 creator_employee_id 維持 null。
 * 執行：pnpm --filter @workspace/db run migrate:erp-document-creators
 */
import pg from "pg";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}

const statements = [
  `ALTER TABLE quotations ADD COLUMN IF NOT EXISTS creator_employee_id integer REFERENCES erp_employees(id)`,
  `ALTER TABLE sales_orders ADD COLUMN IF NOT EXISTS creator_employee_id integer REFERENCES erp_employees(id)`,
  `ALTER TABLE sales_returns ADD COLUMN IF NOT EXISTS creator_employee_id integer REFERENCES erp_employees(id)`,
  `ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS creator_employee_id integer REFERENCES erp_employees(id)`,
  `ALTER TABLE purchase_returns ADD COLUMN IF NOT EXISTS creator_employee_id integer REFERENCES erp_employees(id)`,
  `ALTER TABLE stock_transfers ADD COLUMN IF NOT EXISTS creator_employee_id integer REFERENCES erp_employees(id)`,
];

const client = new pg.Client({ connectionString });
await client.connect();
try {
  await client.query("BEGIN");
  for (const statement of statements) await client.query(statement);
  await client.query("COMMIT");
  console.log("migrate-erp-document-creators: done");
} catch (err) {
  await client.query("ROLLBACK");
  console.error("migrate-erp-document-creators: FAILED —", err.message);
  process.exitCode = 1;
} finally {
  await client.end();
}