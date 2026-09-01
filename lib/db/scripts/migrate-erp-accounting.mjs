/**
 * ERP 會計財務模組 — 冪等資料庫遷移
 *
 * 新增科目/日記帳/收付款單/發票/核銷/付款申請/銀行對帳/會計設定等表，
 * 並種入預設會計科目表（COA）。可重複執行（IF NOT EXISTS / ON CONFLICT）。
 * 執行： pnpm --filter @workspace/db run migrate:erp-accounting
 */
import pg from "pg";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}

const statements = [
  // ---------- 會計科目 ----------
  `CREATE TABLE IF NOT EXISTS erp_accounts (
     id serial PRIMARY KEY,
     account_number text NOT NULL UNIQUE,
     account_name text NOT NULL,
     account_type text NOT NULL,
     parent_account_id integer,
     is_group boolean NOT NULL DEFAULT false,
     cash_flow_category text,
     balance integer NOT NULL DEFAULT 0,
     description text,
     is_active boolean NOT NULL DEFAULT true,
     created_at timestamp NOT NULL DEFAULT now()
   )`,
  `CREATE INDEX IF NOT EXISTS idx_erp_accounts_parent ON erp_accounts (parent_account_id)`,

  // ---------- 日記帳/傳票 ----------
  `CREATE TABLE IF NOT EXISTS erp_journal_entries (
     id serial PRIMARY KEY,
     entry_number text NOT NULL UNIQUE,
     entry_date text NOT NULL,
     reference text,
     description text,
     total_debit integer NOT NULL DEFAULT 0,
     total_credit integer NOT NULL DEFAULT 0,
     lines jsonb NOT NULL DEFAULT '[]'::jsonb,
     status text NOT NULL DEFAULT 'Posted',
     is_auto boolean NOT NULL DEFAULT false,
     source_type text,
     source_id text,
     created_by integer,
     created_at timestamp NOT NULL DEFAULT now()
   )`,
  `CREATE INDEX IF NOT EXISTS idx_erp_je_date ON erp_journal_entries (entry_date)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS uq_erp_je_source ON erp_journal_entries (source_type, source_id)
     WHERE source_type IS NOT NULL AND source_id IS NOT NULL`,

  // ---------- 收付款/請款單 ----------
  `CREATE TABLE IF NOT EXISTS erp_vouchers (
     id serial PRIMARY KEY,
     voucher_number text NOT NULL UNIQUE,
     voucher_type text NOT NULL,
     voucher_date text NOT NULL,
     party_type text,
     customer_id integer REFERENCES erp_customers(id),
     supplier_id integer REFERENCES suppliers(id),
     total_amount integer NOT NULL DEFAULT 0,
     payment_method text,
     bank_account text,
     items jsonb NOT NULL DEFAULT '[]'::jsonb,
     remarks text,
     journal_entry_id integer REFERENCES erp_journal_entries(id),
     created_by integer,
     created_at timestamp NOT NULL DEFAULT now()
   )`,
  `CREATE INDEX IF NOT EXISTS idx_erp_vouchers_type_date ON erp_vouchers (voucher_type, voucher_date)`,

  // ---------- 發票（AR/AP） ----------
  `CREATE TABLE IF NOT EXISTS erp_invoices (
     id serial PRIMARY KEY,
     invoice_number text NOT NULL UNIQUE,
     invoice_type text NOT NULL,
     customer_id integer REFERENCES erp_customers(id),
     supplier_id integer REFERENCES suppliers(id),
     sales_order_id integer REFERENCES sales_orders(id),
     purchase_order_id integer REFERENCES purchase_orders(id),
     invoice_date text NOT NULL,
     due_date text,
     total_amount integer NOT NULL DEFAULT 0,
     paid_amount integer NOT NULL DEFAULT 0,
     outstanding_amount integer NOT NULL DEFAULT 0,
     tax_type text NOT NULL DEFAULT 'taxable',
     tax_rate integer NOT NULL DEFAULT 5,
     net_amount integer NOT NULL DEFAULT 0,
     tax_amount integer NOT NULL DEFAULT 0,
     gov_invoice_number text,
     status text NOT NULL DEFAULT 'Unpaid',
     items jsonb NOT NULL DEFAULT '[]'::jsonb,
     remarks text,
     journal_entry_id integer REFERENCES erp_journal_entries(id),
     created_by integer,
     created_at timestamp NOT NULL DEFAULT now()
   )`,
  `CREATE INDEX IF NOT EXISTS idx_erp_invoices_type_status ON erp_invoices (invoice_type, status)`,
  `CREATE INDEX IF NOT EXISTS idx_erp_invoices_customer ON erp_invoices (customer_id)`,
  `CREATE INDEX IF NOT EXISTS idx_erp_invoices_supplier ON erp_invoices (supplier_id)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS uq_erp_invoices_sales_order ON erp_invoices (sales_order_id)
     WHERE sales_order_id IS NOT NULL`,
  `CREATE UNIQUE INDEX IF NOT EXISTS uq_erp_invoices_purchase_order ON erp_invoices (purchase_order_id)
     WHERE purchase_order_id IS NOT NULL`,

  // ---------- 核銷 ----------
  `CREATE TABLE IF NOT EXISTS erp_invoice_settlements (
     id serial PRIMARY KEY,
     invoice_id integer NOT NULL REFERENCES erp_invoices(id) ON DELETE CASCADE,
     voucher_id integer REFERENCES erp_vouchers(id) ON DELETE CASCADE,
     payment_request_id integer,
     amount integer NOT NULL,
     remarks text,
     created_at timestamp NOT NULL DEFAULT now()
   )`,
  `CREATE INDEX IF NOT EXISTS idx_erp_settlements_invoice ON erp_invoice_settlements (invoice_id)`,

  // ---------- 付款申請 ----------
  `CREATE TABLE IF NOT EXISTS erp_payment_requests (
     id serial PRIMARY KEY,
     request_number text NOT NULL UNIQUE,
     invoice_id integer REFERENCES erp_invoices(id),
     party_type text NOT NULL,
     customer_id integer REFERENCES erp_customers(id),
     supplier_id integer REFERENCES suppliers(id),
     request_date text NOT NULL,
     due_date text,
     amount integer NOT NULL,
     status text NOT NULL DEFAULT 'Draft',
     payment_method text,
     bank_account text,
     remarks text,
     created_by integer,
     created_at timestamp NOT NULL DEFAULT now()
   )`,
  `CREATE INDEX IF NOT EXISTS idx_erp_payreq_status ON erp_payment_requests (status)`,

  // ---------- 銀行對帳 ----------
  `CREATE TABLE IF NOT EXISTS erp_bank_statements (
     id serial PRIMARY KEY,
     bank_name text,
     account_number text,
     bank_account_id integer,
     statement_date text NOT NULL,
     opening_balance integer NOT NULL DEFAULT 0,
     closing_balance integer NOT NULL DEFAULT 0,
     status text NOT NULL DEFAULT 'draft',
     remarks text,
     created_at timestamp NOT NULL DEFAULT now()
   )`,
  `CREATE TABLE IF NOT EXISTS erp_bank_reconciliation_entries (
     id serial PRIMARY KEY,
     statement_id integer NOT NULL REFERENCES erp_bank_statements(id) ON DELETE CASCADE,
     transaction_date text NOT NULL,
     description text,
     debit integer NOT NULL DEFAULT 0,
     credit integer NOT NULL DEFAULT 0,
     reference text,
     matched_voucher_id integer REFERENCES erp_vouchers(id),
     matched_journal_entry_id integer REFERENCES erp_journal_entries(id),
     match_status text NOT NULL DEFAULT 'unmatched',
     created_at timestamp NOT NULL DEFAULT now()
   )`,
  `CREATE INDEX IF NOT EXISTS idx_erp_bankrec_statement ON erp_bank_reconciliation_entries (statement_id)`,
  // 修補既有資料庫（早期版本欄位/預設值差異）
  `ALTER TABLE erp_bank_statements ALTER COLUMN bank_name DROP NOT NULL`,
  `ALTER TABLE erp_bank_statements ADD COLUMN IF NOT EXISTS bank_account_id integer`,
  `ALTER TABLE erp_bank_statements ADD COLUMN IF NOT EXISTS opening_balance integer NOT NULL DEFAULT 0`,
  `ALTER TABLE erp_bank_statements ADD COLUMN IF NOT EXISTS closing_balance integer NOT NULL DEFAULT 0`,
  `ALTER TABLE erp_bank_statements ALTER COLUMN status SET DEFAULT 'draft'`,
  `UPDATE erp_bank_statements SET status='draft' WHERE status='Open'`,
  `UPDATE erp_bank_statements SET status='completed' WHERE status='Reconciled'`,
  `ALTER TABLE erp_bank_reconciliation_entries ADD COLUMN IF NOT EXISTS matched_journal_entry_id integer REFERENCES erp_journal_entries(id)`,
  `ALTER TABLE erp_bank_reconciliation_entries ALTER COLUMN match_status SET DEFAULT 'unmatched'`,
  `UPDATE erp_bank_reconciliation_entries SET match_status=lower(match_status)`,

  // ---------- 會計設定（單列） ----------
  `CREATE TABLE IF NOT EXISTS erp_accounting_settings (
     id serial PRIMARY KEY,
     lock_date text,
     updated_at timestamp NOT NULL DEFAULT now()
   )`,
  `INSERT INTO erp_accounting_settings (id, lock_date)
     SELECT 1, NULL WHERE NOT EXISTS (SELECT 1 FROM erp_accounting_settings)`,
];

