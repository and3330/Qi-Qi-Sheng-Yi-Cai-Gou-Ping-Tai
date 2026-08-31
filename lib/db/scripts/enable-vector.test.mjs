import assert from "node:assert/strict";
import test from "node:test";
import pg from "pg";

test("pgvector is installed and its distance operator is usable", async () => {
  assert.ok(process.env.DATABASE_URL, "DATABASE_URL is required");
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    const extension = await client.query(
      "SELECT extversion FROM pg_extension WHERE extname = 'vector'",
    );
    assert.equal(extension.rowCount, 1);

    const distance = await client.query(
      "SELECT '[1,0]'::vector <=> '[0,1]'::vector AS value",
    );
    assert.equal(Number(distance.rows[0].value), 1);
  } finally {
    await client.end();
  }
});