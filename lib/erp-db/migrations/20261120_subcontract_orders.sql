-- 外包單（供料加工）：新增 1 張資料表、倉庫與發票各 1 個欄位。不改既有資料。

CREATE TABLE IF NOT EXISTS subcontract_orders (
  tenant_id integer NOT NULL DEFAULT (current_setting('app.tenant_id'::text))::integer,
  id serial PRIMARY KEY,
  order_number text NOT NULL,
  supplier_id integer NOT NULL,
  item_id integer NOT NULL,
  bom_id integer,
  project_id integer NOT NULL,
  quantity numeric(12,2) NOT NULL,
  received_quantity numeric(12,2) NOT NULL DEFAULT 0,
  unit_fee numeric(12,2) NOT NULL DEFAULT 0,
  taxable boolean NOT NULL DEFAULT true,
  vendor_warehouse_id integer NOT NULL,
  status text NOT NULL DEFAULT 'Open',
  order_date text NOT NULL,
  expected_date text,
  remarks text,
  materials jsonb NOT NULL DEFAULT '[]'::jsonb,
  material_cost numeric(14,2) NOT NULL DEFAULT 0,
  fee_amount numeric(14,2) NOT NULL DEFAULT 0,
  loss_amount numeric(14,2) NOT NULL DEFAULT 0,
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS subcontract_orders_number_unique ON subcontract_orders(tenant_id, order_number);
CREATE INDEX IF NOT EXISTS subcontract_orders_supplier_idx ON subcontract_orders(tenant_id, supplier_id);

-- 代工廠倉：這間倉庫代表哪一家代工廠手上的料
ALTER TABLE warehouses ADD COLUMN IF NOT EXISTS subcontractor_supplier_id integer;
-- 加工費發票是哪一張外包單產生的
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS subcontract_order_id integer;

ALTER TABLE subcontract_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE subcontract_orders FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON subcontract_orders;
CREATE POLICY tenant_isolation ON subcontract_orders FOR ALL TO public
  USING (tenant_id = (current_setting('app.tenant_id'::text))::integer)
  WITH CHECK (tenant_id = (current_setting('app.tenant_id'::text))::integer);
GRANT SELECT,INSERT,UPDATE,DELETE ON subcontract_orders TO erp_app;
GRANT USAGE,SELECT ON SEQUENCE subcontract_orders_id_seq TO erp_app;
