-- 歷史單據（從舊系統搬來、只供查詢）：新增 1 張資料表。不改既有資料。
CREATE TABLE IF NOT EXISTS legacy_documents (
  tenant_id integer NOT NULL DEFAULT (current_setting('app.tenant_id'::text))::integer,
  id serial PRIMARY KEY,
  source text NOT NULL DEFAULT 'ecount',
  doc_type text NOT NULL,
  doc_number text NOT NULL,
  doc_date text,
  party_name text,
  project_name text,
  staff_name text,
  total numeric(16,2),
  line_count integer NOT NULL DEFAULT 0,
  search_text text,
  lines json NOT NULL DEFAULT '[]'::json,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS legacy_documents_unique ON legacy_documents(tenant_id, source, doc_type, doc_number);
CREATE INDEX IF NOT EXISTS legacy_documents_type_date_idx ON legacy_documents(tenant_id, doc_type, doc_date);
CREATE INDEX IF NOT EXISTS legacy_documents_party_idx ON legacy_documents(tenant_id, party_name);

ALTER TABLE legacy_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE legacy_documents FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON legacy_documents;
CREATE POLICY tenant_isolation ON legacy_documents FOR ALL TO public USING (tenant_id = (current_setting('app.tenant_id'::text))::integer) WITH CHECK (tenant_id = (current_setting('app.tenant_id'::text))::integer);
GRANT SELECT,INSERT,UPDATE,DELETE ON legacy_documents TO erp_app;
GRANT USAGE,SELECT ON SEQUENCE legacy_documents_id_seq TO erp_app;
