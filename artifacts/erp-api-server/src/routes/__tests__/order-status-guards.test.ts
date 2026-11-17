import express from "express";
import type { Server } from "node:http";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const table = (name: string) => new Proxy({ __name: name }, {
    get(target, key) { return key in target ? target[key as keyof typeof target] : String(key); },
  });
  return {
    db: { select: vi.fn(), update: vi.fn(), transaction: vi.fn(), insert: vi.fn() },
    tx: { select: vi.fn(), update: vi.fn(), insert: vi.fn() },
    tables: {
      salesOrders: table("salesOrders"), purchaseOrders: table("purchaseOrders"),
      deliveries: table("deliveries"), receipts: table("receipts"),
      salesReturns: table("salesReturns"),
      invoices: table("invoices"), items: table("items"),
      customers: table("customers"), suppliers: table("suppliers"),
      activities: table("activities"), templates: table("templates"),
      notifications: table("notifications"),
    },
    syncJournal: vi.fn(),
  };
});

vi.mock("@workspace/erp-db", () => ({
  db: mocks.db,
  salesOrdersTable: mocks.tables.salesOrders, purchaseOrdersTable: mocks.tables.purchaseOrders,
  deliveryNotesTable: mocks.tables.deliveries, purchaseReceiptsTable: mocks.tables.receipts,
  salesReturnsTable: mocks.tables.salesReturns,
  invoicesTable: mocks.tables.invoices, itemsTable: mocks.tables.items,
  customersTable: mocks.tables.customers, suppliersTable: mocks.tables.suppliers,
  activitiesTable: mocks.tables.activities, orderTemplatesTable: mocks.tables.templates,
  notificationsTable: mocks.tables.notifications,
}));
vi.mock("../../middleware/require-auth", () => ({
  requireAuth: (_req: unknown, _res: unknown, next: () => void) => next(),
  requireRole: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));
vi.mock("../../lib/template-check", () => ({ validateTemplateForProject: vi.fn(async () => null) }));
vi.mock("../../lib/auto-journal", () => ({
  syncSalesOrderJournalEntry: mocks.syncJournal,
  getLockDate: vi.fn(async () => null),
  REVENUE_ORDER_STATUSES: ["Confirmed", "To Deliver", "Completed"],
}));
vi.mock("../../lib/credit-limit", () => ({ assertCreditLimit: vi.fn(async () => undefined) }));
vi.mock("../../utils/approval-helper", () => ({ createApprovalRequest: vi.fn(), approvalBlockReason: vi.fn(async () => null) }));

import salesOrdersRouter from "../sales-orders";
import purchaseOrdersRouter from "../purchase-orders";

function query(rows: any[]) {
  const chain: any = {
    from: (table: unknown) => { chain.table = table; return chain; },
    where: () => chain, for: () => chain, orderBy: () => chain,
    then: (resolve: (value: any[]) => unknown) => Promise.resolve(rows).then(resolve),
  };
  return chain;
}

function updateResult(row: any) {
  return { set: () => ({ where: () => ({ returning: async () => [row] }) }) };
}

describe("sales and purchase order status PATCH guards", () => {
  let server: Server;
  let baseUrl: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    mocks.db.transaction.mockImplementation(async (callback: (tx: typeof mocks.tx) => unknown) => callback(mocks.tx));
    mocks.tx.update.mockImplementation((table: unknown) => updateResult({
      id: 1, status: "Confirmed", totalAmount: "100", table,
    }));
    mocks.syncJournal.mockResolvedValue(null);
    const app = express();
    app.use(express.json(), salesOrdersRouter, purchaseOrdersRouter);
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

  async function patch(path: string, status: string) {
    const response = await fetch(baseUrl + path, {
      method: "PATCH", headers: { "content-type": "application/json" },
      body: JSON.stringify({ status }),
    });
    return { status: response.status, body: await response.json() as { error?: string } };
  }

  it("rejects unknown sales and purchase statuses without updating", async () => {
    const sales = { id: 1, status: "Draft", items: [{ itemId: 7, quantity: 1, isVirtual: false }] };
    mocks.tx.select.mockReturnValue(query([sales]));
    const salesResponse = await patch("/sales-orders/1", "Hacked");
    expect(salesResponse.status).toBe(400);
    expect(salesResponse.body.error).toContain("未知");

    const purchase = { id: 2, status: "Draft", items: [{ itemId: 8, quantity: 1 }] };
    mocks.db.select.mockReturnValue(query([purchase]));
    mocks.tx.select.mockReturnValue(query([purchase]));
    const purchaseResponse = await patch("/purchase-orders/2", "Hacked");
    expect(purchaseResponse.status).toBe(400);
    expect(purchaseResponse.body.error).toContain("未知");
    expect(mocks.tx.update).not.toHaveBeenCalled();
  });

  it("rejects direct Completed when physical sales delivery is incomplete", async () => {
    const order = { id: 1, status: "Confirmed", items: [{ itemId: 7, quantity: 2, isVirtual: false }] };
    mocks.tx.select.mockImplementation(() => {
      const chain = query([]);
      const originalFrom = chain.from;
      chain.from = (table: unknown) => {
        originalFrom(table);
        if (table === mocks.tables.salesOrders) chain.then = (resolve: (value: any[]) => unknown) => Promise.resolve([order]).then(resolve);
        return chain;
      };
      return chain;
    });
    const response = await patch("/sales-orders/1", "Completed");
    expect(response.status).toBe(400);
    expect(response.body.error).toContain("尚未全部出貨");
    expect(mocks.tx.update).not.toHaveBeenCalled();
  });

  it("rejects purchase Completed until submitted receipts cover every item", async () => {
    const order = { id: 2, status: "To Receive", items: [{ itemId: 8, quantity: 3 }] };
    mocks.db.select.mockReturnValue(query([order]));
    mocks.tx.select.mockImplementation(() => {
      const chain = query([]);
      const originalFrom = chain.from;
      chain.from = (table: unknown) => {
        originalFrom(table);
        const rows = table === mocks.tables.purchaseOrders ? [order]
          : table === mocks.tables.receipts ? [{ items: [{ itemId: 8, quantity: 2 }] }] : [];
        chain.then = (resolve: (value: any[]) => unknown) => Promise.resolve(rows).then(resolve);
        return chain;
      };
      return chain;
    });
    const response = await patch("/purchase-orders/2", "Completed");
    expect(response.status).toBe(400);
    expect(response.body.error).toContain("尚未全部收貨");
    expect(mocks.tx.update).not.toHaveBeenCalled();
  });

  it("allows Completed only when existing derived fulfillment rules are satisfied", async () => {
    const sales = { id: 1, status: "To Deliver", items: [{ itemId: 7, quantity: 2, isVirtual: false }] };
    mocks.tx.select.mockImplementation(() => {
      const chain = query([]);
      const originalFrom = chain.from;
      chain.from = (table: unknown) => {
        originalFrom(table);
        const rows = table === mocks.tables.salesOrders ? [sales]
          : table === mocks.tables.deliveries ? [{ items: [{ itemId: 7, quantity: 2 }] }] : [];
        chain.then = (resolve: (value: any[]) => unknown) => Promise.resolve(rows).then(resolve);
        return chain;
      };
      return chain;
    });
    expect((await patch("/sales-orders/1", "Completed")).status).toBe(200);

    const purchase = { id: 2, status: "To Receive", items: [{ itemId: 8, quantity: 3 }] };
    mocks.db.select.mockReturnValue(query([purchase]));
    mocks.tx.select.mockImplementation(() => {
      const chain = query([]);
      const originalFrom = chain.from;
      chain.from = (table: unknown) => {
        originalFrom(table);
        const rows = table === mocks.tables.purchaseOrders ? [purchase]
          : table === mocks.tables.receipts ? [{ items: [{ itemId: 8, quantity: 3 }] }] : [];
        chain.then = (resolve: (value: any[]) => unknown) => Promise.resolve(rows).then(resolve);
        return chain;
      };
      return chain;
    });
    mocks.tx.update.mockImplementation((table: unknown) => updateResult({ id: 2, status: "Completed", totalAmount: "100", table }));
    expect((await patch("/purchase-orders/2", "Completed")).status).toBe(200);
  });

  it("blocks cancellation while a non-cancelled downstream document exists", async () => {
    const order = { id: 1, status: "Confirmed", items: [] };
    mocks.tx.select.mockImplementation(() => {
      const chain = query([]);
      const originalFrom = chain.from;
      chain.from = (table: unknown) => {
        originalFrom(table);
        const rows = table === mocks.tables.salesOrders ? [order]
          : table === mocks.tables.deliveries ? [{ id: 55 }] : [];
        chain.then = (resolve: (value: any[]) => unknown) => Promise.resolve(rows).then(resolve);
        return chain;
      };
      return chain;
    });
    const response = await patch("/sales-orders/1", "Cancelled");
    expect(response.status).toBe(400);
    expect(response.body.error).toContain("下游單據");
    expect(mocks.tx.update).not.toHaveBeenCalled();
  });

  it("retains compatible Draft to confirmed/to-receive transitions", async () => {
    const sales = { id: 1, status: "Draft", items: [] };
    mocks.tx.select.mockReturnValue(query([sales]));
    expect((await patch("/sales-orders/1", "Confirmed")).status).toBe(200);

    const purchase = { id: 2, status: "Draft", items: [] };
    mocks.db.select.mockReturnValue(query([purchase]));
    mocks.tx.select.mockReturnValue(query([purchase]));
    mocks.tx.update.mockImplementation((table: unknown) => updateResult({ id: 2, status: "To Receive", totalAmount: "100", table }));
    expect((await patch("/purchase-orders/2", "To Receive")).status).toBe(200);
  });

  it("does not resurrect completed or cancelled orders through manual PATCH", async () => {
    const completed = { id: 1, status: "Completed", items: [] };
    mocks.tx.select.mockReturnValue(query([completed]));
    expect((await patch("/sales-orders/1", "Draft")).status).toBe(400);

    const cancelled = { id: 2, status: "Cancelled", items: [] };
    mocks.db.select.mockReturnValue(query([cancelled]));
    mocks.tx.select.mockReturnValue(query([cancelled]));
    expect((await patch("/purchase-orders/2", "Draft")).status).toBe(400);
    expect(mocks.tx.update).not.toHaveBeenCalled();
  });
});