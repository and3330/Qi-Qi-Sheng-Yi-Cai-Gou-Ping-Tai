-- Linktree 個人連結頁模組 - 資料庫 Schema

CREATE TABLE IF NOT EXISTS user_links (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  subtitle TEXT,
  url TEXT NOT NULL,
  icon TEXT,
  link_type TEXT NOT NULL DEFAULT 'link', -- link, social, video, music
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS user_linktree_settings (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  bio TEXT,
  subtitle TEXT,
  theme TEXT NOT NULL DEFAULT 'default', -- default, dark, gradient, pastel
  background_color TEXT,
  button_color TEXT,
  button_text_color TEXT,
  button_style TEXT NOT NULL DEFAULT 'rounded', -- rounded, pill, square, outline
  show_avatar BOOLEAN NOT NULL DEFAULT true,
  custom_title TEXT
);

CREATE INDEX IF NOT EXISTS idx_user_links_user ON user_links(user_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_user_linktree_settings_user ON user_linktree_settings(user_id);
