/**
 * 內容版本圖片快照 — 冪等資料庫遷移。
 * 舊資料的 image_snapshot_present 預設 false，還原時會保留內容目前圖片。
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
  await client.query("BEGIN");
  await client.query(
    "ALTER TABLE content_revisions ADD COLUMN IF NOT EXISTS image_url text",
  );
  await client.query(
    "ALTER TABLE content_revisions ADD COLUMN IF NOT EXISTS image_snapshot_present boolean NOT NULL DEFAULT false",
  );
  await client.query("COMMIT");
  console.log("migrate-content-revision-images: done");
} catch (err) {
  await client.query("ROLLBACK");
  console.error("migrate-content-revision-images: FAILED —", err.message);
  process.exitCode = 1;
} finally {
  await client.end();
}