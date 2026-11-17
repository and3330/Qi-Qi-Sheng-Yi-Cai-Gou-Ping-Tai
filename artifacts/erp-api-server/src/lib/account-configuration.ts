import { createHash } from "node:crypto";
import type { Account } from "@workspace/erp-db";

export interface AccountConfigurationRow {
  accountNumber: string;
  accountName: string;
  accountType: "Asset" | "Liability" | "Equity" | "Income" | "Expense";
  parentCode: string | null;
  isGroup: boolean;
  cashFlowCategory: "operating" | "investing" | "financing" | "cash" | null;
}
export interface AccountConfiguration {
  version: 1;
  companyCode: string;
  accounts: AccountConfigurationRow[];
}
export class AccountConfigurationError extends Error {
  constructor(message: string, readonly status = 400) { super(message); }
}
const fields = ["accountNumber", "accountName", "accountType", "parentCode", "isGroup", "cashFlowCategory"];
const types = new Set(["Asset", "Liability", "Equity", "Income", "Expense"]);
const categories = new Set(["operating", "investing", "financing", "cash"]);
function code(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 64 &&
    value.trim() === value && !/[\u0000-\u001f]/.test(value);
}
/** Reject IDs, balances and other business data rather than silently accepting them. */
export function parseAccountConfiguration(value: unknown): AccountConfiguration {
  const body = value as AccountConfiguration;
  if (!body || typeof body !== "object" || Array.isArray(body) ||
    Object.keys(body).sort().join(",") !== "accounts,companyCode,version" ||
    body.version !== 1 || typeof body.companyCode !== "string" || !/^\d{8}$/.test(body.companyCode) ||
    !Array.isArray(body.accounts) || body.accounts.length < 1 || body.accounts.length > 5000) {
    throw new AccountConfigurationError("檔案須有版本 1、8 位公司統編及 1 至 5000 筆科目設定");
  }
  const seen = new Set<string>();
  for (const [index, row] of body.accounts.entries()) {
    if (!row || typeof row !== "object" || Array.isArray(row) ||
      Object.keys(row).sort().join(",") !== [...fields].sort().join(",") ||
      !code(row.accountNumber) || typeof row.accountName !== "string" || !row.accountName.trim() ||
      row.accountName.length > 200 || /[\u0000-\u001f]/.test(row.accountName) ||
      !types.has(row.accountType) || typeof row.isGroup !== "boolean" ||
      (row.parentCode !== null && !code(row.parentCode)) ||
      (row.cashFlowCategory !== null && !categories.has(row.cashFlowCategory))) {
      throw new AccountConfigurationError(`第 ${index + 1} 筆科目格式不正確，請檢查編碼、名稱、類型、群組與上層科目`);
    }
    if (seen.has(row.accountNumber)) throw new AccountConfigurationError(`科目編碼重複：${row.accountNumber}`);
    seen.add(row.accountNumber);
  }
  return body;
}

export function exportAccountConfiguration(companyCode: string, rows: readonly Account[]): AccountConfiguration {
  const codeById = new Map(rows.map(row => [row.id, row.accountNumber]));
  return {
    version: 1, companyCode,
    accounts: rows.map(row => {
      const parentCode = row.parentAccountId === null ? null : codeById.get(row.parentAccountId);
      if (parentCode === undefined) throw new AccountConfigurationError(`科目 ${row.accountNumber} 的上層科目不存在，無法下載設定`, 409);
      if (!types.has(row.accountType) || (row.cashFlowCategory !== null && !categories.has(row.cashFlowCategory))) {
        throw new AccountConfigurationError(`科目 ${row.accountNumber} 的類型或現金流量分類無效`, 409);
      }
      return {
        accountNumber: row.accountNumber, accountName: row.accountName,
        accountType: row.accountType as AccountConfigurationRow["accountType"],
        parentCode, isGroup: row.isGroup,
        cashFlowCategory: row.cashFlowCategory as AccountConfigurationRow["cashFlowCategory"],
      };
    }).sort((a, b) => a.accountNumber.localeCompare(b.accountNumber)),
  };
}

export function previewAccountConfiguration(
  tenantId: number, companyCode: string, rows: readonly Account[], configuration: AccountConfiguration,
) {
  if (companyCode !== configuration.companyCode) {
    throw new AccountConfigurationError("檔案公司統編與目前登入公司不符，已停止匯入", 403);
  }
  const byCode = new Map(rows.map(row => [row.accountNumber, row]));
  const codeById = new Map(rows.map(row => [row.id, row.accountNumber]));
  const incoming = new Map(configuration.accounts.map(row => [row.accountNumber, row]));
  const conflicts: string[] = [];
  const warnings: string[] = [];
  const missing = configuration.accounts.filter(row => !byCode.has(row.accountNumber));
  for (const row of configuration.accounts) {
    const existing = byCode.get(row.accountNumber);
    if (existing) {
      const parentCode = existing.parentAccountId === null ? null : codeById.get(existing.parentAccountId) ?? `#missing:${existing.parentAccountId}`;
      if (existing.accountType !== row.accountType || existing.isGroup !== row.isGroup || parentCode !== row.parentCode) {
        conflicts.push(`科目 ${row.accountNumber} 的類型、群組或上層科目與既有設定衝突`);
      }
      if (existing.accountName !== row.accountName || existing.cashFlowCategory !== row.cashFlowCategory) {
        warnings.push(`科目 ${row.accountNumber} 已存在，保留原名稱與現金流量分類，不套用檔案中的不同設定`);
      }
    }
    if (row.parentCode !== null) {
      const parent = byCode.get(row.parentCode) ?? incoming.get(row.parentCode);
      if (!parent) conflicts.push(`科目 ${row.accountNumber} 的上層 ${row.parentCode} 不存在`);
      else if (!parent.isGroup) conflicts.push(`科目 ${row.accountNumber} 的上層 ${row.parentCode} 不是群組科目`);
    }
  }
  // Follow both existing and imported ancestry; never manufacture parent IDs from another database.
  const complete = new Set<string>();
  for (const row of configuration.accounts) {
    const visiting = new Set<string>();
    let next: string | null = row.accountNumber;
    while (next !== null && !complete.has(next)) {
      if (visiting.has(next)) { conflicts.push(`科目 ${row.accountNumber} 的階層有循環`); break; }
      visiting.add(next);
      const imported = incoming.get(next);
      const existing = byCode.get(next);
      if (imported) next = imported.parentCode;
      else if (existing) {
        if (existing.parentAccountId === null) next = null;
        else {
          const parent = codeById.get(existing.parentAccountId);
          if (!parent) { conflicts.push(`科目 ${row.accountNumber} 的既有上層不存在`); break; }
          next = parent;
        }
      } else break;
    }
    visiting.forEach(item => complete.add(item));
  }
  const fingerprint = createHash("sha256").update(JSON.stringify({
    tenantId, companyCode,
    rows: [...rows].sort((a, b) => a.id - b.id),
    configuration: { ...configuration, accounts: [...configuration.accounts].sort((a, b) => a.accountNumber.localeCompare(b.accountNumber)) },
  })).digest("hex");
  return {
    companyCode, total: configuration.accounts.length, existing: configuration.accounts.length - missing.length,
    missing, conflicts: [...new Set(conflicts)], warnings, fingerprint,
  };
}
