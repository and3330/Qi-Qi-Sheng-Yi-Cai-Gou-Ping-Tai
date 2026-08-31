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
    req.member = member;
    next();
  } catch (err) {
    req.log.error({ err }, "requireMember failed");
    res.status(500).json({ error: "Internal error" });
  }
}
