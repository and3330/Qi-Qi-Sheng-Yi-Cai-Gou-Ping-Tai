-- 主、子專案：專案加上「主專案」欄位。只新增一個欄位，既有專案都維持是獨立專案。
ALTER TABLE projects ADD COLUMN IF NOT EXISTS parent_id integer;
CREATE INDEX IF NOT EXISTS projects_parent_idx ON projects(tenant_id, parent_id);
