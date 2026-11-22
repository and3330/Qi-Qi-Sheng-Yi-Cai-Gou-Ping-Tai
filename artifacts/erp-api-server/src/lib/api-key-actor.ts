import type { Request } from "express";
import type { SessionData } from "express-session";

/**
 * API 金鑰的權限跟著「綁定的使用者」走（老闆 2026-11-19：金鑰不要自己有獨立權限）。
 * 這裡只放不碰資料庫的部分，守衛和單元測試都可以直接用；讀使用者在 api-key-user.ts。
 */
export type ActingUser = NonNullable<SessionData["user"]>;

/**
 * 這次請求以這個使用者的身分執行。
 * 掛在 session 上但設成「不可列舉」：所有讀 req.session.user 的地方都看得到，
 * 但 express-session 計算有沒有變動時看不到，所以不會因此存一筆 session、也不會發登入 cookie。
 */
export function actAsUser(req: Request, user: ActingUser): void {
  if (!req.session) throw new Error("Session middleware required before API key auth");
  Object.defineProperty(req.session, "user", { value: user, enumerable: false, configurable: true, writable: false });
}

/** 機器身分、沒有對應任何使用者（只剩伺服器內部、環境變數設定的舊 AI 金鑰會這樣） */
export function machineOnly(req: Request): boolean {
  return !!(req as any).apiKeyAuth && !req.session?.user;
}

const FULL = ["owner", "admin", "super_admin"];
/**
 * 誰可以把金鑰綁給誰：老闆、平台管理員可以綁任何人；系統管理員不能綁給老闆或平台管理員
 * （不然等於拿到比自己大的權限）。
 */
export function canBindKeyTo(actorRole: string | undefined, targetRole: string): boolean {
  if (actorRole === "owner" || actorRole === "super_admin") return true;
  if (actorRole === "admin") return targetRole !== "owner" && targetRole !== "super_admin";
  return false;
}
export const isFullAccessRole = (role: string | undefined) => FULL.includes(String(role));
