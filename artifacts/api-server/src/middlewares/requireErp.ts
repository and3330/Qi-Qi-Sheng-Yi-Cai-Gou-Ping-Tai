import type { Request, Response, NextFunction } from "express";
import { requireMember } from "./requireMember";

export const ERP_ROLES = [
  "super_admin",
  "admin",
  "manager",
  "hr_admin",
  "finance_admin",
  "accountant",
  "viewer",
] as const;

/**
 * 有效 ERP 角色：
 * - members.erp_role 有值 → 以其為準
 * - 平台 admin 未設定 erp_role → 視同 super_admin
 * - 其餘 → null（無 ERP 權限）
 */
export function effectiveErpRole(member: {
  role: string;
  erpRole: string | null;
}): string | null {
  if (member.erpRole) return member.erpRole;
  if (member.role === "admin") return "super_admin";
  return null;
}

/** 需要任一 ERP 角色（登入 + erpRole 非 null）。super_admin 永遠通過。 */
export function requireErp(...roles: string[]) {
  return function (req: Request, res: Response, next: NextFunction) {
    requireMember(req, res, () => {
      const erpRole = effectiveErpRole(req.member!);
      if (!erpRole) {
        res.status(403).json({ error: "無 ERP 權限" });
        return;
      }
      if (
        roles.length > 0 &&
        erpRole !== "super_admin" &&
        !roles.includes(erpRole)
      ) {
        res.status(403).json({ error: "Forbidden" });
        return;
      }
      next();
    });
  };
}

/** 任何 ERP 角色皆可 */
export const requireErpAny = requireErp();

import { menuAllows } from "../lib/erpMenu";

/**
 * 以「選單權限」為準的伺服器端授權：
 * 與前端 RoleGate 相同規則（覆寫優先於預設、空陣列 = 全部 ERP 角色、super_admin 全通），
 * 讓被選單隱藏的頁面對應 API 也一併被擋下。
 */
export function requireErpMenu(menuPath: string) {
  return function (req: Request, res: Response, next: NextFunction) {
    requireMember(req, res, async () => {
      const erpRole = effectiveErpRole(req.member!);
      if (!erpRole) {
        res.status(403).json({ error: "無 ERP 權限" });
        return;
      }
      try {
        if (!(await menuAllows(menuPath, erpRole))) {
          res.status(403).json({ error: "Forbidden" });
          return;
        }
        next();
      } catch (err) {
        req.log.error({ err }, "requireErpMenu failed");
        res.status(500).json({ error: "Internal error" });
      }
    });
  };
}
