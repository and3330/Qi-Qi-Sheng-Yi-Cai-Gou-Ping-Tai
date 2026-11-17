import { describe, expect, it } from "vitest";
import { parseAccountConfiguration, previewAccountConfiguration, exportAccountConfiguration } from "../account-configuration";

const row = { accountNumber: "001.0", accountName: "原始銀行名稱", accountType: "Asset" as const, parentCode: null, isGroup: false, cashFlowCategory: "cash" as const };
const config = { version: 1 as const, companyCode: "83483621", accounts: [row] };
const existing = { tenantId: 99, id: 5432, accountNumber: row.accountNumber, accountName: "既有名稱", accountType: "Asset",
  parentAccountId: null, balance: "987.65", isGroup: false, cashFlowCategory: null, createdAt: new Date("2026-01-01"), updatedAt: new Date("2026-01-01") };
describe("portable, additive account configuration", () => {
  it("validates input strictly and never permits balances or database IDs", () => {
    expect(parseAccountConfiguration(config)).toEqual(config);
    expect(() => parseAccountConfiguration({ ...config, accounts: [{ ...row, balance: 500 }] })).toThrow();
    expect(() => parseAccountConfiguration({ ...config, accounts: [row, row] })).toThrow(/重複/);
    expect(() => parseAccountConfiguration({ ...config, accounts: [{ ...row, accountNumber: 1 }] })).toThrow();
  });
  it("exports parent codes rather than IDs, with no balance, tenant ID or dates", () => {
    expect(exportAccountConfiguration("83483621", [existing])).toEqual({
      ...config, accounts: [{ ...row, accountName: "既有名稱", cashFlowCategory: null }],
    });
    expect(() => exportAccountConfiguration("83483621", [{ ...existing, parentAccountId: 42 }])).toThrow(/不存在/);
  });
  it("preserves names and categories, but blocks incompatible structural collisions", () => {
    expect(previewAccountConfiguration(99, "83483621", [existing], config)).toMatchObject({ existing: 1, missing: [], conflicts: [], warnings: [expect.stringContaining("保留")] });
    expect(previewAccountConfiguration(99, "83483621", [{ ...existing, isGroup: true }], config).conflicts).toHaveLength(1);
  });
  it("rejects other companies, dangling parents, non-group parents, and cycles", () => {
    expect(() => previewAccountConfiguration(99, "12345678", [], config)).toThrow(/公司統編/);
    expect(previewAccountConfiguration(99, config.companyCode, [], { ...config, accounts: [{ ...row, parentCode: "absent" }] }).conflicts).toHaveLength(1);
    expect(previewAccountConfiguration(99, config.companyCode, [existing], { ...config, accounts: [{ ...row, accountNumber: "001-1", parentCode: row.accountNumber }] }).conflicts).toHaveLength(1);
    expect(previewAccountConfiguration(99, config.companyCode, [], { ...config, accounts: [{ ...row, isGroup: true, parentCode: row.accountNumber }] }).conflicts).toContainEqual(expect.stringContaining("循環"));
  });
  it("binds preview to target tenant, uploaded content and full existing state", () => {
    const preview = previewAccountConfiguration(99, config.companyCode, [existing], config);
    expect(previewAccountConfiguration(100, config.companyCode, [existing], config).fingerprint).not.toBe(preview.fingerprint);
    expect(previewAccountConfiguration(99, config.companyCode, [{ ...existing, balance: "1" }], config).fingerprint).not.toBe(preview.fingerprint);
    expect(previewAccountConfiguration(99, config.companyCode, [existing], { ...config, accounts: [{ ...row, accountName: "changed" }] }).fingerprint).not.toBe(preview.fingerprint);
  });
});
