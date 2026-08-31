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
  const [updated] = await db
    .update(membersTable)
    .set(parsed.data)
    .where(eq(membersTable.id, req.member!.id))
    .returning();
  res.json(
    serializeMember(updated, await institutionName(updated.boundInstitutionId)),
  );
});

export default router;
