-- 外部系統串接：新增 5 張資料表（來源、對應表、品項對應、收件匣、儲值金明細）。不改既有資料。

CREATE TABLE IF NOT EXISTS integration_sources (
  tenant_id integer NOT NULL DEFAULT (current_setting('app.tenant_id'::text))::integer,
  id serial PRIMARY KEY,
  code text NOT NULL,
  name text NOT NULL,
  api_key_id integer,
  default_project_id integer,
  default_department_id integer,
  default_cash_account_id integer,
  is_active boolean NOT NULL DEFAULT true,
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS integration_sources_code_unique ON integration_sources(tenant_id, code);

CREATE TABLE IF NOT EXISTS integration_mappings (
  tenant_id integer NOT NULL DEFAULT (current_setting('app.tenant_id'::text))::integer,
  id serial PRIMARY KEY,
  source_id integer NOT NULL,
  external_type text NOT NULL,
  label text,
  project_id integer,
  department_id integer,
  revenue_account_id integer,
  expense_account_id integer,
  default_item_id integer,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS integration_mappings_unique ON integration_mappings(tenant_id, source_id, external_type);

CREATE TABLE IF NOT EXISTS integration_item_maps (
  tenant_id integer NOT NULL DEFAULT (current_setting('app.tenant_id'::text))::integer,
  id serial PRIMARY KEY,
  source_id integer NOT NULL,
  external_sku text NOT NULL,
  external_name text,
  item_id integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS integration_item_maps_unique ON integration_item_maps(tenant_id, source_id, external_sku);

CREATE TABLE IF NOT EXISTS integration_events (
  tenant_id integer NOT NULL DEFAULT (current_setting('app.tenant_id'::text))::integer,
  id serial PRIMARY KEY,
  source_id integer NOT NULL,
  kind text NOT NULL,
  external_id text NOT NULL,
  occurred_at text NOT NULL,
  payload jsonb NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  error text,
  result jsonb,
  attempts integer NOT NULL DEFAULT 0,
  amount numeric(14,2) NOT NULL DEFAULT 0,
  summary text,
  received_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  processed_by text
);
CREATE UNIQUE INDEX IF NOT EXISTS integration_events_unique ON integration_events(tenant_id, source_id, kind, external_id);
CREATE INDEX IF NOT EXISTS integration_events_status_idx ON integration_events(tenant_id, status);

CREATE TABLE IF NOT EXISTS stored_value_ledger (
  tenant_id integer NOT NULL DEFAULT (current_setting('app.tenant_id'::text))::integer,
  id serial PRIMARY KEY,
  source_id integer NOT NULL,
  customer_id integer NOT NULL,
  amount numeric(14,2) NOT NULL,
  entry_type text NOT NULL,
  event_id integer,
  entry_date text NOT NULL,
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS stored_value_ledger_customer_idx ON stored_value_ledger(tenant_id, source_id, customer_id);

DO $$
DECLARE t text;
BEGIN
 FOREACH t IN ARRAY ARRAY['integration_sources','integration_mappings','integration_item_maps','integration_events','stored_value_ledger'] LOOP
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
  EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
  EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
  EXECUTE format('CREATE POLICY tenant_isolation ON %I FOR ALL TO public USING (tenant_id = (current_setting(''app.tenant_id''::text))::integer) WITH CHECK (tenant_id = (current_setting(''app.tenant_id''::text))::integer)', t);
  EXECUTE format('GRANT SELECT,INSERT,UPDATE,DELETE ON %I TO erp_app', t);
  EXECUTE format('GRANT USAGE,SELECT ON SEQUENCE %I TO erp_app', t || '_id_seq');
 END LOOP;
END $$;
