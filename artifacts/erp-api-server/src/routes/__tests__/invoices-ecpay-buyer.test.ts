import crypto from "node:crypto";
import express from "express";
import type { Server } from "node:http";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  transaction: vi.fn(),
  dbSelect: vi.fn(),
  dbUpdate: vi.fn(),
  issueInvoice: vi.fn(),
  printInvoice: vi.fn(),
  renderEcpayPdf: vi.fn(),
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
vi.mock("../../middleware/invoice-permission", () => ({
  requireInvoicePermission: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));
vi.mock("../../lib/ecpay-pdf", () => ({ renderEcpayPdf: mocks.renderEcpayPdf }));
vi.mock("../../lib/ecpay-invoice", () => ({
  printInvoice: mocks.printInvoice,
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

  it("refuses internal-only or voided invoice printing without calling ECPay", async () => {
    for (const invoice of [accountingInvoice, { ...accountingInvoice, ecpayInvoiceNumber: "AB12345678", ecpayInvoiceDate: "2026-11-19", ecpayVoidedAt: new Date() }]) {
      mocks.dbSelect.mockReturnValueOnce(queryResult([invoice]));
      const response = await fetch(`${baseUrl}/invoices/44/ecpay-print`, { method: "POST" });
      expect(response.status).toBe(409);
    }
    expect(mocks.printInvoice).not.toHaveBeenCalled();
    expect(mocks.issueInvoice).not.toHaveBeenCalled();
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("gets print URL for a visible issued invoice without accounting writes", async () => {
    mocks.dbSelect.mockReturnValueOnce(queryResult([{ ...accountingInvoice, ecpayInvoiceNumber: "AB12345678", ecpayInvoiceDate: "2026-11-19 12:00:00" }]));
    mocks.printInvoice.mockResolvedValueOnce({ success: true, url: "https://einvoice.ecpay.com.tw/print/example" });
    const response = await fetch(`${baseUrl}/invoices/44/ecpay-print`, { method: "POST" });
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(mocks.printInvoice).toHaveBeenCalledWith("AB12345678", "2026-11-19", undefined, 1);
    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(mocks.issueInvoice).not.toHaveBeenCalled();
  });

  it("downloads a PDF attachment without issuing or updating accounting", async () => {
    mocks.dbSelect.mockReturnValueOnce(queryResult([{ ...accountingInvoice, ecpayInvoiceNumber: "AB12345678", ecpayInvoiceDate: "2026-11-19", ecpayTaxId: "12345678" }]));
    mocks.printInvoice.mockResolvedValueOnce({ success: true, url: "https://einvoice.ecpay.com.tw/print/example" });
    mocks.renderEcpayPdf.mockResolvedValueOnce(Buffer.from("%PDF-1.7\nfixture"));
    const response = await fetch(`${baseUrl}/invoices/44/ecpay-pdf`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ printStyle: 4 }) });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/pdf");
    expect(response.headers.get("content-disposition")).toBe('attachment; filename="AB12345678.pdf"');
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.text()).toMatch(/^%PDF-/);
    expect(mocks.printInvoice).toHaveBeenCalledWith("AB12345678", "2026-11-19", undefined, 4);
    expect(mocks.renderEcpayPdf).toHaveBeenCalledWith("https://einvoice.ecpay.com.tw/print/example", "AB12345678");
    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(mocks.dbUpdate).not.toHaveBeenCalled();
    expect(mocks.issueInvoice).not.toHaveBeenCalled();
  });

  it("does not render invisible, unissued or cancelled invoices", async () => {
    for (const [rows, status] of [
      [[], 404],
      [[accountingInvoice], 409],
      [[{ ...accountingInvoice, ecpayInvoiceNumber: "AB12345678", ecpayInvoiceDate: "2026-11-19", status: "Cancelled" }], 409],
    ] as const) {
      mocks.dbSelect.mockReturnValueOnce(queryResult([...rows]));
      const response = await fetch(`${baseUrl}/invoices/44/ecpay-pdf`, { method: "POST" });
      expect(response.status).toBe(status);
    }
    expect(mocks.renderEcpayPdf).not.toHaveBeenCalled();
    expect(mocks.printInvoice).not.toHaveBeenCalled();
  });

  it("returns a safe error rather than a broken PDF on rendering failure", async () => {
    mocks.dbSelect.mockReturnValueOnce(queryResult([{ ...accountingInvoice, ecpayInvoiceNumber: "AB12345678", ecpayInvoiceDate: "2026-11-19" }]));
    mocks.printInvoice.mockResolvedValueOnce({ success: true, url: "https://einvoice.ecpay.com.tw/print/example" });
    mocks.renderEcpayPdf.mockRejectedValueOnce(new Error("sensitive browser diagnostic"));
    const response = await fetch(`${baseUrl}/invoices/44/ecpay-pdf`, { method: "POST" });
    expect(response.status).toBe(502);
    expect(await response.text()).not.toContain("sensitive");
  });

  it("returns 404 for invoices outside the tenant-scoped query result", async () => {
    mocks.dbSelect.mockReturnValueOnce(queryResult([]));
    const response = await fetch(`${baseUrl}/invoices/44/ecpay-print`, { method: "POST" });
    expect(response.status).toBe(404);
    expect(mocks.printInvoice).not.toHaveBeenCalled();
  });

  it("only allows A4 for invoices originally issued with a buyer tax ID", async () => {
    const issued = { ...accountingInvoice, ecpayInvoiceNumber: "AB12345678", ecpayInvoiceDate: "2026-11-19" };
    mocks.dbSelect.mockReturnValueOnce(queryResult([issued]));
    const noTaxId = await fetch(`${baseUrl}/invoices/44/ecpay-print`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ printStyle: 4 }) });
    expect(noTaxId.status).toBe(409);
    expect(mocks.printInvoice).not.toHaveBeenCalled();
    mocks.dbSelect.mockReturnValueOnce(queryResult([{ ...issued, ecpayTaxId: "04174495" }]));
    mocks.printInvoice.mockResolvedValueOnce({ success: true, url: "https://einvoice.ecpay.com.tw/print/example" });
    const a4 = await fetch(`${baseUrl}/invoices/44/ecpay-print`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ printStyle: 4 }) });
    expect(a4.status).toBe(200);
    expect(mocks.printInvoice).toHaveBeenCalledWith("AB12345678", "2026-11-19", undefined, 4);
    expect(mocks.issueInvoice).not.toHaveBeenCalled();
  });

  it("rejects unsupported print styles before querying invoices", async () => {
    const response = await fetch(`${baseUrl}/invoices/44/ecpay-print`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ printStyle: 99 }) });
    expect(response.status).toBe(400);
    expect(mocks.dbSelect).not.toHaveBeenCalled();
  });
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