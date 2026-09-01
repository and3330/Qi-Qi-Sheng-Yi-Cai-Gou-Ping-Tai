/** ERP 專案、任務與工時模組－可重複執行的資料庫遷移。 */
import pg from "pg";
const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is not set");
const statements = [
  `CREATE TABLE IF NOT EXISTS erp_projects (id serial PRIMARY KEY, project_no text NOT NULL, name text NOT NULL, customer_id integer, manager_id integer, status text NOT NULL DEFAULT 'planning', start_date text, end_date text, budget integer, description text, created_at timestamptz NOT NULL DEFAULT now())`,
  `CREATE UNIQUE INDEX IF NOT EXISTS uq_erp_projects_no ON erp_projects(project_no)`,
  `CREATE INDEX IF NOT EXISTS idx_erp_projects_status ON erp_projects(status)`,
  `CREATE TABLE IF NOT EXISTS erp_project_tasks (id serial PRIMARY KEY, project_id integer NOT NULL REFERENCES erp_projects(id) ON DELETE CASCADE, title text NOT NULL, description text, assignee_id integer, status text NOT NULL DEFAULT 'todo', priority text NOT NULL DEFAULT 'medium', due_date text, sort_order integer NOT NULL DEFAULT 0, estimated_hours numeric, created_at timestamptz NOT NULL DEFAULT now(), completed_at timestamptz)`,
  `CREATE INDEX IF NOT EXISTS idx_erp_project_tasks_project ON erp_project_tasks(project_id)`,
  `CREATE INDEX IF NOT EXISTS idx_erp_project_tasks_assignee ON erp_project_tasks(assignee_id)`,
  `CREATE TABLE IF NOT EXISTS erp_job_cards (id serial PRIMARY KEY, task_id integer REFERENCES erp_project_tasks(id) ON DELETE SET NULL, project_id integer NOT NULL REFERENCES erp_projects(id) ON DELETE CASCADE, member_id integer NOT NULL, work_date text NOT NULL, hours numeric NOT NULL, description text, created_at timestamptz NOT NULL DEFAULT now())`,
  `CREATE INDEX IF NOT EXISTS idx_erp_job_cards_project ON erp_job_cards(project_id)`,
  `CREATE INDEX IF NOT EXISTS idx_erp_job_cards_member ON erp_job_cards(member_id)`,
];
const client = new pg.Client({ connectionString }); await client.connect();
try { for (const statement of statements) await client.query(statement); console.log("erp-projects migration completed"); }
finally { await client.end(); }