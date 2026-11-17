-- 付款申請加上「申請人」：記是誰送出的（登入帳號），員工才能在「我的申請」看到自己送的單。
-- 只新增一個欄位；舊資料從審批請求補回申請人。
ALTER TABLE payment_requests ADD COLUMN IF NOT EXISTS requested_by text;
CREATE INDEX IF NOT EXISTS payment_requests_requested_by_idx ON payment_requests(tenant_id, requested_by);
UPDATE payment_requests r SET requested_by = a.requested_by
  FROM (SELECT DISTINCT ON (tenant_id, document_id) tenant_id, document_id, requested_by FROM approval_requests WHERE document_type = 'PaymentRequest' ORDER BY tenant_id, document_id, id) a
  WHERE r.requested_by IS NULL AND a.document_id = r.id AND a.tenant_id = r.tenant_id;
