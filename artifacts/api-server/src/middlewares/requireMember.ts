import type { Request, Response, NextFunction } from "express";
import { eq } from "drizzle-orm";
import { getAuth, clerkClient } from "@clerk/express";
import { db, membersTable, type Member } from "@workspace/db";

declare global {
  namespace Express {
    interface Request {
      member?: Member;
    }
  }
}

/** Find or JIT-provision a member row for a Clerk user id. */
async function memberFromClerkUser(clerkUserId: string): Promise<Member> {
  const [existing] = await db
    .select()
    .from(membersTable)
    .where(eq(membersTable.clerkUserId, clerkUserId))
    .limit(1);
  if (existing) return existing;

  // JIT provisioning: fetch profile from Clerk and create a member row
  const user = await clerkClient.users.getUser(clerkUserId);
  const email = user.primaryEmailAddress?.emailAddress ?? null;
  const name =
    [user.firstName, user.lastName].filter(Boolean).join(" ") ||
    user.username ||
    email?.split("@")[0] ||
    "會員";

  // NOTE: identity is Clerk-only. We deliberately do NOT auto-link by email —
  // an email match proves nothing about ownership of another row.
  const [created] = await db
    .insert(membersTable)
    .values({
      clerkUserId,
      name,
      email,
      tier: "consumer",
    })
    .onConflictDoNothing({ target: membersTable.clerkUserId })
    .returning();
  if (created) return created;
  // Concurrent request created the row for this Clerk user first
  const [row] = await db
    .select()
    .from(membersTable)
    .where(eq(membersTable.clerkUserId, clerkUserId))
    .limit(1);
  if (row) return row;
  throw new Error("Failed to provision member for Clerk user");
}

/** Requires a signed-in Clerk user and loads (or JIT-provisions) the member row. */
export async function requireMember(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    let member: Member | undefined;

    const auth = getAuth(req);
    const clerkUserId = auth?.userId ?? null;
    if (clerkUserId) {
      member = await memberFromClerkUser(clerkUserId);
    }

    if (!member) {
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
