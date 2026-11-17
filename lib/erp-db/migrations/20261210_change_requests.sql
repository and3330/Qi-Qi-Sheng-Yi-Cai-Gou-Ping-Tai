-- 異動申請：已過帳單據的修改、刪除，以及關帳月份解鎖，審核通過才執行。新增 1 張資料表，不改既有資料。
CREATE TABLE IF NOT EXISTS change_requests (
  tenant_id integer NOT NULL DEFAULT (current_setting('app.tenant_id'::text))::integer,
  id serial PRIMARY KEY,
  request_number text NOT NULL,
  kind text NOT NULL,
  target_type text NOT NULL,
  target_id integer,
  target_number text,
  title text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  original jsonb,
  reason text NOT NULL DEFAULT '',
  requested_by text NOT NULL,
  requested_role text,
  status text NOT NULL DEFAULT 'Pending',
  result text,
  applied_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS change_requests_target_idx ON change_requests(tenant_id, target_type, target_id);

ALTER TABLE change_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE change_requests FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON change_requests;
CREATE POLICY tenant_isolation ON change_requests FOR ALL TO public USING (tenant_id = (current_setting('app.tenant_id'::text))::integer) WITH CHECK (tenant_id = (current_setting('app.tenant_id'::text))::integer);
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'erp_app') THEN
    GRANT SELECT,INSERT,UPDATE,DELETE ON change_requests TO erp_app;
    GRANT USAGE,SELECT ON SEQUENCE change_requests_id_seq TO erp_app;
  END IF;
END $$;
