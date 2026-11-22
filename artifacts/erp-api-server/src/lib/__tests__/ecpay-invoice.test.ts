import { describe, expect, it, vi } from "vitest";
import {
  aesDecrypt,
  aesEncrypt,
  aesUrlEncode,
  getInvoiceConfig,
  issueAllowance,
  issueInvoice,
  queryInvoice,
  queryInvoiceByRelateNumber,
  queryVoidedAllowance,
  sanitizeEcpayResponse,
  voidAllowance,
  printInvoice,
} from "../ecpay-invoice";
import { assertIntegerInvoiceItems } from "../ecpay-integer-items";

const config = {
  merchantId: "2000132",
  hashKey: "ejCk326UnaZWKisg",
  hashIV: "q9jcZX8Ib9LM8wYk",
  apiUrl: "https://einvoice-stage.ecpay.com.tw",
  isTest: true,
};
const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

describe("integer tax included invoice validation", () => {
  it("allows integer prices and rejects mismatches and rounding", () => {
    expect(() => assertIntegerInvoiceItems([{ count: 14, unitPrice: 2510, amount: 35140 }])).not.toThrow();
    for (const item of [
      { count: 3, unitPrice: 100 / 3, amount: 100 },
      { count: 3, unitPrice: 33, amount: 100 },
      { count: 1.5, unitPrice: 20, amount: 30 },
    ]) expect(() => assertIntegerInvoiceItems([item])).toThrow(/含稅/);
  });
});

