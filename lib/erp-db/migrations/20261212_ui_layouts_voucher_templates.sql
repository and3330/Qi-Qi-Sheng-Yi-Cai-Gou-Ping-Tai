-- 畫面版面設定（視覺化編輯：每個視窗的欄位名稱、顯示與否、順序）＋ 收付款單模板。
-- 新增 2 張資料表、收付款單多 2 個欄位（用了哪個模板、模板自訂欄位的值）；不改既有資料。
CREATE TABLE IF NOT EXISTS ui_layouts (
  tenant_id integer NOT NULL DEFAULT (current_setting('app.tenant_id'::text))::integer,
  id serial PRIMARY KEY,
  layout_key text NOT NULL,
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_by text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS ui_layouts_key_unique ON ui_layouts(tenant_id, layout_key);

CREATE TABLE IF NOT EXISTS voucher_templates (
  tenant_id integer NOT NULL DEFAULT (current_setting('app.tenant_id'::text))::integer,
  id serial PRIMARY KEY,
  name text NOT NULL,
  voucher_type text NOT NULL,
  description text,
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS voucher_templates_type_idx ON voucher_templates(tenant_id, voucher_type);

ALTER TABLE vouchers ADD COLUMN IF NOT EXISTS template_id integer;
ALTER TABLE vouchers ADD COLUMN IF NOT EXISTS extra_fields jsonb;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['ui_layouts', 'voucher_templates'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I FOR ALL TO public USING (tenant_id = (current_setting(''app.tenant_id''::text))::integer) WITH CHECK (tenant_id = (current_setting(''app.tenant_id''::text))::integer)', t);
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'erp_app') THEN
      EXECUTE format('GRANT SELECT,INSERT,UPDATE,DELETE ON %I TO erp_app', t);
      EXECUTE format('GRANT USAGE,SELECT ON SEQUENCE %I TO erp_app', t || '_id_seq');
    END IF;
  END LOOP;
END $$;
