import { describe, expect, it } from "vitest";
import {
  COMPANY_CODE_ERROR,
  companyCodeValidationMessage,
  normalizeCompanyCode,
} from "../company-code";

describe("company code validation", () => {
  it("accepts exactly eight ASCII digits and preserves leading zeros", () => {
    expect(companyCodeValidationMessage("00123456")).toBeNull();
    expect(normalizeCompanyCode(" 00123456 ")).toBe("00123456");
  });

  it("rejects other lengths, non-digits, and full-width digits", () => {
    expect(companyCodeValidationMessage("1234567")).toBe(COMPANY_CODE_ERROR);
    expect(companyCodeValidationMessage("123456789")).toBe(COMPANY_CODE_ERROR);
    expect(companyCodeValidationMessage("1234A678")).toBe(COMPANY_CODE_ERROR);
    expect(companyCodeValidationMessage("１２３４５６７８")).toBe(COMPANY_CODE_ERROR);
  });
});