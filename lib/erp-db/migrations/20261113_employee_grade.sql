-- Additive only; reviewed Publish migration, never runtime/startup execution.
-- 員工資料加上職級（對應「職級管理」的清單）。只新增一個可為空的欄位，不改既有資料。
-- ⚠ 必須在新版程式上線（Publish）之前執行，否則員工相關頁面會讀不到新欄位而出錯。
BEGIN;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS grade_id integer;
COMMIT;
