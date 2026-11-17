import { defineConfig } from "drizzle-kit";

// 只用來產生遷移檔（不連資料庫）。套用由 ERP 伺服器啟動時處理，見
// artifacts/erp-api-server/src/lib/schema-bootstrap.ts。
export default defineConfig({
  schema: "./src/schema/index.ts",
  out: "./drizzle",
  dialect: "postgresql",
});
