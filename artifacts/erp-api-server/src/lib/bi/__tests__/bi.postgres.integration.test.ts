import { realpathSync, statSync } from "node:fs";
import path from "node:path";
// Test-only driver import: never load the workspace DB runtime or initialize its role.
// @ts-expect-error workspace database owns pg
import pg from "../../../../../../lib/erp-db/node_modules/pg/lib/index.js";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * 真實 SQL 驗收：以正式 drizzle schema 建立的拋棄式 PostgreSQL，套用租戶 RLS，
 * 以非超級使用者 + app.tenant_id=1 執行 BI builders。只由 tests/bi-postgres-isolated.runner.mjs 啟用。
 */
const injected = vi.hoisted(() => ({ client: null as any }));
vi.mock("../../tenant-db", () => ({
  tenantPool: { query: (text: string, params?: unknown[]) => injected.client.query(text, params) },
}));
vi.mock("@workspace/erp-db", () => ({ db: {}, accountsTable: {} }));

import { buildExecutive } from "../executive";
import { buildSales } from "../sales";
import { buildInventory } from "../inventory";
import { buildHr } from "../hr";
import { buildHealth } from "../health";

const optedIn = process.env.BI_POSTGRES_ACCEPTANCE === "1" && Boolean(process.env.BI_TEST_PG_ROOT) && Boolean(process.env.BI_TEST_PG_SOCKET);
const acceptance = optedIn ? describe : describe.skip;
const R = { startDate: "2026-01-01", endDate: "2026-02-28", days: 59 };

