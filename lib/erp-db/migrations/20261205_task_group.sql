-- 任務加上「組別」：可以把多個任務歸到同一個組別底下（例如同一個階段、同一個活動），任務清單可依組別篩選與批次整理。
-- 只新增一個欄位，不動既有資料。
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS task_group text;
CREATE INDEX IF NOT EXISTS tasks_task_group_idx ON tasks(tenant_id, task_group);
