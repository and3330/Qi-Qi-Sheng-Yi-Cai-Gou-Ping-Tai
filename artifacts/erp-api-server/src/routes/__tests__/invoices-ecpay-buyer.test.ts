import crypto from "node:crypto";
import express from "express";
import type { Server } from "node:http";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  transaction: vi.fn(),
  dbSelect: vi.fn(),
  dbUpdate: vi.fn(),
  issueInvoice: vi.fn(),
  assertVatAccountsReady: vi.fn(),
  assertPeriodOpen: vi.fn(),
  createInvoiceJournalEntry: vi.fn(),
  deleteInvoiceJournalEntry: vi.fn(),
}));

vi.mock("@workspace/erp-db", () => ({
  db: {
    transaction: mocks.transaction,
    select: mocks.dbSelect,
    update: mocks.dbUpdate,
    insert: vi.fn(),
    delete: vi.fn(),
  },
  invoicesTable: {},
  ecpayInvoiceAllowancesTable: {},
  ecpayInvoiceIssueRequestsTable: {},
  invoiceSettlementsTable: {},
  customersTable: {},
  suppliersTable: {},
  itemsTable: {},
  activitiesTable: {},
  salesOrdersTable: {},
  deliveryNotesTable: {},
  journalEntriesTable: {},
  salesReturnsTable: {},
  purchaseReturnsTable: {},
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn(() => ({})),
  and: vi.fn(() => ({})),
  inArray: vi.fn(() => ({})),
  isNull: vi.fn(() => ({})),
  ne: vi.fn(() => ({})),
  sql: vi.fn(() => ({})),
}));

