import { sql, desc } from "drizzle-orm";
import {
  erpAccountingSettingsTable,
  erpJournalEntriesTable,
  type ErpJournalLine,
} from "@workspace/db";

/**
 * ERP 自動立帳輔助：
 * 1. resolveJournalLines — 將自動分錄的 accountName 對應到 erp_accounts 的實際葉節點科目
 *    （精確名稱比對明細科目，含備援候選名稱）。報表以 line.accountId 彙總，
 *    未解析的行僅保留名稱、不會出現在試算表/損益表，須讓使用者看得到未對應名稱而非亂猜。
 * 2. assertPeriodOpen — 關帳日（lock date）檢查：任何會計寫入路徑都必須先呼叫。
 * 3. createAutoJournalEntry — 建立自動傳票（同交易內），回傳傳票 id。
 */

// 每個自動分錄名稱的候選科目名稱（依序嘗試精確比對，取第一個存在的明細科目）
const ACCOUNT_CANDIDATES: Record<string, string[]> = {
  "現金/銀行": ["銀行存款", "庫存現金"],
  庫存現金: ["庫存現金"],
  銀行存款: ["銀行存款"],
  應收帳款: ["應收帳款"],
  應付帳款: ["應付帳款"],
  銷貨收入: ["銷貨收入"],
  銷貨退回: ["銷貨退回"],
  銷貨成本: ["銷貨成本"],
  存貨: ["存貨"],
  費用: ["營業費用", "其他費用", "雜費"],
  薪資費用: ["薪資費用"],
  分潤費用: ["分潤費用"],
  折舊費用: ["折舊費用"],
  累計折舊: ["累計折舊"],
  錢包儲值負債: ["錢包儲值負債"],
  進項稅額: ["進項稅額"],
  銷項稅額: ["銷項稅額"],
};

export type AutoJournalLine = ErpJournalLine & { accountNumber?: string };

/** 將分錄明細的 accountName 解析為實際科目（accountId）。解析不到時保留原樣（名稱-only）。 */
export async function resolveJournalLines(
  tx: any,
  lines: AutoJournalLine[],
): Promise<AutoJournalLine[]> {
  const wanted = new Set<string>();
  for (const line of lines) {
    if (line.accountId) continue;
    const name = line.accountName || "";
    for (const cand of ACCOUNT_CANDIDATES[name] || [name]) wanted.add(cand);
  }
  if (wanted.size === 0) return lines;

  const names = Array.from(wanted);
  const result = await tx.execute(sql`
    SELECT id, account_number AS "accountNumber", account_name AS "accountName"
    FROM erp_accounts
    WHERE is_group = false AND account_name IN (${sql.join(
      names.map((n) => sql`${n}`),
      sql`, `,
    )})
    ORDER BY account_number
  `);
  const rows: Array<{ id: number; accountNumber: string; accountName: string }> =
    result.rows ?? result;

  const byName = new Map<string, (typeof rows)[number]>();
  for (const row of rows) if (!byName.has(row.accountName)) byName.set(row.accountName, row);

  return lines.map((line) => {
    if (line.accountId) return line;
    const name = line.accountName || "";
    for (const cand of ACCOUNT_CANDIDATES[name] || [name]) {
      const acc = byName.get(cand);
      if (acc)
        return {
          ...line,
          accountId: acc.id,
          accountNumber: acc.accountNumber,
          accountName: acc.accountName,
        };
    }
    return line;
  });
}

/** 取得關帳日（無設定回傳 null） */
export async function getLockDate(dbOrTx: any): Promise<string | null> {
  const [row] = await dbOrTx.select().from(erpAccountingSettingsTable).limit(1);
  return row?.lockDate || null;
}

/** 若日期落在關帳日（含）之前則拋出錯誤 */
export async function assertPeriodOpen(
  dbOrTx: any,
  date: string | null | undefined,
  action: string,
): Promise<void> {
  if (!date) return;
  const lockDate = await getLockDate(dbOrTx);
  if (lockDate && date <= lockDate) {
    throw new Error(
      `${lockDate}（含）以前已關帳，無法${action}。如需調整請先修改關帳日。`,
    );
  }
}

/** 產生傳票編號：JE-YYYYMMDD-xxxx（同交易內以序號遞增） */
async function nextEntryNumber(tx: any, date: string): Promise<string> {
  const prefix = `JE-${date.replace(/-/g, "")}`;
  const result = await tx.execute(
    sql`SELECT COUNT(*)::int AS n FROM erp_journal_entries WHERE entry_number LIKE ${prefix + "%"}`,
  );
  const n = Number((result.rows ?? result)[0]?.n || 0);
  return `${prefix}-${String(n + 1).padStart(4, "0")}`;
}

/**
 * 建立自動傳票（同交易內）。lines 會先經 resolveJournalLines 解析。
 * sourceType/sourceId 提供時具冪等性（部分唯一索引）：已存在同來源傳票時回傳既有 id。
 * 注意：呼叫端若在關帳日前的日期立帳，應自行決定是否改用當日日期或拋錯。
 */
export async function createAutoJournalEntry(
  tx: any,
  opts: {
    entryDate: string;
    description: string;
    reference?: string | null;
    lines: AutoJournalLine[];
    sourceType?: string;
    sourceId?: string;
    createdBy?: number | null;
  },
): Promise<number> {
  if (opts.sourceType && opts.sourceId) {
    const result = await tx.execute(
      sql`SELECT id FROM erp_journal_entries WHERE source_type = ${opts.sourceType} AND source_id = ${opts.sourceId} LIMIT 1`,
    );
    const rows = result.rows ?? result;
    if (rows.length > 0) return rows[0].id;
  }
  const resolved = await resolveJournalLines(tx, opts.lines);
  const totalDebit = resolved.reduce((s, l) => s + (l.debit || 0), 0);
  const totalCredit = resolved.reduce((s, l) => s + (l.credit || 0), 0);
  if (totalDebit !== totalCredit) {
    throw new Error(`自動傳票借貸不平衡（借 ${totalDebit} / 貸 ${totalCredit}）`);
  }
  const entryNumber = await nextEntryNumber(tx, opts.entryDate);
  const [row] = await tx
    .insert(erpJournalEntriesTable)
    .values({
      entryNumber,
      entryDate: opts.entryDate,
      reference: opts.reference ?? null,
      description: opts.description,
      totalDebit,
      totalCredit,
      lines: resolved,
      status: "Posted",
      isAuto: true,
      sourceType: opts.sourceType ?? null,
      sourceId: opts.sourceId ?? null,
      createdBy: opts.createdBy ?? null,
    })
    .returning({ id: erpJournalEntriesTable.id });
  return row.id;
}

/** 今天（本地 ISO 日期） */
export function todayISO(): string {
  return new Date().toISOString().split("T")[0];
}