describe("official invoice printing", () => {
  it("sends the B2B A4 format without issuing a new invoice", async () => {
    const fetch = mockFetch({ RtnCode: 1, InvoiceHtml: "https://einvoice-stage.ecpay.com.tw/print/a4" });
    expect((await printInvoice("AB12345678", "2026-11-19", { config, fetch, log }, 4)).success).toBe(true);
    expect(decryptedRequest(fetch).data.PrintStyle).toBe(4);
    expect(decryptedRequest(fetch).url).toContain("/InvoicePrint");
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("requests only InvoicePrint with details and returns the official URL", async () => {
    const fetch = mockFetch({ RtnCode: 1, InvoiceHtml: "https://einvoice-stage.ecpay.com.tw/print/example" });
    const result = await printInvoice("AB12345678", "2026-11-19", { config, fetch, log });
    expect(result.success).toBe(true);
    expect(decryptedRequest(fetch).url).toBe(`${config.apiUrl}/B2CInvoice/InvoicePrint`);
    expect(decryptedRequest(fetch).data).toMatchObject({ InvoiceNo: "AB12345678", PrintStyle: 1, IsShowingDetail: 1 });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("rejects internal numbers before any network request", async () => {
    const fetch = mockFetch({ RtnCode: 1 });
    expect((await printInvoice("SINV-123", "2026-11-19", { config, fetch, log })).success).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
  });
  it("does not expose unsafe URLs, missing links or upstream failures", async () => {
    for (const reply of [
      { RtnCode: 1, InvoiceHtml: "https://ecpay.com.tw.evil.example/print" },
      { RtnCode: 1, InvoiceHtml: "http://einvoice.ecpay.com.tw/print" },
      { RtnCode: 1 },
      { RtnCode: 999, RtnMsg: "列印失敗" },
    ]) expect((await printInvoice("AB12345678", "2026-11-19", { config, fetch: mockFetch(reply), log })).success).toBe(false);
  });
});

function mockFetch(reply: Record<string, unknown>) {
  return vi.fn(async () => new Response(JSON.stringify({
    TransCode: 1,
    TransMsg: "Success",
    Data: aesEncrypt(JSON.stringify(reply), config.hashKey, config.hashIV),
  }), { status: 200, headers: { "Content-Type": "application/json" } }));
}

function decryptedRequest(fetchMock: ReturnType<typeof mockFetch>) {
  const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
  const envelope = JSON.parse(String(init.body));
  return {
    url,
    envelope,
    data: JSON.parse(aesDecrypt(envelope.Data, config.hashKey, config.hashIV)),
  };
}

describe("ECPay invoice AES client", () => {
  it("requires explicit credentials and only opts into stage explicitly", () => {
    expect(() => getInvoiceConfig({})).toThrow(/尚未設定/);
    expect(getInvoiceConfig({
      ECPAY_INVOICE_MERCHANT_ID: "m",
      ECPAY_INVOICE_HASH_KEY: config.hashKey,
      ECPAY_INVOICE_HASH_IV: config.hashIV,
      ECPAY_INVOICE_ENV: "sandbox",
    }).apiUrl).toBe(config.apiUrl);
  });

  it("uses ECPay/PHP-compatible URL encoding before AES", () => {
    expect(aesUrlEncode("中文 空格~!*()'")).toBe(
      "%E4%B8%AD%E6%96%87+%E7%A9%BA%E6%A0%BC%7E%21%2A%28%29%27",
    );
    const source = JSON.stringify({ name: "測試 商品+服務" });
    expect(aesDecrypt(aesEncrypt(source, config.hashKey, config.hashIV), config.hashKey, config.hashIV)).toBe(source);
  });

  it("maps invoice issue to Revision 3.0.0 and official Issue endpoint", async () => {
    const fetchMock = mockFetch({
      RtnCode: 1, RtnMsg: "Success", InvoiceNo: "AB12345678",
      InvoiceDate: "2026-01-02", RandomNumber: "1234",
    });
    const result = await issueInvoice({
      relateNumber: "SO-1",
      customerEmail: "buyer@example.com",
      invoiceType: "personal",
      salesAmount: 105,
      items: [{ name: "商品", count: 1, unitPrice: 105, amount: 105 }],
    }, { config, fetch: fetchMock as typeof fetch, log, now: () => 1_700_000_000_000 });
    const request = decryptedRequest(fetchMock);
    expect(request.url).toBe(`${config.apiUrl}/B2CInvoice/Issue`);
    expect(request.envelope.RqHeader).toEqual({ Timestamp: 1_700_000_000, Revision: "3.0.0" });
    expect(request.data).toMatchObject({
      MerchantID: config.merchantId, RelateNumber: "SO-1", SalesAmount: 105,
      Items: [{ ItemSeq: 1, ItemWord: "式", ItemAmount: 105 }],
    });
    expect(result).toMatchObject({ success: true, invoiceNumber: "AB12345678", randomNumber: "1234" });
    expect(result.rawResponse).not.toHaveProperty("CustomerEmail");
  });

  it("maps query, allowance issue and allowance invalid to official B2C fields", async () => {
    const queryFetch = mockFetch({
      RtnCode: 1, RtnMsg: "Success", InvoiceStatus: "1",
      InvoiceNo: "AB12345678",
      IIS_Sales_Amount: 105, IIS_Remain_Allowance_Amt: 55,
    });
    const queried = await queryInvoice("AB12345678", "2026-01-02", { config, fetch: queryFetch as typeof fetch, log });
    expect(decryptedRequest(queryFetch)).toMatchObject({
      url: `${config.apiUrl}/B2CInvoice/GetIssue`,
      data: { MerchantID: config.merchantId, InvoiceNo: "AB12345678", InvoiceDate: "2026-01-02" },
    });
    expect(queried).toMatchObject({ salesAmount: 105, remainingAllowanceAmount: 55 });

    const relationFetch = mockFetch({
      RtnCode: 1, RtnMsg: "Success", IIS_Number: "AB12345678",
      IIS_Create_Date: "2026-01-02 10:20:30", IIS_Random_Number: "2468",
      IIS_Relate_Number: "T1KABC", IIS_Sales_Amount: 105, IIS_Issue_Status: "1",
    });
    const related = await queryInvoiceByRelateNumber("T1KABC", { config, fetch: relationFetch as typeof fetch, log });
    expect(decryptedRequest(relationFetch)).toMatchObject({
      url: `${config.apiUrl}/B2CInvoice/GetIssue`,
      data: { MerchantID: config.merchantId, RelateNumber: "T1KABC" },
    });
    expect(related).toMatchObject({
      success: true, invoiceNumber: "AB12345678", randomNumber: "2468",
      relateNumber: "T1KABC", salesAmount: 105, invoiceStatus: "Issued",
    });

    const allowanceFetch = mockFetch({ RtnCode: 1, RtnMsg: "Success", AllowanceNo: "202601020001", AllowanceAmount: 50 });
    const allowance = await issueAllowance({
      invoiceNumber: "AB12345678", invoiceDate: "2026-01-02", amount: 50,
      reason: "商品退回", notify: "N", items: [{ name: "退貨", count: 1, unitPrice: 50, amount: 50 }],
    }, { config, fetch: allowanceFetch as typeof fetch, log });
    expect(decryptedRequest(allowanceFetch)).toMatchObject({
      url: `${config.apiUrl}/B2CInvoice/Allowance`,
      data: {
        InvoiceNo: "AB12345678", InvoiceDate: "2026-01-02",
        AllowanceNotify: "N", AllowanceAmount: 50, Reason: "商品退回",
        Items: [{ ItemSeq: 1, ItemName: "退貨", ItemTaxType: "1", ItemAmount: 50 }],
      },
    });
    expect(allowance.allowanceNumber).toBe("202601020001");

    const voidFetch = mockFetch({ RtnCode: 1, RtnMsg: "Success" });
    await voidAllowance("AB12345678", "202601020001", "輸入錯誤", { config, fetch: voidFetch as typeof fetch, log });
    expect(decryptedRequest(voidFetch)).toMatchObject({
      url: `${config.apiUrl}/B2CInvoice/AllowanceInvalid`,
      data: { InvoiceNo: "AB12345678", AllowanceNo: "202601020001", Reason: "輸入錯誤" },
    });

    const queryVoidedFetch = mockFetch({ RtnCode: 1, RtnMsg: "Success", AllowanceAmount: 50 });
    const voided = await queryVoidedAllowance("AB12345678", "202601020001", {
      config, fetch: queryVoidedFetch as typeof fetch, log,
    });
    expect(decryptedRequest(queryVoidedFetch)).toMatchObject({
      url: `${config.apiUrl}/B2CInvoice/GetAllowanceInvalid`,
      data: { MerchantID: config.merchantId, InvoiceNo: "AB12345678", AllowanceNo: "202601020001" },
    });
    expect(voided).toMatchObject({ success: true, allowanceAmount: 50 });
  });

  it("sanitizes data before persistence and handles HTTP errors without response bodies", async () => {
    expect(sanitizeEcpayResponse({
      RtnCode: 1, InvoiceNo: "AB12345678", CustomerEmail: "secret@example.com",
    })).toEqual({ RtnCode: 1, InvoiceNo: "AB12345678" });
    const fetchMock = vi.fn(async () => new Response("upstream secret body", { status: 503 }));
    const result = await queryInvoice("AB12345678", "2026-01-02", {
      config, fetch: fetchMock as typeof fetch, log,
    });
    expect(result).toMatchObject({ success: false, outcomeUnknown: true, message: "ECPay HTTP 503" });
    expect(JSON.stringify(result)).not.toContain("upstream secret body");
  });

  it("treats incomplete successful mutation responses as outcome unknown", async () => {
    const issueFetch = mockFetch({ RtnCode: 1, RtnMsg: "Success" });
    const issue = await issueInvoice({
      relateNumber: "T1KABC",
      customerEmail: "buyer@example.com",
      invoiceType: "personal",
      salesAmount: 100,
      items: [{ name: "商品", count: 1, unitPrice: 100, amount: 100 }],
    }, { config, fetch: issueFetch as typeof fetch, log });
    expect(issue).toMatchObject({ success: false, outcomeUnknown: true });

    const allowanceFetch = mockFetch({ RtnCode: 1, RtnMsg: "Success", AllowanceAmount: 50 });
    const allowance = await issueAllowance({
      invoiceNumber: "AB12345678",
      invoiceDate: "2026-01-02",
      amount: 50,
      notify: "N",
      items: [{ name: "退貨", count: 1, unitPrice: 50, amount: 50 }],
    }, { config, fetch: allowanceFetch as typeof fetch, log });
    expect(allowance).toMatchObject({ success: false, outcomeUnknown: true });
  });

  it("rejects invalid issue and allowance inputs before any network call", async () => {
    const fetchMock = vi.fn();
    const issue = await issueInvoice({
      relateNumber: "SO-1", customerEmail: "", invoiceType: "company",
      taxId: "123", salesAmount: 100,
      items: [{ name: "商品", count: 1, unitPrice: 100, amount: 100 }],
    }, { config, fetch: fetchMock as typeof fetch, log });
    const allowance = await issueAllowance({
      invoiceNumber: "AB12345678", invoiceDate: "2026-01-02", amount: 100,
      notify: "E", items: [{ name: "退貨", count: 1, unitPrice: 50, amount: 50 }],
    }, { config, fetch: fetchMock as typeof fetch, log });
    expect(issue.success).toBe(false);
    expect(allowance).toMatchObject({ success: false, message: expect.stringContaining("合計") });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});