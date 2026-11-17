import { sql } from "drizzle-orm";
import { journalEntriesTable } from "@workspace/erp-db/schema";
import { assertPeriodOpen, resolveJournalLinesStrict } from "./auto-journal";
import { autoEntryText, autoOrPlain } from "./auto-entry-text";

/**
 * 庫存相關單據（工單發料／完工、手動庫存異動、銀行對帳入帳）的自動分錄。
 * 分錄編號尾碼帶有來源單據鍵（例如 -WO12-M…），不需額外欄位就能回查某張單據已入帳的金額。
 */

export const round2 = (n: number): number => Math.round((Number(n) || 0) * 100) / 100;

/**
 * 單據上的單價與金額是含稅價（進貨、銷貨轉發票時都是「總額 ÷ 1.05 ＝ 未稅」）。
 * 存貨成本、收入與成本要用未稅金額，稅額另外記到進項／銷項稅額，
 * 否則庫存報表的金額會比帳上存貨多出一截營業稅。
 */
export const VAT_RATE = 0.05;
export function netOfVat(gross: number): number {
  return (Number(gross) || 0) / (1 + VAT_RATE);
}
export function vatSplit(gross: number): { net: number; tax: number } {
  const total = round2(gross);
  const net = round2(netOfVat(total));
  return { net, tax: round2(total - net) };
}

/** 今天的日期（臺灣時間，YYYY-MM-DD） */
export function todayTaipei(now: Date = new Date()): string {
  return new Date(now.getTime() + 8 * 3600_000).toISOString().slice(0, 10);
}

/** 品項的單位成本：移動平均成本優先，沒有時用進價 */
export function itemUnitCost(item: { movingAvgCost?: string | number | null; buyingPrice?: string | number | null } | null | undefined): number {
  return Number(item?.movingAvgCost) || Number(item?.buyingPrice) || 0;
}

/** 入庫後的移動平均成本（加權平均）；入庫前庫存為負或零時直接採用本次成本 */
export function nextMovingAvgCost(currentStock: number, currentAvg: number, addQty: number, addAmount: number): number {
  const newStock = currentStock + addQty;
  if (addQty <= 0) return currentAvg;
  if (currentStock <= 0 || newStock <= 0) return addAmount / addQty;
  return (currentStock * currentAvg + addAmount) / newStock;
}

/**
 * 這一批完工要從在製品轉出多少成本。
 * 分批完工時依「這批數量 ÷ 還沒完工的數量」分攤；最後一批拿走剩下的全部，不留尾差。
 * 原本第一批就把全部在製品成本轉走，第一批的單位成本會灌水、後面幾批變成 0。
 */
export function finishCostShare(wipBalance: number, finishedQty: number, plannedQty: number, completedBefore: number): number {
  const wip = Math.max(0, round2(wipBalance));
  const remaining = plannedQty - completedBefore;
  if (wip === 0 || finishedQty <= 0) return 0;
  if (remaining <= 0 || finishedQty >= remaining - 0.0001) return wip;
  return round2(wip * (finishedQty / remaining));
}

export interface AutoJournalInput {
  /** 來源單據鍵，寫入分錄編號尾碼，例如 WO12-M、SE88、BR5 */
  key: string;
  entryDate: string;
  description: string;
  /** 用於關帳檢查的錯誤訊息，例如「工單發料」 */
  action: string;
  lines: Array<{ accountId?: number; accountNumber?: string; accountName: string; debit: number; credit: number; description?: string }>;
  projectId?: number | null;
  departmentId?: number | null;
}

/** 建立已過帳的自動分錄。金額為 0 時不建立並回傳 null；科目缺漏或已關帳時拋錯，讓整筆交易回滾。 */
export async function postAutoJournal(tx: any, input: AutoJournalInput): Promise<{ id: number; entryNumber: string } | null> {
  const lines = input.lines
    .map(l => ({ ...l, debit: round2(l.debit), credit: round2(l.credit) }))
    .filter(l => l.debit !== 0 || l.credit !== 0);
  const totalDebit = round2(lines.reduce((s, l) => s + l.debit, 0));
  const totalCredit = round2(lines.reduce((s, l) => s + l.credit, 0));
  if (lines.length === 0 || totalDebit <= 0) return null;
  if (totalDebit !== totalCredit) throw new Error(`自動分錄借貸不平衡（借 ${totalDebit}／貸 ${totalCredit}）`);

  await assertPeriodOpen(tx, input.entryDate, input.action);
  const resolved = await resolveJournalLinesStrict(tx, lines);
  const unique = `${Date.now().toString().slice(-8)}${Math.floor(Math.random() * 900 + 100)}`;
  const entryNumber = `JE-${unique}-${input.key}`;
  // 摘要改成「對象｜摘要」（查來源單據的客戶／廠商和備註），不再只寫單號
  const text = autoOrPlain(await autoEntryText(tx, entryNumber), input.description, resolved);
  const [je] = await tx.insert(journalEntriesTable).values({
    entryNumber,
    entryDate: input.entryDate,
    description: text.description,
    totalDebit: String(totalDebit),
    totalCredit: String(totalCredit),
    status: "Posted",
    lines: text.lines,
    projectId: input.projectId ?? null,
    departmentId: input.departmentId ?? null,
  }).returning();
  return { id: je.id, entryNumber: je.entryNumber };
}

/** 加總分錄編號尾碼以指定鍵開頭的已過帳分錄金額（例如 WO12-M 代表工單 12 的全部發料分錄） */
export async function sumAutoJournal(tx: any, keyPrefix: string): Promise<number> {
  const pattern = `%-${keyPrefix}%`;
  const result = await tx.execute(sql`
    SELECT COALESCE(SUM(total_debit), 0) AS total
    FROM journal_entries
    WHERE entry_number LIKE ${pattern} AND status <> 'Draft'
  `);
  const rows = result?.rows ?? result ?? [];
  return round2(Number(rows[0]?.total ?? 0));
}

/** 工單尚未轉出的在製品成本＝已發料成本 − 已轉入製成品 − 已結轉 */
export async function workOrderWipBalance(tx: any, workOrderId: number): Promise<number> {
  const issued = await sumAutoJournal(tx, `WO${workOrderId}-M`) + await sumAutoJournal(tx, `WO${workOrderId}-L`);
  const finished = await sumAutoJournal(tx, `WO${workOrderId}-F`);
  const closed = await sumAutoJournal(tx, `WO${workOrderId}-C`);
  return round2(issued - finished - closed);
}

/**
 * 工單結案（完成或取消）時，把還留在在製品的成本轉列銷貨成本，
 * 避免在製品科目掛著永遠不會轉出的餘額。
 */
export async function closeWorkOrderWip(tx: any, wo: { id: number; workOrderNumber: string }, reason: string): Promise<number> {
  const balance = await workOrderWipBalance(tx, wo.id);
  if (balance <= 0) return 0;
  await postAutoJournal(tx, {
    key: `WO${wo.id}-C`,
    entryDate: todayTaipei(),
    description: `自動分錄 - 工單 ${wo.workOrderNumber} ${reason}，未轉出在製品轉列成本`,
    action: `工單${reason}（結轉在製品）`,
    lines: [
      { accountName: "銷貨成本", debit: balance, credit: 0, description: `${wo.workOrderNumber} 未轉出在製品` },
      { accountName: "在製品", debit: 0, credit: balance, description: `${wo.workOrderNumber} 在製品結轉` },
    ],
  });
  return balance;
}
