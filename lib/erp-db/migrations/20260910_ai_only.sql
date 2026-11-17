-- Additive only; reviewed Publish migration, never runtime/startup execution.
BEGIN;
CREATE TABLE ai_actions (
 id serial PRIMARY KEY, tenant_id integer NOT NULL,
 tool text NOT NULL, args jsonb NOT NULL, result_summary text NOT NULL,
 status text NOT NULL CHECK (status IN ('ok','denied','error')),
 target_type text, target_id integer, ip text, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ai_actions_tenant_created_idx ON ai_actions(tenant_id,created_at);
CREATE TABLE ai_draft_documents (
 id serial PRIMARY KEY, tenant_id integer NOT NULL,
 doc_type text NOT NULL CHECK (doc_type IN ('receipt','payment','quotation','payment_request','sales_invoice')), payload jsonb NOT NULL,
 status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','confirmed','rejected')),
 summary text NOT NULL, created_by text NOT NULL DEFAULT 'ai', confirmed_by integer,
 confirmed_at timestamptz, result_document_id integer, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ai_drafts_tenant_created_idx ON ai_draft_documents(tenant_id,created_at);
ALTER TABLE ai_actions ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_actions FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON ai_actions FOR ALL TO public USING (tenant_id = (current_setting('app.tenant_id'::text))::integer) WITH CHECK (tenant_id = (current_setting('app.tenant_id'::text))::integer);
ALTER TABLE ai_draft_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_draft_documents FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON ai_draft_documents FOR ALL TO public USING (tenant_id = (current_setting('app.tenant_id'::text))::integer) WITH CHECK (tenant_id = (current_setting('app.tenant_id'::text))::integer);
GRANT SELECT,INSERT,UPDATE ON ai_actions,ai_draft_documents TO erp_app;
GRANT USAGE,SELECT ON SEQUENCE ai_actions_id_seq,ai_draft_documents_id_seq TO erp_app;
COMMIT;
