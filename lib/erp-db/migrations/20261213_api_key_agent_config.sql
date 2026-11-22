-- API 金鑰多一欄：這把金鑰給 AI 助理（MCP）用的設定（要不要開放、身分、沖銷／付款／刪除／核准各自的做法）。
-- 只加 1 個可以空白的欄位，不改既有資料；沒設定的金鑰照舊不能用在 AI 助理。
ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS agent_config jsonb;
