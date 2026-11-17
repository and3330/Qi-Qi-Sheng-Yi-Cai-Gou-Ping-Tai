import express from "express";
import type { Server } from "node:http";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  dbSelect: vi.fn(),
  dbUpdate: vi.fn(),
  transaction: vi.fn(),
  assertPeriodOpen: vi.fn(),
}));

vi.mock("@workspace/erp-db", () => ({
  db: {
    select: mocks.dbSelect,
    update: mocks.dbUpdate,
    transaction: mocks.transaction,
    insert: vi.fn(),
    delete: vi.fn(),
  },
  vouchersTable: {},
  projectsTable: {},
  departmentsTable: {},
  customersTable: {},
  employeesTable: {},
  activitiesTable: {},
  journalEntriesTable: {},
  invoicesTable: {},
  invoiceSettlementsTable: {},
}));
vi.mock("drizzle-orm", () => ({
  eq: vi.fn(() => ({})),
  and: vi.fn(() => ({})),
  inArray: vi.fn(() => ({})),
  sql: vi.fn(() => ({})),
}));
vi.mock("../../middleware/require-auth", () => ({
  requireAuth: (_req: unknown, _res: unknown, next: () => void) => next(),
  requireRole: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));
vi.mock("../../lib/auto-journal", () => ({
  assertPeriodOpen: mocks.assertPeriodOpen,
  resolveJournalLines: vi.fn(),
}));
vi.mock("../../lib/invoice-sync", () => ({ recomputeInvoices: vi.fn() }));
vi.mock("../../lib/friendly-errors", () => ({
  friendlyCaughtError: (error: Error) => error.message,
  friendlyValidationError: (error: unknown) => String(error),
}));

import vouchersRouter from "../vouchers";

function queryResult(rows: unknown[]) {
  const builder: any = {
    from: () => builder,
    where: () => builder,
    orderBy: () => builder,
    groupBy: () => builder,
    limit: () => builder,
    for: () => builder,
    set: () => builder,
    values: () => builder,
    returning: () => builder,
    then: (resolve: (value: unknown[]) => unknown, reject: (reason: unknown) => unknown) =>
      Promise.resolve(rows).then(resolve, reject),
  };
  return builder;
}

describe("voucher money invariants", () => {
  let server: Server;
  let baseUrl: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    const app = express();
    app.use(express.json(), vouchersRouter);
    server = await new Promise<Server>(resolve => {
      const listening = app.listen(0, "127.0.0.1", () => resolve(listening));
    });
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Test server did not bind");
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterEach(async () => {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  });

  async function request(method: string, path: string, body: unknown) {
    return fetch(baseUrl + path, {
      method,
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  it.each([-90, 0])("rejects non-positive voucher line amount %s before persistence", async amount => {
    const response = await request("POST", "/vouchers", {
      voucherType: "收款單",
      voucherDate: "2026-08-15",
      customerId: 3,
      totalAmount: "10",
      items: [
        { description: "沖帳", amount: 100, invoiceId: 8 },
        { description: "不支援的負向調整", amount },
      ],
    });

    expect(response.status).toBe(400);
    expect((await response.json() as { error: string }).error).toContain("明細金額必須為正數");
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it.each([
    [{ totalAmount: "1" }, "總金額"],
    [{ status: "Cancelled" }, "狀態"],
  ])("refuses in-place posted voucher mutation %j", async (body, field) => {
    const response = await request("PATCH", "/vouchers/12", body);

    expect(response.status).toBe(400);
    expect((await response.json() as { error: string }).error).toContain(field);
    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(mocks.dbUpdate).not.toHaveBeenCalled();
  });

  it("allows description-only correction under voucher row lock and lock-date check", async () => {
    const existing = {
      id: 12, voucherNumber: "RC-00012", voucherType: "Receipt",
      voucherDate: "2026-08-15", description: "舊說明", totalAmount: "100",
      status: "草稿", items: [{ amount: 100 }], journalEntryId: null,
    };
    const updated = { ...existing, description: "更正說明" };
    const txSelect = vi.fn(() => queryResult([existing]));
    const txUpdate = vi.fn(() => queryResult([updated]));
    const tx = { select: txSelect, update: txUpdate };
    mocks.transaction.mockImplementation(async callback => callback(tx));

    const response = await request("PATCH", "/vouchers/12", { description: "更正說明" });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ id: 12, description: "更正說明", totalAmount: "100" });
    expect(mocks.assertPeriodOpen).toHaveBeenCalledWith(tx, existing.voucherDate, "修改傳票");
    expect(txSelect).toHaveBeenCalledOnce();
    expect(txUpdate).toHaveBeenCalledOnce();
  });

  it("refuses direct edits of a posted voucher: changes go through an approved change request (owner 2026-11-16)", async () => {
    const existing = {
      id: 12, voucherNumber: "RC-00012", voucherType: "Receipt",
      voucherDate: "2026-08-15", description: "舊說明", totalAmount: "100",
      status: "已過帳", items: [{ amount: 100 }], journalEntryId: 112,
    };
    const txUpdate = vi.fn(() => queryResult([existing]));
    const tx = { select: vi.fn(() => queryResult([existing])), update: txUpdate };
    mocks.transaction.mockImplementation(async callback => callback(tx));

    const response = await request("PATCH", "/vouchers/12", { description: "更正說明" });

    expect(response.status).toBe(400);
    expect(txUpdate).not.toHaveBeenCalled();
  });
});
