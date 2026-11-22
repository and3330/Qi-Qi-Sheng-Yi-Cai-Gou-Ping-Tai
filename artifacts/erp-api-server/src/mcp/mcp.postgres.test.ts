import { realpathSync, statSync } from "node:fs";
import path from "node:path";
import express from "express";
import type { Server as HttpServer } from "node:http";
// @ts-expect-error pg belongs to workspace db
import pg from "../../../../lib/erp-db/node_modules/pg/lib/index.js";
import { drizzle } from "drizzle-orm/node-postgres";
import { beforeAll, afterAll, describe, it, expect, vi } from "vitest";
const state = vi.hoisted(() => ({ client: null as any, database: null as any, tenant: null as number | null }));
vi.mock("@workspace/erp-db", async () => {
  const schema = await import("../../../../lib/erp-db/src/schema");
  return {
    ...schema,
    db: new Proxy({}, { get: (_,key) => { const v = state.database[key]; return typeof v === "function" ? v.bind(state.database) : v; } }),
    currentTenantId: () => state.tenant,
    currentTenantClient: () => state.client,
    runWithTenant: async (tenant: number, fn: () => Promise<unknown>) => {
      await state.client.query("SELECT set_config('app.tenant_id',$1,false)",[String(tenant)]);
      state.tenant = tenant;
      try { return await fn(); } finally { state.tenant = null; await state.client.query("RESET app.tenant_id"); }
    },
  };
});
import router, { validBearer, auditArgs, audit, auditedTool } from "./index";
import { toolSchemas, executeTool } from "./tools";
import { validateDraft } from "./drafts";
import { toCustomerDraftPayload } from "./customer-drafts";
import { runWithTenant } from "@workspace/erp-db";
import { CreateInvoiceBody, CreateVoucherBody } from "@workspace/erp-api-zod";

describe("MCP boundary unit checks", () => {
  it("uses exact bearer credential and rejects missing or malformed input", () => {
    expect(validBearer("Bearer abc","abc")).toBe(true);
    for (const token of [undefined,"abc","Bearer ab","Bearer abc ","bearer abc","Bearer "]) expect(validBearer(token,"abc")).toBe(false);
  });
  it("redacts all arguments including key names and sensitive nested payloads", () => {
    expect(JSON.stringify(auditArgs({ password: "private", payload: { bankAccount: "secret" } }))).not.toMatch(/private|secret|password|bankAccount/);
  });
  it("exposes exactly twenty-two tools (legacy key still sees ten) and rejects tenant injection, SQL and excessive limits", () => {
    // 2026-11-11：新增 5 個依身分開放的工具；原有共用金鑰仍只看得到原本的 10 個（identity.test.ts）
    // 2026-11-13：新增 4 個只給全權身分的工具（通用操作、報價單 PDF）
    // 2026-11-19：新增 erp_whoami（ERP 金鑰回答「代表誰、能做什麼」）
    expect(Object.keys(toolSchemas)).toHaveLength(22);
    expect(toolSchemas.search_documents.safeParse({ type:"invoices",limit:51 }).success).toBe(false);
    expect(toolSchemas.get_finance_summary.safeParse({ tenantId:2 }).success).toBe(false);
    expect(toolSchemas.get_document.safeParse({ type:"employees",id:1 }).success).toBe(false);
    expect(toolSchemas.create_receipt_draft.safeParse({ customer_id:1,date:"2026-02-30",account_id:1,lines:[{invoice_id:1,amount:1}],description:"" }).success).toBe(false);
  });
  it("fails before any database access without trusted tenant context", async () => {
    await expect(audit("get_document", {}, "denied")).rejects.toThrow("Tenant context required");
    await expect(executeTool("list_my_drafts", {})).rejects.toThrow("Tenant context required");
  });
  it("allows empty customer searches and bounded limits but retains strict arguments", () => {
    for (const args of [{}, {limit:1}, {keyword:""}, {keyword:"   ",limit:50}]) {
      expect(toolSchemas.search_customers.safeParse(args).success).toBe(true);
    }
    expect(toolSchemas.search_customers.parse({keyword:"  ACME  "}).keyword).toBe("ACME");
    for (const args of [{limit:0}, {limit:51}, {limit:1.5}, {keyword:null}, {tenant_id:2}, {sql:"SELECT 1"}]) {
      expect(toolSchemas.search_customers.safeParse(args).success).toBe(false);
    }
  });
  it("create_customer_draft is strict, trims input, validates 統編 and never accepts a tenant", () => {
    const schema = toolSchemas.create_customer_draft;
    const parsed = schema.parse({ name: "  Acme 股份有限公司 ", tax_id: " 22099131 ", customer_code: " AC-1 ", email: "" });
    expect(parsed).toMatchObject({ name: "Acme 股份有限公司", tax_id: "22099131", customer_code: "AC-1" });
    expect(toCustomerDraftPayload(parsed)).toEqual({ name: "Acme 股份有限公司", taxId: "22099131", customerCode: "AC-1" });
    for (const extra of [{ tenant_id: 2 }, { tenantId: 2 }, { tenant: 2 }, { id: 5 }, { taxId: "22099131" }]) {
      expect(schema.safeParse({ name: "X", ...extra }).success).toBe(false);
    }
    for (const bad of [{}, { name: "" }, { name: "   " }, { name: "x".repeat(201) }, { name: "X", tax_id: "22099132" },
      { name: "X", tax_id: "2209 9131" }, { name: "X", tax_id: "2209913A" }, { name: "X", tax_id: "2209913" }, { name: "X", tax_id: "" }]) {
      expect(schema.safeParse(bad).success).toBe(false);
    }
  });
});

