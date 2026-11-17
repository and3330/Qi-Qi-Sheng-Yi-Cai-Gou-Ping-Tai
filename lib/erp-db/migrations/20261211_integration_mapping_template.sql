-- 外部串接的訂單對應表多一欄：這一類訂單進來時要套用哪個銷貨訂單模組（居家、活動、課程…）。
-- 只加 1 個可以空白的欄位，不改既有資料；沒設定的對應照舊不套模組。
ALTER TABLE integration_mappings ADD COLUMN IF NOT EXISTS template_id integer;
