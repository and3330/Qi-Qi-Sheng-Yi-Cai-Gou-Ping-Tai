-- 進貨、出貨、採購、生產工單照 Ecount 輸入畫面補的表頭欄位（老闆 2026-11-19）
-- 全部是可以不填的新欄位，不動既有資料
ALTER TABLE delivery_notes ADD COLUMN IF NOT EXISTS handler_id integer REFERENCES employees(id);
ALTER TABLE delivery_notes ADD COLUMN IF NOT EXISTS contact_info text;
ALTER TABLE delivery_notes ADD COLUMN IF NOT EXISTS shipping_address text;
ALTER TABLE purchase_receipts ADD COLUMN IF NOT EXISTS handler_id integer REFERENCES employees(id);
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS handler_id integer REFERENCES employees(id);
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS warehouse_id integer REFERENCES warehouses(id);
ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS customer_id integer REFERENCES customers(id);
ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS handler_id integer REFERENCES employees(id);
