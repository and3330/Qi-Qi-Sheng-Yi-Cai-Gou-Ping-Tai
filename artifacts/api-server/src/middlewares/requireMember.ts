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
