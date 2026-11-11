import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, membersTable, institutionsTable } from "@workspace/db";
import { UpdateMeBody } from "@workspace/api-zod";
import { requireMember } from "../middlewares/requireMember";
import { serializeMember } from "../lib/serialize";

const router: IRouter = Router();

async function institutionName(id: number | null): Promise<string | null> {
  if (!id) return null;
  const [row] = await db
    .select({ name: institutionsTable.name })
    .from(institutionsTable)
    .where(eq(institutionsTable.id, id))
    .limit(1);
  return row?.name ?? null;
}

router.get("/me", requireMember, async (req, res) => {
  const m = req.member!;
  res.json(serializeMember(m, await institutionName(m.boundInstitutionId)));
});

router.patch("/me", requireMember, async (req, res) => {
  const parsed = UpdateMeBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid input" });
    return;
  }
  // 會員自行變更綁定院所時，重置審核狀態（需管理員重新審核才能查看院所範圍資料）
  const changes: Record<string, unknown> = { ...parsed.data };
  if ("email" in parsed.data) {
    const email = (parsed.data.email ?? "").trim();
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      res.status(400).json({ error: "Email 格式不正確" });
      return;
    }
    changes.email = email || null;
  }
  if (
    "boundInstitutionId" in parsed.data &&
    parsed.data.boundInstitutionId !== req.member!.boundInstitutionId
  ) {
    changes.institutionVerified = false;
  }
  const [updated] = await db
    .update(membersTable)
    .set(changes)
    .where(eq(membersTable.id, req.member!.id))
    .returning();
  res.json(
    serializeMember(updated, await institutionName(updated.boundInstitutionId)),
  );
});

export default router;
