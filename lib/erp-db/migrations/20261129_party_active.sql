-- 客戶與供應商加上「停用」：只新增一個欄位，既有資料全部維持啟用。
ALTER TABLE customers ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;
