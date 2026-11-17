import { realpathSync, statSync } from "node:fs";
import type { Server } from "node:http";
import path from "node:path";
import express from "express";
import { drizzle } from "drizzle-orm/node-postgres";
// Test-only driver import: never load the workspace DB runtime or initialize its role.
// @ts-expect-error workspace database owns pg
import pg from "../../../../../lib/erp-db/node_modules/pg/lib/index.js";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const injected = vi.hoisted(() => ({ db: null as any }));

vi.mock("@workspace/erp-db", async () => ({
  ...await import("@workspace/erp-db/schema"),
  db: new Proxy({}, {
    get: (_target, key) => {
      const value = injected.db[key];
      return typeof value === "function" ? value.bind(injected.db) : value;
    },
  }),
}));

// Exercise the real route handlers and real PostgreSQL transactions; only auth is bypassed.
vi.mock("../../middleware/require-auth", () => ({
  requireAuth: (_req: unknown, _res: unknown, next: () => void) => next(),
  requireRole: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));

import deliveryNotesRouter from "../delivery-notes";
import purchaseReceiptsRouter from "../purchase-receipts";

const optedIn =
  process.env.ORDER_DOCUMENTS_POSTGRES_ACCEPTANCE === "1" &&
  Boolean(process.env.ORDER_DOCUMENTS_TEST_PG_ROOT) &&
  Boolean(process.env.ORDER_DOCUMENTS_TEST_PG_SOCKET);
const acceptance = optedIn ? describe : describe.skip;

acceptance("order document locking against disposable PostgreSQL", () => {
  const pool = new pg.Pool({
    host: process.env.ORDER_DOCUMENTS_TEST_PG_SOCKET,
    port: Number(process.env.ORDER_DOCUMENTS_TEST_PG_PORT),
    database: "order_documents_acceptance",
    user: "order_documents_test_owner",
    options: "-c app.tenant_id=1",
  });
  let server: Server;
  let baseUrl: string;

  beforeAll(async () => {
    const root = realpathSync(process.env.ORDER_DOCUMENTS_TEST_PG_ROOT!);
    const socket = realpathSync(process.env.ORDER_DOCUMENTS_TEST_PG_SOCKET!);
    if (path.dirname(socket) !== root || path.basename(socket) !== "socket") {
      throw new Error("Dedicated test socket is outside the runner-controlled directory");
    }
    const socketFile = path.join(socket, `.s.PGSQL.${process.env.ORDER_DOCUMENTS_TEST_PG_PORT}`);
    if (!statSync(socketFile).isSocket()) {
      throw new Error("Dedicated test PostgreSQL Unix socket is unavailable");
    }

    const context = await pool.query("SELECT current_database(), current_user");
    expect(context.rows).toEqual([{
      current_database: "order_documents_acceptance",
      current_user: "order_documents_test_owner",
    }]);

    await pool.query(`
      CREATE TABLE customers (
        tenant_id integer NOT NULL DEFAULT current_setting('app.tenant_id')::integer,
        id serial PRIMARY KEY, customer_code text, name text NOT NULL, short_name text,
        email text, phone text, mobile text, contact_person text, sales_person text,
        address text, city text, country text, tax_id text, category text DEFAULT '一般客戶',
        created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE TABLE suppliers (
        tenant_id integer NOT NULL DEFAULT current_setting('app.tenant_id')::integer,
        id serial PRIMARY KEY, supplier_code text, name text NOT NULL, short_name text,
        email text, phone text, mobile text, contact_person text, address text, city text,
        country text, tax_id text, category text DEFAULT '一般供應商',
        created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE TABLE items (
        tenant_id integer NOT NULL DEFAULT current_setting('app.tenant_id')::integer,
        id serial PRIMARY KEY, item_code text NOT NULL, item_name text NOT NULL,
        item_group text, item_type text, description text, specification text,
        unit text NOT NULL DEFAULT 'Nos', selling_price numeric(12,2) NOT NULL DEFAULT 0,
        buying_price numeric(12,2) NOT NULL DEFAULT 0, total_cost numeric(12,2) DEFAULT 0,
        material_cost numeric(12,2) DEFAULT 0, expense_cost numeric(12,2) DEFAULT 0,
        outsourcing_cost numeric(12,2) DEFAULT 0, labor_cost numeric(12,2) DEFAULT 0,
        internal_price numeric(12,2) DEFAULT 0, wholesale_price numeric(12,2) DEFAULT 0,
        retail_price numeric(12,2) DEFAULT 0, svip_price numeric(12,2) DEFAULT 0,
        peer_price numeric(12,2) DEFAULT 0, dealer_price numeric(12,2) DEFAULT 0,
        supplier_name text, summary text, moving_avg_cost numeric(14,4) NOT NULL DEFAULT 0,
        current_stock numeric(12,2) NOT NULL DEFAULT 0, reorder_level numeric(12,2) NOT NULL DEFAULT 0,
        is_virtual boolean NOT NULL DEFAULT false, status text NOT NULL DEFAULT 'Active',
        created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE TABLE sales_orders (
        tenant_id integer NOT NULL DEFAULT current_setting('app.tenant_id')::integer,
        id serial PRIMARY KEY, order_number text NOT NULL, customer_id integer NOT NULL,
        salesperson_id integer, order_date text NOT NULL, delivery_date text, status text NOT NULL DEFAULT 'Draft',
        total_amount numeric(14,2) NOT NULL DEFAULT 0, items jsonb NOT NULL DEFAULT '[]',
        department_id integer, project_id integer, order_source text, quotation_id integer,
        template_id integer, extra_fields jsonb DEFAULT '{}', label text, handler_id integer,
        class_weeks integer, course_start_date text, course_end_date text, case_time text,
        teacher_code text, teacher_fee_per_session numeric(10,2), teacher_material_fee_method text,
        course_period text, warehouse_code text, transaction_type text, date_details text, remarks text,
        invoice_tax_id text, invoice_title text, journal_entry_id integer,
        created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE TABLE purchase_orders (
        tenant_id integer NOT NULL DEFAULT current_setting('app.tenant_id')::integer,
        id serial PRIMARY KEY, order_number text NOT NULL, supplier_id integer NOT NULL,
        order_date text NOT NULL, expected_date text, status text NOT NULL DEFAULT 'Draft',
        total_amount numeric(14,2) NOT NULL DEFAULT 0, currency text NOT NULL DEFAULT 'TWD',
        exchange_rate numeric(12,6) NOT NULL DEFAULT 1, items jsonb NOT NULL DEFAULT '[]',
        template_id integer, extra_fields jsonb DEFAULT '{}', department_id integer, project_id integer,
        created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE TABLE delivery_notes (
        tenant_id integer NOT NULL DEFAULT current_setting('app.tenant_id')::integer,
        id serial PRIMARY KEY, note_number text NOT NULL, sales_order_id integer, customer_id integer NOT NULL,
        warehouse_id integer, delivery_date text NOT NULL, status text NOT NULL DEFAULT 'Draft',
        total_amount numeric(14,2) NOT NULL DEFAULT 0, items jsonb NOT NULL DEFAULT '[]',
        remarks text, department_id integer, project_id integer, cogs_journal_entry_id integer,
        created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE TABLE purchase_receipts (
        tenant_id integer NOT NULL DEFAULT current_setting('app.tenant_id')::integer,
        id serial PRIMARY KEY, receipt_number text NOT NULL, purchase_order_id integer, supplier_id integer NOT NULL,
        warehouse_id integer, receipt_date text NOT NULL, status text NOT NULL DEFAULT 'Draft',
        total_amount numeric(14,2) NOT NULL DEFAULT 0, items jsonb NOT NULL DEFAULT '[]',
        remarks text, department_id integer, project_id integer,
        created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE TABLE purchase_returns (
        tenant_id integer NOT NULL DEFAULT current_setting('app.tenant_id')::integer,
        id serial PRIMARY KEY, return_number text NOT NULL, purchase_receipt_id integer,
        supplier_id integer NOT NULL, warehouse_id integer, return_date text NOT NULL,
        reason text, status text NOT NULL DEFAULT 'Draft',
        total_amount numeric(14,2) NOT NULL DEFAULT 0, items jsonb NOT NULL DEFAULT '[]',
        remarks text, department_id integer, project_id integer, debit_note_invoice_id integer,
        reverse_receipt_id integer, created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE TABLE activities (
        tenant_id integer NOT NULL DEFAULT current_setting('app.tenant_id')::integer,
        id serial PRIMARY KEY, type text NOT NULL, title text NOT NULL,
        description text NOT NULL, module text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE TABLE invoices (
        tenant_id integer NOT NULL DEFAULT current_setting('app.tenant_id')::integer,
        id serial PRIMARY KEY, invoice_number text NOT NULL, invoice_type text NOT NULL,
        customer_id integer, supplier_id integer, sales_order_id integer, delivery_note_id integer,
        purchase_order_id integer, purchase_receipt_id integer, invoice_date text NOT NULL,
        status text NOT NULL DEFAULT 'Draft'
      );
      CREATE TABLE sales_returns (
        tenant_id integer NOT NULL DEFAULT current_setting('app.tenant_id')::integer,
        id serial PRIMARY KEY, delivery_note_id integer, status text NOT NULL DEFAULT 'Draft',
        items jsonb NOT NULL DEFAULT '[]'
      );
      CREATE TABLE accounting_settings (
        tenant_id integer NOT NULL DEFAULT current_setting('app.tenant_id')::integer,
        id serial PRIMARY KEY, lock_date text, updated_at timestamptz NOT NULL DEFAULT now()
      );
      -- 出貨／進貨入庫前會檢查連結的品質檢驗
      CREATE TABLE quality_inspection_templates (
        tenant_id integer NOT NULL DEFAULT current_setting('app.tenant_id')::integer,
        id serial PRIMARY KEY, name text NOT NULL, inspection_type text NOT NULL DEFAULT 'Incoming',
        item_id integer, criteria jsonb NOT NULL DEFAULT '[]', remarks text,
        created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE TABLE quality_inspections (
        tenant_id integer NOT NULL DEFAULT current_setting('app.tenant_id')::integer,
        id serial PRIMARY KEY, inspection_number text NOT NULL, template_id integer,
        inspection_type text NOT NULL DEFAULT 'Incoming', item_id integer,
        reference_type text, reference_id integer, status text NOT NULL DEFAULT 'Draft',
        inspection_date text NOT NULL DEFAULT '2026-01-01'
      );
    `);

    injected.db = drizzle(pool);
    const app = express();
    app.use(express.json());
    app.use(deliveryNotesRouter);
    app.use(purchaseReceiptsRouter);
    server = app.listen(0, "127.0.0.1");
    await new Promise<void>((resolve) => server.once("listening", resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as any).port}`;
  });

  beforeEach(async () => {
    await pool.query(`
      TRUNCATE activities, sales_returns, purchase_returns, invoices, delivery_notes, purchase_receipts,
        sales_orders, purchase_orders, customers, suppliers, items RESTART IDENTITY CASCADE;
      INSERT INTO customers(id, name) VALUES (1, 'Acceptance customer');
      INSERT INTO suppliers(id, name) VALUES (1, 'Acceptance supplier');
      INSERT INTO items(id, item_code, item_name, current_stock, moving_avg_cost, buying_price)
        VALUES (1, 'ITEM-1', 'Locking item', 10, 0, 0);
      INSERT INTO sales_orders(id, order_number, customer_id, order_date, delivery_date, total_amount, items)
        VALUES (1, 'SO-LOCK', 1, '2026-01-01', '2026-01-02', 0,
          '[{"itemId":1,"itemName":"Locking item","quantity":5,"rate":0,"amount":0}]');
      INSERT INTO purchase_orders(id, order_number, supplier_id, order_date, expected_date, total_amount, items)
        VALUES (1, 'PO-LOCK', 1, '2026-01-01', '2026-01-02', 0,
          '[{"itemId":1,"itemName":"Locking item","quantity":5,"rate":4,"amount":20}]');
    `);
  });

  afterAll(async () => {
    if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
    await pool.end();
    injected.db = null;
  });

  async function post(pathname: string, body: object = {}) {
    return fetch(baseUrl + pathname, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  async function patch(pathname: string, body: object) {
    return fetch(baseUrl + pathname, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  it("serializes delivery creation, submit, and cancel without duplicate allocation or stock movement", async () => {
    const creates = await Promise.all([
      post("/delivery-notes/from-order/1"),
      post("/delivery-notes/from-order/1"),
    ]);
    expect(creates.map((response) => response.status).sort()).toEqual([201, 400]);
    const docs = await pool.query("SELECT id, status, items FROM delivery_notes ORDER BY id");
    expect(docs.rows).toHaveLength(1);
    expect(docs.rows[0].items).toMatchObject([{ itemId: 1, quantity: 5 }]);

    const id = docs.rows[0].id;
    const submits = await Promise.all([
      patch(`/delivery-notes/${id}`, { status: "Submitted" }),
      patch(`/delivery-notes/${id}`, { status: "Submitted" }),
    ]);
    expect(submits.map((response) => response.status).sort()).toEqual([200, 400]);
    expect((await pool.query("SELECT current_stock::float AS stock FROM items WHERE id=1")).rows[0].stock).toBe(5);
    expect((await pool.query("SELECT status FROM sales_orders WHERE id=1")).rows[0].status).toBe("Completed");

    const cancels = await Promise.all([
      patch(`/delivery-notes/${id}`, { status: "Cancelled" }),
      patch(`/delivery-notes/${id}`, { status: "Cancelled" }),
    ]);
    expect(cancels.map((response) => response.status).sort()).toEqual([200, 400]);
    expect((await pool.query("SELECT current_stock::float AS stock FROM items WHERE id=1")).rows[0].stock).toBe(10);
    expect((await pool.query("SELECT status FROM delivery_notes WHERE id=$1", [id])).rows[0].status).toBe("Cancelled");
    expect((await pool.query("SELECT status FROM sales_orders WHERE id=1")).rows[0].status).toBe("Draft");
  });

  it("serializes receipt creation, submit, and cancel without duplicate allocation or stock movement", async () => {
    const creates = await Promise.all([
      post("/purchase-receipts/from-order/1"),
      post("/purchase-receipts/from-order/1"),
    ]);
    expect(creates.map((response) => response.status).sort()).toEqual([201, 400]);
    const docs = await pool.query("SELECT id, status, items FROM purchase_receipts ORDER BY id");
    expect(docs.rows).toHaveLength(1);
    expect(docs.rows[0].items).toMatchObject([{ itemId: 1, quantity: 5 }]);

    const id = docs.rows[0].id;
    const submits = await Promise.all([
      patch(`/purchase-receipts/${id}`, { status: "Submitted" }),
      patch(`/purchase-receipts/${id}`, { status: "Submitted" }),
    ]);
    expect(submits.map((response) => response.status).sort()).toEqual([200, 400]);
    expect((await pool.query("SELECT current_stock::float AS stock FROM items WHERE id=1")).rows[0].stock).toBe(15);
    expect((await pool.query("SELECT status FROM purchase_orders WHERE id=1")).rows[0].status).toBe("Completed");

    await pool.query(`
      INSERT INTO purchase_returns(return_number, purchase_receipt_id, supplier_id, return_date, status, items)
      VALUES ('PRET-ACTIVE', $1, 1, '2026-01-03', 'Submitted', '[]')
    `, [id]);
    const blocked = await patch(`/purchase-receipts/${id}`, { status: "Cancelled" });
    expect(blocked.status).toBe(400);
    await expect(blocked.json()).resolves.toMatchObject({
      error: expect.stringContaining("採購退回"),
    });
    expect((await pool.query("SELECT current_stock::float AS stock FROM items WHERE id=1")).rows[0].stock).toBe(15);
    expect((await pool.query("SELECT status FROM purchase_receipts WHERE id=$1", [id])).rows[0].status).toBe("Submitted");
    await pool.query("DELETE FROM purchase_returns WHERE purchase_receipt_id=$1", [id]);

    const cancels = await Promise.all([
      patch(`/purchase-receipts/${id}`, { status: "Cancelled" }),
      patch(`/purchase-receipts/${id}`, { status: "Cancelled" }),
    ]);
    expect(cancels.map((response) => response.status).sort()).toEqual([200, 400]);
    expect((await pool.query("SELECT current_stock::float AS stock FROM items WHERE id=1")).rows[0].stock).toBe(10);
    expect((await pool.query("SELECT status FROM purchase_receipts WHERE id=$1", [id])).rows[0].status).toBe("Cancelled");
    expect((await pool.query("SELECT status FROM purchase_orders WHERE id=1")).rows[0].status).toBe("Draft");
  });
});