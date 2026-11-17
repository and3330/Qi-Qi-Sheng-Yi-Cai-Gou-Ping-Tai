import type { Request, Response, NextFunction } from "express";
import { runWithTenant } from "@workspace/erp-db";

/**
 * 租戶上下文中介層：依登入 session（或 API key）決定租戶，
 * 在該租戶的隔離資料庫連線中處理整個請求（Row-Level Security 生效）。
 * 未登入請求不綁定租戶——RLS 之下看不到任何租戶資料，天然 fail-closed。
 */
/** 目前請求的租戶 id（登入或 API key 驗證後一定有值） */
export function reqTenantId(req: Request): number {
  const t = Number((req as any).tenantId ?? req.session?.user?.tenantId ?? (req as any).apiKey?.tenantId);
  if (!Number.isInteger(t) || t <= 0) throw new Error("此請求沒有租戶上下文");
  return t;
}

export function tenantContext(req: Request, res: Response, next: NextFunction): void {
  const sessionTenant = req.session?.user?.tenantId;
  const apiKeyTenant = (req as any).apiKey?.tenantId;
  if (
    Number.isInteger(sessionTenant) &&
    Number.isInteger(apiKeyTenant) &&
    sessionTenant !== apiKeyTenant
  ) {
    res.status(403).json({ error: "租戶憑證不一致" });
    return;
  }
  const tenantId = Number(sessionTenant ?? apiKeyTenant);
  if (!Number.isInteger(tenantId) || tenantId <= 0) { next(); return; }
  (req as any).tenantId = tenantId;
  runWithTenant(tenantId, () => new Promise<void>((resolve) => {
    let settled = false;
    const done = () => { if (!settled) { settled = true; resolve(); } };
    res.on("finish", done);
    res.on("close", done);
    next();
  })).catch((err) => next(err));
}
