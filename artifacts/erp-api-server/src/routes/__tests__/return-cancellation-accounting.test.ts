import express from "express";
import type { Server } from "node:http";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const tables = {
    salesReturns: { id: "salesReturnId" },
    purchaseReturns: { id: "purchaseReturnId" },
    invoices: { id: "invoiceId" },
    settlements: { id: "settlementId", invoiceId: "settlementInvoiceId" },
  };
  return {
    tables,
    dbSelect: vi.fn(),
    transaction: vi.fn(),
    assertPeriodOpen: vi.fn(),
    deleteInvoiceJournalEntry: vi.fn(),
  };
});

vi.mock("@workspace/erp-db", () => ({
  db: {
    select: mocks.dbSelect,
    transaction: mocks.transaction,
    update: vi.fn(),
    insert: vi.fn(),
    delete: vi.fn(),
  },
  salesReturnsTable: mocks.tables.salesReturns,
  purchaseReturnsTable: mocks.tables.purchaseReturns,
  invoicesTable: mocks.tables.invoices,
  invoiceSettlementsTable: mocks.tables.settlements,
  deliveryNotesTable: {},
  purchaseReceiptsTable: {},
  customersTable: {},
  suppliersTable: {},
  itemsTable: {},
  activitiesTable: {},
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn(() => ({})),
  and: vi.fn(() => ({})),
  inArray: vi.fn(() => ({})),
  sql: vi.fn(() => ({})),
}));
vi.mock("../../middleware/require-auth", () => ({
  requireAuth: (_req: unknown, _res: unknown, next: () => void) => next(),
}));
vi.mock("../../lib/auto-journal", () => ({
  assertPeriodOpen: mocks.assertPeriodOpen,
  createInvoiceJournalEntry: vi.fn(),
  deleteInvoiceJournalEntry: mocks.deleteInvoiceJournalEntry,
}));
vi.mock("../delivery-notes", () => ({ recalcOrderStatus: vi.fn() }));

import salesReturnsRouter from "../sales-returns";
import purchaseReturnsRouter from "../purchase-returns";

function queryResult(rows: unknown[]) {
  const builder: any = {
    from: () => builder,
    where: () => builder,
    limit: () => builder,
    for: () => builder,
    orderBy: () => builder,
    then: (resolve: (value: unknown[]) => unknown, reject: (reason: unknown) => unknown) =>
      Promise.resolve(rows).then(resolve, reject),
  };
  return builder;
}

const cases = [
  {
    name: "sales return",
    path: "/sales-returns/1",
    existing: {
      id: 1, status: "Submitted", returnNumber: "SR-1", returnDate: "2026-08-10",
      deliveryNoteId: 31, creditNoteInvoiceId: 91, items: [],
    },
    source: { id: 31, status: "Submitted", items: [] },
    invoice: {
      id: 91, invoiceNumber: "CN-1", invoiceDate: "2026-08-10",
      paidAmount: "0", journalEntryId: 191,
    },
  },
  {
    name: "purchase return",
    path: "/purchase-returns/1",
    existing: {
      id: 1, status: "Submitted", returnNumber: "PRT-1", returnDate: "2026-08-10",
      purchaseReceiptId: 32, debitNoteInvoiceId: 92, items: [],
    },
    source: { id: 32, status: "Submitted", items: [] },
    invoice: {
      id: 92, invoiceNumber: "DBN-1", invoiceDate: "2026-08-10",
      paidAmount: "0", journalEntryId: 192,
    },
  },
] as const;

