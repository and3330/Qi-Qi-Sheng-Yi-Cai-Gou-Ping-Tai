import { eq } from "drizzle-orm";
// Schema-only import: the table definition, without opening a DB pool at import time.
import { accountsTable } from "@workspace/erp-db/schema";
import workbookBaseline from "./data/accounting-baseline.json";

export type CoreAccountType = "Asset" | "Liability" | "Equity" | "Income" | "Expense";
export type AccountingBaselineProfile = "generic" | "yubang-83483621";

export interface AccountingBaselineAccount {
  readonly code: string;
  readonly displayName: string;
  readonly accountType: CoreAccountType;
  readonly parentCode: string | null;
  readonly level: number;
  readonly isGroup: boolean;
  readonly source: {
    readonly workbookRow: number;
    readonly debitCredit: string;
    readonly workbookType: string;
    readonly allowanceType: string;
    readonly usageType: string;
    readonly summary: string | null;
  };
}

interface WorkbookAccountRow {
  readonly code: string;
  readonly displayName: string;
  readonly isGroup: boolean;
  readonly debitCredit: string;
  readonly workbookType: string;
  readonly allowanceType: string;
  readonly usageType: string;
  readonly summary: string | null;
  readonly workbookRow: number;
}

const GENERIC_NAMES: Readonly<Record<string, string>> = Object.freeze({
  "1113": "銀行存款-主要帳戶",
  "1114": "銀行存款-第二帳戶",
  "1115": "電子支付存款",
  "1119": "代管銀行存款-第一帳戶",
  "1120": "代管銀行存款-第二帳戶",
  "1113.0": "銀行存款-專用帳戶",
  "1119.0": "代管銀行存款-專用帳戶",
  "1145": "其他應收帳款",
  "2119": "短期借款-個人往來一",
  "2120": "短期借款-個人往來二",
  "21201": "短期借款-個人往來三",
});

const WORKBOOK_ACCOUNT_ROWS = workbookBaseline.accounts as readonly WorkbookAccountRow[];

function scrubGenericMetadata(value: string | null): string | null {
  if (value === null) return null;
  return value
    .replaceAll("育邦文化教育科技股份有限公司", "本公司")
    .replaceAll("國際兒童才藝協會", "受託管理單位")
    .replaceAll("詠勝教育文化事業有限公司", "受託管理單位")
    .replaceAll("國泰板橋", "主要銀行")
    .replaceAll("土地東板橋", "第二銀行")
    .replaceAll("安廷", "個人往來一")
    .replaceAll("弘晉", "個人往來二")
    .replaceAll("猛璋", "個人往來三");
}

function coreType({ code, debitCredit, workbookType }: WorkbookAccountRow): CoreAccountType {
  if (workbookType === "資產") return "Asset";
  if (workbookType === "負債") return "Liability";
  if (workbookType === "資本") return "Equity";
  if (workbookType === "成本") return "Expense";
  if (workbookType !== "損益") throw new Error(`Unknown workbook account type at ${code}: ${workbookType}`);

  // 損益 cannot be mapped as one type. Contra revenue remains Income under its
  // revenue root; operating/cost/tax roots are Expense regardless of a leaf's nature.
  if (["75", "61", "62", "45", "410"].some((root) => code === root || code.startsWith(root))) {
    return "Expense";
  }
  if (code === "4" || ["40", "401", "405", "408", "41", "71"].some((root) => code === root || code.startsWith(root))) {
    return "Income";
  }
  return debitCredit === "貸方" ? "Income" : "Expense";
}

