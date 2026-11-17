import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as XLSX from "xlsx";
import { createAccountConfigurationWorkbook, readAccountConfigurationWorkbook } from "../account-configuration-file.ts";

const configuration = {
  version: 1, companyCode: "83483621",
  accounts: [
    { accountNumber: "001", accountName: "資產", accountType: "Asset", parentCode: null, isGroup: true, cashFlowCategory: null },
    { accountNumber: "001.0", accountName: "銀行存款-指定帳戶", accountType: "Asset", parentCode: "001", isGroup: false, cashFlowCategory: "cash" },
    { accountNumber: "001-1", accountName: "=純文字名稱", accountType: "Asset", parentCode: "001", isGroup: false, cashFlowCategory: "operating" },
  ],
};
const read = workbook => readAccountConfigurationWorkbook(XLSX.write(workbook, { type: "array", bookType: "xlsx" }));
describe("account configuration Excel round trip", () => {
  it("preserves textual codes, exact names, parent codes, groups and categories", () => {
    const workbook = createAccountConfigurationWorkbook(configuration);
    assert.deepEqual(read(workbook), configuration);
    assert.equal(workbook.Sheets["科目設定"].A2.t, "s");
    assert.equal(workbook.Sheets["科目設定"].B4.t, "s");
    assert.equal(workbook.Sheets["科目設定"].B4.f, undefined);
    assert.ok(!JSON.stringify(workbook).includes("balance"));
    assert.ok(!JSON.stringify(workbook).includes("parentAccountId"));
  });
  it("rejects numeric account codes rather than losing leading zeroes", () => {
    const workbook = createAccountConfigurationWorkbook(configuration);
    workbook.Sheets["科目設定"].A2 = { t: "n", v: 1 };
    assert.throws(() => read(workbook), /編碼及上層編碼須為文字/);
  });
  it("rejects formulas and incompatible layouts", () => {
    const workbook = createAccountConfigurationWorkbook(configuration);
    workbook.Sheets["科目設定"].B2.f = "1+1";
    assert.throws(() => read(workbook), /不可含公式/);
    delete workbook.Sheets["匯入資訊"];
    workbook.SheetNames = workbook.SheetNames.filter(name => name !== "匯入資訊");
    assert.throws(() => read(workbook), /須含/);
  });
  it("rejects unknown types, groups and empty data", () => {
    const workbook = createAccountConfigurationWorkbook(configuration);
    workbook.Sheets["科目設定"].C2.v = "未知";
    assert.throws(() => read(workbook), /格式錯誤/);
    assert.throws(() => read(createAccountConfigurationWorkbook({ ...configuration, accounts: [] })), /沒有科目資料/);
  });
});
