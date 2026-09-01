/** ERP 合約模組－可重複執行的資料庫遷移。 */
import pg from "pg";
const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is not set");
const statements = [
  `CREATE TABLE IF NOT EXISTS erp_contracts (id serial PRIMARY KEY, contract_no text NOT NULL, title text NOT NULL, party_type text NOT NULL DEFAULT 'other', customer_id integer, supplier_id integer, amount integer, signed_date text, start_date text, end_date text, status text NOT NULL DEFAULT 'draft', renewal_notice boolean NOT NULL DEFAULT false, notes text, created_at timestamptz NOT NULL DEFAULT now())`,
  `CREATE UNIQUE INDEX IF NOT EXISTS uq_erp_contracts_no ON erp_contracts(contract_no)`,
  `CREATE INDEX IF NOT EXISTS idx_erp_contracts_status ON erp_contracts(status)`,
  `CREATE INDEX IF NOT EXISTS idx_erp_contracts_end_date ON erp_contracts(end_date)`,
];
const client = new pg.Client({ connectionString }); await client.connect();
try { for (const statement of statements) await client.query(statement); console.log("erp-contracts migration completed"); }
finally { await client.end(); }