import { sql } from "drizzle-orm";
import { todayTaipei } from "./inventory-journal";

/**
 * 連號的單據編號：前綴-年月-流水號，例如 SO-202611-0001，每個月從 0001 重新起算。
 *
 * 做法是查同一個月已經用到第幾號再加一（各公司的資料本來就由 RLS 分開，不會互相看到）。
 * 這個查詢包在自己的小交易裡：
 * - 取號期間用鎖擋住同公司同前綴的另一筆，避免兩個人同時拿到同一號；
 * - 萬一查詢本身失敗，只會退回這個小交易，不會拖垮外層正在開單的交易，
 *   然後改用 fallback（原本的時間編號），開單不會因為編號而失敗。
 * 編號欄位另有唯一索引當最後一道保險。
 *
 * table、column、prefix 都是程式裡寫死的常數，不接受使用者輸入。
 */
export async function nextDocNumber(
  executor: any,
  table: string,
  column: string,
  prefix: string,
  fallback: () => string,
  date: string = todayTaipei(),
): Promise<string> {
  if (!/^[a-z_]+$/.test(table) || !/^[a-z_]+$/.test(column) || !/^[A-Z]+$/.test(prefix)) return fallback();
  const head = `${prefix}-${date.slice(0, 7).replace("-", "")}-`;
  try {
    return await executor.transaction(async (tx: any) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${"docnum:" + head} || COALESCE(current_setting('app.tenant_id', true), '')))`);
      const result = await tx.execute(sql`
        SELECT COALESCE(MAX(SUBSTRING(${sql.raw(column)} FROM ${sql.raw(String(head.length + 1))})::integer), 0) AS last
        FROM ${sql.raw(table)}
        WHERE ${sql.raw(column)} ~ ${"^" + head + "[0-9]{1,9}$"}
      `);
      const rows: any[] = result?.rows ?? result ?? [];
      return formatDocNumber(head, Number(rows[0]?.last ?? 0) + 1);
    });
  } catch (err) {
    console.error(`[doc-number] ${table}.${column} 取號失敗，改用時間編號`, err);
    return fallback();
  }
}

/** 流水號至少四位數，超過 9999 就照實際位數 */
export function formatDocNumber(head: string, sequence: number): string {
  return head + String(sequence).padStart(4, "0");
}
