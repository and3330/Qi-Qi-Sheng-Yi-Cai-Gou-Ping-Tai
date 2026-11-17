-- 「我的頁面」：每個帳號自己挑的常用功能，存在帳號上，換電腦也看得到
ALTER TABLE admin_users ADD COLUMN IF NOT EXISTS home_shortcuts jsonb;
