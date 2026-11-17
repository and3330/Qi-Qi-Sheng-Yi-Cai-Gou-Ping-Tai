import express from "express";
import type { Server } from "node:http";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const table = () => new Proxy({}, { get: (_target, key) => String(key) });
  return {
    db: { select: vi.fn(), execute: vi.fn() },
    accounts: table(),
    journal: table(),
    tables: table(),
    entries: [] as unknown[],
  };
});

vi.mock("@workspace/erp-db", () => ({
  db: mocks.db,
  accountsTable: mocks.accounts,
  journalEntriesTable: mocks.journal,
  projectsTable: mocks.tables,
  departmentsTable: mocks.tables,
  invoicesTable: mocks.tables,
  customersTable: mocks.tables,
  suppliersTable: mocks.tables,
  salesOrdersTable: mocks.tables,
  purchaseOrdersTable: mocks.tables,
  quotationsTable: mocks.tables,
  itemsTable: mocks.tables,
  warehousesTable: mocks.tables,
  stockEntriesTable: mocks.tables,
  attendanceTable: mocks.tables,
  employeesTable: mocks.tables,
  salarySlipsTable: mocks.tables,
  shiftTypesTable: mocks.tables,
  deliveryNotesTable: mocks.tables,
}));

vi.mock("drizzle-orm", () => {
  const expression = vi.fn(() => ({}));
  const sql = Object.assign(vi.fn(() => ({})), { join: vi.fn(() => ({})) });
  return {
    eq: expression, lte: expression, gte: expression, and: expression, ne: expression,
    or: expression, lt: expression, gt: expression, desc: expression, sql,
  };
});

vi.mock("../../middleware/require-auth", () => ({
  requireAuth: (_req: unknown, _res: unknown, next: () => void) => next(),
  requireRole: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));

import reportsRouter from "../reports";

function queryResult(rows: unknown[]) {
  const promise = Promise.resolve(rows);
  const chain: any = {
    where: () => chain,
    orderBy: () => chain,
    limit: () => chain,
    innerJoin: () => chain,
    then: promise.then.bind(promise),
    catch: promise.catch.bind(promise),
  };
  return chain;
}

describe("report route historical data integrity", () => {
  let server: Server;
  let url: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    mocks.entries = [];
    mocks.db.select.mockImplementation(() => ({
      from: (table: unknown) => queryResult(table === mocks.journal ? mocks.entries : []),
    }));
    const app = express();
    app.use(reportsRouter);
    app.use((_err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
      res.status(500).json({ error: "unexpected" });
    });
    server = await new Promise<Server>(resolve => {
      const listener = app.listen(0, "127.0.0.1", () => resolve(listener));
    });
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("No test listener");
    url = `http://127.0.0.1:${address.port}`;
  });

  afterEach(async () => {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  });

  it("returns 422 with an explicit error for malformed historical journal JSON", async () => {
    mocks.entries = [{ lines: [{ accountId: 10, debit: "NaN", credit: 0 }] }];
    const response = await fetch(`${url}/reports/trial-balance`);
    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({ error: expect.stringContaining("歷史財務資料異常") });
  });

  it("returns a valid empty report for an empty journal list", async () => {
    const response = await fetch(`${url}/reports/trial-balance`);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      rows: [],
      totalDebit: 0,
      totalCredit: 0,
      totalDebitBalance: 0,
      totalCreditBalance: 0,
      isBalanced: true,
    });
  });
});