/**
 * 預設會計科目表（COA）。
 * [accountNumber, accountName, accountType, parentNumber|null, isGroup, cashFlowCategory|null]
 * 自動立帳依「科目名稱」解析到葉節點科目，勿隨意改名（見 erpAutoJournal.ts）。
 */
const coa = [
  ["1000", "資產", "Asset", null, true, null],
  ["1100", "流動資產", "Asset", "1000", true, null],
  ["1111", "庫存現金", "Asset", "1100", false, "cash"],
  ["1113", "銀行存款", "Asset", "1100", false, "cash"],
  ["1141", "應收帳款", "Asset", "1100", false, "operating"],
  ["1145", "進項稅額", "Asset", "1100", false, "operating"],
  ["1301", "存貨", "Asset", "1100", false, "operating"],
  ["1500", "固定資產", "Asset", "1000", true, null],
  ["1511", "機器設備", "Asset", "1500", false, "investing"],
  ["2000", "負債", "Liability", null, true, null],
  ["2100", "流動負債", "Liability", "2000", true, null],
  ["2141", "應付帳款", "Liability", "2100", false, "operating"],
  ["2143", "錢包儲值負債", "Liability", "2100", false, "operating"],
  ["2201", "應付營業稅", "Liability", "2100", false, "operating"],
  ["2202", "銷項稅額", "Liability", "2100", false, "operating"],
  ["3000", "權益", "Equity", null, true, null],
  ["3110", "股本", "Equity", "3000", false, "financing"],
  ["3350", "保留盈餘", "Equity", "3000", false, "financing"],
  ["4000", "收入", "Income", null, true, null],
  ["4111", "銷貨收入", "Income", "4000", false, "operating"],
  ["4171", "銷貨退回", "Income", "4000", false, "operating"],
  ["4611", "其他收入", "Income", "4000", false, "operating"],
  ["5000", "費用", "Expense", null, true, null],
  ["5111", "銷貨成本", "Expense", "5000", false, "operating"],
  ["6100", "營業費用", "Expense", "5000", false, "operating"],
  ["6111", "薪資費用", "Expense", "5000", false, "operating"],
  ["6151", "租金費用", "Expense", "5000", false, "operating"],
  ["6215", "分潤費用", "Expense", "5000", false, "operating"],
];

async function main() {
  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    for (const stmt of statements) {
      await client.query(stmt);
    }
    // 種入 COA（先父後子；已存在則略過）
    for (const [num, name, type, parentNum, isGroup, cfc] of coa) {
      await client.query(
        `INSERT INTO erp_accounts (account_number, account_name, account_type, parent_account_id, is_group, cash_flow_category)
         SELECT $1, $2, $3, (SELECT id FROM erp_accounts WHERE account_number = $4), $5, $6
         WHERE NOT EXISTS (SELECT 1 FROM erp_accounts WHERE account_number = $1)`,
        [num, name, type, parentNum, isGroup, cfc],
      );
    }
    console.log("erp-accounting migration completed");
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
