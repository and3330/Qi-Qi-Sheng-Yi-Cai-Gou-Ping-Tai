import { isDraftStatus } from "./batch-policy";

/**
 * 單據刪除規則：只有草稿可以刪除。
 * 已確認、已送出、已入帳的單據是交易紀錄，要改就作廢（取消），讓紀錄留著可以追查，
 * 而不是從資料庫消失。
 *
 * @param label 單據名稱，例如「銷貨單」
 * @param status 目前狀態
 * @param voidAction 這種單據的作廢方式，例如「取消」「作廢」
 */
export function assertDeletableDraft(label: string, status: unknown, voidAction: string): void {
  if (isDraftStatus(status)) return;
  throw new Error(`只能刪除草稿狀態的${label}（目前狀態：${String(status ?? "")}）。已成立的${label}請改為「${voidAction}」，以保留紀錄`);
}
