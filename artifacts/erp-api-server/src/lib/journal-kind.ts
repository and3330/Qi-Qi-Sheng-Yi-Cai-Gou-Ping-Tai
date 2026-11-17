import { sql, type SQL } from "drizzle-orm";

/**
 * 日記帳的「交易類型」，照 Ecount「查詢會計交易」的分法，從分錄用到的科目推出來：
 * 錢進銀行／現金是收款、錢出去是付款、兩邊都有是轉帳；沒動到錢的，掛應收是應收、掛應付是應付，其餘是一般。
 */
export const JOURNAL_KINDS = ["receipt", "payment", "transfer", "receivable", "payable", "general", "reversal"] as const;
export type JournalKind = typeof JOURNAL_KINDS[number];
export const JOURNAL_KIND_LABELS: Record<JournalKind, string> = {
  receipt: "收款", payment: "付款", transfer: "轉帳", receivable: "應收", payable: "應付", general: "一般", reversal: "沖銷",
};

const CASH = "(銀行存款|庫存現金|零用金|電子支付存款|約當現金|在途現金)";

/**
 * 每筆分錄只掃一次自己的分錄行：科目名稱優先用分錄行裡存好的，沒有才去查科目表（查表很慢，上萬筆會拖到二十幾秒）。
 */
export const journalKindSql: SQL<string> = sql<string>`(CASE
  WHEN journal_entries.description LIKE '沖銷 %' OR journal_entries.description LIKE '作廢%' THEN 'reversal'
  ELSE (SELECT CASE
      WHEN bool_or(d > 0 AND n ~ ${CASH}) AND bool_or(c > 0 AND n ~ ${CASH}) THEN 'transfer'
      WHEN bool_or(d > 0 AND n ~ ${CASH}) THEN 'receipt'
      WHEN bool_or(c > 0 AND n ~ ${CASH}) THEN 'payment'
      WHEN bool_or(d > 0 AND n ~ '^應收') THEN 'receivable'
      WHEN bool_or(c > 0 AND n ~ '^應付') THEN 'payable'
      ELSE 'general' END
    FROM (
      SELECT COALESCE((jl->>'debit')::numeric, 0) AS d, COALESCE((jl->>'credit')::numeric, 0) AS c,
        COALESCE(NULLIF(jl->>'accountName', ''), (SELECT ja.account_name FROM accounts ja WHERE ja.id = NULLIF(jl->>'accountId', '')::int), '') AS n
      FROM jsonb_array_elements(journal_entries.lines) jl
    ) x)
  END)`;

/**
 * Ecount 搬來的分錄說明是「Ecount 單號｜客戶或廠商｜摘要」，拆成三段給清單用；
 * 新系統自己開的分錄沒有這個格式，客戶留空、摘要用整段說明。
 */
export function splitDescription(description: string | null | undefined): { sourceNumber: string | null; party: string | null; summary: string } {
  const text = (description || "").trim();
  const m = /^Ecount\s+([^\s｜]+)｜([^｜]*)｜(.*)$/s.exec(text);
  // 對象欄會連銀行帳戶一起列（「財政部、國泰世華 育邦文化」），清單只取第一個，跟 Ecount 的客戶名一樣
  if (m) return { sourceNumber: m[1], party: m[2].split("、")[0].trim() || null, summary: m[3].trim() };
  // 舊的系統分錄開頭是「自動分錄 - 」，清單上拿掉，只留內容
  return { sourceNumber: null, party: null, summary: text.replace(/^自動分錄 - /, "") };
}
