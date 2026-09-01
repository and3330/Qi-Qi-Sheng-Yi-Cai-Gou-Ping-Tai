/**
 * ERP 進銷存整合 — 冪等資料庫遷移
 *
 * 新增倉庫／客戶／價格表／銷貨單／銷退／採退等表，並擴充既有表欄位。
 * 可重複執行（IF NOT EXISTS）。執行： pnpm --filter @workspace/db run migrate:erp-inventory
 */
import pg from "pg";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}

const statements = [
  // ---------- ERP 基礎（部門/選單權限/審計/成員角色；冪等，供落後的資料庫補齊） ----------
  `CREATE TABLE IF NOT EXISTS erp_departments (
     id serial PRIMARY KEY,
     name text NOT NULL,
     description text,
     parent_id integer,
     manager_id integer,
     cost_center text,
     is_active boolean NOT NULL DEFAULT true,
     created_at timestamp NOT NULL DEFAULT now()
   )`,
  `CREATE TABLE IF NOT EXISTS erp_menu_permissions (
     path text PRIMARY KEY,
     roles text[] NOT NULL DEFAULT '{}',
     updated_at timestamp NOT NULL DEFAULT now()
   )`,
  `CREATE TABLE IF NOT EXISTS erp_audit_logs (
     id serial PRIMARY KEY,
     action text NOT NULL,
     module text NOT NULL,
     document_type text,
     document_id text,
     user_id integer NOT NULL,
     user_name text NOT NULL DEFAULT '',
     description text,
     old_values jsonb,
     new_values jsonb,
     created_at timestamp NOT NULL DEFAULT now()
   )`,
  `CREATE INDEX IF NOT EXISTS idx_erp_audit_logs_module ON erp_audit_logs (module)`,
  `CREATE INDEX IF NOT EXISTS idx_erp_audit_logs_created ON erp_audit_logs (created_at)`,
  `ALTER TABLE members ADD COLUMN IF NOT EXISTS erp_role text`,
  `ALTER TABLE members ADD COLUMN IF NOT EXISTS erp_department_id integer`,

  // ---------- 既有表欄位擴充（一律 nullable / 有預設值） ----------
  `ALTER TABLE products ADD COLUMN IF NOT EXISTS is_virtual boolean NOT NULL DEFAULT false`,
  `ALTER TABLE products ADD COLUMN IF NOT EXISTS unit text`,
  `ALTER TABLE products ADD COLUMN IF NOT EXISTS barcode text`,
  `ALTER TABLE products ADD COLUMN IF NOT EXISTS safety_stock integer NOT NULL DEFAULT 0`,
  `ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS created_by integer`,
  `ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS warehouse_id integer`,
  `ALTER TABLE stock_movements ADD COLUMN IF NOT EXISTS warehouse_id integer`,

  // ---------- 倉庫 ----------
  `CREATE TABLE IF NOT EXISTS erp_warehouses (
     id serial PRIMARY KEY,
     code text NOT NULL UNIQUE,
     name text NOT NULL,
     address text,
     note text,
     is_default boolean NOT NULL DEFAULT false,
     is_active boolean NOT NULL DEFAULT true,
     created_at timestamp NOT NULL DEFAULT now()
   )`,
  // 只允許一個預設倉
  `CREATE UNIQUE INDEX IF NOT EXISTS uq_erp_warehouses_default
     ON erp_warehouses (is_default) WHERE is_default = true`,
  // 預設主倉（冪等）
  `INSERT INTO erp_warehouses (code, name, is_default)
     SELECT 'WH-MAIN', '主倉', true
     WHERE NOT EXISTS (SELECT 1 FROM erp_warehouses)`,

  // ---------- 客戶 ----------
  `CREATE TABLE IF NOT EXISTS erp_customers (
     id serial PRIMARY KEY,
     code text NOT NULL UNIQUE,
     name text NOT NULL,
     member_id integer REFERENCES members(id),
     institution_id integer REFERENCES institutions(id),
     contact_person text,
     phone text,
     email text,
     address text,
     tax_id text,
     payment_terms text,
     price_list_id integer,
     note text,
     is_active boolean NOT NULL DEFAULT true,
     created_at timestamp NOT NULL DEFAULT now()
   )`,
  // 一個會員只對應一個 ERP 客戶（部分唯一索引）
  `CREATE UNIQUE INDEX IF NOT EXISTS uq_erp_customers_member_id
     ON erp_customers (member_id) WHERE member_id IS NOT NULL`,

  // ---------- 價格表 ----------
  `CREATE TABLE IF NOT EXISTS price_lists (
     id serial PRIMARY KEY,
     name text NOT NULL,
     description text,
     is_active boolean NOT NULL DEFAULT true,
     created_at timestamp NOT NULL DEFAULT now()
   )`,
  `CREATE TABLE IF NOT EXISTS price_list_items (
     id serial PRIMARY KEY,
     price_list_id integer NOT NULL REFERENCES price_lists(id),
     product_id integer NOT NULL,
     variant_id integer,
     price integer NOT NULL
   )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS uq_price_list_items_line
     ON price_list_items (price_list_id, product_id, COALESCE(variant_id, 0))`,

  // ---------- 銷貨單 ----------
  `CREATE TABLE IF NOT EXISTS sales_orders (
     id serial PRIMARY KEY,
     so_no text NOT NULL UNIQUE,
     source text NOT NULL DEFAULT 'erp',
     customer_id integer REFERENCES erp_customers(id),
     customer_name text NOT NULL DEFAULT '',
     order_id integer,
     order_no text,
     warehouse_id integer,
     status text NOT NULL DEFAULT 'draft',
     total_amount integer NOT NULL DEFAULT 0,
     note text,
     created_by integer,
     created_at timestamp NOT NULL DEFAULT now(),
     confirmed_at timestamp,
     shipped_at timestamp,
     completed_at timestamp
   )`,
  // 一張商城訂單只會有一張銷貨單（防重複單據）
  `CREATE UNIQUE INDEX IF NOT EXISTS uq_sales_orders_order_id
     ON sales_orders (order_id) WHERE order_id IS NOT NULL`,
  `CREATE INDEX IF NOT EXISTS idx_sales_orders_status
     ON sales_orders (status, created_at)`,
  `CREATE TABLE IF NOT EXISTS sales_order_items (
     id serial PRIMARY KEY,
     sales_order_id integer NOT NULL REFERENCES sales_orders(id),
     product_id integer NOT NULL,
     variant_id integer,
     variant_name text,
     product_name text NOT NULL,
     product_code text NOT NULL,
     unit_price integer NOT NULL,
     quantity integer NOT NULL,
     unit_cost integer NOT NULL DEFAULT 0,
     is_virtual boolean NOT NULL DEFAULT false
   )`,

  // ---------- 銷貨退回 ----------
  `CREATE TABLE IF NOT EXISTS sales_returns (
     id serial PRIMARY KEY,
     sr_no text NOT NULL UNIQUE,
     sales_order_id integer REFERENCES sales_orders(id),
     customer_id integer,
     customer_name text NOT NULL DEFAULT '',
     warehouse_id integer,
     status text NOT NULL DEFAULT 'draft',
     total_amount integer NOT NULL DEFAULT 0,
     reason text,
     note text,
     created_by integer,
     created_at timestamp NOT NULL DEFAULT now(),
     confirmed_at timestamp
   )`,
  `CREATE INDEX IF NOT EXISTS idx_sales_returns_status
     ON sales_returns (status, created_at)`,
  `CREATE TABLE IF NOT EXISTS sales_return_items (
     id serial PRIMARY KEY,
     sales_return_id integer NOT NULL REFERENCES sales_returns(id),
     product_id integer NOT NULL,
     variant_id integer,
     variant_name text,
     product_name text NOT NULL,
     product_code text NOT NULL,
     unit_price integer NOT NULL,
     quantity integer NOT NULL,
     is_virtual boolean NOT NULL DEFAULT false
   )`,

  // ---------- 採購退回 ----------
  `CREATE TABLE IF NOT EXISTS purchase_returns (
     id serial PRIMARY KEY,
     pr_no text NOT NULL UNIQUE,
     supplier_id integer NOT NULL REFERENCES suppliers(id),
     purchase_order_id integer,
     warehouse_id integer,
     status text NOT NULL DEFAULT 'draft',
     total_amount integer NOT NULL DEFAULT 0,
     reason text,
     note text,
     created_by integer,
     created_at timestamp NOT NULL DEFAULT now(),
     confirmed_at timestamp
   )`,
  `CREATE INDEX IF NOT EXISTS idx_purchase_returns_status
     ON purchase_returns (status, created_at)`,
  `CREATE TABLE IF NOT EXISTS purchase_return_items (
     id serial PRIMARY KEY,
     purchase_return_id integer NOT NULL REFERENCES purchase_returns(id),
     product_id integer NOT NULL,
     variant_id integer,
     variant_name text,
     product_name text NOT NULL,
     product_code text NOT NULL,
     unit_cost integer NOT NULL,
     quantity integer NOT NULL,
     is_virtual boolean NOT NULL DEFAULT false
   )`,

  // ---------- 既有商城訂單回填銷貨單（冪等：靠部分唯一索引 + NOT EXISTS） ----------
  `INSERT INTO sales_orders (so_no, source, customer_name, order_id, order_no, status, total_amount, created_at)
     SELECT 'SO-' || o.order_no, 'shop', COALESCE(m.name, m.username, ''), o.id, o.order_no,
            CASE o.status
              WHEN 'pending' THEN 'confirmed'
              WHEN 'paid' THEN 'confirmed'
              WHEN 'shipped' THEN 'shipped'
              WHEN 'completed' THEN 'completed'
              WHEN 'cancelled' THEN 'cancelled'
              ELSE 'confirmed' END,
            o.total_amount, o.created_at
       FROM orders o
       LEFT JOIN members m ON m.id = o.member_id
      WHERE NOT EXISTS (SELECT 1 FROM sales_orders so WHERE so.order_id = o.id)`,
  `INSERT INTO sales_order_items (sales_order_id, product_id, variant_id, variant_name, product_name, product_code, unit_price, quantity, unit_cost, is_virtual)
     SELECT so.id, oi.product_id, oi.variant_id, oi.variant_name, oi.product_name, oi.product_code, oi.unit_price, oi.quantity, oi.unit_cost, false
       FROM order_items oi
       JOIN sales_orders so ON so.order_id = oi.order_id
      WHERE NOT EXISTS (SELECT 1 FROM sales_order_items si WHERE si.sales_order_id = so.id)`,

  // ---------- 既有會員回填 ERP 客戶（僅有訂單的會員） ----------
  `INSERT INTO erp_customers (code, name, member_id, institution_id, phone, email, address)
     SELECT 'C' || LPAD(m.id::text, 6, '0'), COALESCE(NULLIF(m.name, ''), m.username), m.id,
            CASE WHEN m.institution_verified THEN m.bound_institution_id ELSE NULL END,
            m.phone, m.email, m.shipping_address
       FROM members m
      WHERE EXISTS (SELECT 1 FROM orders o WHERE o.member_id = m.id)
        AND NOT EXISTS (SELECT 1 FROM erp_customers c WHERE c.member_id = m.id)`,
  `UPDATE sales_orders so
      SET customer_id = c.id
     FROM orders o, erp_customers c
    WHERE so.order_id = o.id AND c.member_id = o.member_id AND so.customer_id IS NULL`,
];

const client = new pg.Client({ connectionString });
await client.connect();
try {
  await client.query("BEGIN");
  for (const stmt of statements) {
    await client.query(stmt);
    console.log("OK:", stmt.trim().split("\n")[0]);
  }
  await client.query("COMMIT");
  console.log("migrate-erp-inventory: done");
} catch (err) {
  await client.query("ROLLBACK");
  console.error("migrate-erp-inventory: FAILED —", err.message);
  process.exitCode = 1;
} finally {
  await client.end();
}
