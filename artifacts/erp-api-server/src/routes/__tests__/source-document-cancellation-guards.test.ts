import express from "express";
import type { Server } from "node:http";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const table = (name: string) => new Proxy({ __name: name }, {
    get(target, key) { return key in target ? target[key as keyof typeof target] : String(key); },
  });
  return {
    db: { select: vi.fn(), transaction: vi.fn() },
    tx: { select: vi.fn(), update: vi.fn(), insert: vi.fn(), delete: vi.fn() },
    tables: {
      deliveries: table("deliveries"), receipts: table("receipts"),
      salesReturns: table("salesReturns"), purchaseReturns: table("purchaseReturns"),
      invoices: table("invoices"), items: table("items"),
      salesOrders: table("salesOrders"), purchaseOrders: table("purchaseOrders"),
      customers: table("customers"), suppliers: table("suppliers"),
      activities: table("activities"), journals: table("journals"),
      paymentRequests: table("paymentRequests"),
    },
  };
});

vi.mock("@workspace/erp-db", () => ({
  db: mocks.db,
  deliveryNotesTable: mocks.tables.deliveries, purchaseReceiptsTable: mocks.tables.receipts,
  salesReturnsTable: mocks.tables.salesReturns, purchaseReturnsTable: mocks.tables.purchaseReturns,
  invoicesTable: mocks.tables.invoices, itemsTable: mocks.tables.items,
  salesOrdersTable: mocks.tables.salesOrders, purchaseOrdersTable: mocks.tables.purchaseOrders,
  customersTable: mocks.tables.customers, suppliersTable: mocks.tables.suppliers,
  activitiesTable: mocks.tables.activities, journalEntriesTable: mocks.tables.journals,
  paymentRequestsTable: mocks.tables.paymentRequests,
}));
vi.mock("../../middleware/require-auth", () => ({
  requireAuth: (_req: unknown, _res: unknown, next: () => void) => next(),
  requireRole: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));
vi.mock("../../lib/auto-journal", () => ({
  resolveJournalLines: vi.fn(), assertPeriodOpen: vi.fn(),
  syncSalesOrderJournalEntry: vi.fn(), createInvoiceJournalEntry: vi.fn(), deleteInvoiceJournalEntry: vi.fn(),
}));

import deliveryNotesRouter from "../delivery-notes";
import purchaseReceiptsRouter from "../purchase-receipts";

function query(rows: any[]) {
  const chain: any = {
    from: (table: unknown) => { chain.table = table; return chain; },
    where: () => chain, for: () => chain,
    then: (resolve: (value: any[]) => unknown) => Promise.resolve(rows).then(resolve),
  };
  return chain;
}

describe("source stock-document cancellation guards", () => {
  let server: Server;
  let baseUrl: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    mocks.db.transaction.mockImplementation(async (callback: (tx: typeof mocks.tx) => unknown) => callback(mocks.tx));
    const app = express();
    app.use(express.json(), deliveryNotesRouter, purchaseReceiptsRouter);
    server = await new Promise<Server>(resolve => {
      const listener = app.listen(0, "127.0.0.1", () => resolve(listener));
    });
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("No test listener");
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterEach(async () => {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  });

  async function cancel(path: string) {
    const response = await fetch(baseUrl + path, {
      method: "PATCH", headers: { "content-type": "application/json" },
      body: JSON.stringify({ status: "Cancelled" }),
    });
    return { status: response.status, body: await response.json() as { error?: string } };
  }

  it.each([
    {
      path: "/delivery-notes/1", parent: mocks.tables.deliveries, returns: mocks.tables.salesReturns,
      existing: { id: 1, status: "Submitted", items: [{ itemId: 7, quantity: 1 }], salesOrderId: null },
      message: "銷貨退回",
    },
    {
      path: "/purchase-receipts/2", parent: mocks.tables.receipts, returns: mocks.tables.purchaseReturns,
      existing: { id: 2, status: "Submitted", items: [{ itemId: 8, quantity: 1 }], purchaseOrderId: null },
      message: "採購退回",
    },
  ])("blocks $path when an active return references the source document", async ({ path, parent, returns, existing, message }) => {
    mocks.db.select.mockReturnValue(query([existing]));
    mocks.tx.select.mockImplementation(() => {
      const chain = query([]);
      const originalFrom = chain.from;
      chain.from = (table: unknown) => {
        originalFrom(table);
        const rows = table === parent ? [existing] : table === returns ? [{ id: 99 }] : [];
        chain.then = (resolve: (value: any[]) => unknown) => Promise.resolve(rows).then(resolve);
        return chain;
      };
      return chain;
    });
    const response = await cancel(path);
    expect(response.status).toBe(400);
    expect(response.body.error).toContain(message);
    expect(mocks.tx.update).not.toHaveBeenCalled();
    expect(mocks.tx.insert).not.toHaveBeenCalled();
  });

  it.each([
    {
      path: "/delivery-notes/1", parent: mocks.tables.deliveries, returns: mocks.tables.salesReturns,
      existing: { id: 1, status: "Submitted", items: [{ itemId: 7, quantity: 1 }], salesOrderId: null },
    },
    {
      path: "/purchase-receipts/2", parent: mocks.tables.receipts, returns: mocks.tables.purchaseReturns,
      existing: { id: 2, status: "Submitted", items: [{ itemId: 8, quantity: 1 }], purchaseOrderId: null },
    },
  ])("does not cancel or delete a finalized paid invoice for $path", async ({ path, parent, returns, existing }) => {
    mocks.db.select.mockReturnValue(query([existing]));
    mocks.tx.select.mockImplementation(() => {
      const chain = query([]);
      const originalFrom = chain.from;
      chain.from = (table: unknown) => {
        originalFrom(table);
        const rows = table === parent ? [existing]
          : table === returns ? []
          : table === mocks.tables.invoices ? [{ id: 77, invoiceNumber: "INV-PAID", status: "Paid" }] : [];
        chain.then = (resolve: (value: any[]) => unknown) => Promise.resolve(rows).then(resolve);
        return chain;
      };
      return chain;
    });
    const response = await cancel(path);
    expect(response.status).toBe(400);
    expect(response.body.error).toContain("INV-PAID");
    expect(mocks.tx.update).not.toHaveBeenCalled();
    expect(mocks.tx.delete).not.toHaveBeenCalled();
  });
});