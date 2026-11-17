-- 客戶信用額度（新增 1 個欄位）＋ 詢價單（新增 1 張資料表）。不改既有資料。
ALTER TABLE customers ADD COLUMN IF NOT EXISTS credit_limit numeric(14,2);

CREATE TABLE IF NOT EXISTS rfqs (
  tenant_id integer NOT NULL DEFAULT (current_setting('app.tenant_id'::text))::integer,
  id serial PRIMARY KEY,
  rfq_number text NOT NULL,
  rfq_date text NOT NULL,
  due_date text,
  title text,
  status text NOT NULL DEFAULT 'Open',
  items jsonb NOT NULL DEFAULT '[]'::jsonb,
  quotes jsonb NOT NULL DEFAULT '[]'::jsonb,
  project_id integer,
  department_id integer,
  awarded_supplier_id integer,
  purchase_order_id integer,
  notes text,
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS rfqs_number_unique ON rfqs(tenant_id, rfq_number);

ALTER TABLE rfqs ENABLE ROW LEVEL SECURITY;
ALTER TABLE rfqs FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON rfqs;
CREATE POLICY tenant_isolation ON rfqs FOR ALL TO public
  USING (tenant_id = (current_setting('app.tenant_id'::text))::integer)
  WITH CHECK (tenant_id = (current_setting('app.tenant_id'::text))::integer);
GRANT SELECT,INSERT,UPDATE,DELETE ON rfqs TO erp_app;
GRANT USAGE,SELECT ON SEQUENCE rfqs_id_seq TO erp_app;
