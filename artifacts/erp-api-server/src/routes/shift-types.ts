import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, shiftTypesTable } from "@workspace/erp-db";
import { requireAuth, requireRole } from "../middleware/require-auth";
import { isTimeString } from "../lib/hr-rules";
import { employeesTable } from "@workspace/erp-db";

const HR = requireRole("owner", "admin", "hr_admin");
/** 檢查班制的時間與工時，回傳錯誤說明 */
function shiftProblem(body: any): string | null {
  if (!body?.name || !String(body.name).trim()) return "請填寫班制名稱";
  if (!isTimeString(String(body.startTime ?? "").slice(0, 5)) || !isTimeString(String(body.endTime ?? "").slice(0, 5))) return "上下班時間格式不正確（例如 09:00）";
  for (const key of ["breakStart", "breakEnd"]) {
    if (body[key] && !isTimeString(String(body[key]).slice(0, 5))) return "休息時間格式不正確（例如 12:00）";
  }
  if (Boolean(body.breakStart) !== Boolean(body.breakEnd)) return "休息時間要同時填開始與結束";
  const hours = Number(body.workingHours ?? 8);
  if (!Number.isFinite(hours) || hours <= 0 || hours > 12) return "每日工時請填 1 到 12 小時";
  return null;
}

const router: IRouter = Router();
router.use("/shift-types", requireAuth);

router.get("/shift-types", async (_req, res): Promise<void> => {
  const rows = await db.select().from(shiftTypesTable).orderBy(shiftTypesTable.id);
  res.json(rows);
});

router.post("/shift-types", HR, async (req, res): Promise<void> => {
  const { name, startTime, endTime, breakStart, breakEnd, workingHours } = req.body;
  const problem = shiftProblem(req.body);
  if (problem) { res.status(400).json({ error: problem }); return; }
  const [row] = await db.insert(shiftTypesTable).values({ name, startTime, endTime, breakStart, breakEnd, workingHours }).returning();
  res.status(201).json(row);
});

router.put("/shift-types/:id", HR, async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  const { name, startTime, endTime, breakStart, breakEnd, workingHours, status } = req.body;
  const problem = shiftProblem(req.body);
  if (problem) { res.status(400).json({ error: problem }); return; }
  const [row] = await db.update(shiftTypesTable).set({ name, startTime, endTime, breakStart, breakEnd, workingHours, status }).where(eq(shiftTypesTable.id, id)).returning();
  if (!row) { res.status(404).json({ error: "not found" }); return; }
  res.json(row);
});

router.delete("/shift-types/:id", HR, async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  const [inUse] = await db.select({ id: employeesTable.id }).from(employeesTable).where(eq(employeesTable.shiftTypeId, id)).limit(1);
  if (inUse) { res.status(409).json({ error: "還有員工使用這個班制，請先替他們換班制" }); return; }
  await db.delete(shiftTypesTable).where(eq(shiftTypesTable.id, id));
  res.status(204).end();
});

export default router;
