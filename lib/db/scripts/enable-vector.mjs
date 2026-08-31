/**
 * Enable pgvector before Drizzle creates vector-typed columns.
 *
 * This migration is intentionally idempotent and must run before `drizzle-kit push`.
 */
import pg from "pg";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}

const client = new pg.Client({ connectionString });
await client.connect();
try {
  await client.query("CREATE EXTENSION IF NOT EXISTS vector");
  const result = await client.query(
    "SELECT extversion FROM pg_extension WHERE extname = 'vector'",
  );
  if (result.rowCount !== 1) {
    throw new Error("pgvector extension is unavailable on this database");
  }
  console.log(`enable-vector: ready (version ${result.rows[0].extversion})`);
} catch (err) {
  console.error("enable-vector: FAILED —", err.message);
  process.exitCode = 1;
} finally {
  await client.end();
}