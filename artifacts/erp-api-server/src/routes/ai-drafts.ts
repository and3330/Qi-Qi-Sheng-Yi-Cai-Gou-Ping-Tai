import { Router, type IRouter, type Request, type Response } from "express";
import { and, desc, eq } from "drizzle-orm";
import { aiActionsTable, aiCustomerDraftsTable, aiDraftDocumentsTable, currentTenantId, db, runInTenantTransaction } from "@workspace/erp-db";
import { requireAuth, requireRole, sessionOnly } from "../middleware/require-auth";
import { moduleGuard } from "../middleware/module-guard";
import { employeeAccessGuard } from "../middleware/employee-access-guard";
import { docTypeSchema, draftTarget, validateDraft } from "../mcp/drafts";
import { CustomerDraftConflictError, validateCustomerDraft } from "../mcp/customer-drafts";
import customersRouter from "./customers";
import vouchersRouter from "./vouchers";
import quotationsRouter from "./quotations";
import paymentRequestsRouter from "./payment-requests";
import invoicesRouter from "./invoices";

const router: IRouter = Router();
router.use("/ai-drafts", sessionOnly, requireAuth, requireRole("owner", "admin", "finance_admin", "accountant"));

// Run the same target-path module checks and the actual existing route guards.
// Never call via HTTP: that would lose both the human session and transaction.
const createRouter = Router();
createRouter.use(moduleGuard, employeeAccessGuard);
// customersRouter first: it only handles /customers and must not traverse other routers' guards.
createRouter.use(customersRouter, vouchersRouter, quotationsRouter, paymentRequestsRouter, invoicesRouter);

class ApprovalError extends Error {
  constructor(public status: number, public body: unknown) { super("Draft approval failed"); }
}

/** Capture only; the real HTTP response is written after the outer COMMIT. */
export function dispatchDraftCreate(req: Request, path: string, body: Record<string, unknown>): Promise<{ id: number }> {
  return new Promise((resolve, reject) => {
    // Inherit the actual human identity, headers and session, not a fabricated user.
    const internalReq = Object.create(req) as Request;
    Object.assign(internalReq, { method: "POST", url: path, originalUrl: `/api${path}`, body, params: {}, baseUrl: "/api" });
    let status = 200;
    const response = {
      locals: {},
      status(code: number) { status = code; return this; },
      json(value: unknown) {
        if (status < 200 || status >= 300) reject(new ApprovalError(status, value));
        else if (!value || typeof value !== "object" || !("id" in value) || !Number.isSafeInteger(value.id) || Number(value.id) <= 0) {
          reject(new ApprovalError(500, { error: "建立單據未回傳有效編號" }));
        } else resolve({ id: Number(value.id) });
        return this;
      },
      send(value: unknown) { return this.json(value); },
      end() { reject(new ApprovalError(500, { error: "建立單據未回傳結果" })); },
    };
    createRouter(internalReq, response as unknown as Response, (err?: unknown) => {
      reject(err ?? new ApprovalError(500, { error: "找不到建立單據路由" }));
    });
  });
}

function tenant(req: Request): number {
  const id = currentTenantId();
  if (!id || id !== req.session?.user?.tenantId) throw new ApprovalError(403, { error: "租戶上下文不一致" });
  return id;
}

function sendError(res: Response, error: unknown): void {
  if (error instanceof ApprovalError) res.status(error.status).json(error.body);
  else res.status(500).json({ error: "AI 草稿操作失敗，請稍後再試" });
}

router.get("/ai-drafts", async (req, res): Promise<void> => {
  try {
    const tenantId = tenant(req);
    const status = req.query.status ?? "pending";
    if (status !== "pending" && status !== "confirmed" && status !== "rejected") {
      throw new ApprovalError(400, { error: "無效的草稿狀態" });
    }
    const drafts = await db.select().from(aiDraftDocumentsTable)
      .where(and(eq(aiDraftDocumentsTable.tenantId, tenantId), eq(aiDraftDocumentsTable.status, status)))
      .orderBy(desc(aiDraftDocumentsTable.createdAt));
    res.json(drafts);
  } catch (error) { sendError(res, error); }
});

