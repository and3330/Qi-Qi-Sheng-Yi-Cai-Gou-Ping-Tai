import type { Request, Response, NextFunction } from "express";
import { machineOnly } from "../lib/api-key-actor";

function hasValidTenantScope(req: Request): boolean {
  const tenantId = (req as any).apiKeyAuth
    ? (req as any).apiKey?.tenantId
    : req.session?.user?.tenantId;
  return Number.isInteger(tenantId) && tenantId > 0;
}

/** 有效 API key 或已登入 session 皆視為已驗證 */
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if ((req as any).apiKeyAuth) {
    if (hasValidTenantScope(req)) { next(); return; }
    res.status(401).json({ error: "無效的租戶憑證" });
    return;
  }
  if (!req.session?.user || !hasValidTenantScope(req)) {
    res.status(401).json({ error: "請先登入" });
    return;
  }
  next();
}

export const EMPLOYEE_ROLE = "employee";

/** 員工自助帳號：回傳綁定的員工 id（非 employee 角色回傳 null）。金鑰綁到員工帳號時一樣受限。 */
export function sessionEmployeeScope(req: Request): { isEmployee: boolean; employeeId: number | null } {
  if (machineOnly(req)) return { isEmployee: false, employeeId: null };
  const u = req.session?.user;
  if (!u || u.role !== EMPLOYEE_ROLE) return { isEmployee: false, employeeId: null };
  return { isEmployee: true, employeeId: u.employeeId ?? null };
}

/**
 * 角色守衛。API 金鑰跟著綁定的使用者角色判斷，跟那個人自己登入一樣。
 * 只有沒有對應使用者的機器身分（環境變數設定的舊 AI 金鑰）才看它原本的等級：admin 才能過。
 */
export function requireRole(...roles: string[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (machineOnly(req)) {
      if (!hasValidTenantScope(req)) {
        res.status(401).json({ error: "無效的租戶憑證" });
        return;
      }
      const perms = (req as any).apiKey?.permissions;
      if (perms === "admin") { next(); return; }
      res.status(403).json({ error: "權限不足", message: "此 API Key 權限不足以執行角色保護的操作" });
      return;
    }
    const u = req.session?.user;
    if (!u || !hasValidTenantScope(req)) { res.status(401).json({ error: "請先登入" }); return; }
    if (roles.length > 0 && u.role !== "super_admin" && !roles.includes(u.role)) {
      res.status(403).json({ error: "權限不足" });
      return;
    }
    next();
  };
}

/** 僅限登入 session 使用；任何 API key 一律拒絕。用於帳號管理、備份、金鑰管理等。 */
export function sessionOnly(req: Request, res: Response, next: NextFunction): void {
  if ((req as any).apiKeyAuth) {
    res.status(403).json({ error: "權限不足", message: "此端點僅限登入使用者操作，不開放 API Key" });
    return;
  }
  next();
}
