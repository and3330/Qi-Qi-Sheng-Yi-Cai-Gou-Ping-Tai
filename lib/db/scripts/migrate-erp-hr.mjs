/** ERP 人資模組－可重複執行的資料庫遷移。 */
import pg from "pg";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is not set");

const statements = [
  `CREATE TABLE IF NOT EXISTS erp_job_grades (id serial PRIMARY KEY, name text NOT NULL, rank integer NOT NULL DEFAULT 0, min_salary integer NOT NULL DEFAULT 0, max_salary integer NOT NULL DEFAULT 0)`,
  `CREATE TABLE IF NOT EXISTS erp_employees (id serial PRIMARY KEY, employee_no text NOT NULL, name text NOT NULL, member_id integer, department_id integer, job_title text, job_grade_id integer REFERENCES erp_job_grades(id), hire_date text, termination_date text, status text NOT NULL DEFAULT 'active', email text, phone text, id_number text, birth_date text, address text, emergency_contact text, bank_account text, base_salary integer NOT NULL DEFAULT 0, labor_insurance_grade integer, health_insurance_grade integer, notes text, created_at timestamptz NOT NULL DEFAULT now())`,
  `ALTER TABLE erp_employees DROP CONSTRAINT IF EXISTS erp_employees_department_id_erp_departments_id_fk`,
  `ALTER TABLE erp_employees DROP CONSTRAINT IF EXISTS erp_employees_department_id_fkey`,
  `CREATE UNIQUE INDEX IF NOT EXISTS uq_erp_employees_employee_no ON erp_employees(employee_no)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS uq_erp_employees_member ON erp_employees(member_id) WHERE member_id IS NOT NULL`,
  `CREATE INDEX IF NOT EXISTS idx_erp_employees_department ON erp_employees(department_id)`,
  `CREATE TABLE IF NOT EXISTS erp_shifts (id serial PRIMARY KEY, name text NOT NULL, start_time text NOT NULL DEFAULT '09:00', end_time text NOT NULL DEFAULT '18:00', break_minutes integer NOT NULL DEFAULT 60)`,
  `CREATE TABLE IF NOT EXISTS erp_attendance_records (id serial PRIMARY KEY, employee_id integer NOT NULL REFERENCES erp_employees(id), work_date text NOT NULL, clock_in timestamptz, clock_out timestamptz, shift_id integer REFERENCES erp_shifts(id), status text NOT NULL DEFAULT 'normal', notes text)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS uq_erp_attendance_employee_date ON erp_attendance_records(employee_id, work_date)`,
  `CREATE INDEX IF NOT EXISTS idx_erp_attendance_date ON erp_attendance_records(work_date)`,
  `CREATE TABLE IF NOT EXISTS erp_leave_types (id serial PRIMARY KEY, name text NOT NULL, annual_quota integer NOT NULL DEFAULT 0, requires_proof boolean NOT NULL DEFAULT false)`,
  `CREATE TABLE IF NOT EXISTS erp_leave_requests (id serial PRIMARY KEY, employee_id integer NOT NULL REFERENCES erp_employees(id), leave_type_id integer NOT NULL REFERENCES erp_leave_types(id), start_at timestamptz NOT NULL, end_at timestamptz NOT NULL, hours integer NOT NULL DEFAULT 0, reason text, status text NOT NULL DEFAULT 'pending', approver_id integer, approved_at timestamptz, reject_reason text)`,
  `CREATE INDEX IF NOT EXISTS idx_erp_leave_employee ON erp_leave_requests(employee_id)`,
  `CREATE INDEX IF NOT EXISTS idx_erp_leave_status ON erp_leave_requests(status)`,
  `CREATE TABLE IF NOT EXISTS erp_payroll_runs (id serial PRIMARY KEY, period text NOT NULL, status text NOT NULL DEFAULT 'draft', notes text, created_at timestamptz NOT NULL DEFAULT now())`,
  `CREATE UNIQUE INDEX IF NOT EXISTS uq_erp_payroll_period ON erp_payroll_runs(period)`,
  `CREATE TABLE IF NOT EXISTS erp_payroll_items (id serial PRIMARY KEY, run_id integer NOT NULL REFERENCES erp_payroll_runs(id) ON DELETE CASCADE, employee_id integer NOT NULL REFERENCES erp_employees(id), base_salary integer NOT NULL DEFAULT 0, overtime_pay integer NOT NULL DEFAULT 0, allowances integer NOT NULL DEFAULT 0, labor_insurance integer NOT NULL DEFAULT 0, health_insurance integer NOT NULL DEFAULT 0, other_deductions integer NOT NULL DEFAULT 0, net_pay integer NOT NULL DEFAULT 0, notes text)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS uq_erp_payroll_item_employee ON erp_payroll_items(run_id, employee_id)`,
  `CREATE TABLE IF NOT EXISTS erp_insurance_brackets (id serial PRIMARY KEY, type text NOT NULL, grade integer NOT NULL, salary_min integer NOT NULL DEFAULT 0, salary_max integer NOT NULL DEFAULT 0, employee_amount integer NOT NULL DEFAULT 0, employer_amount integer NOT NULL DEFAULT 0)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS uq_erp_insurance_type_grade ON erp_insurance_brackets(type, grade)`,
];

const client = new pg.Client({ connectionString });
await client.connect();
try {
  for (const statement of statements) await client.query(statement);
  console.log("erp-hr migration completed");
} finally {
  await client.end();
}