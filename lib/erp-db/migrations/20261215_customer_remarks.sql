-- 客戶備註（老闆 2026-11-18：新增客戶時要能寫備註）
ALTER TABLE customers ADD COLUMN IF NOT EXISTS remarks text;
