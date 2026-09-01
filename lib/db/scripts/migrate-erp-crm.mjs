/** ERP CRM 與內部客服模組－可重複執行的資料庫遷移。 */
import pg from "pg";
const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is not set");
const statements = [
  `CREATE TABLE IF NOT EXISTS erp_leads (id serial PRIMARY KEY, name text NOT NULL, company text, phone text, email text, source text NOT NULL DEFAULT 'other', status text NOT NULL DEFAULT 'new', owner_id integer, notes text, created_at timestamptz NOT NULL DEFAULT now())`,
  `CREATE INDEX IF NOT EXISTS idx_erp_leads_status ON erp_leads(status)`,
  `CREATE TABLE IF NOT EXISTS erp_opportunities (id serial PRIMARY KEY, name text NOT NULL, lead_id integer, customer_id integer, stage text NOT NULL DEFAULT 'prospecting', expected_amount integer NOT NULL DEFAULT 0, probability integer NOT NULL DEFAULT 0, expected_close_date text, owner_id integer, notes text, lost_reason text, created_at timestamptz NOT NULL DEFAULT now(), CONSTRAINT erp_opportunities_probability_check CHECK (probability BETWEEN 0 AND 100))`,
  `CREATE INDEX IF NOT EXISTS idx_erp_opportunities_stage ON erp_opportunities(stage)`,
  `CREATE TABLE IF NOT EXISTS erp_complaints (id serial PRIMARY KEY, complaint_no text NOT NULL, customer_id integer, member_id integer, category text NOT NULL DEFAULT 'other', severity text NOT NULL DEFAULT 'medium', subject text NOT NULL, content text NOT NULL, status text NOT NULL DEFAULT 'open', assignee_id integer, resolution text, resolved_at timestamptz, created_at timestamptz NOT NULL DEFAULT now())`,
  `CREATE UNIQUE INDEX IF NOT EXISTS uq_erp_complaints_no ON erp_complaints(complaint_no)`,
  `CREATE INDEX IF NOT EXISTS idx_erp_complaints_status ON erp_complaints(status)`,
  `CREATE TABLE IF NOT EXISTS erp_tickets (id serial PRIMARY KEY, ticket_no text NOT NULL, title text NOT NULL, description text NOT NULL, priority text NOT NULL DEFAULT 'medium', status text NOT NULL DEFAULT 'open', assignee_id integer, requester_name text, customer_id integer, complaint_id integer, due_at timestamptz, resolved_at timestamptz, created_at timestamptz NOT NULL DEFAULT now())`,
  `CREATE UNIQUE INDEX IF NOT EXISTS uq_erp_tickets_no ON erp_tickets(ticket_no)`,
  `CREATE INDEX IF NOT EXISTS idx_erp_tickets_status ON erp_tickets(status)`,
  `CREATE TABLE IF NOT EXISTS erp_ticket_comments (id serial PRIMARY KEY, ticket_id integer NOT NULL REFERENCES erp_tickets(id) ON DELETE CASCADE, author_id integer, content text NOT NULL, created_at timestamptz NOT NULL DEFAULT now())`,
  `CREATE INDEX IF NOT EXISTS idx_erp_ticket_comments_ticket ON erp_ticket_comments(ticket_id)`,
  `CREATE TABLE IF NOT EXISTS erp_kb_articles (id serial PRIMARY KEY, title text NOT NULL, category text NOT NULL DEFAULT '一般', content text NOT NULL, tags text[] NOT NULL DEFAULT '{}', is_published boolean NOT NULL DEFAULT false, author_id integer, updated_at timestamptz NOT NULL DEFAULT now(), created_at timestamptz NOT NULL DEFAULT now())`,
];
const client = new pg.Client({ connectionString }); await client.connect();
try { for (const statement of statements) await client.query(statement); console.log("erp-crm migration completed"); }
finally { await client.end(); }