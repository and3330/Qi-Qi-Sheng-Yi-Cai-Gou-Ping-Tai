import { and, eq } from "drizzle-orm";
import { db, adminUsersTable } from "@workspace/erp-db";
import type { ActingUser } from "./api-key-actor";

export { actAsUser, machineOnly, canBindKeyTo, isFullAccessRole, type ActingUser } from "./api-key-actor";

/**
 * API 金鑰的權限跟著「綁定的使用者」走（老闆 2026-11-19：金鑰不要自己有獨立權限）。
 *
 * 用金鑰呼叫時，伺服器把這次請求當成那個人自己登入操作：
 * 角色守衛、角色與權限勾選表、員工自助限制、各路由自己的角色檢查，全部用那個人目前的角色判斷。
 * 那個人改了角色，金鑰馬上跟著變；帳號停用，金鑰也跟著不能用。
 */

/** 讀出金鑰綁定的使用者；不在這家公司、已停用或不存在都回傳 null */
export async function loadKeyUser(tenantId: number, userId: number | null | undefined): Promise<ActingUser | null> {
  if (!Number.isSafeInteger(userId) || (userId as number) <= 0) return null;
  const [u] = await db.select({
    id: adminUsersTable.id, username: adminUsersTable.username, displayName: adminUsersTable.displayName,
    role: adminUsersTable.role, employeeId: adminUsersTable.employeeId, tenantId: adminUsersTable.tenantId, isActive: adminUsersTable.isActive,
  }).from(adminUsersTable).where(and(eq(adminUsersTable.id, userId as number), eq(adminUsersTable.tenantId, tenantId))).limit(1);
  if (!u || !u.isActive) return null;
  return { id: u.id, username: u.username, displayName: u.displayName, role: u.role, employeeId: u.employeeId, tenantId: u.tenantId };
}

