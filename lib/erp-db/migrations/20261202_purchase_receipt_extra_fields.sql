-- 進貨單加上「額外欄位」：用來標記從舊系統（Ecount）搬過來的歷史進貨單（extra_fields.legacy = true）。
-- 只新增一個欄位，既有進貨單都是空的 {}。
ALTER TABLE purchase_receipts ADD COLUMN IF NOT EXISTS extra_fields jsonb DEFAULT '{}'::jsonb;
