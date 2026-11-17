import type { Request, Response, NextFunction } from "express";
import { eq, sql } from "drizzle-orm";
import { db, tenantsTable, creditTransactionsTable, type Tenant } from "@workspace/erp-db";

/** 60 秒租戶快取，避免每個請求都查 tenants */
const tenantCache = new Map<number, { tenant: Tenant; at: number }>();
const CACHE_MS = 60_000;

export function invalidateTenantCache(tenantId: number): void {
  tenantCache.delete(tenantId);
}

export async function loadTenant(tenantId: number, fresh = false): Promise<Tenant | null> {
  const hit = tenantCache.get(tenantId);
  if (!fresh && hit && Date.now() - hit.at < CACHE_MS) return hit.tenant;
  const [tenant] = await db.select().from(tenantsTable).where(eq(tenantsTable.id, tenantId));
  if (tenant) tenantCache.set(tenantId, { tenant, at: Date.now() });
  return tenant ?? null;
}

/** 訂閱有效（含試用中/豁免）判斷 */
export function isSubscriptionActive(tenant: Tenant): boolean {
  if (tenant.isExempt) return true;
  if (tenant.status === "active") return true;
  if (tenant.status === "trialing" && tenant.trialEndsAt && new Date(tenant.trialEndsAt) > new Date()) return true;
  return false;
}

/** 這些路徑不受訂閱狀態限制（登入/帳務/公開端點） */
const EXEMPT_PREFIXES = ["/admin/", "/billing", "/public/", "/stripe/", "/health", "/config"];

/**
 * 訂閱守門員：租戶試用到期且未訂閱 → 402，前端導向帳務頁。
 */
export async function subscriptionGate(req: Request, res: Response, next: NextFunction): Promise<void> {
  const tenantId = (req as any).tenantId as number | undefined;
  if (!tenantId) { next(); return; } // 未登入請求由 requireAuth 處理
  const path = req.path;
  if (EXEMPT_PREFIXES.some((p) => path === p || path.startsWith(p))) { next(); return; }
  const tenant = await loadTenant(tenantId);
  if (!tenant) { res.status(401).json({ error: "租戶不存在" }); return; }
  if (!isSubscriptionActive(tenant)) {
    res.status(402).json({
      error: "訂閱已到期",
      code: "subscription_required",
      message: "免費試用已結束或訂閱已停用，請訂閱後繼續使用（US$49/月）。",
    });
    return;
  }
  next();
}

/**
 * AI 點數守門員：掛在 AI 端點上，每次呼叫原子扣 1 點；餘額不足回 402。
 * 豁免租戶（創始租戶）不扣點。
 */
export function aiCreditGuard(cost = 1) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    if (req.method !== "POST") { next(); return; } // 只有實際 AI 呼叫（POST）扣點
    const tenantId = (req as any).tenantId as number | undefined;
    if (!tenantId) { next(); return; }
    const tenant = await loadTenant(tenantId);
    if (tenant?.isExempt) { next(); return; }
    // 原子扣點：餘額足夠才會更新成功
    const [updated] = await db.update(tenantsTable)
      .set({ aiCredits: sql`${tenantsTable.aiCredits} - ${cost}` })
      .where(sql`${tenantsTable.id} = ${tenantId} AND ${tenantsTable.aiCredits} >= ${cost}`)
      .returning({ aiCredits: tenantsTable.aiCredits });
    if (!updated) {
      res.status(402).json({
        error: "AI 點數不足",
        code: "credits_required",
        message: "AI 點數已用完，請購買點數（US$10 = 100 點）後繼續使用。",
      });
      return;
    }
    invalidateTenantCache(tenantId);
    db.insert(creditTransactionsTable).values({
      tenantId, delta: -cost, balanceAfter: updated.aiCredits, reason: `AI 使用：${req.path}`,
    }).execute().catch(() => {});
    next();
  };
}

/** 平台維運限定：只有平台方（tenant 1）能使用全庫層級功能（備份、資料匯出入） */
export function platformOperatorOnly(req: any, res: any, next: any): void {
  const tid = req.session?.user?.tenantId ?? req.apiKey?.tenantId;
  if (tid !== 1) {
    res.status(403).json({ error: "此功能僅限平台維運人員使用" });
    return;
  }
  next();
}
