-- Additive only; reviewed Publish migration, never runtime/startup execution.
-- 講師與服務費（勞務報酬）：服務型單據的人事成本登錄，年底彙總各人所得。
-- 只新增一張表，不改任何既有資料。必須在新版程式上線（Publish）之前執行。
BEGIN;
CREATE TABLE IF NOT EXISTS service_fees (
 id serial PRIMARY KEY,
 tenant_id integer NOT NULL DEFAULT (current_setting('app.tenant_id'::text))::integer,
 fee_number text NOT NULL,
 payee_type text NOT NULL CHECK (payee_type IN ('teacher','employee')),
 teacher_id integer,
 employee_id integer,
 payee_name text NOT NULL,
 sales_order_id integer,
 project_id integer NOT NULL,
 department_id integer,
 service_date text NOT NULL,
 description text,
 hours numeric(8,2),
 rate numeric(12,2),
 amount numeric(12,2) NOT NULL,
 income_type text NOT NULL DEFAULT '50',
 withholding_tax numeric(12,2) NOT NULL DEFAULT 0,
 nhi_supplement numeric(12,2) NOT NULL DEFAULT 0,
 net_amount numeric(12,2) NOT NULL,
 status text NOT NULL DEFAULT 'Confirmed' CHECK (status IN ('Confirmed','Paid','Voided')),
 paid_date text,
 journal_entry_id integer,
 payment_journal_entry_id integer,
 created_by text,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS service_fees_number_unique ON service_fees(tenant_id, fee_number);
CREATE INDEX IF NOT EXISTS service_fees_order_idx ON service_fees(tenant_id, sales_order_id);
CREATE INDEX IF NOT EXISTS service_fees_date_idx ON service_fees(tenant_id, service_date);
ALTER TABLE service_fees ENABLE ROW LEVEL SECURITY;
ALTER TABLE service_fees FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON service_fees;
CREATE POLICY tenant_isolation ON service_fees FOR ALL TO public USING (tenant_id = (current_setting('app.tenant_id'::text))::integer) WITH CHECK (tenant_id = (current_setting('app.tenant_id'::text))::integer);
GRANT SELECT,INSERT,UPDATE,DELETE ON service_fees TO erp_app;
GRANT USAGE,SELECT ON SEQUENCE service_fees_id_seq TO erp_app;
COMMIT;