function compile(profile: AccountingBaselineProfile): readonly AccountingBaselineAccount[] {
  const groups = WORKBOOK_ACCOUNT_ROWS.filter((row) => row.isGroup).map((row) => row.code);
  const parentByCode = new Map<string, string | null>();
  for (const { code } of WORKBOOK_ACCOUNT_ROWS) {
    parentByCode.set(code, groups
      .filter((candidate) => candidate.length < code.length && code.startsWith(candidate))
      .sort((a, b) => b.length - a.length)[0] ?? null);
  }
  const levelOf = (code: string): number => {
    const parent = parentByCode.get(code);
    return parent ? levelOf(parent) + 1 : 0;
  };
  return Object.freeze(WORKBOOK_ACCOUNT_ROWS.map((row) => {
    const { code, displayName: sourceName, isGroup, debitCredit, workbookType, allowanceType, usageType, summary, workbookRow } = row;
    const parentCode = parentByCode.get(code) ?? null;
    return Object.freeze({
      code,
      displayName: profile === "generic" ? GENERIC_NAMES[code] ?? sourceName : sourceName,
      accountType: coreType(row),
      parentCode,
      level: levelOf(code),
      isGroup,
      source: Object.freeze({
        workbookRow,
        debitCredit,
        workbookType,
        allowanceType,
        usageType,
        summary: profile === "generic" ? scrubGenericMetadata(summary) : summary,
      }),
    });
  }));
}

const BASELINES = Object.freeze({
  generic: compile("generic"),
  "yubang-83483621": compile("yubang-83483621"),
});

/** Explicit selector: signup must always request generic; repair may explicitly choose 育邦. */
export function selectAccountingBaseline(profile: AccountingBaselineProfile): readonly AccountingBaselineAccount[] {
  return BASELINES[profile];
}

export interface EnsureAccountingBaselineResult {
  readonly inserted: number;
  readonly existing: number;
}

/**
 * Add missing baseline rows inside the caller's transaction. Existing rows,
 * balances, ids, labels, and metadata are never overwritten. A code collision
 * with incompatible type/group/parent structure fails the transaction.
 */
export async function ensureAccountingBaseline(
  tx: any,
  baseline: readonly AccountingBaselineAccount[],
  options: { tenantId?: number } = {},
): Promise<EnsureAccountingBaselineResult> {
  const query = tx.select().from(accountsTable);
  const existingRows: Array<{
    id: number; accountNumber: string; accountType: string;
    parentAccountId: number | null; isGroup: boolean;
  }> = options.tenantId === undefined
    ? await query
    : await query.where(eq(accountsTable.tenantId, options.tenantId));
  const byCode = new Map(existingRows.map((row) => [row.accountNumber, row]));
  const codeById = new Map(existingRows.map((row) => [row.id, row.accountNumber]));
  let inserted = 0;

  let pending = [...baseline];
  while (pending.length > 0) {
    const ready = pending.filter((definition) => !definition.parentCode || byCode.has(definition.parentCode));
    if (ready.length === 0) {
      throw new Error(`會計科目基線階層無效：${pending.map((item) => item.code).join(", ")}`);
    }
    for (const definition of ready) {
    const expectedParent = definition.parentCode ? byCode.get(definition.parentCode) : undefined;
    const current = byCode.get(definition.code);
    if (current) {
      const currentParentCode = current.parentAccountId ? codeById.get(current.parentAccountId) ?? null : null;
      if (
        current.accountType !== definition.accountType ||
        current.isGroup !== definition.isGroup ||
        currentParentCode !== definition.parentCode
      ) {
        throw new Error(
          `會計科目 ${definition.code} 結構衝突：` +
          `existing(type=${current.accountType}, group=${current.isGroup}, parent=${currentParentCode ?? "null"}), ` +
          `baseline(type=${definition.accountType}, group=${definition.isGroup}, parent=${definition.parentCode ?? "null"})`,
        );
      }
      continue;
    }

    const [created] = await tx.insert(accountsTable).values({
      ...(options.tenantId === undefined ? {} : { tenantId: options.tenantId }),
      accountNumber: definition.code,
      accountName: definition.displayName,
      accountType: definition.accountType,
      parentAccountId: expectedParent?.id ?? null,
      balance: "0",
      isGroup: definition.isGroup,
      cashFlowCategory: null,
    }).returning({ id: accountsTable.id });
    const row = {
      id: created.id,
      accountNumber: definition.code,
      accountType: definition.accountType,
      parentAccountId: expectedParent?.id ?? null,
      isGroup: definition.isGroup,
    };
    byCode.set(definition.code, row);
    codeById.set(created.id, definition.code);
    inserted++;
    }
    const readyCodes = new Set(ready.map((item) => item.code));
    pending = pending.filter((item) => !readyCodes.has(item.code));
  }
  return { inserted, existing: baseline.length - inserted };
}