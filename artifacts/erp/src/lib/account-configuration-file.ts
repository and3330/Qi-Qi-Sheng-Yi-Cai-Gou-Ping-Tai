import * as XLSX from "xlsx";
import type { AccountConfiguration, AccountConfigurationRow } from "@workspace/erp-api-client-react";

const HEADERS = ["科目編碼", "科目名稱", "科目類型", "上層科目編碼", "群組科目", "現金流量分類"];
const TYPE_LABELS: Record<string, string> = { Asset: "資產", Liability: "負債", Equity: "權益", Income: "收入", Expense: "費用" };
const CATEGORY_LABELS: Record<string, string> = { operating: "營業", investing: "投資", financing: "籌資", cash: "現金" };
const TYPES = Object.fromEntries(Object.entries(TYPE_LABELS).flatMap(([key, label]) => [[key, key], [label, key]]));
const CATEGORIES = Object.fromEntries(Object.entries(CATEGORY_LABELS).flatMap(([key, label]) => [[key, key], [label, key]]));

export function createAccountConfigurationWorkbook(configuration: AccountConfiguration): XLSX.WorkBook {
  const workbook = XLSX.utils.book_new();
  const rows = configuration.accounts.map(row => [
    row.accountNumber, row.accountName, TYPE_LABELS[row.accountType],
    row.parentCode ?? "", row.isGroup ? "是" : "否",
    row.cashFlowCategory === null ? "" : CATEGORY_LABELS[row.cashFlowCategory],
  ]);
  const sheet = XLSX.utils.aoa_to_sheet([HEADERS, ...rows]);
  sheet["!cols"] = [{ wch: 18 }, { wch: 36 }, { wch: 12 }, { wch: 18 }, { wch: 12 }, { wch: 16 }];
  // Text format is intentional: numeric coercion destroys leading zeroes and dotted codes.
  for (let row = 1; row <= rows.length; row++) {
    for (const col of [0, 3]) {
      const cell = sheet[XLSX.utils.encode_cell({ r: row, c: col })];
      if (cell) cell.z = "@";
    }
  }
  XLSX.utils.book_append_sheet(workbook, sheet, "科目設定");
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
    ["版本", "1"], ["公司統編", configuration.companyCode],
    ["說明", "只新增缺少科目；不含餘額、分錄或資料庫 ID。編碼請保持文字格式。"],
  ]), "匯入資訊");
  return workbook;
}

export function readAccountConfigurationWorkbook(data: ArrayBuffer): AccountConfiguration {
  if (data.byteLength > 10 * 1024 * 1024) throw new Error("檔案不得超過 10 MB");
  const workbook = XLSX.read(data, { type: "array", sheetRows: 5002, cellFormula: true });
  const sheet = workbook.Sheets["科目設定"];
  const info = workbook.Sheets["匯入資訊"];
  if (!sheet || !info) throw new Error("請上傳由「下載科目設定」取得的 Excel，須含科目設定及匯入資訊工作表");
  for (const target of [sheet, info]) {
    if (Object.entries(target).some(([key, cell]) => !key.startsWith("!") && cell?.f)) {
      throw new Error("設定檔不可含公式，請改成純文字或值");
    }
  }
  const range = XLSX.utils.decode_range(sheet["!fullref"] ?? sheet["!ref"] ?? "A1");
  if (range.e.r > 5000 || range.e.c > 5) throw new Error("科目設定最多 5000 筆、6 個欄位");
  const metadata = XLSX.utils.sheet_to_json<unknown[]>(info, { header: 1, defval: "", blankrows: false });
  const metadataValues = new Map(metadata.map(row => [row[0], row[1]]));
  const companyCode = metadataValues.get("公司統編");
  if (metadataValues.get("版本") !== "1" || typeof companyCode !== "string" || !/^\d{8}$/.test(companyCode)) {
    throw new Error("匯入資訊須含版本 1 及文字格式的 8 位公司統編");
  }
  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: "", blankrows: true });
  if (JSON.stringify(rows[0]) !== JSON.stringify(HEADERS)) throw new Error("科目設定欄位不符，請勿更動下載檔的欄位名稱");
  const accounts: AccountConfigurationRow[] = [];
  for (const [index, row] of rows.slice(1).entries()) {
    if (row.every(value => value === "" || value === null)) continue;
    const [accountNumber, accountName, type, parent, group, category] = row;
    if (typeof accountNumber !== "string" || !accountNumber.trim() ||
      typeof accountName !== "string" || !accountName.trim() ||
      typeof parent !== "string" || typeof type !== "string" || !TYPES[type] ||
      (group !== "是" && group !== "否") || typeof category !== "string" || (category && !CATEGORIES[category])) {
      throw new Error(`第 ${index + 2} 列格式錯誤：編碼及上層編碼須為文字，群組填「是／否」，類型及現金流量分類請使用下載檔的選項`);
    }
    accounts.push({
      accountNumber, accountName, accountType: TYPES[type] as AccountConfigurationRow["accountType"],
      parentCode: parent || null, isGroup: group === "是",
      cashFlowCategory: category ? CATEGORIES[category] as AccountConfigurationRow["cashFlowCategory"] : null,
    });
  }
  if (!accounts.length) throw new Error("設定檔沒有科目資料");
  return { version: 1, companyCode, accounts };
}
