-- API 金鑰綁定使用者：用金鑰呼叫時，權限跟著這個人的角色走，金鑰不再有自己的權限（老闆 2026-11-19）
-- 只加一個可以不填的欄位，不動既有資料；還沒指定使用者的金鑰會暫停使用，到「API 金鑰」頁面指定後恢復
ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS user_id integer REFERENCES admin_users(id) ON DELETE SET NULL;
