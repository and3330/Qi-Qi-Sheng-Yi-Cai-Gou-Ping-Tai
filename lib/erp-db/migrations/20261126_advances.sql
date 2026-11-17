-- 代墊款與借款：新增 1 張資料表。不改既有資料。
CREATE TABLE IF NOT EXISTS advances (
  tenant_id integer NOT NULL DEFAULT (current_setting('app.tenant_id'::text))::integer,
  id serial PRIMARY KEY,
  advance_number text NOT NULL,
  party_type text NOT NULL,
  employee_id integer,
  party_name text NOT NULL,
  kind text NOT NULL,
  amount numeric(14,2) NOT NULL,
  tax_amount numeric(14,2) NOT NULL DEFAULT 0,
  repaid_amount numeric(14,2) NOT NULL DEFAULT 0,
  entry_date text NOT NULL,
  description text,
  project_id integer,
  department_id integer,
  counter_account_id integer NOT NULL,
  liability_account_id integer NOT NULL,
  status text NOT NULL DEFAULT 'Open',
  journal_entry_id integer,
  repayments jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS advances_number_unique ON advances(tenant_id, advance_number);
CREATE INDEX IF NOT EXISTS advances_party_idx ON advances(tenant_id, party_type, party_name);

ALTER TABLE advances ENABLE ROW LEVEL SECURITY;
ALTER TABLE advances FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON advances;
CREATE POLICY tenant_isolation ON advances FOR ALL TO public
  USING (tenant_id = (current_setting('app.tenant_id'::text))::integer)
  WITH CHECK (tenant_id = (current_setting('app.tenant_id'::text))::integer);
GRANT SELECT,INSERT,UPDATE,DELETE ON advances TO erp_app;
GRANT USAGE,SELECT ON SEQUENCE advances_id_seq TO erp_app;
