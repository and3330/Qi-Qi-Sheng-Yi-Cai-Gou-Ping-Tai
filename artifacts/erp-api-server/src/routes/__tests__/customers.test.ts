import express from "express";
import type { Server } from "node:http";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  transaction: vi.fn(),
  customersTable: { table: "customers" },
  activitiesTable: { table: "activities" },
}));

vi.mock("@workspace/erp-db", () => ({
  db: {
    transaction: mocks.transaction,
    insert: vi.fn(),
    select: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
  customersTable: mocks.customersTable,
  activitiesTable: mocks.activitiesTable,
  invoicesTable: {},
  invoiceSettlementsTable: {},
  vouchersTable: {},
}));

vi.mock("../../middleware/require-auth", () => ({
  requireAuth: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

import customersRouter from "../customers";

describe("customer create route", () => {
  let server: Server;
  let baseUrl: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    const app = express();
    app.use(express.json());
    app.use(customersRouter);
    server = await new Promise<Server>((resolve) => {
      const listening = app.listen(0, "127.0.0.1", () => resolve(listening));
    });
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Test server did not bind");
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterEach(async () => {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  });

  /** Transaction double: records lock/dedup/inserts; `existing` rows are returned by the dedup SELECT. */
  function fakeTx(existing: Array<Record<string, unknown>> = [], customer: Record<string, unknown> = { id: 7 }) {
    const customerValues = vi.fn((_values: unknown) => ({ returning: vi.fn(async () => [customer]) }));
    const activityValues = vi.fn(async (_values: unknown) => undefined);
    const insert = vi.fn()
      .mockImplementationOnce(() => ({ values: customerValues }))
      .mockImplementationOnce(() => ({ values: activityValues }));
    const execute = vi.fn(async () => undefined);
    const limit = vi.fn(async () => existing);
    const select = vi.fn(() => ({ from: () => ({ where: () => ({ limit }) }) }));
    mocks.transaction.mockImplementation(async (callback) => callback({ insert, execute, select }));
    return { insert, execute, select, customerValues, activityValues };
  }
  const postCustomer = (body: unknown) => fetch(`${baseUrl}/customers`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

  it("creates the customer and activity in one transaction", async () => {
    const customer = { id: 7, name: "測試客戶", customerCode: "C-007" };
    const tx = fakeTx([], customer);

    const response = await postCustomer({ name: customer.name, customerCode: customer.customerCode });

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({ ...customer, totalOrders: 0, totalSpent: 0 });
    expect(mocks.transaction).toHaveBeenCalledOnce();
    expect(tx.execute).toHaveBeenCalledOnce(); // per-tenant advisory lock before the duplicate check
    expect(tx.insert).toHaveBeenNthCalledWith(1, mocks.customersTable);
    expect(tx.insert).toHaveBeenNthCalledWith(2, mocks.activitiesTable);
  });

  it("trims string fields, blanks optional fields to null and accepts a valid 統編", async () => {
    const tx = fakeTx();
    const response = await postCustomer({ name: "  測試客戶  ", customerCode: " C-1 ", taxId: " 22099131 ", email: "  ", category: "" });
    expect(response.status).toBe(201);
    expect(tx.customerValues).toHaveBeenCalledWith({ name: "測試客戶", customerCode: "C-1", taxId: "22099131", email: null });
    expect(tx.activityValues).toHaveBeenCalledWith(expect.objectContaining({ description: "測試客戶 added as customer" }));
  });

  it.each([
    [{ name: "   " }, "name"],
    [{}, "name"],
    [{ name: "X", taxId: "22099132" }, "taxId"],
    [{ name: "X", taxId: "2209 9131" }, "taxId"],
    [{ name: "X", taxId: "ABCDEFGH" }, "taxId"],
    [{ name: { nested: true } }, "name"],
  ])("rejects %j with 400 before any database work", async (body, field) => {
    const response = await postCustomer(body);
    expect(response.status).toBe(400);
    expect(((await response.json()) as any).field).toBe(field);
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it.each([
    [{ name: "Other", taxId: "22099131" }, { name: "Existing", taxId: " 22099131 ", customerCode: null }, "taxId"],
    [{ name: "Other", customerCode: "C-1" }, { name: "Existing", taxId: null, customerCode: "C-1" }, "customerCode"],
    [{ name: " Existing " }, { name: "Existing ", taxId: null, customerCode: null }, "name"],
  ])("returns 409 for same-tenant duplicate %j and inserts nothing", async (body, existing, field) => {
    const tx = fakeTx([existing]);
    const response = await postCustomer(body);
    expect(response.status).toBe(409);
    expect(((await response.json()) as any).field).toBe(field);
    expect(tx.insert).not.toHaveBeenCalled();
  });

  it("batch applies the same validation and duplicate rules", async () => {
    const batch = (records: unknown) => fetch(`${baseUrl}/customers/batch`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ records }),
    });
    let response = await batch([{ name: "OK" }, { name: "  " }]);
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ field: "name", index: 1 });
    response = await batch([{ name: "OK", taxId: "22099132" }]);
    expect(response.status).toBe(400);
    response = await batch([{ name: "Same" }, { name: " Same " }]);
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ field: "name", index: 1 });
    expect(mocks.transaction).not.toHaveBeenCalled();

    fakeTx([{ name: "Existing", taxId: null, customerCode: null }]);
    response = await batch([{ name: "New" }, { name: "Existing" }]);
    expect(response.status).toBe(409);

    const values = vi.fn((_v: unknown) => ({ returning: vi.fn(async () => [{ id: 1 }, { id: 2 }]) }));
    mocks.transaction.mockImplementation(async (callback) => callback({
      execute: vi.fn(async () => undefined),
      select: () => ({ from: () => ({ where: () => ({ limit: async () => [] }) }) }),
      insert: () => ({ values }),
    }));
    response = await batch([{ name: " A ", taxId: "22099131" }, { name: "B" }]);
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ count: 2 });
    expect(values).toHaveBeenCalledWith([
      { name: "A", taxId: "22099131", category: "一般客戶" },
      { name: "B", category: "一般客戶" },
    ]);
  });

  it("returns sanitized JSON when a wrapped missing-schema error occurs", async () => {
    mocks.transaction.mockRejectedValue(
      new Error("Failed query: INSERT private customer values", {
        cause: { code: "42P01", query: "private SQL", params: ["private customer"] },
      }),
    );

    const response = await fetch(`${baseUrl}/customers`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "不應外洩的客戶" }),
    });
    const body = await response.text();

    expect(response.status).toBe(503);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(JSON.parse(body)).toEqual({
      code: "DATABASE_UPDATE_REQUIRED",
      error: "資料庫尚未完成更新，請聯絡系統管理員執行資料庫更新。",
    });
    expect(body).not.toContain("private");
    expect(body).not.toContain("不應外洩");
  });
});