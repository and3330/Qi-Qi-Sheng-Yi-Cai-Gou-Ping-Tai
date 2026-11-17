-- Additive only; reviewed Publish migration, never runtime/startup execution.
-- 人事模組：特休自動發放、員工離職日與基本資料。
-- 只新增可為空的欄位與一張新表：不改任何既有資料、預設值或限制。
-- ⚠ 必須在新版程式上線（Publish）之前執行，否則員工相關頁面會讀不到新欄位而出錯。
BEGIN;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS resignation_date text;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS birth_date text;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS emergency_contact text;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS emergency_phone text;

CREATE TABLE IF NOT EXISTS leave_grants (
 id serial PRIMARY KEY,
 tenant_id integer NOT NULL DEFAULT (current_setting('app.tenant_id'::text))::integer,
 employee_id integer NOT NULL REFERENCES employees(id),
 leave_type text NOT NULL DEFAULT 'Annual Leave',
 period_start text NOT NULL,
 period_end text NOT NULL,
 days numeric(5,1) NOT NULL,
 source text NOT NULL DEFAULT 'auto' CHECK (source IN ('auto','manual')),
 note text,
 created_by text,
 settled_at timestamptz,
 settled_days numeric(5,1),
 settled_amount numeric(12,2),
 settled_note text,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS leave_grants_employee_idx ON leave_grants(tenant_id, employee_id, period_start);
-- 同一位員工同一個年資區間只會自動發放一次
CREATE UNIQUE INDEX IF NOT EXISTS leave_grants_auto_uniq ON leave_grants(tenant_id, employee_id, leave_type, period_start) WHERE source = 'auto';
ALTER TABLE leave_grants ENABLE ROW LEVEL SECURITY;
ALTER TABLE leave_grants FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON leave_grants;
CREATE POLICY tenant_isolation ON leave_grants FOR ALL TO public USING (tenant_id = (current_setting('app.tenant_id'::text))::integer) WITH CHECK (tenant_id = (current_setting('app.tenant_id'::text))::integer);
GRANT SELECT,INSERT,UPDATE,DELETE ON leave_grants TO erp_app;
GRANT USAGE,SELECT ON SEQUENCE leave_grants_id_seq TO erp_app;
COMMIT;
