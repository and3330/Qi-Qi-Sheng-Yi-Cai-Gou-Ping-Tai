import { describe, expect, it } from "vitest";
import {
  getEcpayInvoiceFormErrors,
  getEcpayOrderId,
  toTaxIncludedInvoiceItem,
  invoiceIntegerErrors,
  type EcpayInvoiceForm,
} from "../ecpay-invoice-form";

describe("integer tax included invoice items", () => {
  it("derives the included price from the original subtotal without changing total", () => {
    const item = toTaxIncludedInvoiceItem({ itemName: "材料費", quantity: 14, rate: 2390.4761905, amount: 35140 });
    expect(item).toEqual({ name: "材料費", count: 14, unitPrice: 2510, amount: 35140 });
    expect(invoiceIntegerErrors([item])).toEqual([]);
  });
  it("preserves non-divisible amounts and blocks instead of rounding", () => {
    const item = toTaxIncludedInvoiceItem({ quantity: 3, rate: 30, amount: 100 });
    expect(item.amount).toBe(100);
    expect(invoiceIntegerErrors([item])).toHaveLength(1);
    expect(invoiceIntegerErrors([{ count: 2, unitPrice: 50, amount: 101 }])).toHaveLength(1);
    expect(invoiceIntegerErrors([{ count: 1.5, unitPrice: 20, amount: 30 }])).toHaveLength(1);
  });
});

describe("getEcpayOrderId", () => {
  it("opens a specific order preview independent of list filters", () => {
    expect(getEcpayOrderId("?ecpay=32922")).toBe(32922);
    expect(getEcpayOrderId("customerId=1&ecpay=42")).toBe(42);
  });
  it("rejects missing, invalid, non-positive and unsafe order ids", () => {
    for (const query of ["", "ecpay=", "ecpay=0", "ecpay=-1", "ecpay=1.5", "ecpay=1/issue", "ecpay=abc", "ecpay=9007199254740992"]) {
      expect(getEcpayOrderId(query)).toBeNull();
    }
  });
});

const completePersonal: EcpayInvoiceForm = {
  invoiceType: "personal",
  customerName: "王小明",
  customerEmail: "buyer@example.com",
  customerPhone: "0912345678",
  customerAddr: "台北市信義區市府路 1 號",
  taxId: "",
  companyTitle: "",
  carrierType: "",
  carrierNum: "",
  loveCode: "",
};

describe("getEcpayInvoiceFormErrors", () => {
  it("requires every common buyer field and a name for personal invoices", () => {
    expect(getEcpayInvoiceFormErrors({
      ...completePersonal,
      customerName: "",
      customerEmail: "",
      customerPhone: "",
      customerAddr: "",
    })).toEqual([
      "買方姓名（必填）",
      "買方地址（必填）",
      "聯絡電話／手機（必填）",
      "Email（必填）",
    ]);
  });

  it("requires a valid email instead of accepting phone as a substitute", () => {
    expect(getEcpayInvoiceFormErrors({
      ...completePersonal,
      customerEmail: "not-an-email",
    })).toContain("Email（格式不正確）");
  });

  it("requires company title and exactly eight tax ID digits", () => {
    const company = {
      ...completePersonal,
      invoiceType: "company" as const,
      customerName: "",
      companyTitle: "範例股份有限公司",
      taxId: "12345678",
    };
    expect(getEcpayInvoiceFormErrors(company)).toEqual([]);
    expect(getEcpayInvoiceFormErrors({ ...company, taxId: "1234 5678" }))
      .toContain("統一編號（需為 8 碼數字）");
    expect(getEcpayInvoiceFormErrors({ ...company, companyTitle: " " }))
      .toContain("公司抬頭（必填）");
  });

  it("keeps donation and personal carrier format validations", () => {
    const donation = {
      ...completePersonal,
      invoiceType: "donation" as const,
      loveCode: "12A",
      carrierType: "phone_barcode" as const,
      carrierNum: "/ABC+123",
    };
    expect(getEcpayInvoiceFormErrors(donation)).toEqual([
      "愛心碼（需為 3–7 碼數字）",
      "捐贈發票不可使用載具",
    ]);
    expect(getEcpayInvoiceFormErrors({
      ...completePersonal,
      carrierType: "phone_barcode",
      carrierNum: "invalid",
    })).toContain("手機條碼載具（格式不正確）");
  });

  it("rejects leading or trailing whitespace before submission without normalizing the payload", () => {
    expect(getEcpayInvoiceFormErrors({
      ...completePersonal,
      customerEmail: " buyer@example.com ",
    })).toContain("Email（請移除前後空白）");

    expect(getEcpayInvoiceFormErrors({
      ...completePersonal,
      invoiceType: "company",
      customerName: "",
      companyTitle: "範例股份有限公司",
      taxId: " 12345678 ",
    })).toContain("統一編號（請移除前後空白）");

    expect(getEcpayInvoiceFormErrors({
      ...completePersonal,
      carrierType: "phone_barcode",
      carrierNum: " /ABC+123 ",
    })).toContain("載具號碼（請移除前後空白）");

    expect(getEcpayInvoiceFormErrors({
      ...completePersonal,
      invoiceType: "donation",
      loveCode: " 168 ",
    })).toContain("愛心碼（請移除前後空白）");
  });
});