for (const action of ["confirm", "reject"] as const) {
  router.post(`/ai-drafts/:id/${action}`, async (req, res): Promise<void> => {
    try {
      const tenantId = tenant(req);
      const id = Number(req.params.id);
      if (!/^[1-9]\d*$/.test(String(req.params.id)) || !Number.isSafeInteger(id)) {
        throw new ApprovalError(400, { error: "無效的草稿編號" });
      }
      const result = await runInTenantTransaction(async () => {
        const condition = and(eq(aiDraftDocumentsTable.id, id), eq(aiDraftDocumentsTable.tenantId, tenantId));
        const [draft] = await db.select().from(aiDraftDocumentsTable).where(condition).for("update");
        if (!draft) throw new ApprovalError(404, { error: "找不到 AI 草稿" });
        if (draft.status !== "pending") throw new ApprovalError(409, { error: "此草稿已處理，不能重複操作" });
        if (action === "reject") {
          const [rejected] = await db.update(aiDraftDocumentsTable).set({ status: "rejected" }).where(condition).returning();
          return rejected;
        }
        const type = docTypeSchema.safeParse(draft.docType);
        if (!type.success) throw new ApprovalError(400, { error: "不支援的草稿類型" });
        let body: Record<string, unknown>;
        try { body = await validateDraft(type.data, draft.payload); }
        catch { throw new ApprovalError(400, { error: "草稿資料已失效或不符合建立條件，請重新建立草稿" }); }
        const document = await dispatchDraftCreate(req, draftTarget(type.data), body);
        const [confirmed] = await db.update(aiDraftDocumentsTable).set({
          status: "confirmed", confirmedBy: req.session!.user!.id,
          confirmedAt: new Date(), resultDocumentId: document.id,
        }).where(condition).returning();
        // Awaited inside the same transaction, unlike the legacy HTTP audit
        // wrapper. Record identifiers only, never the financial payload.
        await db.insert(aiActionsTable).values({
          tenantId, tool: "human_confirm_draft", args: { draftId: id, userId: req.session!.user!.id },
          status: "ok", resultSummary: "Human confirmed AI draft",
          targetType: type.data, targetId: document.id,
        });
        return confirmed;
      });
      res.json(result);
    } catch (error) { sendError(res, error); }
  });
}

// ── AI customer-master drafts (ai_customer_drafts) ───────────────────────────
// Same session-only/role chain as above (mounted under /ai-drafts). Confirmation
// creates the formal customer ONLY through the existing POST /customers handler.
router.get("/ai-drafts/customers", async (req, res): Promise<void> => {
  try {
    const tenantId = tenant(req);
    const status = req.query.status ?? "pending";
    if (status !== "pending" && status !== "confirmed" && status !== "rejected") {
      throw new ApprovalError(400, { error: "無效的草稿狀態" });
    }
    const drafts = await db.select().from(aiCustomerDraftsTable)
      .where(and(eq(aiCustomerDraftsTable.tenantId, tenantId), eq(aiCustomerDraftsTable.status, status)))
      .orderBy(desc(aiCustomerDraftsTable.createdAt));
    res.json(drafts);
  } catch (error) { sendError(res, error); }
});

const CONFLICT_LABEL = { taxId: "統一編號", customerCode: "客戶代碼", name: "客戶名稱" } as const;

for (const action of ["confirm", "reject"] as const) {
  router.post(`/ai-drafts/customers/:id/${action}`, async (req, res): Promise<void> => {
    try {
      const tenantId = tenant(req);
      const id = Number(req.params.id);
      if (!/^[1-9]\d*$/.test(String(req.params.id)) || !Number.isSafeInteger(id)) {
        throw new ApprovalError(400, { error: "無效的草稿編號" });
      }
      const result = await runInTenantTransaction(async () => {
        const condition = and(eq(aiCustomerDraftsTable.id, id), eq(aiCustomerDraftsTable.tenantId, tenantId));
        const [draft] = await db.select().from(aiCustomerDraftsTable).where(condition).for("update");
        if (!draft) throw new ApprovalError(404, { error: "找不到 AI 客戶草稿" });
        if (draft.status !== "pending") throw new ApprovalError(409, { error: "此草稿已處理，不能重複操作" });
        if (action === "reject") {
          const [rejected] = await db.update(aiCustomerDraftsTable).set({ status: "rejected" }).where(condition).returning();
          return rejected;
        }
        let body: Record<string, unknown>;
        try { body = await validateCustomerDraft(draft.payload, id); }
        catch (error) {
          if (error instanceof CustomerDraftConflictError) {
            throw new ApprovalError(409, {
              error: `${error.source === "customer" ? "已有正式客戶" : "已有其他待確認客戶草稿"}使用相同${CONFLICT_LABEL[error.field]}，無法建立`,
              field: error.field,
            });
          }
          throw new ApprovalError(400, { error: "客戶草稿資料已失效或不符合建立條件，請重新建立草稿" });
        }
        const customer = await dispatchDraftCreate(req, "/customers", body);
        const [confirmed] = await db.update(aiCustomerDraftsTable).set({
          status: "confirmed", confirmedBy: req.session!.user!.id,
          confirmedAt: new Date(), resultCustomerId: customer.id,
        }).where(condition).returning();
        await db.insert(aiActionsTable).values({
          tenantId, tool: "human_confirm_customer_draft", args: { draftId: id, userId: req.session!.user!.id },
          status: "ok", resultSummary: "Human confirmed AI customer draft",
          targetType: "customers", targetId: customer.id,
        });
        return confirmed;
      });
      res.json(result);
    } catch (error) { sendError(res, error); }
  });
}

export default router;
