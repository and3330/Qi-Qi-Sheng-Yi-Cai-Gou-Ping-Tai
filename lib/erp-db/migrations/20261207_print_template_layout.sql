-- 列印模板改成視覺化設定：版面設定（勾選欄位、標題、配色、頁尾、簽名欄）存成 JSON
ALTER TABLE print_templates ADD COLUMN IF NOT EXISTS layout jsonb;
