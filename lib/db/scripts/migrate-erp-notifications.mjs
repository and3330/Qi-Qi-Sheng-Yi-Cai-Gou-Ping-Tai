import pg from "pg";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required");
const client = new pg.Client({ connectionString });
await client.connect();
try {
  await client.query(`
    CREATE TABLE IF NOT EXISTS erp_notifications (
      id serial PRIMARY KEY,
      member_id integer NOT NULL REFERENCES members(id) ON DELETE CASCADE,
      type text NOT NULL,
      title text NOT NULL,
      body text,
      link_path text,
      is_read boolean NOT NULL DEFAULT false,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_erp_notifications_member_read
      ON erp_notifications(member_id, is_read);
  `);
  console.log("ERP notifications migration complete");
} finally {
  await client.end();
}