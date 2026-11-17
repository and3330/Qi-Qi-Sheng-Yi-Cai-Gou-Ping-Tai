import express from "express";
import type { Server } from "node:http";
import { AsyncLocalStorage } from "node:async_hooks";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  select: vi.fn(), insert: vi.fn(), update: vi.fn(), delete: vi.fn(), transaction: vi.fn(),
  accounts: { id: "id", accountName: "accountName", isGroup: "isGroup" },
  journal: {}, activities: {},
}));
// No real DB module (or startup/role initialization) is imported by this suite.
vi.mock("@workspace/erp-db", () => ({
  db: mocks,
  accountsTable: mocks.accounts, journalEntriesTable: mocks.journal,
  activitiesTable: mocks.activities, vouchersTable: {}, projectsTable: {},
  departmentsTable: {}, customersTable: {}, employeesTable: {},
  invoicesTable: {}, invoiceSettlementsTable: {},
}));
vi.mock("../../lib/auto-journal", () => ({
  assertPeriodOpen: vi.fn(), resolveJournalLines: vi.fn(),
}));
vi.mock("../../lib/invoice-sync", () => ({ recomputeInvoices: vi.fn() }));

import vouchers from "../vouchers";
import journal from "../journal-entries";
import { employeeAccessGuard } from "../../middleware/employee-access-guard";

const tenantContext = new AsyncLocalStorage<string>();
type EntryResult = { lines: { accountName: string }[] };
type ListResult = { data: EntryResult[] };
const accounts = {
  A: [{ id: 11, accountName: "A private account", isGroup: false }],
  B: [
    { id: 22, accountName: "B account", isGroup: false },
    { id: 23, accountName: "B group", isGroup: true },
  ],
};
const endpoints = [
  ["GET", "/vouchers"], ["POST", "/vouchers"], ["GET", "/vouchers/1"],
  ["PATCH", "/vouchers/1"], ["DELETE", "/vouchers/1"],
  ["GET", "/journal-entries"], ["POST", "/journal-entries"],
] as const;
const body = (accountId: number) => ({
  entryDate: "2026-01-15", description: "Isolation test",
  lines: [{ accountId, debit: 10, credit: 0 }, { accountId, debit: 0, credit: 10 }],
});

