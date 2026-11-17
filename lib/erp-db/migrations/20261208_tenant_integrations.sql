-- 各公司自己的串接設定（綠界電子發票、Resend 寄信）：新增 1 張資料表。不改既有資料。
-- 金鑰加密後才存（secret_cipher），解密金鑰在主機環境變數 ERP_SECRETS_KEY，不在資料庫裡。
CREATE TABLE IF NOT EXISTS tenant_integrations (
  tenant_id integer NOT NULL DEFAULT (current_setting('app.tenant_id'::text))::integer,
  id serial PRIMARY KEY,
  provider text NOT NULL,
  settings jsonb NOT NULL DEFAULT '{}'::jsonb,
  secret_cipher text,
  secret_hint text,
  updated_by text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS tenant_integrations_provider_unique ON tenant_integrations(tenant_id, provider);

ALTER TABLE tenant_integrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_integrations FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON tenant_integrations;
CREATE POLICY tenant_isolation ON tenant_integrations FOR ALL TO public USING (tenant_id = (current_setting('app.tenant_id'::text))::integer) WITH CHECK (tenant_id = (current_setting('app.tenant_id'::text))::integer);
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'erp_app') THEN
    GRANT SELECT,INSERT,UPDATE,DELETE ON tenant_integrations TO erp_app;
    GRANT USAGE,SELECT ON SEQUENCE tenant_integrations_id_seq TO erp_app;
  END IF;
END $$;
