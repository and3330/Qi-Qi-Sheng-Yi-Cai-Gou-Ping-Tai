import type { Request, Response, NextFunction } from "express";
import { eq } from "drizzle-orm";
import { db, membersTable, institutionsTable } from "@workspace/db";
import { bridgeMemberId } from "../lib/adminBridge";

/** 若已登入則載入會員（不強制登入）。 */
export async function optionalMember(
  req: Request,
  _res: Response,
  next: NextFunction,
) {
  try {
    const memberId = bridgeMemberId(req) ?? req.session?.memberId;
    if (memberId) {
      const [member] = await db
        .select()
        .from(membersTable)
        .where(eq(membersTable.id, memberId))
        .limit(1);
      if (member && member.isActive) req.member = member;
    }
  } catch {
    // 匿名瀏覽即可，不因此失敗
  }
  next();
}

/**
 * 取得目前使用者的「機構分級」：已審核綁定機構且機構有分級才回傳。
 * 後台人員（admin/ops/support）回傳 "STAFF" 表示不受限。
 */
export async function resolveMemberGrade(
  member: Request["member"],
): Promise<string | null> {
  if (!member) return null;
  if (["admin", "ops", "support"].includes(member.role)) return "STAFF";
  if (!member.boundInstitutionId || !member.institutionVerified) return null;
  const [inst] = await db
    .select({ grade: institutionsTable.grade })
    .from(institutionsTable)
    .where(eq(institutionsTable.id, member.boundInstitutionId))
    .limit(1);
  return inst?.grade ?? null;
}

/** 商品是否對此分級開放（allowedGrades 空 = 不限）。 */
export function gradeAllowed(
  allowedGrades: string[] | null | undefined,
  grade: string | null,
): boolean {
  if (!allowedGrades || allowedGrades.length === 0) return true;
  if (grade === "STAFF") return true;
  return grade != null && allowedGrades.includes(grade);
}
