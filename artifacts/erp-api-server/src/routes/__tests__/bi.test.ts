import express from "express";
import type { Server } from "node:http";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 非正式環境測試資料：以 mock 的租戶連線回應 SQL，驗證 BI 指標的實際計算、
 * 角色守衛、日期驗證、缺資料標示，以及 AI 端點只使用伺服器計算的上下文。
 */
const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  charge: vi.fn(),
  generate: vi.fn(),
  disabled: new Set<string>(),
  tenantRows: [{ companyCode: "83483621" }] as Array<{ companyCode: string }>,
}));

vi.mock("@workspace/erp-db", () => ({
  db: { select: () => ({ from: () => ({ where: async () => mocks.tenantRows }) }) },
  tenantsTable: { id: "id", companyCode: "company_code" },
  accountsTable: {},
}));
vi.mock("../../lib/tenant-db", () => ({ tenantPool: { query: (sql: string, params?: unknown[]) => mocks.query(sql, params) } }));
vi.mock("../../middleware/saas-guard", () => ({
  aiCreditGuard: () => (_req: unknown, _res: unknown, next: () => void) => { mocks.charge(); next(); },
}));
vi.mock("../../middleware/module-guard", () => ({
  isMenuPathDisabled: async (_t: number, p: string) => mocks.disabled.has(p),
}));
vi.mock("@google/genai", () => ({
  GoogleGenAI: class {
    models = { generateContent: (args: unknown) => mocks.generate(args) };
  },
}));

import biRouter from "../bi";
import { agingBucket, classifyStock, computeBu, computePnL, computeRfm, employerCost, turnoverDays, unitCost } from "../../lib/bi/compute";
import { monthsBetween, parseRange } from "../../lib/bi/range";

// ---------- 種子資料（2026-01-01 ~ 2026-02-28，59 天） ----------
const ACCOUNTS = [
  { id: 1, accountType: "Income", accountNumber: "4101" },
  { id: 2, accountType: "Expense", accountNumber: "5101" },
  { id: 3, accountType: "Expense", accountNumber: "6101" },
];
const ENTRIES = [
  { entryDate: "2026-01-15", departmentId: 7, projectId: null, isInternalTransfer: false, totalDebit: "208500", transferFromDepartmentId: null, transferToDepartmentId: null,
    lines: [{ accountId: 1, debit: 0, credit: 120000 }, { accountId: 2, debit: 70000, credit: 0 }, { accountId: 3, debit: 18500, credit: 0 }] },
  { entryDate: "2026-02-03", departmentId: null, projectId: 3, isInternalTransfer: false, totalDebit: "92000", transferFromDepartmentId: null, transferToDepartmentId: null,
    lines: [{ accountId: 1, debit: 0, credit: 80000 }, { accountId: 3, debit: 12000, credit: 0 }] },
  { entryDate: "2026-02-20", departmentId: null, projectId: null, isInternalTransfer: true, totalDebit: "5000", transferFromDepartmentId: 7, transferToDepartmentId: 8,
    lines: [{ accountId: 1, debit: 5000, credit: 0 }, { accountId: 1, debit: 0, credit: 5000 }] },
];

function seeded(sql: string): unknown[] {
  if (sql.includes("FROM journal_entries WHERE status")) return ENTRIES;
  if (sql.includes("FROM accounts WHERE is_group")) return ACCOUNTS;
  if (sql.includes("invoice_settlements")) return [
    { month: "2026-01", invoiceType: "Sales", amount: 81000 },
    { month: "2026-01", invoiceType: "Sales Invoice", amount: 14000 },
    { month: "2026-02", invoiceType: "Purchase", amount: 40250 },
  ];
  if (sql.includes("('Sales','Sales Invoice')") && sql.includes("WrittenOff")) return [{ n: 3, total: 45000 }];
  if (sql.includes("('Purchase','Purchase Invoice')") && sql.includes("WrittenOff")) return [{ n: 2, total: 21000 }];
  if (sql.includes("('Purchase','Purchase Invoice')") && sql.includes("invoice_date >=")) return [{ total: 63000 }];
  if (sql.includes("FROM items") && sql.includes("current_stock > 0")) return [
    { stock: "10", mac: "1500", bp: "0" }, { stock: "4", mac: "0", bp: "0" },
  ];
  if (sql.includes("FROM departments")) return [{ id: 7, name: "課程事業部" }, { id: 8, name: "教材事業部" }];
  if (sql.includes("FROM projects")) return [{ id: 3, departmentId: 8 }];
  return empty(sql);
}

