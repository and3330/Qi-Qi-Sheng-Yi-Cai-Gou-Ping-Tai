import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import { and, eq } from "drizzle-orm";
import { db, insuranceBracketsTable } from "@workspace/erp-db";
import { requireRole, sessionOnly } from "../middleware/require-auth";

const PAYROLL_ROLES = ["owner", "admin", "hr_admin", "finance_admin"] as const;
export const BRACKET_TYPES = ["labor", "health", "pension"] as const;
const PLATFORM_TENANT_ID = 1;

/**
 * 投保級距是法定表、全系統共用（insurance_brackets 沒有 tenant_id）。
 * 任何一家公司改動都會影響所有公司的薪資計算，所以只允許平台方管理員維護。
 */
export function isPlatformAdmin(req: Request): boolean {
  if ((req as any).apiKeyAuth) return false;
  const u = req.session?.user;
  if (!u) return false;
  if (u.role === "super_admin") return true;
  return u.tenantId === PLATFORM_TENANT_ID && (u.role === "owner" || u.role === "admin");
}

function platformWrite(req: Request, res: Response, next: NextFunction): void {
  if (!isPlatformAdmin(req)) {
    res.status(403).json({ error: "投保級距為全系統共用的法定資料，僅平台管理員可以維護" });
    return;
  }
  next();
}

export interface BracketInput { minSalary: number; maxSalary: number | null; insuredAmount: number }

/** 驗證單筆級距；回傳字串代表錯誤訊息 */
export function parseBracket(raw: unknown): BracketInput | string {
  if (!raw || typeof raw !== "object") return "級距資料格式錯誤";
  const r = raw as Record<string, unknown>;
  const minSalary = Number(r.minSalary);
  const insuredAmount = Number(r.insuredAmount);
  const maxSalary = r.maxSalary === null || r.maxSalary === undefined || r.maxSalary === "" ? null : Number(r.maxSalary);
  if (!Number.isInteger(minSalary) || minSalary < 0) return "最低薪資必須是 0 以上的整數";
  if (!Number.isInteger(insuredAmount) || insuredAmount <= 0) return "投保金額必須是正整數";
  if (maxSalary !== null && (!Number.isInteger(maxSalary) || maxSalary < minSalary)) {
    return "最高薪資必須是整數，且不可小於最低薪資";
  }
  return { minSalary, maxSalary, insuredAmount };
}

function isBracketType(value: unknown): value is (typeof BRACKET_TYPES)[number] {
  return typeof value === "string" && (BRACKET_TYPES as readonly string[]).includes(value);
}

const router: IRouter = Router();
router.use("/insurance-brackets", requireRole(...PAYROLL_ROLES));

router.get("/insurance-brackets", async (req, res): Promise<void> => {
  const type = req.query.type as string | undefined;
  const conditions = type ? eq(insuranceBracketsTable.type, type) : undefined;
  const rows = await db.select().from(insuranceBracketsTable).where(conditions).orderBy(insuranceBracketsTable.level);
  res.json(rows);
});

/** 前端用來決定要不要顯示維護按鈕 */
router.get("/insurance-brackets/permissions", (req, res): void => {
  res.json({ canManage: isPlatformAdmin(req) });
});

router.get("/insurance-brackets/lookup", async (req, res): Promise<void> => {
  const salary = Number(req.query.salary);
  const type = req.query.type as string;
  if (!salary || !type) { res.status(400).json({ error: "salary and type required" }); return; }

  const rows = await db.select().from(insuranceBracketsTable)
    .where(eq(insuranceBracketsTable.type, type))
    .orderBy(insuranceBracketsTable.level);
  if (rows.length === 0) { res.status(404).json({ error: "尚未建立投保級距表，請聯絡平台管理員" }); return; }

  let matched = rows[rows.length - 1];
  for (const row of rows) {
    if (salary <= row.insuredAmount) {
      matched = row;
      break;
    }
  }
  res.json(matched);
});

/** 整批取代某一類級距（從官方分級表貼上）。依投保金額由小到大自動編級數。 */
router.post("/insurance-brackets/bulk-replace", sessionOnly, platformWrite, async (req, res): Promise<void> => {
  const type = req.body?.type;
  const rawRows = req.body?.rows;
  if (!isBracketType(type)) { res.status(400).json({ error: "type 必須是 labor、health 或 pension" }); return; }
  if (!Array.isArray(rawRows) || rawRows.length === 0 || rawRows.length > 200) {
    res.status(400).json({ error: "rows 必須是 1 到 200 筆級距" });
    return;
  }
  const parsed: BracketInput[] = [];
  for (let i = 0; i < rawRows.length; i++) {
    const p = parseBracket(rawRows[i]);
    if (typeof p === "string") { res.status(400).json({ error: `第 ${i + 1} 筆：${p}` }); return; }
    parsed.push(p);
  }
  parsed.sort((a, b) => a.insuredAmount - b.insuredAmount);
  for (let i = 1; i < parsed.length; i++) {
    if (parsed[i].insuredAmount === parsed[i - 1].insuredAmount) {
      res.status(400).json({ error: `投保金額 ${parsed[i].insuredAmount} 重複` });
      return;
    }
  }
  const rows = await db.transaction(async (tx) => {
    await tx.delete(insuranceBracketsTable).where(eq(insuranceBracketsTable.type, type));
    return tx.insert(insuranceBracketsTable)
      .values(parsed.map((p, i) => ({ type, level: i + 1, ...p })))
      .returning();
  });
  res.json({ type, count: rows.length });
});

router.post("/insurance-brackets", sessionOnly, platformWrite, async (req, res): Promise<void> => {
  const type = req.body?.type;
  const level = Number(req.body?.level);
  if (!isBracketType(type)) { res.status(400).json({ error: "type 必須是 labor、health 或 pension" }); return; }
  if (!Number.isInteger(level) || level <= 0) { res.status(400).json({ error: "級數必須是正整數" }); return; }
  const p = parseBracket(req.body);
  if (typeof p === "string") { res.status(400).json({ error: p }); return; }
  const [dup] = await db.select({ id: insuranceBracketsTable.id }).from(insuranceBracketsTable)
    .where(and(eq(insuranceBracketsTable.type, type), eq(insuranceBracketsTable.level, level)));
  if (dup) { res.status(409).json({ error: `第 ${level} 級已存在` }); return; }
  const [row] = await db.insert(insuranceBracketsTable).values({ type, level, ...p }).returning();
  res.status(201).json(row);
});

router.patch("/insurance-brackets/:id", sessionOnly, platformWrite, async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) { res.status(400).json({ error: "無效的級距 ID" }); return; }
  const p = parseBracket(req.body);
  if (typeof p === "string") { res.status(400).json({ error: p }); return; }
  const [row] = await db.update(insuranceBracketsTable).set(p).where(eq(insuranceBracketsTable.id, id)).returning();
  if (!row) { res.status(404).json({ error: "找不到級距" }); return; }
  res.json(row);
});

router.delete("/insurance-brackets/:id", sessionOnly, platformWrite, async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) { res.status(400).json({ error: "無效的級距 ID" }); return; }
  const [row] = await db.delete(insuranceBracketsTable).where(eq(insuranceBracketsTable.id, id)).returning();
  if (!row) { res.status(404).json({ error: "找不到級距" }); return; }
  res.sendStatus(204);
});

export default router;
