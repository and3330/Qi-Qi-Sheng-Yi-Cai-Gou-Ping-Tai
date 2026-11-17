-- 公司 ERP 手動遷移檔裡有、但不在 drizzle 結構定義裡的索引
CREATE UNIQUE INDEX IF NOT EXISTS leave_grants_auto_uniq ON leave_grants(tenant_id, employee_id, leave_type, period_start) WHERE source = 'auto';--> statement-breakpoint
CREATE INDEX IF NOT EXISTS stock_entries_warehouse_item_idx ON stock_entries(tenant_id, warehouse_id, item_id);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS projects_parent_idx ON projects(tenant_id, parent_id);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS payment_requests_requested_by_idx ON payment_requests(tenant_id, requested_by);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS tasks_task_group_idx ON tasks(tenant_id, task_group);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS contracts_employee_idx ON contracts(tenant_id, employee_id);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS contracts_teacher_idx ON contracts(tenant_id, teacher_id);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS change_requests_target_idx ON change_requests(tenant_id, target_type, target_id);
