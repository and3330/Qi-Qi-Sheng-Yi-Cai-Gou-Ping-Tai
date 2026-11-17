import { describe, expect, it } from "vitest";
import { missingIssues, normalizeSavedEcpayCustomer } from "../ecpay-buyer";

describe("ECPay buyer safeguards", () => {
  it("reports trimmed required buyer fields and formats", () => {
    expect(missingIssues({
      invoiceType: "company",
      companyTitle: " ",
      taxId: "1234567 ",
      customerAddr: "\t",
      customerPhone: "",
      customerEmail: "invalid",
    })).toEqual([
      "公司抬頭",
      "統一編號（須為 8 碼數字）",
      "買方地址",
      "買方電話",
      "買方 Email（格式不正確）",
      "統一編號（請移除前後空白）",
    ]);

    expect(missingIssues({
      invoiceType: "donation",
      customerName: "王小明",
      customerAddr: "台北市信義路 1 號",
      customerPhone: "0912345678",
      customerEmail: "buyer@example.com",
      loveCode: " ",
    })).toEqual(["愛心碼"]);
  });

  it("rejects leading or trailing whitespace instead of persisting a provider-invalid payload", () => {
    expect(missingIssues({
      invoiceType: "company",
      companyTitle: " 測試股份有限公司 ",
      taxId: " 12345678 ",
      customerAddr: " 台北市信義路 1 號 ",
      customerPhone: " 02-12345678 ",
      customerEmail: " buyer@example.com ",
    })).toEqual([
      "公司抬頭（請移除前後空白）",
      "買方地址（請移除前後空白）",
      "買方電話（請移除前後空白）",
      "買方 Email（請移除前後空白）",
      "統一編號（請移除前後空白）",
    ]);
  });

  it("accepts complete canonical values", () => {
    expect(missingIssues({
      invoiceType: "company",
      companyTitle: "測試股份有限公司",
      taxId: "12345678",
      customerAddr: "台北市信義路 1 號",
      customerPhone: "02-12345678",
      customerEmail: "buyer@example.com",
    })).toEqual([]);
  });

  it("trims saved fields, falls back to mobile, and rejects country-only addresses", () => {
    expect(normalizeSavedEcpayCustomer({
      id: 7,
      name: " 王小明 ",
      shortName: " 小明 ",
      taxId: " 12345678 ",
      country: " 台灣 ",
      city: " 台北市 ",
      address: " ",
      email: " buyer@example.com ",
      phone: " ",
      mobile: " 0912345678 ",
      contactPerson: " 王小姐 ",
    })).toEqual({
      id: 7,
      name: "王小明",
      shortName: "小明",
      taxId: "12345678",
      address: "",
      email: "buyer@example.com",
      phone: "0912345678",
      contactPerson: "王小姐",
    });
  });
});