describe("return cancellation accounting invariants", () => {
  let server: Server;
  let baseUrl: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    const app = express();
    app.use(express.json(), salesReturnsRouter, purchaseReturnsRouter);
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

  it.each(cases)("$name checks settlement rows under invoice lock, not stale paidAmount", async testCase => {
    // Initial route read and linked credit/debit-note lookup.
    mocks.dbSelect
      .mockReturnValueOnce(queryResult([testCase.existing]))
      .mockReturnValueOnce(queryResult([testCase.invoice]));

    const txSelect = vi.fn()
      .mockReturnValueOnce(queryResult([testCase.source])) // common parent FOR UPDATE
      .mockReturnValueOnce(queryResult([testCase.existing])) // return row FOR UPDATE
      .mockReturnValueOnce(queryResult([testCase.invoice])) // invoice row FOR UPDATE
      .mockReturnValueOnce(queryResult([{ id: 501 }])); // authoritative settlement ledger
    const tx = { select: txSelect, update: vi.fn(), insert: vi.fn(), delete: vi.fn() };
    mocks.transaction.mockImplementation(async callback => callback(tx));

    const response = await fetch(baseUrl + testCase.path, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status: "Cancelled" }),
    });

    expect(response.status).toBe(400);
    expect((await response.json() as { error: string }).error).toContain("已有沖抵/收付紀錄");
    expect(testCase.invoice.paidAmount).toBe("0"); // proves the denormalized value was intentionally stale
    expect(txSelect).toHaveBeenCalledTimes(4);
    expect(mocks.assertPeriodOpen).toHaveBeenCalledTimes(2);
    expect(mocks.deleteInvoiceJournalEntry).not.toHaveBeenCalled();
    expect(tx.update).not.toHaveBeenCalled();
  });

  it.each(cases)("$name lock-date failure happens inside the cancellation transaction before writes", async testCase => {
    mocks.dbSelect
      .mockReturnValueOnce(queryResult([testCase.existing]))
      .mockReturnValueOnce(queryResult([testCase.invoice]));
    const txSelect = vi.fn()
      .mockReturnValueOnce(queryResult([testCase.source]))
      .mockReturnValueOnce(queryResult([testCase.existing]));
    const tx = { select: txSelect, update: vi.fn(), insert: vi.fn(), delete: vi.fn() };
    mocks.assertPeriodOpen.mockRejectedValueOnce(new Error("2026-08-10（含）以前已關帳"));
    mocks.transaction.mockImplementation(async callback => callback(tx));

    const response = await fetch(baseUrl + testCase.path, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status: "Cancelled" }),
    });

    expect(response.status).toBe(400);
    expect((await response.json() as { error: string }).error).toContain("已關帳");
    expect(mocks.assertPeriodOpen).toHaveBeenCalledWith(tx, testCase.existing.returnDate, expect.any(String));
    expect(tx.update).not.toHaveBeenCalled();
    expect(mocks.deleteInvoiceJournalEntry).not.toHaveBeenCalled();
  });

  it("locks item rows and rejects a purchase return that would make stock negative", async () => {
    const draft = {
      id: 2, status: "Draft", returnNumber: "PRT-2", returnDate: "2026-08-12",
      purchaseReceiptId: 42, supplierId: 4,
      items: [{ itemId: 20, itemName: "實體品", quantity: 3, rate: 10, amount: 30, isVirtual: false }],
    };
    const source = { id: 42, status: "Submitted", items: [{ itemId: 20, quantity: 3 }] };
    mocks.dbSelect.mockReturnValueOnce(queryResult([draft]));
    const txSelect = vi.fn()
      .mockReturnValueOnce(queryResult([source]))
      .mockReturnValueOnce(queryResult([draft]))
      .mockReturnValueOnce(queryResult([]))
      .mockReturnValueOnce(queryResult([{ id: 20, currentStock: "2" }]));
    const tx = { select: txSelect, update: vi.fn(), insert: vi.fn(), delete: vi.fn() };
    mocks.transaction.mockImplementation(async callback => callback(tx));

    const response = await fetch(`${baseUrl}/purchase-returns/2`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status: "Submitted" }),
    });

    expect(response.status).toBe(400);
    expect((await response.json() as { error: string }).error).toContain("不足以退回 3");
    expect(txSelect).toHaveBeenCalledTimes(4);
    expect(tx.update).not.toHaveBeenCalled();
    expect(tx.insert).not.toHaveBeenCalled();
  });

  it("locks item rows and rejects sales-return cancellation that would make stock negative", async () => {
    const submitted = {
      id: 3, status: "Submitted", returnNumber: "SR-3", returnDate: "2026-08-12",
      deliveryNoteId: 43, creditNoteInvoiceId: 93,
      items: [{ itemId: 21, itemName: "實體品", quantity: 2, rate: 10, amount: 20, isVirtual: false }],
    };
    const source = { id: 43, status: "Submitted", items: [{ itemId: 21, quantity: 2 }] };
    const creditNote = {
      id: 93, invoiceNumber: "CN-3", invoiceDate: "2026-08-12",
      paidAmount: "0", journalEntryId: 193,
    };
    mocks.dbSelect
      .mockReturnValueOnce(queryResult([submitted]))
      .mockReturnValueOnce(queryResult([creditNote]));
    const txSelect = vi.fn()
      .mockReturnValueOnce(queryResult([source]))
      .mockReturnValueOnce(queryResult([submitted]))
      .mockReturnValueOnce(queryResult([creditNote]))
      .mockReturnValueOnce(queryResult([]))
      .mockReturnValueOnce(queryResult([{ id: 21, currentStock: "1" }]));
    const tx = { select: txSelect, update: vi.fn(), insert: vi.fn(), delete: vi.fn() };
    mocks.transaction.mockImplementation(async callback => callback(tx));

    const response = await fetch(`${baseUrl}/sales-returns/3`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status: "Cancelled" }),
    });

    expect(response.status).toBe(400);
    expect((await response.json() as { error: string }).error).toContain("不足以取消退貨所需扣回的 2");
    expect(txSelect).toHaveBeenCalledTimes(5);
    expect(tx.update).not.toHaveBeenCalled();
    expect(mocks.deleteInvoiceJournalEntry).not.toHaveBeenCalled();
  });

  it.each([
    {
      name: "sales",
      path: "/sales-returns/11",
      draft: {
        id: 11, status: "Draft", deliveryNoteId: 71, returnNumber: "SR-11",
        items: [{ itemId: 30, quantity: 4, isVirtual: false }],
      },
      source: { id: 71, status: "Submitted", items: [{ itemId: 30, quantity: 5 }] },
      expected: "原送貨數量 5",
    },
    {
      name: "purchase",
      path: "/purchase-returns/12",
      draft: {
        id: 12, status: "Draft", purchaseReceiptId: 72, returnNumber: "PRT-12",
        items: [{ itemId: 30, quantity: 4, isVirtual: false }],
      },
      source: { id: 72, status: "Submitted", items: [{ itemId: 30, quantity: 5 }] },
      expected: "原進貨數量 5",
    },
  ])("$name submission rejects two individually-valid drafts whose aggregate exceeds source", async testCase => {
    // This draft requests 4/5. A sibling draft was also individually valid and
    // has since submitted 4/5. Parent locking makes this 8/5 check serializable.
    mocks.dbSelect.mockReturnValueOnce(queryResult([testCase.draft]));
    const txSelect = vi.fn()
      .mockReturnValueOnce(queryResult([testCase.source]))
      .mockReturnValueOnce(queryResult([testCase.draft]))
      .mockReturnValueOnce(queryResult([{ items: [{ itemId: 30, quantity: 4, isVirtual: false }] }]));
    const tx = { select: txSelect, update: vi.fn(), insert: vi.fn(), delete: vi.fn() };
    mocks.transaction.mockImplementation(async callback => callback(tx));

    const response = await fetch(baseUrl + testCase.path, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status: "Submitted" }),
    });

    expect(response.status).toBe(400);
    expect((await response.json() as { error: string }).error).toContain(testCase.expected);
    expect(txSelect).toHaveBeenCalledTimes(3);
    expect(tx.update).not.toHaveBeenCalled();
    expect(tx.insert).not.toHaveBeenCalled();
  });
});