const enabled = process.env.MCP_TEST_PG_ROOT && process.env.MCP_TEST_PG_SOCKET;
(enabled ? describe : describe.skip)("MCP on disposable PostgreSQL", () => {
  const conn = { host: process.env.MCP_TEST_PG_SOCKET, port: 55439, database: "mcp_acceptance" };
  const owner = new pg.Client({ ...conn, user: "mcp_owner" });
  const client = new pg.Client({ ...conn, user: "erp_app" });
  let http: HttpServer;
  let origin: string;
  it("requires explicit tenants and rejects cross-tenant INSERT on both AI tables", async () => {
    const columns = (await owner.query(`SELECT table_name,column_default,is_nullable
      FROM information_schema.columns
      WHERE table_schema='public' AND table_name IN ('ai_actions','ai_draft_documents','ai_customer_drafts') AND column_name='tenant_id'`)).rows;
    expect(columns).toHaveLength(3);
    for (const col of columns) {
      expect(col.column_default).toBeNull();
      expect(col.is_nullable).toBe("NO");
    }
    await runWithTenant(1, async () => {
      await expect(client.query("INSERT INTO ai_actions(tool,args,status,result_summary) VALUES('probe','{}','ok','probe')"))
        .rejects.toMatchObject({ code: expect.stringMatching(/^(23502|42501)$/) });
      await expect(client.query("INSERT INTO ai_draft_documents(doc_type,payload,summary) VALUES('receipt','{}','probe')"))
        .rejects.toMatchObject({ code: expect.stringMatching(/^(23502|42501)$/) });
      await expect(client.query("INSERT INTO ai_actions(tenant_id,tool,args,status,result_summary) VALUES(2,'probe','{}','ok','probe')"))
        .rejects.toMatchObject({ code: "42501" });
      await expect(client.query("INSERT INTO ai_draft_documents(tenant_id,doc_type,payload,summary) VALUES(2,'receipt','{}','probe')"))
        .rejects.toMatchObject({ code: "42501" });
      await expect(client.query("INSERT INTO ai_customer_drafts(payload,summary) VALUES('{}','probe')"))
        .rejects.toMatchObject({ code: expect.stringMatching(/^(23502|42501)$/) });
      await expect(client.query("INSERT INTO ai_customer_drafts(tenant_id,payload,summary) VALUES(2,'{}','probe')"))
        .rejects.toMatchObject({ code: "42501" });
    });
  });
  beforeAll(async () => {
    const root = realpathSync(process.env.MCP_TEST_PG_ROOT!);
    const socket = realpathSync(process.env.MCP_TEST_PG_SOCKET!);
    if (path.dirname(socket) !== root || !statSync(path.join(socket,".s.PGSQL.55439")).isSocket()) throw new Error("Not an isolated socket");
    await owner.connect();
    expect((await owner.query("select current_database() d")).rows[0].d).toBe("mcp_acceptance");
    await owner.query("CREATE ROLE erp_app LOGIN NOSUPERUSER NOBYPASSRLS; GRANT USAGE ON SCHEMA public TO erp_app; GRANT SELECT,INSERT,UPDATE ON ALL TABLES IN SCHEMA public TO erp_app; GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA public TO erp_app;");
    const tables = await owner.query("SELECT table_name FROM information_schema.columns WHERE table_schema='public' AND column_name='tenant_id'");
    for (const { table_name: t } of tables.rows) await owner.query(`ALTER TABLE "${t}" ENABLE ROW LEVEL SECURITY; ALTER TABLE "${t}" FORCE ROW LEVEL SECURITY; DROP POLICY IF EXISTS tenant_isolation ON "${t}"; CREATE POLICY tenant_isolation ON "${t}" USING (tenant_id=current_setting('app.tenant_id')::integer) WITH CHECK (tenant_id=current_setting('app.tenant_id')::integer)`);
    await owner.query(`
      SET app.tenant_id='1';
      INSERT INTO customers(id,name) VALUES(1,'A');
      INSERT INTO suppliers(id,name) VALUES(1,'Supplier A');
      INSERT INTO items(id,item_code,item_name) VALUES(1,'ITEM-A','Item A');
      INSERT INTO accounts(id,account_number,account_name,account_type) VALUES(1,'1100','現金/銀行','Asset');
      INSERT INTO invoices(id,invoice_number,invoice_type,customer_id,invoice_date,status,total_amount,outstanding_amount) VALUES(1,'A-INV','Sales',1,'2026-01-01','Unpaid',100,100);
      SET app.tenant_id='2';
      INSERT INTO customers(id,name) VALUES(2,'B');
      INSERT INTO invoices(id,invoice_number,invoice_type,customer_id,invoice_date,status,total_amount,outstanding_amount) VALUES(2,'B-INV','Sales',2,'2026-01-01','Unpaid',200,200);
    `);
    await client.connect();
    state.client = client; state.database = drizzle(client);
    const app = express();
    app.use(express.json()); app.use("/mcp",router);
    http = app.listen(0,"127.0.0.1");
    await new Promise<void>(resolve => http.once("listening",resolve));
    origin = `http://127.0.0.1:${(http.address() as any).port}/mcp`;
  });
  afterAll(async () => {
    vi.unstubAllEnvs();
    await new Promise<void>(resolve => http.close(() => resolve()));
    await client.end(); await owner.end();
  });
  const receipt = (lines = [{invoice_id:1,amount:20}]) => ({customer_id:1,date:"2026-09-10",account_id:1,lines,description:"confidential note"});
  it("creates only AI draft and redacted audit; never mutates financial data", async () => {
    const before = (await owner.query("SELECT row_to_json(i) data FROM invoices i ORDER BY id")).rows;
    const result = await auditedTool(1,"create_receipt_draft",receipt());
    expect(result).not.toHaveProperty("isError");
    expect((await owner.query("SELECT row_to_json(i) data FROM invoices i ORDER BY id")).rows).toEqual(before);
    for (const table of ["vouchers","journal_entries","invoice_settlements"]) expect((await owner.query(`SELECT count(*)::int n FROM ${table}`)).rows[0].n).toBe(0);
    const audits = (await owner.query("SELECT * FROM ai_actions")).rows;
    expect(audits.at(-1).status).toBe("ok");
    expect(JSON.stringify(audits)).not.toContain("confidential");
    expect((await owner.query("SELECT status FROM ai_draft_documents")).rows).toEqual([{status:"pending"}]);
  });
  it("rejects aggregate overpayment and cross-tenant references with audit", async () => {
    expect((await auditedTool(1,"create_receipt_draft",receipt([{invoice_id:1,amount:60},{invoice_id:1,amount:60}]))).isError).toBe(true);
    expect((await auditedTool(1,"create_receipt_draft",receipt([{invoice_id:2,amount:10}]))).isError).toBe(true);
    expect((await owner.query("SELECT count(*)::int n FROM ai_draft_documents")).rows[0].n).toBe(1);
    expect((await owner.query("SELECT count(*)::int n FROM ai_actions WHERE status='error'")).rows[0].n).toBe(2);
  });
  it("isolates reads and drafts, denies unknown and invalid tools, strips private fields", async () => {
    const result = await auditedTool(1,"search_documents",{type:"invoices"});
    expect(JSON.parse(result.content[0].text).map((r: any) => r.number)).toEqual(["A-INV"]);
    expect(result.content[0].text).not.toMatch(/ecpay|employee|tenantId/);
    expect(JSON.parse((await auditedTool(2,"list_my_drafts",{})).content[0].text)).toEqual([]);
    expect((await auditedTool(1,"execute_sql",{sql:"DELETE FROM invoices"})).isError).toBe(true);
    expect((await auditedTool(1,"search_customers",{keyword:"A",tenantId:2})).isError).toBe(true);
    expect((await owner.query("SELECT count(*)::int n FROM ai_actions WHERE status='denied'")).rows[0].n).toBe(2);
  });
  it("converts receipts to existing human voucher payload with Chinese type", async () => {
    const body = await runWithTenant(1,() => validateDraft("receipt",{voucherType:"收款單",voucherDate:"2026-09-10",customerId:1,accountId:1,description:"test",items:[{invoiceId:1,amount:10}]}));
    expect(body.voucherType).toBe("收款單");
    expect(body.totalAmount).toBe("10.00");
    expect(body.items).toEqual([{invoiceId:1,amount:10,accountId:1,description:"test"}]);
    expect(CreateVoucherBody.safeParse(body).success).toBe(true);
  });
  it("rolls draft back if audit persistence fails", async () => {
    const before = (await owner.query("SELECT count(*)::int n FROM ai_draft_documents")).rows[0].n;
    await owner.query("REVOKE INSERT ON ai_actions FROM erp_app");
    try {
      await expect(auditedTool(1,"create_receipt_draft",receipt())).rejects.toThrow();
      vi.stubEnv("ERP_AI_TENANT_ID","1"); vi.stubEnv("ERP_AI_KEY","test-only-key");
      const denied = await fetch(origin,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({jsonrpc:"2.0",id:1,method:"tools/list"})});
      expect(denied.status).toBe(401);
    } finally { await owner.query("GRANT INSERT ON ai_actions TO erp_app"); }
    expect((await owner.query("SELECT count(*)::int n FROM ai_draft_documents")).rows[0].n).toBe(before);
  });
  it("enforces HTTP config/auth, stateless MCP and cross-instance database rate budget", async () => {
    vi.stubEnv("ERP_AI_TENANT_ID","1");
    vi.stubEnv("ERP_AI_KEY","");
    const call = (key = "test-only-key", body: unknown = {jsonrpc:"2.0",id:1,method:"tools/list"}) =>
      fetch(origin,{method:"POST",headers:{"Content-Type":"application/json",Accept:"application/json, text/event-stream",Authorization:`Bearer ${key}`},body:JSON.stringify(body)});
    expect((await call()).status).toBe(503);
    vi.stubEnv("ERP_AI_KEY","test-only-key");
    expect((await call("incorrect")).status).toBe(401);
    const listed = await call();
    expect(listed.status).toBe(200);
    expect((await listed.json() as any).result.tools).toHaveLength(10);
    const denied = await call("test-only-key",{jsonrpc:"2.0",id:2,method:"tools/call",params:{name:"search_customers",arguments:{keyword:"A",tenantId:2}}});
    expect((await denied.json() as any).result.isError).toBe(true);
    const unknown = await call("test-only-key",{jsonrpc:"2.0",id:3,method:"tools/call",params:{name:"arbitrary_sql",arguments:{}}});
    expect((await unknown.json() as any).result.isError).toBe(true);
    const invalid = await call("test-only-key",{jsonrpc:"2.0",id:4,method:"tools/call",params:{name:42}});
    expect((await invalid.json() as any).error).toBeDefined();
    // Simulate admission from another replica: budget is database-backed, not process-local.
    await owner.query("INSERT INTO ai_actions(tenant_id,tool,args,status,result_summary) SELECT 1,'mcp_request','{}','ok','other replica' FROM generate_series(1,56)");
    expect((await call()).status).toBe(429);
    const recorded = (await owner.query("SELECT tool,status FROM ai_actions WHERE tool IN ('authentication','configuration','invalid_tool','rate_limit')")).rows;
    for (const tool of ["authentication","configuration","invalid_tool","rate_limit"]) expect(recorded).toContainEqual({tool,status:"denied"});
  });
  it("reuses finance read handler and exposes tenant-safe overdue data", async () => {
    await owner.query("INSERT INTO invoices(tenant_id,id,invoice_number,invoice_type,customer_id,invoice_date,status,total_amount,outstanding_amount) VALUES(1,3,'LEGACY-EXCLUDED','Sales Invoice',1,'2026-01-01','Unpaid',999,999)");
    const result = await auditedTool(1,"get_finance_summary",{period:"2026-01"});
    expect(result).not.toHaveProperty("isError");
    expect(JSON.parse(result.content[0].text).incomeStatement).toMatchObject({startDate:"2026-01-01",endDate:"2026-01-31",totalIncome:0,totalExpense:0,netProfit:0});
    expect(JSON.parse(result.content[0].text).cashFlow).toMatchObject({netCashChange:0,openingCash:0,closingCash:0});
    const receivables = JSON.parse((await auditedTool(1,"list_receivables",{customer_id:1,min_overdue_days:1})).content[0].text);
    expect(receivables.rows.map((r: any) => r.customerId)).toEqual([1]);
    expect(receivables).toMatchObject({basis:"reports/ar-aging",truncated:false,sourceSummary:{total:100}});
    const overdue = JSON.parse((await auditedTool(1,"list_overdue_customers",{})).content[0].text);
    expect(overdue.customers.map((r: any) => r.customerId)).toEqual([1]);
    expect((await auditedTool(1,"get_document",{type:"invoices",id:2})).isError).toBe(true);
  });
  it("strictly validates generic draft types and normalizes existing create bodies", async () => {
    const items = [{itemId:1,quantity:2,rate:10}];
    await runWithTenant(1,async () => {
      const invoice = await validateDraft("sales_invoice",{customerId:1,invoiceDate:"2026-09-10",items});
      expect(CreateInvoiceBody.safeParse(invoice).success).toBe(true);
      const quotation = await validateDraft("quotation",{customerId:1,quotationDate:"2026-09-10",items});
      expect(quotation.items).toEqual([{name:"Item A",code:"ITEM-A",qty:2,unitPrice:10,amount:20}]);
      const request = await validateDraft("payment_request",{partyType:"Supplier",supplierId:1,requestDate:"2026-09-10",amount:10});
      expect(request.status).toBe("Draft");
      await expect(validateDraft("sales_invoice",{customerId:1,invoiceDate:"2026-09-10",items,employeeId:42})).rejects.toThrow();
    });
    const result = await auditedTool(1,"create_document_draft",{doc_type:"quotation",payload:{customerId:1,quotationDate:"2026-09-10",items}});
    expect(result).not.toHaveProperty("isError");
    expect((await owner.query("SELECT count(*)::int n FROM quotations")).rows[0].n).toBe(0);
  });
  it("rejects e-invoice void timestamps and mismatched voucher cash account", async () => {
    await owner.query("UPDATE invoices SET ecpay_voided_at=now() WHERE id=1");
    try { expect((await auditedTool(1,"create_receipt_draft",receipt())).isError).toBe(true); }
    finally { await owner.query("UPDATE invoices SET ecpay_voided_at=NULL WHERE id=1"); }
    await owner.query("INSERT INTO accounts(tenant_id,id,account_number,account_name,account_type) VALUES(1,2,'1200','Other Asset','Asset')");
    expect((await auditedTool(1,"create_receipt_draft",{...receipt(),account_id:2})).isError).toBe(true);
  });

  describe("expanded safe read projections", () => {
    const read = async (tenant: number, tool: string, args: unknown) => {
      const result = await auditedTool(tenant, tool, args);
      expect(result).not.toHaveProperty("isError");
      return JSON.parse(result.content[0].text);
    };
    const snapshot = async () => {
      const result: Record<string, unknown> = {};
      for (const table of ["customers","items","accounts","quotations","sales_orders","invoices","vouchers","journal_entries","invoice_settlements","ai_draft_documents"]) {
        result[table] = (await owner.query(`SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY id),'[]') AS data FROM "${table}" t`)).rows[0].data;
      }
      return result;
    };
    let before: Record<string, unknown>;
    let auditBefore: number;
    beforeAll(async () => {
      await owner.query(`
        SET app.tenant_id='1';
        UPDATE customers SET customer_code='C-A',tax_id='11111111',contact_person='Contact A',email='private-email',phone='private-phone' WHERE id=1;
        INSERT INTO customers(id,customer_code,name) VALUES(3,'LITERAL','literal %_\\ customer');
        INSERT INTO items(id,item_code,item_name,unit,selling_price) VALUES(21,'LIVE-A','Current master name','box',999);
        INSERT INTO accounts(id,account_number,account_name,account_type) VALUES(21,'4100','Sales A','Income');
        INSERT INTO quotations(id,quotation_number,customer_id,customer_name,quotation_date,valid_until,notes,terms,total_amount,tax_amount,grand_total,items)
          VALUES(501,'Q-A',1,'Historical customer A','2026-10-01','2026-10-31','Quote note','Quote terms',36,1.8,37.8,
          '[{"itemId":21,"name":"Historical product","code":"HIST-A","qty":2,"unit":"piece","unitPrice":"20.00","discountRate":10,"discountAmount":4,"taxAmount":"1.80","amount":36,"privateCost":999,"secret":{"password":"hidden"}},{"itemId":21,"qty":0,"rate":0,"amount":0}]');
        INSERT INTO quotations(id,quotation_number,customer_name,quotation_date,items) VALUES(503,'Q-FREE','Walk-in customer','2026-10-02','[]');
        INSERT INTO sales_orders(id,order_number,customer_id,order_date,delivery_date,remarks,total_amount,items)
          VALUES(601,'SO-A',1,'2026-10-01','2026-10-30','Delivery note',100,'[{"itemId":21,"quantity":5,"rate":20,"amount":100,"discount":0,"taxAmount":0}]');
        INSERT INTO invoices(id,invoice_number,invoice_type,customer_id,invoice_date,due_date,total_amount,net_amount,tax_amount,items,ecpay_response)
          VALUES(701,'INV-DETAIL-A','Sales',1,'2026-10-01','2026-10-31',105,100,5,
          '[{"itemId":21,"quantity":5,"rate":20,"amount":100,"unit":"box","employeeId":123}]','{"secret":"provider-secret"}');
        INSERT INTO journal_entries(id,entry_number,entry_date,total_debit,total_credit,lines) VALUES(901,'JE-A','2026-10-01',100,100,
          '[{"accountId":1,"debit":100,"credit":0,"description":"Receipt summary","bankAccount":"private-bank"},{"accountId":21,"accountName":"Historical sales account","debit":0,"credit":100,"description":"Revenue summary"}]');
        INSERT INTO vouchers(id,voucher_number,voucher_type,voucher_date,customer_id,description,total_amount,journal_entry_id,items)
          VALUES(801,'V-A','收款單','2026-10-01',1,'Voucher note',100,901,'[{"accountId":1,"amount":100,"invoiceId":701}]');
        INSERT INTO vouchers(id,voucher_number,voucher_type,voucher_date,customer_id,items)
          VALUES(804,'V-DRAFT','收款單','2026-10-01',1,'[{"accountId":1,"amount":10,"description":"Pending"}]');
        SET app.tenant_id='2';
        UPDATE customers SET customer_code='C-B',tax_id='22222222',contact_person='Hidden contact' WHERE id=2;
        INSERT INTO items(id,item_code,item_name) VALUES(22,'PRIVATE-ITEM-B','Private item B');
        INSERT INTO accounts(id,account_number,account_name,account_type) VALUES(22,'SECRET-B','Private account B','Income');
        INSERT INTO quotations(id,quotation_number,customer_id,quotation_date,items) VALUES(502,'Q-B',2,'2026-10-01','[]');
        INSERT INTO sales_orders(id,order_number,customer_id,order_date,items) VALUES(602,'SO-B',2,'2026-10-01','[]');
        INSERT INTO invoices(id,invoice_number,invoice_type,customer_id,invoice_date,items) VALUES(702,'INV-B','Sales',2,'2026-10-01','[]');
        INSERT INTO journal_entries(id,entry_number,entry_date,lines) VALUES(902,'JE-B','2026-10-01','[{"accountId":22,"debit":999}]');
        INSERT INTO vouchers(id,voucher_number,voucher_type,voucher_date,customer_id,journal_entry_id) VALUES(802,'V-B','收款單','2026-10-01',2,902);
        SET app.tenant_id='1';
        INSERT INTO vouchers(id,voucher_number,voucher_type,voucher_date,customer_id,journal_entry_id) VALUES(803,'V-BAD-LINK','收款單','2026-10-01',1,902);
        INSERT INTO quotations(id,quotation_number,customer_id,quotation_date,items)
          VALUES(504,'Q-BAD-LINK',2,'2026-10-01','[{"itemId":22,"qty":1}]');
        INSERT INTO vouchers(id,voucher_number,voucher_type,voucher_date,items)
          VALUES(805,'V-BAD-ACCOUNT','傳票','2026-10-01','[{"accountId":22,"debit":10,"credit":0}]');
      `);
      before = await snapshot();
      auditBefore = (await owner.query("SELECT count(*)::int n FROM ai_actions")).rows[0].n;
    });
    it("lists customers with omitted or blank keywords, safe fields, literal matching and limits", async () => {
      for (const args of [{}, {keyword:""}, {keyword:" \t "}, {limit:20}]) {
        const result = await read(1,"search_customers",args);
        expect(result.map((c: any) => c.id)).toEqual([1,3]);
        expect(result[0]).toMatchObject({code:"C-A",customerCode:"C-A",name:"A",taxId:"11111111",contactPerson:"Contact A"});
        expect(JSON.stringify(result)).not.toMatch(/private-email|private-phone|tenantId|Hidden contact/);
      }
      expect(await read(1,"search_customers",{limit:1})).toHaveLength(1);
      for (const keyword of [" C-A ","11111111","Contact A"]) {
        expect((await read(1,"search_customers",{keyword})).map((c: any) => c.id)).toEqual([1]);
      }
      for (const keyword of ["%","_","\\"]) {
        expect((await read(1,"search_customers",{keyword})).map((c: any) => c.id)).toEqual([3]);
      }
      expect((await read(2,"search_customers",{})).map((c: any) => c.id)).toEqual([2]);
      expect(await read(1,"search_customers",{keyword:"Hidden contact"})).toEqual([]);
      expect((await auditedTool(1,"search_customers",{limit:1,tenantId:2})).isError).toBe(true);
    });
    it("returns every product row, stored financial values and type-specific headers", async () => {
      const quote = await read(1,"get_document",{type:"quotations",id:501});
      expect(quote).toMatchObject({number:"Q-A",customerName:"Historical customer A",customerCode:"C-A",validUntil:"2026-10-31",notes:"Quote note",terms:"Quote terms",taxAmount:"1.80",totalAmount:"37.80"});
      expect(quote.items).toHaveLength(2);
      expect(quote.items[0]).toMatchObject({name:"Historical product",code:"HIST-A",quantity:2,unit:"piece",unitPrice:"20.00",discountRate:10,discountAmount:4,taxAmount:"1.80",subtotal:36});
      expect(quote.items[1]).toMatchObject({name:"Current master name",code:"LIVE-A",quantity:0,unit:"box",unitPrice:0,subtotal:0,taxAmount:null,discount:null});
      const order = await read(1,"get_document",{type:"sales_orders",id:601});
      expect(order).toMatchObject({customerName:"A",customerCode:"C-A",notes:"Delivery note",deliveryDate:"2026-10-30"});
      expect(order.items[0]).toMatchObject({quantity:5,unitPrice:20,discount:0,taxAmount:0,subtotal:100});
      const invoice = await read(1,"get_document",{type:"invoices",id:701});
      expect(invoice).toMatchObject({customerName:"A",dueDate:"2026-10-31",netAmount:"100.00",taxAmount:"5.00"});
      expect(invoice.items[0]).toMatchObject({quantity:5,unitPrice:20,subtotal:100,taxAmount:null});
      expect(JSON.stringify([quote,order,invoice])).not.toMatch(/privateCost|password|secret|employeeId|ecpay|provider-secret|tenantId/);
    });
    it("adds customer names to all search types, including free-text quotation customers", async () => {
      for (const [type,keyword,name] of [
        ["quotations","Q-A","Historical customer A"], ["sales_orders","SO-A","A"],
        ["invoices","INV-DETAIL-A","A"], ["vouchers","V-A","A"],
      ]) {
        const result = await read(1,"search_documents",{type,keyword});
        expect(result).toHaveLength(1);
        expect(result[0]).toMatchObject({customerName:name,customerCode:"C-A"});
      }
      const free = await read(1,"get_document",{type:"quotations",id:503});
      expect(free).toMatchObject({customerName:"Walk-in customer",customerCode:null,items:[]});
    });
    it("returns linked journal accounts/debits/credits and never invents draft accounting", async () => {
      const voucher = await read(1,"get_document",{type:"vouchers",id:801});
      expect(voucher).toMatchObject({notes:"Voucher note",customerName:"A",lineSource:"journal_entry",journalEntry:{number:"JE-A",totalDebit:"100.00",totalCredit:"100.00"}});
      expect(voucher.lines).toHaveLength(2);
      expect(voucher.lines[0]).toMatchObject({accountName:"現金/銀行",accountCode:"1100",debit:100,credit:0,description:"Receipt summary"});
      expect(voucher.lines[1]).toMatchObject({accountName:"Historical sales account",accountCode:"4100",debit:0,credit:100,description:"Revenue summary"});
      expect(JSON.stringify(voucher)).not.toMatch(/bankAccount|private-bank/);
      const draft = await read(1,"get_document",{type:"vouchers",id:804});
      expect(draft).toMatchObject({lineSource:"voucher_items",journalEntry:null});
      expect(draft.lines[0]).toMatchObject({amount:10,debit:null,credit:null,description:"Pending"});
    });
    it("isolates headers, customers, items, account lookups and linked journals", async () => {
      for (const [type,id] of [["quotations",502],["sales_orders",602],["invoices",702],["vouchers",802]] as const) {
        expect((await auditedTool(1,"get_document",{type,id})).isError).toBe(true);
        expect((await read(2,"get_document",{type,id})).id).toBe(id);
      }
      expect((await auditedTool(1,"get_document",{type:"vouchers",id:803})).isError).toBe(true);
      const quote = await read(1,"get_document",{type:"quotations",id:504});
      expect(quote).toMatchObject({customerName:null,customerCode:null});
      expect(quote.items[0]).toMatchObject({name:null,code:null,unit:null});
      const voucher = await read(1,"get_document",{type:"vouchers",id:805});
      expect(voucher.lines[0]).toMatchObject({accountName:null,accountCode:null});
      expect(JSON.stringify([quote,voucher])).not.toMatch(/Private item B|Private account B|SECRET-B/);
      for (const type of ["quotations","sales_orders","invoices","vouchers"]) {
        const results = await read(1,"search_documents",{type});
        expect(results.some((r: any) => ["Q-B","SO-B","INV-B","V-B"].includes(r.number))).toBe(false);
      }
    });
    it("advertises optional customer keyword and accepts blank/list-only calls over MCP HTTP", async () => {
      // Tenant 2 has an independent admission budget from the earlier rate-limit test.
      vi.stubEnv("ERP_AI_KEY","read-only-test-key");
      vi.stubEnv("ERP_AI_TENANT_ID","2");
      let id = 100;
      const call = async (method: string, params: unknown) => {
        const response = await fetch(origin, {
          method:"POST",
          headers:{"Content-Type":"application/json",Accept:"application/json, text/event-stream",Authorization:"Bearer read-only-test-key"},
          body:JSON.stringify({jsonrpc:"2.0",id:id++,method,params}),
        });
        expect(response.status).toBe(200);
        return await response.json() as any;
      };
      const listed = await call("tools/list",{});
      expect(listed.result.tools).toHaveLength(10);
      const schema = listed.result.tools.find((t: any) => t.name === "search_customers").inputSchema;
      expect(schema.required ?? []).not.toContain("keyword");
      expect(schema.properties.limit.maximum).toBe(50);
      for (const args of [{}, {limit:1}, {keyword:""}, {keyword:"   ",limit:20}]) {
        const result = await call("tools/call",{name:"search_customers",arguments:args});
        expect(result.result.isError).not.toBe(true);
        expect(JSON.parse(result.result.content[0].text)).toEqual([
          {id:2,code:"C-B",customerCode:"C-B",name:"B",taxId:"22222222",contactPerson:"Hidden contact"},
        ]);
      }
    });
    it("keeps every business/draft row unchanged and records read/denial audits", async () => {
      expect(await snapshot()).toEqual(before);
      const audits = (await owner.query("SELECT count(*)::int n FROM ai_actions")).rows[0].n;
      expect(audits).toBeGreaterThan(auditBefore);
      expect((await owner.query("SELECT count(*)::int n FROM ai_actions WHERE tool='search_customers' AND status='ok'")).rows[0].n).toBeGreaterThan(0);
    });
  });

  describe("create_customer_draft (customer master drafts only)", () => {
    const count = async (table: string, tenant?: number) =>
      (await owner.query(`SELECT count(*)::int n FROM "${table}"${tenant ? " WHERE tenant_id=$1" : ""}`, tenant ? [tenant] : [])).rows[0].n as number;
    const create = (tenant: number, args: unknown) => auditedTool(tenant, "create_customer_draft", args);
    beforeAll(async () => {
      // Tenant 1 customer 3 gets a valid 統編 so duplicate tax IDs against formal customers are testable.
      await owner.query("UPDATE customers SET tax_id='04595257' WHERE id=3 AND tenant_id=1");
    });

    it("inserts only ai_customer_drafts (+1) with trimmed canonical payload; customers unchanged; redacted audit", async () => {
      const customersBefore = await count("customers");
      const draftsBefore = await count("ai_customer_drafts");
      const result = await create(1, { name: "  New Co  ", tax_id: " 22099131 ", customer_code: " NC-1 ", email: "confidential@example.test", phone: "" });
      expect(result, JSON.stringify(result)).not.toHaveProperty("isError");
      const body = JSON.parse(result.content[0].text);
      expect(body).toMatchObject({ status: "pending" });
      expect(await count("ai_customer_drafts")).toBe(draftsBefore + 1);
      expect(await count("customers")).toBe(customersBefore);
      const row = (await owner.query("SELECT * FROM ai_customer_drafts WHERE id=$1", [body.id])).rows[0];
      expect(row).toMatchObject({ tenant_id: 1, status: "pending", created_by: "ai", result_customer_id: null, confirmed_by: null });
      expect(row.payload).toEqual({ name: "New Co", taxId: "22099131", customerCode: "NC-1", email: "confidential@example.test" });
      const audit = (await owner.query("SELECT * FROM ai_actions WHERE tool='create_customer_draft' AND status='ok' ORDER BY id DESC LIMIT 1")).rows[0];
      expect(audit).toMatchObject({ tenant_id: 1, target_type: "ai_customer_drafts", target_id: body.id });
      expect(JSON.stringify(audit)).not.toMatch(/confidential|New Co|22099131/);
    });

    it("schema-rejects caller tenant fields with denied audit and no draft", async () => {
      const draftsBefore = await count("ai_customer_drafts");
      const deniedBefore = (await owner.query("SELECT count(*)::int n FROM ai_actions WHERE tool='create_customer_draft' AND status='denied'")).rows[0].n;
      for (const extra of [{ tenant_id: 2 }, { tenantId: 2 }, { tenant: 2 }]) {
        expect((await create(1, { name: "Tenant Injection", ...extra })).isError).toBe(true);
      }
      expect(await count("ai_customer_drafts")).toBe(draftsBefore);
      expect((await owner.query("SELECT count(*)::int n FROM ai_actions WHERE tool='create_customer_draft' AND status='denied'")).rows[0].n).toBe(deniedBefore + 3);
    });

    it("rejects invalid 統編", async () => {
      const draftsBefore = await count("ai_customer_drafts");
      for (const tax_id of ["22099132", "2209913A", "2209 9131", "1234567"]) {
        expect((await create(1, { name: `Bad tax ${tax_id}`, tax_id })).isError).toBe(true);
      }
      expect(await count("ai_customer_drafts")).toBe(draftsBefore);
    });

    it("rejects same-tenant duplicates against pending drafts (tax_id, customer_code, trimmed name)", async () => {
      const draftsBefore = await count("ai_customer_drafts");
      for (const args of [{ name: "Other 1", tax_id: "22099131" }, { name: "Other 2", customer_code: "NC-1" }, { name: " New Co " }]) {
        const result = await create(1, args);
        expect(result.isError, JSON.stringify(args)).toBe(true);
        expect(result.content[0].text).toContain("pending customer draft");
      }
      expect(await count("ai_customer_drafts")).toBe(draftsBefore);
    });

    it("rejects same-tenant duplicates against formal customers (tax_id, customer_code, name)", async () => {
      const draftsBefore = await count("ai_customer_drafts");
      for (const args of [{ name: "Other 3", tax_id: "04595257" }, { name: "Other 4", customer_code: "C-A" }, { name: "A" }]) {
        const result = await create(1, args);
        expect(result.isError, JSON.stringify(args)).toBe(true);
        expect(result.content[0].text).toContain("existing customer");
      }
      expect(await count("ai_customer_drafts")).toBe(draftsBefore);
    });

    it("isolates tenants: tenant 2 may reuse tenant 1 values and cannot see tenant 1 drafts", async () => {
      const result = await create(2, { name: "New Co", tax_id: "22099131", customer_code: "NC-1" });
      expect(result, JSON.stringify(result)).not.toHaveProperty("isError");
      const tenant2 = await runWithTenant(2, async () => (await client.query("SELECT tenant_id FROM ai_customer_drafts")).rows);
      expect(tenant2).toEqual([{ tenant_id: 2 }]);
      const tenant1 = await runWithTenant(1, async () => (await client.query("SELECT tenant_id FROM ai_customer_drafts")).rows);
      expect(tenant1.every((r: any) => r.tenant_id === 1)).toBe(true);
      await runWithTenant(1, async () => {
        await expect(client.query("INSERT INTO ai_customer_drafts(tenant_id,payload,summary) VALUES(2,'{}','probe')")).rejects.toMatchObject({ code: "42501" });
        expect((await client.query("UPDATE ai_customer_drafts SET status='rejected' WHERE tenant_id=2")).rowCount).toBe(0);
      });
      expect(await count("customers", 2)).toBe(1);
    });

    it("lists create_customer_draft over MCP HTTP with a strict input schema", async () => {
      vi.stubEnv("ERP_AI_KEY", "customer-draft-test-key");
      vi.stubEnv("ERP_AI_TENANT_ID", "2");
      const response = await fetch(origin, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream", Authorization: "Bearer customer-draft-test-key" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 900, method: "tools/list", params: {} }),
      });
      expect(response.status).toBe(200);
      const tools = (await response.json() as any).result.tools;
      expect(tools).toHaveLength(10);
      const tool = tools.find((t: any) => t.name === "create_customer_draft");
      expect(tool.description).toMatch(/never creates a formal customer/);
      expect(tool.inputSchema.additionalProperties).toBe(false);
      expect(tool.inputSchema.required).toEqual(["name"]);
      expect(Object.keys(tool.inputSchema.properties)).not.toContain("tenant_id");
    });
  });
});
