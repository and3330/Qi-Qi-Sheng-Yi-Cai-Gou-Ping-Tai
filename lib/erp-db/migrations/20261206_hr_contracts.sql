-- 人事合約：跟員工、老師、臨時人員簽的合約，跟客戶／供應商合約共用 contracts 資料表。
-- 只新增欄位，不動既有合約。party_type 多了 Employee（員工）、Teacher（老師）、Person（名單外的人）。
ALTER TABLE contracts ADD COLUMN IF NOT EXISTS employee_id integer REFERENCES employees(id);
ALTER TABLE contracts ADD COLUMN IF NOT EXISTS teacher_id integer REFERENCES teachers(id);
ALTER TABLE contracts ADD COLUMN IF NOT EXISTS contract_type text;
ALTER TABLE contracts ADD COLUMN IF NOT EXISTS pay_basis text;
ALTER TABLE contracts ADD COLUMN IF NOT EXISTS signed_date date;
CREATE INDEX IF NOT EXISTS contracts_employee_idx ON contracts(tenant_id, employee_id);
CREATE INDEX IF NOT EXISTS contracts_teacher_idx ON contracts(tenant_id, teacher_id);
