-- Additive only; reviewed Publish migration, never runtime/startup execution.
-- 讓發票、薪資單、庫存異動也能歸屬專案（專案是收支統計的單位）。
-- 只新增可為空的欄位：不改任何既有資料、預設值或限制；舊資料的專案維持空白。
-- 這三張表已經有 tenant_id 與公司隔離（RLS），新增欄位不影響隔離規則。
BEGIN;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS project_id integer;
ALTER TABLE salary_slips ADD COLUMN IF NOT EXISTS project_id integer;
ALTER TABLE stock_entries ADD COLUMN IF NOT EXISTS project_id integer;
COMMIT;