describe("finance routers: real authentication/role and employee guards, mocked tenant DB", () => {
  let server: Server;
  let url: string;
  beforeEach(async () => {
    vi.resetAllMocks();
    const app = express();
    app.use(express.json());
    // Simulate identity established by upstream session/API-key authentication.
    app.use((req, _res, next) => {
      const tenant = req.get("x-test-tenant") || "A";
      const tenantId = tenant === "B" ? 202 : 101;
      const role = req.get("x-test-role");
      if (role) (req as any).session = { user: { role, tenantId } };
      const permission = req.get("x-test-key");
      if (permission) Object.assign(req, { apiKeyAuth: true, apiKey: { permissions: permission, tenantId } });
      tenantContext.run(tenant, next);
    });
    app.use(employeeAccessGuard, vouchers, journal);
    app.use((_err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
      res.status(599).json({ error: "DB sentinel" });
    });
    server = await new Promise<Server>(resolve => {
      const listener = app.listen(0, "127.0.0.1", () => resolve(listener));
    });
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("No test listener");
    url = `http://127.0.0.1:${address.port}`;
  });
  afterEach(async () => { await new Promise<void>((resolve, reject) => server.close(err => err ? reject(err) : resolve())); });

  async function request(method: string, path: string, headers: Record<string, string> = {}, data?: unknown) {
    return fetch(url + path, {
      method, headers: { "content-type": "application/json", ...headers },
      ...(data === undefined ? {} : { body: JSON.stringify(data) }),
    });
  }

  for (const [method, path] of endpoints) {
    it(`${method} ${path}: rejects anonymous, non-finance roles and non-admin keys before business DB access`, async () => {
      const identities: [Record<string, string>, number][] = [
        [{}, 401],
        ...["viewer", "manager", "hr_admin", "employee", "unknown"].map(role =>
          [{ "x-test-role": role }, 403] as [Record<string, string>, number]),
        ...["read", "readwrite"].map(permission =>
          [{ "x-test-key": permission }, 403] as [Record<string, string>, number]),
      ];
      for (const [headers, status] of identities) {
        expect((await request(method, path, headers)).status).toBe(status);
      }
      for (const fn of [mocks.select, mocks.insert, mocks.update, mocks.delete, mocks.transaction]) {
        expect(fn).not.toHaveBeenCalled();
      }
    });

    it(`${method} ${path}: retains finance roles, super_admin and admin-key access`, async () => {
      mocks.select.mockImplementation(() => { throw new Error("sentinel"); });
      mocks.transaction.mockImplementation(() => { throw new Error("sentinel"); });
      for (const headers of [
        ...["owner", "admin", "finance_admin", "accountant", "super_admin"].map(role => ({ "x-test-role": role })),
        { "x-test-key": "admin" },
      ]) {
        const response = await request(method, path, headers);
        // Invalid write bodies stop at validation; valid read/delete paths reach DB sentinel.
        expect(method === "DELETE" ? [500] : [400, 599]).toContain(response.status);
      }
    });
  }

  function installTenantDb() {
    mocks.select.mockImplementation((selection?: { count?: unknown; entry?: unknown; kind?: unknown }) => ({
      from(table: unknown) {
        const tenant = tenantContext.getStore() as keyof typeof accounts;
        if (table === mocks.accounts) return Promise.resolve(accounts[tenant]);
        const entry = {
          id: 1, totalDebit: "10", totalCredit: "10", description: "",
          // Foreign historical reference must not resolve to A's cached name in B.
          lines: [{ accountId: tenant === "A" ? 11 : 22 }, { accountId: 11 }],
        };
        // 清單查詢把分錄包在 entry 裡，另附交易類型；類型統計只回 kind + count
        const rows = selection?.entry ? [{ entry, kind: "general", projectName: null, departmentName: null }]
          : selection?.kind ? [{ kind: "general", count: 1 }]
          : selection?.count ? [{ count: 1 }] : [entry];
        const chain: any = { then: (resolve: (value: unknown) => unknown) => Promise.resolve(rows).then(resolve) };
        for (const method of ["where", "orderBy", "limit", "offset", "leftJoin", "innerJoin", "groupBy"]) chain[method] = () => chain;
        return chain;
      },
    }));
    mocks.insert.mockImplementation(() => ({
      values: (value: unknown) => ({ returning: async () => [{ id: 1, ...value as object }] }),
    }));
  }

  it("interleaved A/B reads and writes never reuse another tenant's account names", async () => {
    installTenantDb();
    for (const tenant of ["A", "B", "A", "B"]) {
      const headers = { "x-test-role": "accountant", "x-test-tenant": tenant };
      const response = await request("GET", "/journal-entries", headers);
      expect(response.status).toBe(200);
      const result = await response.json() as ListResult;
      expect(result.data[0].lines[0].accountName).toBe(tenant === "A" ? "A private account" : "B account");
      if (tenant === "B") {
        expect(result.data[0].lines[1].accountName).toBe("Unknown");
        expect(JSON.stringify(result)).not.toContain("A private account");
      }
      const created = await request("POST", "/journal-entries", headers, body(tenant === "A" ? 11 : 22));
      expect(created.status).toBe(201);
      expect((await created.json() as EntryResult).lines[0].accountName).toBe(tenant === "A" ? "A private account" : "B account");
    }
    // Changes are visible immediately, with no cache invalidation dependency.
    const original = accounts.B[0].accountName;
    try {
      accounts.B[0].accountName = "Renamed B";
      const response = await request("GET", "/journal-entries", { "x-test-role": "owner", "x-test-tenant": "B" });
      expect((await response.json() as ListResult).data[0].lines[0].accountName).toBe("Renamed B");
    } finally { accounts.B[0].accountName = original; }
  });

  it.each([11, 23, 999, 0, -1, 22.5])("rejects foreign, group, missing or invalid account %s before insert", async accountId => {
    installTenantDb();
    // Warm A first: this reproduced the former global-cache leak.
    await request("GET", "/journal-entries", { "x-test-role": "owner", "x-test-tenant": "A" });
    const response = await request("POST", "/journal-entries",
      { "x-test-role": "accountant", "x-test-tenant": "B" }, body(accountId));
    expect(response.status).toBe(400);
    expect(await response.text()).not.toContain("A private account");
    expect(mocks.insert).not.toHaveBeenCalled();
  });
});