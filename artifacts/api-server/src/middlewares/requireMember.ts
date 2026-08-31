import type { Request, Response, NextFunction } from "express";
import { eq } from "drizzle-orm";
import { db, membersTable, type Member } from "@workspace/db";

declare global {
  namespace Express {
    interface Request {
      member?: Member;
    }
  }
}

/** Requires a logged-in session and loads the member row. */
export async function requireMember(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const memberId = req.session?.memberId;
    if (!memberId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    const [member] = await db
      .select()
      .from(membersTable)
      .where(eq(membersTable.id, memberId))
      .limit(1);
    if (!member) {
      req.session.destroy(() => {});
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    if (!member.isActive) {
      res.status(403).json({ error: "帳號已被停用，請聯繫客服" });
      return;
    }
    req.member = member;
    next();
  } catch (err) {
    req.log.error({ err }, "requireMember failed");
    res.status(500).json({ error: "Internal error" });
  }
}

/**
 * 角色權限：admin（系統管理員）/ ops（營運）/ support（客服）/ member（一般會員）
 * requireRole("admin","ops") 表示僅系統管理員與營運可通過。
 */
export function requireRole(...roles: string[]) {
  return function (req: Request, res: Response, next: NextFunction) {
    requireMember(req, res, () => {
      if (!req.member || !roles.includes(req.member.role)) {
        res.status(403).json({ error: "Forbidden" });
        return;
      }
      next();
    });
  };
}

/** 後台人員（系統管理員／營運／客服）皆可通過 — 用於唯讀後台資料。 */
export const requireStaff = requireRole("admin", "ops", "support");

/** 系統管理員與營運可通過 — 用於商品、訂單、進貨、內容等營運操作。 */
export const requireOps = requireRole("admin", "ops");

/** Requires an authenticated member with the admin role. */
export async function requireAdmin(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  requireMember(req, res, () => {
    if (req.member?.role !== "admin") {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    next();
  });
}
