import { eq, sql } from "drizzle-orm";
import { accountsTable, accountingSettingsTable, warehousesTable } from "@workspace/erp-db/schema";
import { ensureAccountingBaseline, selectAccountingBaseline } from "./accounting-baseline";
import { resolveJournalLines } from "./auto-journal";

/**
 * 基礎資料：各模組連動時一定會用到、缺了就整條流程卡住的資料。
 * - 會計科目：發票、訂單、出貨、薪資、收付款的自動分錄都要對得到科目
 * - 倉庫：出貨、收貨、庫存異動、工單都要指定倉庫
 * - 會計設定：關帳日
 * - 投保級距：薪資的勞健保、勞退計算（全系統共用，由平台方維護）
 */
export const DEFAULT_WAREHOUSE_NAME = "主倉庫";

/** 自動分錄一定會用到的科目（名稱對應 auto-journal.ts 的候選科目表） */
export const KEY_AUTO_JOURNAL_ACCOUNTS = [
  "現金/銀行", "應收帳款", "應付帳款", "銷貨收入", "進貨", "銷貨成本", "存貨",
  "進項稅額", "銷項稅額",
  "薪資費用", "勞健保/退休金費用（雇主）", "代扣款項", "應付勞健保/退休金",
] as const;

export interface FoundationStatus {
  accounts: { count: number; missingKeyAccounts: string[] };
  warehouses: { count: number };
  accountingSettings: { exists: boolean };
  insuranceBrackets: { labor: number; health: number; pension: number };
  ready: boolean;
  /** 本公司管理員自己按一鍵補齊就能解決的缺口 */
  fixable: string[];
  /** 需要人工或平台方處理的缺口 */
  manual: string[];
}

const rowsOf = (r: any): any[] => r?.rows ?? r ?? [];

async function countOf(tx: any, query: ReturnType<typeof sql>): Promise<number> {
  const [row] = rowsOf(await tx.execute(query));
  return Number(row?.count ?? 0);
}

export async function getFoundationStatus(tx: any): Promise<FoundationStatus> {
  const accountCount = await countOf(tx, sql`SELECT count(*)::int AS count FROM accounts`);
  const warehouseCount = await countOf(tx, sql`SELECT count(*)::int AS count FROM warehouses`);
  const settingsCount = await countOf(tx, sql`SELECT count(*)::int AS count FROM accounting_settings`);
  const bracketRows = rowsOf(await tx.execute(sql`SELECT type, count(*)::int AS count FROM insurance_brackets GROUP BY type`));
  const insuranceBrackets = { labor: 0, health: 0, pension: 0 };
  for (const r of bracketRows) {
    if (r.type === "labor" || r.type === "health" || r.type === "pension") {
      insuranceBrackets[r.type as keyof typeof insuranceBrackets] = Number(r.count);
    }
  }

  let missingKeyAccounts: string[] = [];
  if (accountCount > 0) {
    const resolved = await resolveJournalLines(
      tx,
      KEY_AUTO_JOURNAL_ACCOUNTS.map(accountName => ({ accountName, debit: 0, credit: 0 })),
    );
    missingKeyAccounts = resolved.filter(l => !l.accountId).map(l => l.accountName);
  }

  const fixable: string[] = [];
  const manual: string[] = [];
  if (accountCount === 0) fixable.push("尚未建立會計科目表");
  else if (missingKeyAccounts.length > 0) {
    manual.push(`會計科目表缺少自動分錄需要的科目：${missingKeyAccounts.join("、")}`);
  }
  if (warehouseCount === 0) fixable.push("尚未建立倉庫");
  if (settingsCount === 0) fixable.push("尚未建立會計設定");
  const missingBrackets = [
    insuranceBrackets.labor === 0 ? "勞保" : null,
    insuranceBrackets.health === 0 ? "健保" : null,
    insuranceBrackets.pension === 0 ? "勞退" : null,
  ].filter(Boolean);
  if (missingBrackets.length > 0) {
    manual.push(`尚未建立${missingBrackets.join("、")}投保級距表，薪資的保費會直接以原薪資計算；請平台管理員到「投保級距」匯入`);
  }

  return {
    accounts: { count: accountCount, missingKeyAccounts },
    warehouses: { count: warehouseCount },
    accountingSettings: { exists: settingsCount > 0 },
    insuranceBrackets,
    ready: fixable.length === 0 && manual.length === 0,
    fixable,
    manual,
  };
}

export interface EnsureFoundationResult {
  accountsInserted: number;
  warehouseCreated: boolean;
  accountingSettingsCreated: boolean;
}

/**
 * 補齊基礎資料。只新增缺的，不覆蓋、不修改任何既有資料：
 * - 會計科目：只在整張科目表是空的時候套用通用基線（已有科目的公司不動，避免跟自訂科目衝突）
 * - 倉庫：一間都沒有時建立「主倉庫」
 * - 會計設定：沒有時建立一筆
 * 必須在交易中呼叫，且 tenantId 必須來自已驗證的登入身分或開戶交易本身。
 */
export async function ensureFoundation(tx: any, tenantId: number): Promise<EnsureFoundationResult> {
  if (!Number.isInteger(tenantId) || tenantId <= 0) throw new Error("ensureFoundation 需要有效的 tenantId");

  let accountsInserted = 0;
  const existingAccounts = await tx.select({ id: accountsTable.id }).from(accountsTable)
    .where(eq(accountsTable.tenantId, tenantId)).limit(1);
  if (existingAccounts.length === 0) {
    const ensured = await ensureAccountingBaseline(tx, selectAccountingBaseline("generic"), { tenantId });
    accountsInserted = ensured.inserted;
  }

  let warehouseCreated = false;
  const existingWarehouses = await tx.select({ id: warehousesTable.id }).from(warehousesTable)
    .where(eq(warehousesTable.tenantId, tenantId)).limit(1);
  if (existingWarehouses.length === 0) {
    await tx.insert(warehousesTable).values({ tenantId, name: DEFAULT_WAREHOUSE_NAME });
    warehouseCreated = true;
  }

  let accountingSettingsCreated = false;
  const existingSettings = await tx.select({ id: accountingSettingsTable.id }).from(accountingSettingsTable)
    .where(eq(accountingSettingsTable.tenantId, tenantId)).limit(1);
  if (existingSettings.length === 0) {
    await tx.insert(accountingSettingsTable).values({ tenantId });
    accountingSettingsCreated = true;
  }

  return { accountsInserted, warehouseCreated, accountingSettingsCreated };
}
