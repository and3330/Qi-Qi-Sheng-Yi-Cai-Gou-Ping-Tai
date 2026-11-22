import type { RequestHandler } from "express";
import { builtinRolePermissions, customRoleForUser } from "../lib/custom-roles";
import { INVOICE_ACTION_PATHS } from "../lib/role-defaults";

export function invoiceActionForPath(path: string): "issue" | "print" | null {
  if (/^\/sales-orders\/[^/]+\/issue-ecpay-invoice\/?$/.test(path)) return "issue";
  if (/^\/invoices\/[^/]+\/ecpay-(print|pdf)\/?$/.test(path)) return "print";
  return null;
}

/** Separate from financial write privileges; never grants void/refund/allowance access. */
export function requireInvoicePermission(action: "issue" | "print"): RequestHandler {
  return async (req, res, next) => {
    const user = (req as any).session?.user;
    const tenantId = (req as any).tenantId ?? user?.tenantId;
    if (!user?.id || !tenantId || (user.tenantId && user.tenantId !== tenantId)) {
      res.status(401).json({ error: "請先登入所屬公司" }); return;
    }
    if (["owner", "admin", "super_admin"].includes(user.role)) { next(); return; }
    if (user.role === "employee") { res.status(403).json({ error: "沒有發票操作權限" }); return; }
    try {
      const custom = await customRoleForUser(tenantId, user.id);
      const permissions = custom?.permissions ?? await builtinRolePermissions(tenantId, user.role);
      if (!permissions?.[INVOICE_ACTION_PATHS[action]]?.includes("view")) {
        res.status(403).json({ error: action === "issue" ? "角色未授權開立綠界發票" : "角色未授權列印／下載發票 PDF" }); return;
      }
      next();
    } catch {
      res.status(503).json({ error: "暫時無法確認發票權限，請稍後再試" });
    }
  };
}
