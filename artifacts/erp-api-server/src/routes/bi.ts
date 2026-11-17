import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import { db, tenantsTable } from "@workspace/erp-db";
import { eq } from "drizzle-orm";
import { requireAuth, requireRole } from "../middleware/require-auth";
import { aiCreditGuard } from "../middleware/saas-guard";
import { isMenuPathDisabled } from "../middleware/module-guard";
import { ReportDataIntegrityError } from "./report-guards";
import { parseRange, type RangeResult } from "../lib/bi/range";
import { buildExecutive } from "../lib/bi/executive";
import { buildSales } from "../lib/bi/sales";
import { buildInventory } from "../lib/bi/inventory";
import { buildHr } from "../lib/bi/hr";
import { buildHealth } from "../lib/bi/health";
import { askGemini, buildPrompt, compactContext, geminiConfigured, BI_AI_MODEL } from "../lib/bi/ai";
import type { BiPage } from "../lib/bi/types";

const router: IRouter = Router();

export const BI_FINANCE_ROLES = ["owner", "admin", "finance_admin", "accountant"] as const;
export const BI_HR_ROLES = ["owner", "admin", "hr_admin", "finance_admin"] as const;
/** 健康檢查樣本含財務單號，僅限財務角色 */
export const BI_HEALTH_ROLES = BI_FINANCE_ROLES;

type Range = Extract<RangeResult, { ok: true }>;
const BUILDERS: Record<BiPage, { roles: readonly string[]; build: (r: Range) => Promise<object> }> = {
  executive: { roles: BI_FINANCE_ROLES, build: buildExecutive },
  sales: { roles: BI_FINANCE_ROLES, build: buildSales },
  inventory: { roles: BI_FINANCE_ROLES, build: buildInventory },
  hr: { roles: BI_HR_ROLES, build: buildHr },
};

router.use("/bi", requireAuth);

function fail(req: Request, res: Response, err: unknown, what: string) {
  if (err instanceof ReportDataIntegrityError) {
    res.status(422).json({ error: err.message, code: "data_integrity" });
    return;
  }
  (req as any).log?.error({ err: (err as Error)?.message }, `${what} failed`);
  res.status(500).json({ error: `${what}計算失敗，請稍後重試` });
}

for (const page of Object.keys(BUILDERS) as BiPage[]) {
  const def = BUILDERS[page];
  router.get(`/bi/${page}`, requireRole(...def.roles), async (req, res): Promise<void> => {
    const r = parseRange(req.query as Record<string, unknown>);
    if (!r.ok) { res.status(400).json({ error: r.error }); return; }
    try {
      res.json(await def.build(r));
    } catch (err) {
      fail(req, res, err, "BI 指標");
    }
  });
}

router.get("/bi/observability", requireRole(...BI_HEALTH_ROLES), async (req, res): Promise<void> => {
  try {
    const tenantId = Number((req as any).tenantId ?? req.session?.user?.tenantId);
    const [t] = Number.isInteger(tenantId) && tenantId > 0
      ? await db.select({ companyCode: tenantsTable.companyCode }).from(tenantsTable).where(eq(tenantsTable.id, tenantId))
      : [];
    res.json(await buildHealth(t?.companyCode ?? null));
  } catch (err) {
    fail(req, res, err, "數據健康檢查");
  }
});

/** 在扣點前完成所有驗證：頁面權限、日期、問題長度、整合是否可用 */
async function validateConsult(req: Request, res: Response, next: NextFunction): Promise<void> {
  const { page, question } = req.body ?? {};
  if (typeof page !== "string" || !Object.hasOwn(BUILDERS, page)) { res.status(400).json({ error: "page 無效" }); return; }
  const role = req.session?.user?.role;
  const roles = BUILDERS[page as BiPage].roles;
  if (role !== "super_admin" && !roles.includes(String(role))) { res.status(403).json({ error: "權限不足，無法分析此頁數據" }); return; }
  const q = typeof question === "string" ? question.trim() : "";
  if (q.length < 2 || q.length > 500) { res.status(400).json({ error: "問題長度需為 2 到 500 字" }); return; }
  const r = parseRange(req.body ?? {});
  if (!r.ok) { res.status(400).json({ error: r.error }); return; }
  const tenantId = Number((req as any).tenantId ?? req.session?.user?.tenantId);
  try {
    if (Number.isInteger(tenantId) && tenantId > 0 && await isMenuPathDisabled(tenantId, `/bi/${page}`)) {
      res.status(403).json({ error: "此模組未開放", code: "module_disabled" });
      return;
    }
  } catch (err) {
    fail(req, res, err, "模組權限檢查");
    return;
  }
  if (!geminiConfigured()) {
    res.status(503).json({ error: "AI 服務尚未設定，未扣點。", code: "ai_unavailable" });
    return;
  }
  (req as any).biConsult = { page, question: q, range: r };
  next();
}

router.post("/bi/ai-consultant", requireRole(), validateConsult, aiCreditGuard(), async (req, res): Promise<void> => {
  const { page, question, range } = (req as any).biConsult as { page: BiPage; question: string; range: Range };
  let context: object;
  try {
    context = await BUILDERS[page].build(range);
  } catch (err) {
    fail(req, res, err, "AI 上下文");
    return;
  }
  try {
    const reply = await askGemini(buildPrompt(page, compactContext(context as Record<string, unknown>), question));
    res.json({ reply, model: BI_AI_MODEL, contextPage: page, period: { startDate: range.startDate, endDate: range.endDate } });
  } catch (err) {
    (req as any).log?.error({ err: (err as Error)?.message }, "BI AI consult failed");
    res.status(502).json({ error: "AI 服務暫時無法回應，請稍後再試。", code: "ai_failed" });
  }
});

export default router;