acceptance("BI builders against disposable PostgreSQL with production schema", () => {
  const conn = { host: process.env.BI_TEST_PG_SOCKET, port: Number(process.env.BI_TEST_PG_PORT), database: "bi_acceptance" };
  const owner = new pg.Client({ ...conn, user: "bi_test_owner" });
  const reader = new pg.Client({ ...conn, user: "bi_reader", options: "-c app.tenant_id=1" });

  beforeAll(async () => {
    const root = realpathSync(process.env.BI_TEST_PG_ROOT!);
    const socket = realpathSync(process.env.BI_TEST_PG_SOCKET!);
    if (path.dirname(socket) !== root || path.basename(socket) !== "socket") throw new Error("Test socket outside runner directory");
    if (!statSync(path.join(socket, `.s.PGSQL.${process.env.BI_TEST_PG_PORT}`)).isSocket()) throw new Error("Test socket unavailable");
    await owner.connect();
    const ctx = await owner.query("SELECT current_database() AS d");
    expect(ctx.rows[0].d).toBe("bi_acceptance");

    // 與 lib/erp-db/scripts/apply-rls.mjs 相同的租戶政策（排除清單中的表不套用）
    const tables = await owner.query(`SELECT table_name FROM information_schema.columns WHERE table_schema='public' AND column_name='tenant_id'
                                        AND table_name NOT IN ('user_sessions','insurance_brackets','tenants','credit_transactions','admin_users','account_recovery_tokens','account_recovery_profiles','api_keys')`);
    for (const { table_name: t } of tables.rows) {
      await owner.query(`ALTER TABLE "${t}" ENABLE ROW LEVEL SECURITY; ALTER TABLE "${t}" FORCE ROW LEVEL SECURITY;
        CREATE POLICY tenant_isolation ON "${t}" USING (tenant_id = current_setting('app.tenant_id')::integer)`);
    }
    await owner.query(`CREATE ROLE bi_reader LOGIN NOSUPERUSER NOBYPASSRLS; GRANT USAGE ON SCHEMA public TO bi_reader;
                       GRANT SELECT ON ALL TABLES IN SCHEMA public TO bi_reader;`);

    const T = (tenant: number, sql: string) => owner.query(`SET app.tenant_id = ${tenant}; ${sql}`);
    await T(1, `
      INSERT INTO accounts (id, account_number, account_name, account_type, is_group) VALUES
        (1,'4101','課程收入','Income',false),(2,'5101','教材成本','Expense',false),(3,'6101','租金支出','Expense',false),(4,'4000','收入','Income',true),(5,'1101','銀行存款','Asset',false);
      INSERT INTO departments (id, name, is_active) VALUES (1,'課程事業部',true),(2,'教材事業部',true);
      INSERT INTO projects (id, name, department_id) VALUES (1,'春季教材',2);
      INSERT INTO journal_entries (entry_number, entry_date, status, total_debit, total_credit, department_id, project_id, is_internal_transfer, lines) VALUES
        ('JE-2601-001','2026-01-15','Posted',208500,208500,1,NULL,false,'[{"accountId":1,"debit":0,"credit":120000},{"accountId":2,"debit":70000,"credit":0},{"accountId":3,"debit":18500,"credit":0},{"accountId":5,"debit":120000,"credit":0},{"accountId":5,"debit":0,"credit":88500}]'),
        ('JE-2602-001','2026-02-03','Posted',92000,92000,NULL,1,false,'[{"accountId":1,"debit":0,"credit":80000},{"accountId":3,"debit":12000,"credit":0},{"accountId":5,"debit":80000,"credit":0},{"accountId":5,"debit":0,"credit":12000}]'),
        ('JE-2602-DRAFT','2026-02-04','Draft',50000,50000,1,NULL,false,'[{"accountId":1,"debit":0,"credit":50000}]');
      INSERT INTO customers (id, name) VALUES (1,'林記文具'),(2,'南港書局');
      INSERT INTO suppliers (id, name) VALUES (1,'長榮紙業');
      INSERT INTO employees (id, employee_id, first_name, last_name, email, department_id, date_of_joining, status) VALUES
        (1,'E001','怡君','陳','yj@example.test',1,'2024-03-01','Active'),(2,'E002','冠宇','王','gy@example.test',2,'2025-01-02','Active');
      INSERT INTO items (id, item_code, item_name, current_stock, moving_avg_cost, buying_price, reorder_level, is_virtual) VALUES
        (1,'BK-MATH','國小數學講義',40,450,0,10,false),(2,'BK-ENG','英檢題庫',0,800,0,5,false),(3,'BK-ART','美術素描本',15,0,0,0,false);
      INSERT INTO quotations (id, quotation_number, customer_id, quotation_date, status, total_amount, grand_total) VALUES
        (1,'Q-2601-01',1,'2026-01-05','Converted',50000,52500),(2,'Q-2601-02',2,'2026-01-20','Draft',17143,18000);
      INSERT INTO sales_orders (id, order_number, customer_id, salesperson_id, order_date, status, total_amount, quotation_id) VALUES
        (1,'SO-2601-01',1,1,'2026-01-08','Completed',52500,1);
      INSERT INTO invoices (id, invoice_number, invoice_type, customer_id, supplier_id, sales_order_id, invoice_date, status, total_amount, net_amount, paid_amount, outstanding_amount, journal_entry_id, items) VALUES
        (1,'INV-S-001','Sales',1,NULL,1,'2026-01-10','Paid',52500,50000,52500,0,1,'[{"itemId":1,"itemName":"國小數學講義","quantity":20,"amount":30000},{"itemId":2,"itemName":"英檢題庫","quantity":10,"amount":20000}]'),
        (2,'INV-S-002','Sales Invoice',2,NULL,NULL,'2026-02-05','Unpaid',31500,30000,10000,21500,NULL,'[{"itemId":3,"itemName":"美術素描本","quantity":10,"amount":30000}]'),
        (3,'INV-S-003','Sales',2,NULL,NULL,'2026-02-10','Voided',73500,70000,0,73500,NULL,'[]'),
        (4,'INV-P-001','Purchase',NULL,1,NULL,'2026-01-20','Unpaid',42000,40000,20000,22000,NULL,'[]');
      INSERT INTO vouchers (id, voucher_number, voucher_type, voucher_date, total_amount, status) VALUES
        (1,'RV-001','Receipt','2026-01-12',52500,'Posted'),(2,'RV-002','Receipt','2026-02-08',10000,'Posted'),(3,'PV-001','Payment','2026-01-25',20000,'Posted');
      INSERT INTO invoice_settlements (voucher_id, invoice_id, amount) VALUES (1,1,52500),(2,2,10000),(3,4,20000);
      INSERT INTO sales_returns (return_number, customer_id, return_date, status, total_amount) VALUES ('SR-001',2,'2026-02-15','Completed',4000),('SR-002',2,'2026-02-16','Cancelled',9999);
      INSERT INTO warehouses (id, name) VALUES (1,'台北總倉');
      INSERT INTO stock_entries (entry_type, item_id, warehouse_id, quantity, rate, amount, created_at) VALUES
        ('Receipt',1,1,60,450,27000,'2026-01-03T02:00:00Z'),('Issue',1,1,30,450,13500,'2026-02-01T02:00:00Z'),('Issue',2,1,10,800,8000,'2026-01-11T02:00:00Z');
      INSERT INTO purchase_orders (id, order_number, supplier_id, order_date, expected_date, status, total_amount) VALUES (1,'PO-001',1,'2026-01-10','2026-01-18','Completed',42000);
      INSERT INTO purchase_receipts (receipt_number, purchase_order_id, supplier_id, receipt_date, status, total_amount) VALUES ('PR-001',1,1,'2026-01-17','Completed',42000);
      INSERT INTO purchase_returns (return_number, supplier_id, return_date, status, total_amount) VALUES ('PRT-001',1,'2026-01-28','Completed',2100);
      INSERT INTO salary_slips (employee_id, year, month, base_salary, gross_salary, labor_insurance_bracket, labor_insurance_employee, labor_insurance_employer,
                                health_insurance_bracket, health_insurance_employee, health_insurance_employer, pension_bracket, pension_employer, total_deductions, net_salary, status) VALUES
        (1,2026,1,42500,42500,43900,1053,3178,43900,681,2012,43900,2550,1734,40766,'confirmed'),
        (2,2026,1,36000,36000,36300,871,2628,36300,563,1745,36300,2178,1434,34566,'paid'),
        (1,2026,2,42500,42500,43900,1053,3178,43900,681,2012,43900,2550,1734,40766,'draft');
      INSERT INTO attendance (employee_id, date, status, check_in, check_out, working_hours, late_minutes, overtime_hours) VALUES
        (1,'2026-01-06','Present','09:00','18:00',8,0,1.5),
        (2,'2026-01-06','Late','09:12','18:00',7.8,12,0),
        (1,'2026-01-07','Present','22:00','06:00',8,0,0),
        (2,'2026-01-08','Present','9am','18:00',8,0,0);`);
    // 他租戶誘餌資料：若 RLS 或 SQL 漏過濾，數字會明顯偏離
    await T(2, `
      INSERT INTO accounts (id, account_number, account_name, account_type, is_group) VALUES (101,'4101','他租戶收入','Income',false);
      INSERT INTO journal_entries (entry_number, entry_date, status, total_debit, total_credit, lines) VALUES ('X-1','2026-01-15','Posted',1,999999,'[{"accountId":101,"debit":0,"credit":999999}]');
      INSERT INTO invoices (id, invoice_number, invoice_type, invoice_date, status, total_amount, net_amount, paid_amount, outstanding_amount) VALUES (100,'X-INV','Sales','2026-01-15','Unpaid',888888,888888,0,888888);
      INSERT INTO items (id, item_code, item_name, current_stock, moving_avg_cost) VALUES (100,'X','他租戶料件',-5,100);`);
    await reader.connect();
    injected.client = reader;
  });

  afterAll(async () => {
    await reader.end().catch(() => {});
    await owner.end().catch(() => {});
  });

  it("reader is tenant-scoped and cannot bypass RLS", async () => {
    const r = await reader.query("SELECT COUNT(*)::int AS n FROM invoices");
    expect(r.rows[0].n).toBe(4);
    const role = await reader.query("SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user");
    expect(role.rows[0]).toEqual({ rolsuper: false, rolbypassrls: false });
  });

  it("executive: journal P&L, canonical + legacy invoice types, actual settlements", async () => {
    const e = await buildExecutive(R);
    expect(e.summary.revenue.value).toBe(200000);
    expect(e.summary.expense.value).toBe(100500);
    expect(e.summary.netProfit.value).toBe(99500);
    expect(e.summary.cashIn.value).toBe(62500);
    expect(e.summary.cashOut.value).toBe(20000);
    expect(e.summary.netCash.value).toBe(42500);
    expect(e.workingCapital.dso.value).toBeCloseTo((21500 / 200000) * 59, 6);
    expect(e.workingCapital.dio.value).toBeCloseTo((18000 / 70000) * 59, 6);
    expect(e.workingCapital.dpo.value).toBeCloseTo((22000 / 40000) * 59, 6);
    expect(e.monthly.find((m) => m.month === "2026-01")).toMatchObject({ revenue: 120000, cashIn: 52500, cashOut: 20000 });
    expect(e.buContributions.find((b) => b.name === "課程事業部")).toMatchObject({ revenue: 120000, expense: 88500 });
    expect(e.buContributions.find((b) => b.name === "教材事業部")).toMatchObject({ revenue: 80000, expense: 12000 });
  });

  it("sales: invoices both type spellings, voided excluded, returns, funnel, RFM with actual dates", async () => {
    const s = await buildSales(R);
    expect(s.summary.invoicedRevenue.value).toBe(80000);
    expect(s.summary.invoiceCount.value).toBe(2);
    expect(s.summary.returnsAmount.value).toBe(4000);
    expect(s.summary.returnRate.value).toBeCloseTo(0.05, 6);
    expect(s.summary.collected.value).toBe(62500);
    expect(s.summary.quotationConversion.value).toBeCloseTo(0.5, 6);
    expect(s.funnel.map((f) => f.count)).toEqual([2, 1, 1, 1]);
    const rfm = Object.fromEntries(s.rfm.map((r) => [r.name, r]));
    expect(rfm["林記文具"]).toMatchObject({ lastInvoiceDate: "2026-01-10", recencyDays: 49, monetary: 50000 });
    expect(rfm["南港書局"]).toMatchObject({ lastInvoiceDate: "2026-02-05", recencyDays: 23, monetary: 30000 });
    const items = Object.fromEntries(s.topItems.map((t) => [t.name, t]));
    expect(items["國小數學講義"].margin).toBeCloseTo((30000 - 20 * 450) / 30000, 6);
    expect(items["美術素描本"].estCost).toBeNull();
    expect(items["美術素描本"].margin).toBeNull();
  });

  it("inventory: moving-average value, reorder, supplier on-time, returns", async () => {
    const i = await buildInventory(R);
    expect(i.summary.inventoryValue.value).toBe(18000);
    expect(i.summary.zeroCostWithStock.value).toBe(1);
    expect(i.summary.negativeStock.value).toBe(0);
    expect(i.summary.belowReorder.value).toBeGreaterThanOrEqual(1);
    expect(i.summary.supplierOnTimeRate.value).toBe(1);
    expect(i.suppliers[0]).toMatchObject({ name: "長榮紙業", receipts: 1, returns: 1, returnAmount: 2100 });
    expect(i.health.find((h) => h.code === "BK-MATH")?.outboundQty).toBe(30);
  });

  it("hr: confirmed/paid slips only, employer cost, attendance and salesperson revenue", async () => {
    const h = await buildHr(R);
    expect(h.summary.activeHeadcount.value).toBe(2);
    expect(h.summary.payrollGross.value).toBe(78500);
    expect(h.summary.employerCost.value).toBe(78500 + 3178 + 2012 + 2550 + 2628 + 1745 + 2178);
    expect(h.summary.overtimeHours.value).toBe(1.5);
    expect(h.summary.lateCount.value).toBe(1);
    expect(h.salespeople[0]).toMatchObject({ name: "陳怡君", orderRevenue: 52500 });
  });

  it("health: real findings, overnight shift not flagged, malformed time flagged", async () => {
    const r = await buildHealth("83483621");
    const by = Object.fromEntries(r.checks.map((c) => [c.id, c]));
    expect(by.je_unbalanced.status).toBe("pass");
    expect(by.je_unbalanced.scanned).toBe(2);
    expect(by.att_invalid_time).toMatchObject({ status: "fail", observed: 1, scanned: 4 });
    expect(by.att_invalid_time.samples[0]).toContain("2026-01-08");
    expect(by.item_no_cost).toMatchObject({ status: "fail", observed: 1 });
    expect(by.item_negative.status).toBe("pass");
    expect(by.inv_no_je).toMatchObject({ status: "fail", observed: 2 });
    expect(by.inv_outstanding.status).toBe("pass");
    expect(by.slip_net_mismatch.status).toBe("pass");
    expect(r.tableCounts.find((t) => t.table === "invoices")?.rows).toBe(4);
    expect(r.accountBaseline).toMatchObject({ profile: "yubang-83483621", expected: 476 });
  });
});
