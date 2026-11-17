-- 金流通路欠款與撥款沖銷：新增 3 張資料表（通路、通路欠款明細、撥款）。不改既有資料。
-- 通路沒有設定「啟用日」之前，外部訂單的入帳方式跟原本完全一樣。

CREATE TABLE IF NOT EXISTS payment_channels (
  tenant_id integer NOT NULL DEFAULT (current_setting('app.tenant_id'::text))::integer,
  id serial PRIMARY KEY,
  code text NOT NULL,
  name text NOT NULL,
  methods jsonb NOT NULL DEFAULT '[]'::jsonb,
  receivable_account_id integer NOT NULL,
  fee_account_id integer,
  bank_account_id integer,
  start_date text,
  is_active boolean NOT NULL DEFAULT true,
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS payment_channels_code_unique ON payment_channels(tenant_id, code);

CREATE TABLE IF NOT EXISTS channel_receivables (
  tenant_id integer NOT NULL DEFAULT (current_setting('app.tenant_id'::text))::integer,
  id serial PRIMARY KEY,
  channel_id integer NOT NULL,
  kind text NOT NULL DEFAULT 'order',
  source_id integer,
  event_id integer,
  sales_order_id integer,
  order_number text,
  external_ref text NOT NULL,
  entry_date text NOT NULL,
  amount numeric(14,2) NOT NULL,
  expected_fee numeric(14,2),
  project_id integer,
  department_id integer,
  payout_id integer,
  settled_fee numeric(14,2),
  settled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS channel_receivables_open_idx ON channel_receivables(tenant_id, channel_id, payout_id);
CREATE INDEX IF NOT EXISTS channel_receivables_ref_idx ON channel_receivables(tenant_id, channel_id, external_ref);

CREATE TABLE IF NOT EXISTS channel_payouts (
  tenant_id integer NOT NULL DEFAULT (current_setting('app.tenant_id'::text))::integer,
  id serial PRIMARY KEY,
  payout_number text NOT NULL,
  channel_id integer NOT NULL,
  payout_date text NOT NULL,
  bank_account_id integer NOT NULL,
  gross_amount numeric(14,2) NOT NULL,
  fee_amount numeric(14,2) NOT NULL DEFAULT 0,
  extra_fee numeric(14,2) NOT NULL DEFAULT 0,
  bank_amount numeric(14,2) NOT NULL,
  line_count integer NOT NULL DEFAULT 0,
  reference text,
  note text,
  journal_entry_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  status text NOT NULL DEFAULT 'Posted',
  created_by text,
  voided_by text,
  voided_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS channel_payouts_number_unique ON channel_payouts(tenant_id, payout_number);
CREATE INDEX IF NOT EXISTS channel_payouts_channel_idx ON channel_payouts(tenant_id, channel_id);

DO $$
DECLARE t text;
BEGIN
 FOREACH t IN ARRAY ARRAY['payment_channels','channel_receivables','channel_payouts'] LOOP
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
  EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
  EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
  EXECUTE format('CREATE POLICY tenant_isolation ON %I FOR ALL TO public USING (tenant_id = (current_setting(''app.tenant_id''::text))::integer) WITH CHECK (tenant_id = (current_setting(''app.tenant_id''::text))::integer)', t);
  EXECUTE format('GRANT SELECT,INSERT,UPDATE,DELETE ON %I TO erp_app', t);
  EXECUTE format('GRANT USAGE,SELECT ON SEQUENCE %I TO erp_app', t || '_id_seq');
 END LOOP;
END $$;
