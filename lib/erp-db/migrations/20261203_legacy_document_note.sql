-- 歷史單據加上「備註」：舊系統搬來的單據內容不能改，但可以補說明。只新增一個欄位。
ALTER TABLE legacy_documents ADD COLUMN IF NOT EXISTS note text;
