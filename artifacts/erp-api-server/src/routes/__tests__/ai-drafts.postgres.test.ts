import { realpathSync, statSync } from "node:fs";
import path from "node:path";
import express from "express";
import type { Server } from "node:http";
// @ts-expect-error pg is owned by workspace db
import pg from "../../../../../lib/erp-db/node_modules/pg/lib/index.js";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// Exercise the ACTUAL runtime DB proxy, ALS and transaction adapter. Only the
// connection resolver is replaced, and can never read shared DB credentials.
vi.mock("../../../../../lib/erp-db/src/connection.mjs", () => ({
  resolveDatabaseUrl: () => {
    const socket = process.env.MCP_TEST_PG_SOCKET;
    return socket
      ? `postgresql://mcp_owner@localhost/mcp_acceptance?host=${encodeURIComponent(socket)}&port=55439`
      : "postgresql://test@invalid.example/disabled_test";
  },
}));
import { getAppPool, pool, sessionPool } from "@workspace/erp-db";
import { tenantContext } from "../../middleware/tenant-context";
import router from "../ai-drafts";

const enabled = process.env.MCP_TEST_PG_ROOT && process.env.MCP_TEST_PG_SOCKET;
(enabled ? describe : describe.skip)("human approval on disposable PostgreSQL, real routes and DB adapter", () => {
  const owner = new pg.Client({
    host: process.env.MCP_TEST_PG_SOCKET, port: 55439,
    database: "mcp_acceptance", user: "mcp_owner",
  });
  let server: Server | undefined;
  let origin: string;
  const receipt = {
    voucherType: "收款單", voucherDate: "2026-09-10", customerId: 101, accountId: 101,
    description: "synthetic isolated receipt", items: [{ invoiceId: 101, amount: 20 }],
  };
  const financialTables = ["invoices", "vouchers", "journal_entries", "invoice_settlements", "activities", "notifications", "approval_requests"];
  const snapshot = async () => {
    const data: Record<string, unknown> = {};
    for (const table of financialTables) data[table] = (await owner.query(`SELECT row_to_json(t) FROM "${table}" t ORDER BY id`)).rows;
    return data;
  };
  const createDraft = async (docType: string, payload: unknown, tenantId = 7) =>
    (await owner.query(
      "INSERT INTO ai_draft_documents(tenant_id,doc_type,payload,summary) VALUES($1,$2,$3,'isolated test') RETURNING id",
      [tenantId, docType, JSON.stringify(payload)],
    )).rows[0].id as number;
  const post = async (id: number) => {
    const response = await fetch(`${origin}/ai-drafts/${id}/confirm`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ payload: { forged: true }, resultDocumentId: 999999 }),
    });
    return { status: response.status, body: await response.json() as any };
  };

  beforeAll(async () => {
    const root = realpathSync(process.env.MCP_TEST_PG_ROOT!);
    const socket = realpathSync(process.env.MCP_TEST_PG_SOCKET!);
    if (path.dirname(socket) !== root || !statSync(path.join(socket, ".s.PGSQL.55439")).isSocket()) {
      throw new Error("Not an isolated PostgreSQL socket");
    }
    await owner.connect();
    expect((await owner.query("SELECT current_database() d")).rows[0].d).toBe("mcp_acceptance");
    const tables = await owner.query("SELECT table_name FROM information_schema.columns WHERE table_schema='public' AND column_name='tenant_id'");
    for (const { table_name: table } of tables.rows) {
      await owner.query(`ALTER TABLE "${table}" ENABLE ROW LEVEL SECURITY; ALTER TABLE "${table}" FORCE ROW LEVEL SECURITY;
        DROP POLICY IF EXISTS tenant_isolation ON "${table}";
        CREATE POLICY tenant_isolation ON "${table}" USING (tenant_id=current_setting('app.tenant_id')::integer)
        WITH CHECK (tenant_id=current_setting('app.tenant_id')::integer)`);
    }
    await owner.query(`
      SET app.tenant_id='7';
      INSERT INTO customers(id,name) VALUES(101,'Synthetic Customer');
      INSERT INTO suppliers(id,name) VALUES(101,'Synthetic Supplier');
      INSERT INTO items(id,item_code,item_name) VALUES(101,'ISOLATED-ITEM','Synthetic Item');
      INSERT INTO accounts(id,account_number,account_name,account_type) VALUES
        (101,'1100','現金/銀行','Asset'), (102,'1200','應收帳款','Asset'),
        (103,'2100','應付帳款','Liability'), (104,'4100','銷貨收入','Income'),
        (105,'2281','銷項稅額','Liability'), (106,'1281','進項稅額','Asset');
      INSERT INTO invoices(id,invoice_number,invoice_type,customer_id,supplier_id,invoice_date,status,total_amount,outstanding_amount) VALUES
        (101,'ISOLATED-SALES','Sales',101,NULL,'2026-09-10','Unpaid',100,100),
        (102,'ISOLATED-PURCHASE','Purchase',NULL,101,'2026-09-10','Unpaid',100,100);
      SELECT setval(pg_get_serial_sequence('invoices','id'),102);
    `);
    // Initialize only this disposable cluster's restricted role/pool.
    await getAppPool();
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      (req as any).session = { user: { id: 12, tenantId: 7, role: "accountant", username: "isolated-human" } };
      next();
    });
    app.use(tenantContext, router);
    server = app.listen(0, "127.0.0.1");
    await new Promise<void>(resolve => server!.once("listening", resolve));
    origin = `http://127.0.0.1:${(server.address() as any).port}`;
  }, 30_000);

  afterAll(async () => {
    if (server) await new Promise<void>(resolve => server!.close(() => resolve()));
    await owner.end();
    await (await getAppPool()).end();
    await pool.end();
    await sessionPool.end();
  });

  it("serializes two genuinely blocked confirmations and posts one receipt/settlement/journal", async () => {
    const id = await createDraft("receipt", receipt);
    await owner.query("BEGIN");
    await owner.query("SELECT id FROM ai_draft_documents WHERE id=$1 FOR UPDATE", [id]);
    const first = post(id);
    const second = post(id);
    let waiting = 0;
    try {
      for (let n = 0; n < 100 && waiting < 2; n++) {
        await new Promise(resolve => setTimeout(resolve, 20));
        await owner.query("SELECT pg_stat_clear_snapshot()");
        waiting = (await owner.query(`SELECT count(*)::int n FROM pg_stat_activity
          WHERE usename='erp_app' AND wait_event_type='Lock' AND query LIKE '%ai_draft_documents%'`)).rows[0].n;
      }
    } finally { await owner.query("COMMIT"); }
    const results = await Promise.all([first, second]);
    expect(waiting).toBe(2);
    expect(results.map(r => r.status).sort(), JSON.stringify(results)).toEqual([200, 409]);
    const confirmed = results.find(r => r.status === 200)!.body;
    expect(confirmed).toMatchObject({ id, status: "confirmed", confirmedBy: 12 });
    for (const table of ["vouchers", "journal_entries", "invoice_settlements"]) {
      expect((await owner.query(`SELECT count(*)::int n FROM "${table}"`)).rows[0].n).toBe(1);
    }
    const voucher = (await owner.query("SELECT * FROM vouchers")).rows[0];
    expect(voucher.id).toBe(confirmed.resultDocumentId);
    expect(voucher.voucher_type).toBe("Receipt");
    expect(Number(voucher.total_amount)).toBe(20);
    const invoice = (await owner.query("SELECT * FROM invoices WHERE id=101")).rows[0];
    expect(Number(invoice.outstanding_amount)).toBe(80);
    const journal = (await owner.query("SELECT * FROM journal_entries")).rows[0];
    expect(journal.lines).toEqual(expect.arrayContaining([expect.objectContaining({ accountId: 101, debit: 20 })]));
    expect((await owner.query("SELECT count(*)::int n FROM ai_actions WHERE tool='human_confirm_draft'")).rows[0].n).toBe(1);
  });

  it("rolls back real voucher, settlement, invoice and journal writes when approval audit fails", async () => {
    const id = await createDraft("receipt", receipt);
    const before = await snapshot();
    const beforeVoucherSequence = (await owner.query("SELECT last_value FROM vouchers_id_seq")).rows[0].last_value;
    await owner.query("REVOKE INSERT ON ai_actions FROM erp_app");
    let result;
    try { result = await post(id); }
    finally { await owner.query("GRANT INSERT ON ai_actions TO erp_app"); }
    expect(result!.status, JSON.stringify(result)).toBe(500);
    // PostgreSQL sequences are nontransactional: advancement proves the existing
    // route really reached INSERT, rather than merely failing before creation.
    expect(Number((await owner.query("SELECT last_value FROM vouchers_id_seq")).rows[0].last_value))
      .toBeGreaterThan(Number(beforeVoucherSequence));
    expect(await snapshot()).toEqual(before);
    expect((await owner.query("SELECT status,result_document_id,confirmed_by FROM ai_draft_documents WHERE id=$1", [id])).rows[0])
      .toEqual({ status: "pending", result_document_id: null, confirmed_by: null });
  });

  it.each([
    ["quotation", { customerId: 101, quotationDate: "2026-09-10", items: [{ itemId: 101, quantity: 2, rate: 10 }] }, "quotations"],
    ["payment_request", { partyType: "Supplier", supplierId: 101, requestDate: "2026-09-10", amount: 10 }, "payment_requests"],
    ["sales_invoice", { customerId: 101, invoiceDate: "2026-09-10", items: [{ itemId: 101, quantity: 2, rate: 10 }] }, "invoices"],
    ["payment", { voucherType: "付款單", voucherDate: "2026-09-10", supplierId: 101, accountId: 101, items: [{ invoiceId: 102, amount: 10 }] }, "vouchers"],
  ])("confirms %s via its unchanged human create route", async (type, payload, table) => {
    const id = await createDraft(type as string, payload);
    const result = await post(id);
    expect(result.status, JSON.stringify(result)).toBe(200);
    expect(result.body).toMatchObject({ id, status: "confirmed", confirmedBy: 12 });
    const row = (await owner.query(`SELECT * FROM "${table}" WHERE id=$1`, [result.body.resultDocumentId])).rows[0];
    expect(row.tenant_id).toBe(7);
    if (type === "quotation") {
      expect(row.status).toBe("Draft");
      expect(Number(row.grand_total)).toBe(20);
    } else if (type === "payment_request") {
      expect(row.status).toBe("Draft");
      expect(Number(row.amount)).toBe(10);
    } else if (type === "sales_invoice") {
      expect(row.invoice_type).toBe("Sales");
      expect(Number(row.total_amount)).toBe(21);
      expect(row.journal_entry_id).toBeGreaterThan(0);
    } else {
      expect(row.voucher_type).toBe("Payment");
      expect(Number(row.total_amount)).toBe(10);
    }
  });

  it("does not confirm another tenant's draft", async () => {
    const id = await createDraft("receipt", receipt, 8);
    expect((await post(id)).status).toBe(404);
    expect((await owner.query("SELECT status FROM ai_draft_documents WHERE id=$1", [id])).rows[0].status).toBe("pending");
  });

  describe("AI customer drafts → formal customers via existing POST /customers", () => {
    const createCustomerDraft = async (payload: unknown, tenantId = 7) =>
      (await owner.query(
        "INSERT INTO ai_customer_drafts(tenant_id,payload,summary) VALUES($1,$2,'isolated customer draft') RETURNING id",
        [tenantId, JSON.stringify(payload)],
      )).rows[0].id as number;
    const act = async (id: number, action: "confirm" | "reject" = "confirm") => {
      const response = await fetch(`${origin}/ai-drafts/customers/${id}/${action}`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ payload: { name: "forged" }, resultCustomerId: 999999, tenantId: 8 }),
      });
      return { status: response.status, body: await response.json() as any };
    };
    const customers = async (tenantId = 7) =>
      (await owner.query("SELECT count(*)::int n FROM customers WHERE tenant_id=$1", [tenantId])).rows[0].n as number;
    const draftRow = async (id: number) =>
      (await owner.query("SELECT status,result_customer_id,confirmed_by FROM ai_customer_drafts WHERE id=$1", [id])).rows[0];

    it("confirms once: customer +1 via the real route (activity written), draft confirmed with result_customer_id, audit", async () => {
      const id = await createCustomerDraft({ name: "Draft Customer", taxId: "22099131", customerCode: "DC-1", email: "dc@example.test" });
      const before = await customers();
      const activitiesBefore = (await owner.query("SELECT count(*)::int n FROM activities")).rows[0].n;
      const result = await act(id);
      expect(result.status, JSON.stringify(result)).toBe(200);
      expect(result.body).toMatchObject({ id, status: "confirmed", confirmedBy: 12 });
      expect(result.body.resultCustomerId).toBeGreaterThan(0);
      expect(await customers()).toBe(before + 1);
      const customer = (await owner.query("SELECT * FROM customers WHERE id=$1", [result.body.resultCustomerId])).rows[0];
      expect(customer).toMatchObject({ tenant_id: 7, name: "Draft Customer", tax_id: "22099131", customer_code: "DC-1", email: "dc@example.test" });
      expect((await owner.query("SELECT count(*)::int n FROM activities")).rows[0].n).toBe(activitiesBefore + 1);
      expect((await owner.query("SELECT target_type,target_id,args FROM ai_actions WHERE tool='human_confirm_customer_draft'")).rows)
        .toEqual([{ target_type: "customers", target_id: result.body.resultCustomerId, args: { draftId: id, userId: 12 } }]);
      // Duplicate confirmation is rejected and creates nothing.
      expect((await act(id)).status).toBe(409);
      expect((await act(id, "reject")).status).toBe(409);
      expect(await customers()).toBe(before + 1);
    });

    it("serializes concurrent confirmations: exactly one 200 and one 409", async () => {
      const id = await createCustomerDraft({ name: "Concurrent Customer", taxId: "04595257" });
      const before = await customers();
      const results = await Promise.all([act(id), act(id)]);
      expect(results.map(r => r.status).sort(), JSON.stringify(results)).toEqual([200, 409]);
      expect(await customers()).toBe(before + 1);
    });

    it("rolls back when a same-統編 customer appeared before confirmation; draft stays pending", async () => {
      const id = await createCustomerDraft({ name: "Late Draft", taxId: "10458574" });
      await owner.query("SET app.tenant_id='7'; INSERT INTO customers(name,tax_id) VALUES('Created By Human','10458574'); RESET app.tenant_id");
      const before = await customers();
      const result = await act(id);
      expect(result.status, JSON.stringify(result)).toBe(409);
      expect(result.body.field).toBe("taxId");
      expect(await customers()).toBe(before);
      expect(await draftRow(id)).toEqual({ status: "pending", result_customer_id: null, confirmed_by: null });
    });

    it("rejects duplicates of name/customer_code against formal customers and other pending drafts at confirm", async () => {
      const byName = await createCustomerDraft({ name: " Draft Customer " });
      const byCode = await createCustomerDraft({ name: "Code Twin", customerCode: "DC-1" });
      const pendingA = await createCustomerDraft({ name: "Twin Pending", taxId: "22099136" });
      const pendingB = await createCustomerDraft({ name: "Twin Pending 2", taxId: "22099136" });
      const before = await customers();
      for (const [id, field] of [[byName, "name"], [byCode, "customerCode"], [pendingA, "taxId"], [pendingB, "taxId"]] as const) {
        const result = await act(id);
        expect(result.status, JSON.stringify(result)).toBe(409);
        expect(result.body.field).toBe(field);
        expect((await draftRow(id)).status).toBe("pending");
      }
      expect(await customers()).toBe(before);
    });

    it("rolls back the real customer and activity when the approval audit fails", async () => {
      const id = await createCustomerDraft({ name: "Audit Failure Customer" });
      const before = await customers();
      const activitiesBefore = (await owner.query("SELECT count(*)::int n FROM activities")).rows[0].n;
      const sequenceBefore = Number((await owner.query("SELECT last_value FROM customers_id_seq")).rows[0].last_value);
      await owner.query("REVOKE INSERT ON ai_actions FROM erp_app");
      let result;
      try { result = await act(id); }
      finally { await owner.query("GRANT INSERT ON ai_actions TO erp_app"); }
      expect(result!.status, JSON.stringify(result)).toBe(500);
      expect(Number((await owner.query("SELECT last_value FROM customers_id_seq")).rows[0].last_value)).toBeGreaterThan(sequenceBefore);
      expect(await customers()).toBe(before);
      expect((await owner.query("SELECT count(*)::int n FROM activities")).rows[0].n).toBe(activitiesBefore);
      expect(await draftRow(id)).toEqual({ status: "pending", result_customer_id: null, confirmed_by: null });
    });

    it("rejects an invalid stored 統編 with 400 and creates nothing", async () => {
      const id = await createCustomerDraft({ name: "Bad Stored Tax", taxId: "22099132" });
      const before = await customers();
      expect((await act(id)).status).toBe(400);
      expect(await customers()).toBe(before);
      expect((await draftRow(id)).status).toBe("pending");
    });

    it("reject changes only draft status and blocks later confirmation", async () => {
      const id = await createCustomerDraft({ name: "Rejected Customer" });
      const before = await customers();
      const rejected = await act(id, "reject");
      expect(rejected.status).toBe(200);
      expect(rejected.body).toMatchObject({ id, status: "rejected", resultCustomerId: null });
      expect((await act(id)).status).toBe(409);
      expect(await customers()).toBe(before);
    });

    it("isolates tenants: another tenant's draft is invisible, cannot be confirmed or rejected", async () => {
      const id = await createCustomerDraft({ name: "Tenant Eight Customer", taxId: "22099131" }, 8);
      expect((await act(id)).status).toBe(404);
      expect((await act(id, "reject")).status).toBe(404);
      expect(await draftRow(id)).toEqual({ status: "pending", result_customer_id: null, confirmed_by: null });
      expect(await customers(8)).toBe(0);
      const listed = await (await fetch(`${origin}/ai-drafts/customers?status=pending`)).json() as any[];
      expect(listed.length).toBeGreaterThan(0);
      expect(listed.every(d => d.tenantId === 7)).toBe(true);
      expect(listed.some(d => d.id === id)).toBe(false);
      expect((await fetch(`${origin}/ai-drafts/customers?status=bogus`)).status).toBe(400);
    });
  });
});
