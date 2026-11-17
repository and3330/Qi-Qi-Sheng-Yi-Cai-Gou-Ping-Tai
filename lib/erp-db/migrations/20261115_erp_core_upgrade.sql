-- Additive only; reviewed Publish migration, never runtime/startup execution.
-- 薪資項目與薪資結構、付款條件與分期排程、盤點單、工時表、工單人工與製造費用、
-- 催款紀錄、定期發票、請購單、分科目預算。
-- 只新增資料表與欄位，不改任何既有資料。必須在新版程式上線（Publish）之前執行。
BEGIN;

-- 1. 薪資項目
CREATE TABLE IF NOT EXISTS salary_components (
 id serial PRIMARY KEY,
 tenant_id integer NOT NULL DEFAULT (current_setting('app.tenant_id'::text))::integer,
 name text NOT NULL,
 kind text NOT NULL DEFAULT 'earning' CHECK (kind IN ('earning','deduction')),
 default_amount integer NOT NULL DEFAULT 0,
 insurable boolean NOT NULL DEFAULT true,
 is_active boolean NOT NULL DEFAULT true,
 sort_order integer NOT NULL DEFAULT 0,
 note text,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS salary_components_name_unique ON salary_components(tenant_id, name);

CREATE TABLE IF NOT EXISTS employee_salary_components (
 id serial PRIMARY KEY,
 tenant_id integer NOT NULL DEFAULT (current_setting('app.tenant_id'::text))::integer,
 employee_id integer NOT NULL,
 component_id integer NOT NULL,
 amount integer NOT NULL DEFAULT 0,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS employee_salary_components_unique ON employee_salary_components(tenant_id, employee_id, component_id);
CREATE INDEX IF NOT EXISTS employee_salary_components_emp_idx ON employee_salary_components(tenant_id, employee_id);

ALTER TABLE salary_slips ADD COLUMN IF NOT EXISTS components jsonb;
ALTER TABLE salary_slips ADD COLUMN IF NOT EXISTS other_deductions integer NOT NULL DEFAULT 0;

-- 2. 付款條件
CREATE TABLE IF NOT EXISTS payment_terms (
 id serial PRIMARY KEY,
 tenant_id integer NOT NULL DEFAULT (current_setting('app.tenant_id'::text))::integer,
 name text NOT NULL,
 installments jsonb NOT NULL DEFAULT '[]'::jsonb,
 is_active boolean NOT NULL DEFAULT true,
 note text,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS payment_terms_name_unique ON payment_terms(tenant_id, name);
ALTER TABLE customers ADD COLUMN IF NOT EXISTS payment_term_id integer;
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS payment_term_id integer;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS payment_term_id integer;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS payment_schedule jsonb;

-- 3. 盤點單
CREATE TABLE IF NOT EXISTS stock_counts (
 id serial PRIMARY KEY,
 tenant_id integer NOT NULL DEFAULT (current_setting('app.tenant_id'::text))::integer,
 count_number text NOT NULL,
 warehouse_id integer NOT NULL,
 count_date text NOT NULL,
 project_id integer NOT NULL,
 basis text NOT NULL DEFAULT 'warehouse' CHECK (basis IN ('warehouse','total')),
 status text NOT NULL DEFAULT 'Draft' CHECK (status IN ('Draft','Posted','Cancelled')),
 lines jsonb NOT NULL DEFAULT '[]'::jsonb,
 remarks text,
 created_by text,
 posted_by text,
 posted_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS stock_counts_number_unique ON stock_counts(tenant_id, count_number);
ALTER TABLE stock_entries ADD COLUMN IF NOT EXISTS source text;
CREATE INDEX IF NOT EXISTS stock_entries_warehouse_item_idx ON stock_entries(tenant_id, warehouse_id, item_id);

-- 4. 工時表
CREATE TABLE IF NOT EXISTS timesheets (
 id serial PRIMARY KEY,
 tenant_id integer NOT NULL DEFAULT (current_setting('app.tenant_id'::text))::integer,
 employee_id integer NOT NULL,
 work_date text NOT NULL,
 project_id integer NOT NULL,
 task_id integer,
 work_order_id integer,
 hours numeric(6,2) NOT NULL CHECK (hours > 0 AND hours <= 24),
 hourly_cost numeric(12,2) NOT NULL DEFAULT 0,
 cost_amount numeric(12,2) NOT NULL DEFAULT 0,
 description text,
 status text NOT NULL DEFAULT 'Submitted' CHECK (status IN ('Submitted','Approved','Rejected')),
 approved_by text,
 cost_applied boolean NOT NULL DEFAULT false,
 created_by text,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS timesheets_emp_date_idx ON timesheets(tenant_id, employee_id, work_date);
CREATE INDEX IF NOT EXISTS timesheets_project_idx ON timesheets(tenant_id, project_id);
CREATE INDEX IF NOT EXISTS timesheets_work_order_idx ON timesheets(tenant_id, work_order_id);

-- 5. 工單的人工與製造費用
ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS conversion_cost numeric(14,2) NOT NULL DEFAULT 0;
ALTER TABLE job_cards ADD COLUMN IF NOT EXISTS cost_applied boolean NOT NULL DEFAULT false;

-- 6. 催款紀錄、定期發票、請購單、分科目預算
CREATE TABLE IF NOT EXISTS dunning_logs (
 id serial PRIMARY KEY,
 tenant_id integer NOT NULL DEFAULT (current_setting('app.tenant_id'::text))::integer,
 invoice_id integer NOT NULL,
 customer_id integer,
 level integer NOT NULL DEFAULT 1,
 dunned_date text NOT NULL,
 channel text NOT NULL DEFAULT 'phone',
 overdue_amount numeric(14,2) NOT NULL DEFAULT 0,
 note text,
 created_by text,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS dunning_logs_invoice_idx ON dunning_logs(tenant_id, invoice_id);

CREATE TABLE IF NOT EXISTS recurring_invoices (
 id serial PRIMARY KEY,
 tenant_id integer NOT NULL DEFAULT (current_setting('app.tenant_id'::text))::integer,
 name text NOT NULL,
 invoice_type text NOT NULL DEFAULT 'Sales' CHECK (invoice_type IN ('Sales','Purchase')),
 customer_id integer,
 supplier_id integer,
 project_id integer NOT NULL,
 items jsonb NOT NULL DEFAULT '[]'::jsonb,
 tax_type text NOT NULL DEFAULT 'taxable',
 frequency text NOT NULL DEFAULT 'monthly' CHECK (frequency IN ('monthly','quarterly','yearly')),
 next_run_date text NOT NULL,
 end_date text,
 is_active boolean NOT NULL DEFAULT true,
 last_run_date text,
 last_invoice_id integer,
 run_count integer NOT NULL DEFAULT 0,
 note text,
 created_by text,
 created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS material_requests (
 id serial PRIMARY KEY,
 tenant_id integer NOT NULL DEFAULT (current_setting('app.tenant_id'::text))::integer,
 request_number text NOT NULL,
 request_date text NOT NULL,
 needed_by text,
 requester_name text NOT NULL,
 project_id integer NOT NULL,
 department_id integer,
 status text NOT NULL DEFAULT 'Submitted' CHECK (status IN ('Submitted','Approved','Rejected','Ordered','Cancelled')),
 items jsonb NOT NULL DEFAULT '[]'::jsonb,
 reason text,
 reviewed_by text,
 review_note text,
 purchase_order_id integer,
 created_by text,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS material_requests_number_unique ON material_requests(tenant_id, request_number);

CREATE TABLE IF NOT EXISTS budgets (
 id serial PRIMARY KEY,
 tenant_id integer NOT NULL DEFAULT (current_setting('app.tenant_id'::text))::integer,
 fiscal_year integer NOT NULL,
 account_id integer NOT NULL,
 month integer NOT NULL CHECK (month BETWEEN 1 AND 12),
 amount numeric(14,2) NOT NULL DEFAULT 0,
 updated_by text,
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS budgets_year_account_month_unique ON budgets(tenant_id, fiscal_year, account_id, month);

-- 新資料表一律啟用租戶隔離
DO $$
DECLARE t text;
BEGIN
 FOREACH t IN ARRAY ARRAY['salary_components','employee_salary_components','payment_terms','stock_counts','timesheets','dunning_logs','recurring_invoices','material_requests','budgets'] LOOP
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
  EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
  EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
  EXECUTE format('CREATE POLICY tenant_isolation ON %I FOR ALL TO public USING (tenant_id = (current_setting(''app.tenant_id''::text))::integer) WITH CHECK (tenant_id = (current_setting(''app.tenant_id''::text))::integer)', t);
  EXECUTE format('GRANT SELECT,INSERT,UPDATE,DELETE ON %I TO erp_app', t);
  EXECUTE format('GRANT USAGE,SELECT ON SEQUENCE %I TO erp_app', t || '_id_seq');
 END LOOP;
END $$;
COMMIT;