function empty(sql: string): unknown[] {
  if (sql.includes("AS qn")) return [{ qn: 0, qa: 0, orn: 0, ora: 0, ivn: 0, iva: 0, pn: 0, pa: 0 }];
  if (sql.includes("COUNT(*)::int AS n") && sql.includes("AS total")) return [{ n: 0, total: 0 }];
  if (sql.includes("AS total")) return [{ total: 0 }];
  if (sql.includes("COUNT(*)::int AS n")) return [{ n: 0, latest: null }];
  return [];
}

let server: Server;
let base = "";
let role = "owner";
let loggedIn = true;

beforeEach(async () => {
  role = "owner";
  loggedIn = true;
  mocks.query.mockReset();
  mocks.charge.mockReset();
  mocks.generate.mockReset();
  mocks.disabled.clear();
  mocks.query.mockImplementation(async (sql: string) => ({ rows: seeded(sql) }));
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    if (loggedIn) (req as any).session = { user: { id: 9, username: "andy", role, tenantId: 4 } };
    (req as any).tenantId = 4;
    next();
  });
  app.use(biRouter);
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  const addr = server.address();
  base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
});

afterEach(async () => {
  delete process.env.AI_INTEGRATIONS_GEMINI_BASE_URL;
  delete process.env.AI_INTEGRATIONS_GEMINI_API_KEY;
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

const RANGE = "startDate=2026-01-01&endDate=2026-02-28";

describe("BI pure computations (seeded non-production data)", () => {
  it("computes P&L with COGS split and BU attribution matching BU report rules", () => {
    const pnl = computePnL(ENTRIES.filter((e) => !e.isInternalTransfer), ACCOUNTS);
    expect(pnl.revenue).toBe(200000);
    expect(pnl.expense).toBe(100500);
    expect(pnl.cogs).toBe(70000);
    expect(pnl.monthly.get("2026-02")).toEqual({ revenue: 80000, expense: 12000 });

    const bu = computeBu(ENTRIES, ACCOUNTS, [{ id: 7, name: "A" }, { id: 8, name: "B" }], [{ id: 3, departmentId: 8 }]);
    expect(bu.find((b) => b.departmentId === 7)).toMatchObject({ revenue: 120000, expense: 88500, netProfit: 31500, adjustedNet: 26500 });
    expect(bu.find((b) => b.departmentId === 8)).toMatchObject({ revenue: 80000, expense: 12000, netProfit: 68000, adjustedNet: 73000 });
  });

  it("returns null (not 0) for undefined ratios and turnover", () => {
    expect(turnoverDays(45000, 0, 59)).toBeNull();
    expect(turnoverDays(null, 1000, 59)).toBeNull();
    expect(turnoverDays(45000, 200000, 59)).toBeCloseTo(13.275, 6);
    expect(unitCost("0", "0")).toBeNull();
    expect(unitCost("0", "88.5")).toBe(88.5);
  });

  it("RFM recency uses actual dates and data-derived medians", () => {
    const rfm = computeRfm([
      { customerId: 1, name: "林記文具", lastInvoiceDate: "2026-02-25", frequency: 6, monetary: 182400 },
      { customerId: 2, name: "南港書局", lastInvoiceDate: "2026-01-05", frequency: 5, monetary: 96350 },
      { customerId: 3, name: "青田教育", lastInvoiceDate: "2026-02-20", frequency: 1, monetary: 12800 },
      { customerId: 4, name: "大安補習班", lastInvoiceDate: "2025-12-02", frequency: 1, monetary: 7420 },
    ], "2026-02-28");
    expect(rfm.map((r) => [r.customerId, r.recencyDays, r.segment])).toEqual([
      [1, 3, "核心客戶"], [2, 54, "沉睡風險"], [3, 8, "成長客戶"], [4, 88, "一般客戶"],
    ]);
  });

  it("classifies stock and aging buckets from real movement facts", () => {
    expect(agingBucket(null, "2026-02-28")).toBe("無入庫紀錄");
    expect(agingBucket("2026-01-20", "2026-02-28")).toBe("31-90 天");
    expect(classifyStock(0, null, 12, 59).status).toBe("缺貨風險");
    expect(classifyStock(5, 8, 12, 59).status).toBe("低於安全量");
    expect(classifyStock(30, null, 0, 59)).toEqual({ daysOfSupply: null, status: "無出庫紀錄" });
    const healthy = classifyStock(20, 5, 59, 59);
    expect(healthy.daysOfSupply).toBeCloseTo(20, 6);
    expect(employerCost({ gross: 42500, laborEmployer: 3178, healthEmployer: 2012, pensionEmployer: 2550 })).toBe(50240);
  });

  it("validates date ranges", () => {
    expect(parseRange({ startDate: "2025-02-29", endDate: "2025-03-01" }).ok).toBe(false);
    expect(parseRange({ startDate: "2026-03-02", endDate: "2026-03-01" }).ok).toBe(false);
    expect(parseRange({ startDate: "2020-01-01", endDate: "2026-01-01" }).ok).toBe(false);
    expect(parseRange({ startDate: "2026-01-01" }).ok).toBe(false);
    expect(parseRange({ startDate: "2024-02-29", endDate: "2024-03-01" })).toEqual({ ok: true, startDate: "2024-02-29", endDate: "2024-03-01", days: 2 });
    expect(monthsBetween("2025-11-15", "2026-02-01")).toEqual(["2025-11", "2025-12", "2026-01", "2026-02"]);
  });
});

describe("BI routes", () => {
  it("rejects unauthenticated requests", async () => {
    loggedIn = false;
    const res = await fetch(`${base}/bi/executive?${RANGE}`);
    expect(res.status).toBe(401);
    expect(mocks.query).not.toHaveBeenCalled();
  });

  it("enforces finance / HR separation", async () => {
    role = "hr_admin";
    expect((await fetch(`${base}/bi/executive?${RANGE}`)).status).toBe(403);
    expect((await fetch(`${base}/bi/sales?${RANGE}`)).status).toBe(403);
    expect((await fetch(`${base}/bi/hr?${RANGE}`)).status).toBe(200);
    role = "accountant";
    expect((await fetch(`${base}/bi/hr?${RANGE}`)).status).toBe(403);
    role = "employee";
    expect((await fetch(`${base}/bi/observability`)).status).toBe(403);
    role = "hr_admin";
    expect((await fetch(`${base}/bi/observability`)).status).toBe(403);
  });

  it("rejects invalid dates before touching the database", async () => {
    const res = await fetch(`${base}/bi/executive?startDate=2026-02-30&endDate=2026-03-01`);
    expect(res.status).toBe(400);
    expect(mocks.query).not.toHaveBeenCalled();
  });

  it("computes executive metrics from seeded journal, settlement and balance data", async () => {
    const res = await fetch(`${base}/bi/executive?${RANGE}`);
    expect(res.status).toBe(200);
    const body: any = await res.json();
    expect(body.summary.revenue).toEqual({ value: 200000 });
    expect(body.summary.netProfit).toEqual({ value: 99500 });
    expect(body.summary.profitMargin.value).toBeCloseTo(0.4975, 6);
    expect(body.summary.netCash).toEqual({ value: 54750 });
    expect(body.workingCapital.dso.value).toBeCloseTo(13.275, 4);
    expect(body.workingCapital.dio.value).toBeCloseTo((15000 / 70000) * 59, 4);
    expect(body.workingCapital.dpo.value).toBeCloseTo((21000 / 63000) * 59, 4);
    expect(body.workingCapital.ccc.value).toBeCloseTo(13.275 + (15000 / 70000) * 59 - (21000 / 63000) * 59, 4);
    expect(body.monthly).toHaveLength(2);
    expect(body.waterfall.map((w: any) => w.amount)).toEqual([200000, 70000, 30500, 99500]);
    expect(body.notes.some((n: any) => n.text.includes("1 項有庫存料件無成本"))).toBe(true);
  });

  it("reports unavailable with reasons when the tenant has no data", async () => {
    mocks.query.mockImplementation(async (sql: string) => ({ rows: empty(sql) }));
    const body: any = await (await fetch(`${base}/bi/executive?${RANGE}`)).json();
    expect(body.summary.revenue.value).toBeNull();
    expect(body.summary.revenue.reason).toContain("沒有已過帳");
    expect(body.summary.cashIn.value).toBeNull();
    expect(body.workingCapital.ccc.value).toBeNull();
    expect(body.waterfall).toEqual([]);

    const sales: any = await (await fetch(`${base}/bi/sales?${RANGE}`)).json();
    expect(sales.summary.invoicedRevenue.value).toBeNull();
    expect(sales.summary.quotationConversion.reason).toContain("報價單");
    expect(sales.funnel).toEqual([]);
  });

  it("runs real health checks and reports baseline coverage", async () => {
    mocks.query.mockImplementation(async (sql: string) => {
      if (sql.includes("SELECT account_number AS code FROM accounts")) return { rows: [{ code: "1101" }] };
      if (sql.includes("COUNT(*)::int AS n FROM journal_entries WHERE status <> 'Draft'")) return { rows: [{ n: 12 }] };
      if (sql.startsWith("SELECT COUNT(*)::int AS n FROM (") && sql.includes("ABS(total_debit - total_credit)")) return { rows: [{ n: 2 }] };
      if (sql.startsWith("SELECT label FROM (") && sql.includes("ABS(total_debit - total_credit)")) return { rows: [{ label: "JE-0007" }, { label: "JE-0011" }] };
      return { rows: empty(sql) };
    });
    const body: any = await (await fetch(`${base}/bi/observability`)).json();
    const unbalanced = body.checks.find((c: any) => c.id === "je_unbalanced");
    expect(unbalanced).toMatchObject({ status: "fail", observed: 2, scanned: 12, samples: ["JE-0007", "JE-0011"] });
    expect(body.checks.find((c: any) => c.id === "item_negative").status).toBe("not_applicable");
    expect(body.accountBaseline.profile).toBe("yubang-83483621");
    expect(body.accountBaseline.expected).toBe(476);
    expect(body.accountBaseline.present).toBeLessThanOrEqual(1);
    expect(body.accountBaseline.missingCodes.length).toBeGreaterThan(0);
  });

  it("AI consultant: rejects prototype keys and per-page disabled modules before charging", async () => {
    process.env.AI_INTEGRATIONS_GEMINI_BASE_URL = "http://gemini.test";
    process.env.AI_INTEGRATIONS_GEMINI_API_KEY = "dummy";
    const post = (page: string) => fetch(`${base}/bi/ai-consultant`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ page, question: "營收如何？", startDate: "2026-01-01", endDate: "2026-02-28" }),
    });
    for (const p of ["toString", "constructor", "__proto__", "hasOwnProperty"]) expect((await post(p)).status).toBe(400);
    mocks.disabled.add("/bi/sales");
    const blocked = await post("sales");
    expect(blocked.status).toBe(403);
    expect(((await blocked.json()) as any).code).toBe("module_disabled");
    expect(mocks.charge).not.toHaveBeenCalled();
    expect(mocks.generate).not.toHaveBeenCalled();
    expect(mocks.query).not.toHaveBeenCalled();
  });

  it("sales top items: missing cost yields null margin, not 0", async () => {
    const { buildSales } = await import("../../lib/bi/sales");
    mocks.query.mockImplementation(async (sql: string) => {
      if (sql.includes("jsonb_array_elements") && sql.includes("revenue")) return { rows: [
        { name: "國小數學講義", itemId: 5, qty: "12", revenue: "8640" },
        { name: "英檢題庫", itemId: 6, qty: "4", revenue: "3200" },
        { name: "(未命名品項)", itemId: null, qty: "1", revenue: "500" },
      ] };
      if (sql.includes("WHERE id = ANY")) return { rows: [{ id: 5, mac: "0", bp: "0" }, { id: 6, mac: "410", bp: "380" }] };
      return { rows: empty(sql) };
    });
    const r = await buildSales({ startDate: "2026-01-01", endDate: "2026-02-28", days: 59 });
    const noCost = r.topItems.find((t) => t.name === "國小數學講義");
    const costed = r.topItems.find((t) => t.name === "英檢題庫");
    expect(noCost?.estCost).toBeNull();
    expect(noCost?.margin).toBeNull();
    expect(costed?.margin).toBeCloseTo((3200 - 1640) / 3200, 6);
    expect(r.topItems.find((t) => t.name === "(未命名品項)")?.margin).toBeNull();
  });

  it("AI consultant: unconfigured provider returns 503 without charging", async () => {
    const res = await fetch(`${base}/bi/ai-consultant`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ page: "executive", question: "利潤率變化原因？", startDate: "2026-01-01", endDate: "2026-02-28" }),
    });
    expect(res.status).toBe(503);
    expect(mocks.charge).not.toHaveBeenCalled();
    expect(mocks.generate).not.toHaveBeenCalled();
  });

  it("AI consultant: role-guarded per page, uses server context, ignores client context", async () => {
    process.env.AI_INTEGRATIONS_GEMINI_BASE_URL = "http://gemini.test";
    process.env.AI_INTEGRATIONS_GEMINI_API_KEY = "dummy";
    role = "hr_admin";
    const denied = await fetch(`${base}/bi/ai-consultant`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ page: "executive", question: "營收如何？", startDate: "2026-01-01", endDate: "2026-02-28" }),
    });
    expect(denied.status).toBe(403);
    expect(mocks.charge).not.toHaveBeenCalled();

    role = "finance_admin";
    mocks.generate.mockResolvedValue({ text: "本期淨利為 NT$99,500。" });
    const res = await fetch(`${base}/bi/ai-consultant`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ page: "executive", question: "營收如何？", startDate: "2026-01-01", endDate: "2026-02-28", contextSummary: "營收 999999999" }),
    });
    expect(res.status).toBe(200);
    expect(((await res.json()) as any).reply).toContain("99,500");
    expect(mocks.charge).toHaveBeenCalledTimes(1);
    const prompt = JSON.stringify(mocks.generate.mock.calls[0][0]);
    expect(prompt).toContain("200000");
    expect(prompt).not.toContain("999999999");
  });
});
