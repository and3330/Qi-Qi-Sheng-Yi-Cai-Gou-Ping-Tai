import type { Request, Response, NextFunction } from "express";
import { getAuth, clerkClient } from "@clerk/express";
import { eq } from "drizzle-orm";
import { db, membersTable, type Member } from "@workspace/db";

declare global {
  namespace Express {
    interface Request {
      member?: Member;
    }
  }
}

/**
 * Requires a signed-in Clerk user and JIT-provisions the matching member row.
 */
export async function requireMember(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const auth = getAuth(req);
    const clerkUserId = auth?.userId;
    if (!clerkUserId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const existing = await db
      .select()
      .from(membersTable)
      .where(eq(membersTable.clerkUserId, clerkUserId))
      .limit(1);

    if (existing.length > 0) {
      req.member = existing[0];
      next();
      return;
    }

    let name = "";
    let email: string | null = null;
    try {
      const user = await clerkClient.users.getUser(clerkUserId);
      name =
        [user.firstName, user.lastName].filter(Boolean).join(" ") ||
        user.username ||
        "";
      email = user.primaryEmailAddress?.emailAddress ?? null;
    } catch (err) {
      req.log.warn({ err }, "Could not fetch Clerk user profile");
    }

    const inserted = await db
      .insert(membersTable)
      .values({ clerkUserId, name, email, tier: "consumer" })
      .onConflictDoNothing({ target: membersTable.clerkUserId })
      .returning();

    if (inserted.length > 0) {
      req.member = inserted[0];
    } else {
      const [row] = await db
        .select()
        .from(membersTable)
        .where(eq(membersTable.clerkUserId, clerkUserId))
        .limit(1);
      req.member = row;
    }
    next();
  } catch (err) {
    req.log.error({ err }, "requireMember failed");
    res.status(500).json({ error: "Internal error" });
  }
}
