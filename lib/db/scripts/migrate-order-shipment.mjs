import pg from "pg";

// 訂單出貨資訊：貨運公司、運送單號、出貨時間。可重複執行；新欄位皆可為空。
const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required");
const client = new pg.Client({ connectionString });
await client.connect();
try {
  await client.query(`
    ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS shipping_carrier text;
    ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS tracking_no text;
    ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS shipped_at timestamp;
  `);
  console.log("Order shipment migration complete");
} finally {
  await client.end();
}
