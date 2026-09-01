/** ERP 資產、製造、品質模組－可重複執行的資料庫遷移。 */
import pg from "pg";
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set");
const statements = [
`CREATE TABLE IF NOT EXISTS erp_assets(id serial PRIMARY KEY,asset_no text NOT NULL,name text NOT NULL,category text NOT NULL DEFAULT '一般',purchase_date text,cost integer NOT NULL DEFAULT 0,salvage_value integer NOT NULL DEFAULT 0,useful_life_months integer NOT NULL DEFAULT 1,depreciation_method text NOT NULL DEFAULT 'straight_line',status text NOT NULL DEFAULT 'active',location_note text,custodian_id integer,notes text,created_at timestamptz NOT NULL DEFAULT now())`,
`CREATE UNIQUE INDEX IF NOT EXISTS uq_erp_assets_no ON erp_assets(asset_no)`,
`CREATE INDEX IF NOT EXISTS idx_erp_assets_status ON erp_assets(status)`,
`CREATE TABLE IF NOT EXISTS erp_asset_depreciations(id serial PRIMARY KEY,asset_id integer NOT NULL REFERENCES erp_assets(id) ON DELETE CASCADE,period text NOT NULL,amount integer NOT NULL DEFAULT 0,journal_entry_id integer,created_at timestamptz NOT NULL DEFAULT now())`,
`CREATE UNIQUE INDEX IF NOT EXISTS uq_erp_asset_depreciations_asset_period ON erp_asset_depreciations(asset_id,period)`,
`CREATE TABLE IF NOT EXISTS erp_asset_maintenances(id serial PRIMARY KEY,asset_id integer NOT NULL REFERENCES erp_assets(id) ON DELETE CASCADE,maintenance_date text NOT NULL,type text NOT NULL DEFAULT 'routine',cost integer NOT NULL DEFAULT 0,vendor text,notes text,created_at timestamptz NOT NULL DEFAULT now())`,
`CREATE INDEX IF NOT EXISTS idx_erp_asset_maintenances_asset ON erp_asset_maintenances(asset_id)`,
`CREATE TABLE IF NOT EXISTS erp_boms(id serial PRIMARY KEY,product_id integer NOT NULL,name text NOT NULL,version text NOT NULL DEFAULT '1.0',is_active boolean NOT NULL DEFAULT true,notes text)`,
`CREATE TABLE IF NOT EXISTS erp_bom_lines(id serial PRIMARY KEY,bom_id integer NOT NULL REFERENCES erp_boms(id) ON DELETE CASCADE,component_product_id integer NOT NULL,quantity numeric NOT NULL,unit text NOT NULL DEFAULT '個',notes text)`,
`CREATE TABLE IF NOT EXISTS erp_workstations(id serial PRIMARY KEY,name text NOT NULL,code text NOT NULL,capacity_per_day numeric,notes text,is_active boolean NOT NULL DEFAULT true)`,
`CREATE UNIQUE INDEX IF NOT EXISTS uq_erp_workstations_code ON erp_workstations(code)`,
`CREATE TABLE IF NOT EXISTS erp_work_orders(id serial PRIMARY KEY,work_order_no text NOT NULL,bom_id integer,product_id integer NOT NULL,quantity numeric NOT NULL,status text NOT NULL DEFAULT 'draft',workstation_id integer,planned_start_date text,planned_end_date text,actual_start_at timestamptz,actual_end_at timestamptz,notes text,created_at timestamptz NOT NULL DEFAULT now())`,
`CREATE UNIQUE INDEX IF NOT EXISTS uq_erp_work_orders_no ON erp_work_orders(work_order_no)`,
`CREATE INDEX IF NOT EXISTS idx_erp_work_orders_status ON erp_work_orders(status)`,
`CREATE TABLE IF NOT EXISTS erp_production_plans(id serial PRIMARY KEY,period text NOT NULL,product_id integer NOT NULL,planned_quantity numeric NOT NULL,notes text)`,
`CREATE UNIQUE INDEX IF NOT EXISTS uq_erp_production_plans_period_product ON erp_production_plans(period,product_id)`,
`CREATE TABLE IF NOT EXISTS erp_inspections(id serial PRIMARY KEY,inspection_no text NOT NULL,type text NOT NULL DEFAULT 'incoming',ref_type text NOT NULL DEFAULT 'other',ref_id integer,product_id integer NOT NULL,sample_size integer NOT NULL DEFAULT 0,passed_qty integer NOT NULL DEFAULT 0,failed_qty integer NOT NULL DEFAULT 0,result text NOT NULL DEFAULT 'pass',inspector_id integer,inspected_at timestamptz NOT NULL DEFAULT now(),notes text)`,
`CREATE UNIQUE INDEX IF NOT EXISTS uq_erp_inspections_no ON erp_inspections(inspection_no)`,
`CREATE TABLE IF NOT EXISTS erp_nonconformances(id serial PRIMARY KEY,nc_no text NOT NULL,inspection_id integer,product_id integer,description text NOT NULL,severity text NOT NULL DEFAULT 'minor',status text NOT NULL DEFAULT 'open',disposition text,closed_at timestamptz)`,
`CREATE UNIQUE INDEX IF NOT EXISTS uq_erp_nonconformances_no ON erp_nonconformances(nc_no)`,
`CREATE INDEX IF NOT EXISTS idx_erp_nonconformances_status ON erp_nonconformances(status)`,
`CREATE TABLE IF NOT EXISTS erp_capas(id serial PRIMARY KEY,capa_no text NOT NULL,nonconformance_id integer,type text NOT NULL DEFAULT 'corrective',root_cause text NOT NULL,action_plan text NOT NULL,owner_id integer,due_date text,status text NOT NULL DEFAULT 'open',verified_at timestamptz)`,
`CREATE UNIQUE INDEX IF NOT EXISTS uq_erp_capas_no ON erp_capas(capa_no)`,
`CREATE INDEX IF NOT EXISTS idx_erp_capas_status ON erp_capas(status)`,
];
const client=new pg.Client({connectionString:process.env.DATABASE_URL});await client.connect();
try{for(const s of statements)await client.query(s);console.log("erp-misc migration completed");}finally{await client.end();}