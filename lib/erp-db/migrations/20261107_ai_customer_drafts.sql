-- Additive only; reviewed Publish migration, never runtime/startup execution.
-- Adds the AI customer-master draft table. No existing table, default or row is changed.
BEGIN;
CREATE TABLE ai_customer_drafts (
 id serial PRIMARY KEY, tenant_id integer NOT NULL,
 payload jsonb NOT NULL,
 status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','confirmed','rejected')),
 summary text NOT NULL, created_by text NOT NULL DEFAULT 'ai', confirmed_by integer,
 confirmed_at timestamptz, result_customer_id integer, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ai_customer_drafts_tenant_created_idx ON ai_customer_drafts(tenant_id,created_at);
ALTER TABLE ai_customer_drafts ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_customer_drafts FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON ai_customer_drafts FOR ALL TO public USING (tenant_id = (current_setting('app.tenant_id'::text))::integer) WITH CHECK (tenant_id = (current_setting('app.tenant_id'::text))::integer);
GRANT SELECT,INSERT,UPDATE ON ai_customer_drafts TO erp_app;
GRANT USAGE,SELECT ON SEQUENCE ai_customer_drafts_id_seq TO erp_app;
COMMIT;