vi.mock("../../middleware/require-auth", () => ({
  requireAuth: (_req: unknown, _res: unknown, next: () => void) => next(),
  requireRole: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));
vi.mock("../../middleware/tenant-context", () => ({ reqTenantId: () => 1 }));
vi.mock("../../lib/ecpay-invoice", () => ({
  issueInvoice: mocks.issueInvoice,
  voidInvoice: vi.fn(),
  queryInvoice: vi.fn(),
  queryInvoiceByRelateNumber: vi.fn(),
  issueAllowance: vi.fn(),
  voidAllowance: vi.fn(),
  queryAllowance: vi.fn(),
  queryVoidedAllowance: vi.fn(),
}));
vi.mock("../../lib/auto-journal", () => ({
  assertVatAccountsReady: mocks.assertVatAccountsReady,
  assertPeriodOpen: mocks.assertPeriodOpen,
  createInvoiceJournalEntry: mocks.createInvoiceJournalEntry,
  deleteInvoiceJournalEntry: mocks.deleteInvoiceJournalEntry,
  getLockDate: vi.fn(),
  resolveJournalLines: vi.fn(),
  syncSalesOrderJournalEntry: vi.fn(),
}));
vi.mock("../../lib/invoice-sync", () => ({
  recomputeInvoices: vi.fn(),
  syncSalesOrderCompletion: vi.fn(),
}));
vi.mock("../../lib/email", () => ({ autoSendInvoiceEmail: vi.fn() }));
vi.mock("../../lib/friendly-errors", () => ({
  friendlyCaughtError: (error: Error) => error.message,
  friendlyValidationError: vi.fn(),
}));

import invoicesRouter from "../invoices";

function queryResult(rows: unknown[]) {
  const builder: any = {
    from: () => builder,
    leftJoin: () => builder,
    where: () => builder,
    orderBy: () => builder,
    limit: () => builder,
    for: () => builder,
    returning: () => builder,
    set: () => builder,
    values: () => builder,
    then: (resolve: (value: unknown[]) => unknown, reject: (reason: unknown) => unknown) =>
      Promise.resolve(rows).then(resolve, reject),
  };
  return builder;
}

const order = {
  id: 12,
  orderNumber: "SO-12",
  customerId: 7,
  totalAmount: "100",
  items: [{ name: "服務", count: 1, unitPrice: 100, amount: 100 }],
};

const completeBody = {
  invoiceType: "personal",
  customerName: "王小明",
  customerAddr: "台北市信義路 1 號",
  customerPhone: "0912345678",
  customerEmail: "buyer@example.com",
};

describe("ECPay issue route buyer preflight", () => {
  let server: Server;
  let baseUrl: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    const app = express();
    app.use(express.json());
    app.use(invoicesRouter);
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

  async function post(body: Record<string, unknown>, key = "buyer-test-key") {
    return fetch(`${baseUrl}/sales-orders/12/issue-ecpay-invoice`, {
      method: "POST",
      headers: { "content-type": "application/json", "Idempotency-Key": key },
      body: JSON.stringify(body),
    });
  }

  async function patchInvoice(id: number, body: Record<string, unknown>) {
    return fetch(`${baseUrl}/invoices/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  const accountingInvoice = {
    id: 44,
    invoiceNumber: "INV-44",
    invoiceType: "Sales",
    invoiceDate: "2026-08-11",
    totalAmount: "105",
    paidAmount: "0",
    outstandingAmount: "105",
    exchangeRate: "1",
    taxType: "taxable",
    taxRate: "0.05",
    taxAmount: "5",
    status: "Unpaid",
    journalEntryId: 144,
    ecpayInvoiceNumber: null,
    salesOrderId: null,
  };

  it("rejects status-only Paid without creating settlement-derived amounts", async () => {
    mocks.dbSelect.mockReturnValueOnce(queryResult([accountingInvoice]));

    const response = await patchInvoice(accountingInvoice.id, { status: "Paid" });

    expect(response.status).toBe(400);
    expect((await response.json() as { error: string }).error).toContain("沖帳紀錄自動計算");
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("refuses invoice cancellation when settlement ledger has a row despite stale paidAmount zero", async () => {
    mocks.dbSelect.mockReturnValueOnce(queryResult([accountingInvoice]));
    const txSelect = vi.fn()
      .mockReturnValueOnce(queryResult([accountingInvoice]))
      .mockReturnValueOnce(queryResult([{ id: 501 }]));
    const tx = { select: txSelect, update: vi.fn(), insert: vi.fn(), delete: vi.fn() };
    mocks.transaction.mockImplementation(async callback => callback(tx));

    const response = await patchInvoice(accountingInvoice.id, { status: "Cancelled" });

    expect(response.status).toBe(400);
    expect((await response.json() as { error: string }).error).toContain("已有沖帳紀錄");
    expect(mocks.assertPeriodOpen).toHaveBeenCalledWith(tx, accountingInvoice.invoiceDate, "修改發票");
    expect(tx.update).not.toHaveBeenCalled();
    expect(mocks.deleteInvoiceJournalEntry).not.toHaveBeenCalled();
  });

  it("refuses direct cancellation of a credit note owned by a sales return", async () => {
    const creditNote = { ...accountingInvoice, invoiceType: "Credit Note", invoiceNumber: "CN-44" };
    mocks.dbSelect.mockReturnValueOnce(queryResult([creditNote]));
    const txSelect = vi.fn()
      .mockReturnValueOnce(queryResult([creditNote]))
      .mockReturnValueOnce(queryResult([{ id: 7 }]));
    const tx = { select: txSelect, update: vi.fn(), insert: vi.fn(), delete: vi.fn() };
    mocks.transaction.mockImplementation(async callback => callback(tx));

    const response = await patchInvoice(creditNote.id, { status: "Cancelled" });

    expect(response.status).toBe(400);
    expect((await response.json() as { error: string }).error).toContain("請由原退貨單執行取消");
    expect(tx.update).not.toHaveBeenCalled();
    expect(mocks.deleteInvoiceJournalEntry).not.toHaveBeenCalled();
  });

  it("rebuilds an existing journal when tax classification changes but gross total does not", async () => {
    mocks.dbSelect.mockReturnValueOnce(queryResult([accountingInvoice]));
    const exempt = { ...accountingInvoice, taxType: "exempt", taxAmount: "0", netAmount: "105" };
    const txSelect = vi.fn()
      .mockReturnValueOnce(queryResult([accountingInvoice]))
      .mockReturnValueOnce(queryResult([exempt]));
    const txUpdate = vi.fn(() => queryResult([exempt]));
    const tx = { select: txSelect, update: txUpdate, insert: vi.fn(), delete: vi.fn() };
    mocks.transaction.mockImplementation(async callback => callback(tx));

    const response = await patchInvoice(accountingInvoice.id, { taxType: "exempt" });

    expect(response.status).toBe(200);
    expect(mocks.deleteInvoiceJournalEntry).toHaveBeenCalledOnce();
    expect(mocks.createInvoiceJournalEntry).toHaveBeenCalledOnce();
    expect(mocks.createInvoiceJournalEntry).toHaveBeenCalledWith(tx, expect.objectContaining({
      totalAmount: "105",
      taxType: "exempt",
    }));
  });

  it("does not insert an operation or call ECPay when buyer data is incomplete", async () => {
    mocks.dbSelect.mockReturnValueOnce(queryResult([order]));
    const insert = vi.fn();
    const txSelect = vi.fn()
      .mockReturnValueOnce(queryResult([order]))
      .mockReturnValueOnce(queryResult([]));
    mocks.transaction.mockImplementation(async callback => callback({ select: txSelect, insert }));

    const response = await post({
      ...completeBody,
      customerName: " ",
      customerAddr: " ",
      customerPhone: " ",
      customerEmail: "bad-email",
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "買方資料不完整：買方姓名、買方地址、買方電話、買方 Email（格式不正確）",
    });
    expect(insert).not.toHaveBeenCalled();
    expect(mocks.assertVatAccountsReady).not.toHaveBeenCalled();
    expect(mocks.issueInvoice).not.toHaveBeenCalled();
  });

  it.each([
    ["email", { ...completeBody, customerEmail: " buyer@example.com " }, "買方 Email（請移除前後空白）"],
    ["tax ID", {
      invoiceType: "company",
      companyTitle: "測試股份有限公司",
      taxId: " 12345678 ",
      customerAddr: completeBody.customerAddr,
      customerPhone: completeBody.customerPhone,
      customerEmail: completeBody.customerEmail,
    }, "統一編號（請移除前後空白）"],
    ["love code", {
      ...completeBody,
      invoiceType: "donation",
      loveCode: " 168001 ",
    }, "愛心碼（請移除前後空白）"],
    ["carrier number", {
      ...completeBody,
      carrierType: "phone_barcode",
      carrierNum: " /ABC1234 ",
    }, "載具號碼（請移除前後空白）"],
  ])("rejects whitespace around %s before persistence", async (_case, body, issue) => {
    mocks.dbSelect.mockReturnValueOnce(queryResult([order]));
    const insert = vi.fn();
    const txSelect = vi.fn()
      .mockReturnValueOnce(queryResult([order]))
      .mockReturnValueOnce(queryResult([]));
    mocks.transaction.mockImplementation(async callback => callback({ select: txSelect, insert }));

    const response = await post(body);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: `買方資料不完整：${issue}` });
    expect(insert).not.toHaveBeenCalled();
    expect(mocks.issueInvoice).not.toHaveBeenCalled();
  });

  it("prepares and sends an all-complete new operation", async () => {
    mocks.dbSelect.mockReturnValueOnce(queryResult([order]));
    const operation = {
      id: 31,
      relateNumber: "T1Kaccepted",
      status: "Prepared",
      requestPayload: { ...completeBody, invoiceType: "personal", salesAmount: 100, items: order.items },
    };
    const txSelect = vi.fn()
      .mockReturnValueOnce(queryResult([order]))
      .mockReturnValueOnce(queryResult([]))
      .mockReturnValueOnce(queryResult([]))
      .mockReturnValueOnce(queryResult([]));
    const insert = vi.fn(() => queryResult([operation]));
    mocks.transaction.mockImplementation(async callback => callback({ select: txSelect, insert }));
    mocks.dbUpdate
      .mockReturnValueOnce(queryResult([{ ...operation, status: "Sending" }]))
      .mockReturnValueOnce(queryResult([]));
    mocks.issueInvoice.mockResolvedValue({ success: false, message: "provider rejected test request" });

    const response = await post(completeBody);

    expect(response.status).toBe(400);
    expect(insert).toHaveBeenCalledOnce();
    expect(mocks.assertVatAccountsReady).toHaveBeenCalledOnce();
    expect(mocks.issueInvoice).toHaveBeenCalledOnce();
  });

  it("bypasses new completeness rules for a matching persisted historical operation", async () => {
    const historicalBody = { ...completeBody, customerAddr: "", customerPhone: "", customerEmail: "" };
    const requestInput = {
      invoiceType: "personal",
      customerEmail: "",
      customerName: "王小明",
      customerPhone: "",
      customerAddr: "",
      carrierType: "",
      carrierNum: "",
      loveCode: "",
      taxId: "",
      companyTitle: "",
      salesAmount: 100,
      items: order.items,
    };
    const payloadHash = crypto.createHash("sha256").update(JSON.stringify(requestInput)).digest("hex");
    const existingInvoice = { id: 44, totalAmount: "100", paidAmount: "0", outstandingAmount: "100" };
    const existingOperation = {
      id: 32,
      salesOrderId: 12,
      payloadHash,
      status: "Issued",
      invoiceId: 44,
    };
    mocks.dbSelect.mockReturnValueOnce(queryResult([order]));
    const insert = vi.fn();
    const txSelect = vi.fn()
      .mockReturnValueOnce(queryResult([order]))
      .mockReturnValueOnce(queryResult([existingOperation]))
      .mockReturnValueOnce(queryResult([existingInvoice]));
    mocks.transaction.mockImplementation(async callback => callback({ select: txSelect, insert }));

    const response = await post(historicalBody);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ success: true, idempotent: true });
    expect(insert).not.toHaveBeenCalled();
    expect(mocks.issueInvoice).not.toHaveBeenCalled();
  });
});