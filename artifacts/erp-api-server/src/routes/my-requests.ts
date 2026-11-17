import { Router, type IRouter } from "express";
import { and, desc, eq, inArray } from "drizzle-orm";
import { db, paymentRequestsTable, suppliersTable, projectsTable, departmentsTable, approvalRequestsTable, approvalWorkflowsTable, notificationsTable, activitiesTable } from "@workspace/erp-db";
import { requireAuth } from "../middleware/require-auth";
import { nextDocNumber } from "../lib/doc-number";
import { isRealDate } from "../lib/cash-accounts";
import { todayTaipei } from "../lib/inventory-journal";
import { createApprovalRequest, workflowSteps, stepLabel } from "../utils/approval-helper";
import { documentAttachments, receiptUpload, saveDocumentAttachment, sendAttachment, removeAttachment, MAX_ATTACHMENTS_PER_DOCUMENT } from "../lib/document-attachments";

/**
 * 我的申請：每個登入的人（含員工自助帳號）都可以自己送出請款／付款申請，並追蹤審批進度。
 *
 * 老闆 2026-11-15：員工送出收款、付款或相關申請，就出現在財務與管理員的審批裡，這張單是未批准的狀態。
 * 送出的是一般的「付款申請」（狀態：待審核），之後照審批流程走；核准、付款才會入帳。
 * 這裡只能看、撤回自己送的；金額與對象送出後不能自己改（要改就撤回重送），核准與付款是主管和財務的事。
 */
const router: IRouter = Router();
router.use("/my-requests", requireAuth);

/** 申請類型（沿用 Ecount 簽核的分類，方便財務歸類） */
const CATEGORIES = ["人事薪資", "專案雜費", "物品進貨費用", "行政用品", "行銷廣告費用", "研發費用", "其他"];
const me = (req: any): { username: string; displayName: string } => {
  const user = req.session?.user ?? {};
  return { username: String(user.username || ""), displayName: String(user.displayName || user.username || "") };
};
/** 財務（含老闆、管理員）在同一張表單多填付款方式、銀行帳號、到期日 */
const FINANCE_ROLES = ["super_admin", "owner", "admin", "finance_admin", "accountant"];
const isFinance = (req: any): boolean => FINANCE_ROLES.includes(String(req.session?.user?.role || ""));
const round2 = (n: number): number => Math.round(n * 100) / 100;
interface RequestLine { summary: string; amount: number; payTo: "self" | "other"; payeeId: number; payeeName: string }
/** 存在付款申請 metadata.lines 的每一行；付款入帳時每一行各自一組借貸，摘要就是這一行的摘要 */
export interface StoredRequestLine { payee: string; supplierId: number; summary: string; amount: number; self: boolean }
const fallbackNumber = (): string => "PRQ-" + String(Date.now()).slice(-8);

/** 一張申請的內容（每一行付給誰、摘要、金額；類型；備註）。「我的申請」和「付款申請」開的是同一個畫面，所以共用 */
export function requestContent(metadata: unknown): { lines: StoredRequestLine[] | null; category: string | null; memo: string | null } {
  const m = (metadata ?? {}) as { lines?: unknown; category?: unknown; memo?: unknown };
  return { lines: Array.isArray(m.lines) ? m.lines as StoredRequestLine[] : null, category: typeof m.category === "string" ? m.category : null, memo: typeof m.memo === "string" ? m.memo : null };
}

export interface ApprovalProgress { status: string; currentStep: number; totalSteps: number; stepLabels: string[]; comments: string | null; history: Array<{ name: string; action: string; step: number; at: string; comments: string | null }> }
/** 這些付款申請的審批進度（每張取最新的一筆審批） */
export async function approvalProgress(ids: number[]): Promise<Map<number, ApprovalProgress>> {
  const out = new Map<number, ApprovalProgress>();
  if (ids.length === 0) return out;
  const approvals = await db.select().from(approvalRequestsTable).where(and(eq(approvalRequestsTable.documentType, "PaymentRequest"), inArray(approvalRequestsTable.documentId, ids))).orderBy(approvalRequestsTable.id);
  const workflowIds = [...new Set(approvals.map(a => a.workflowId).filter((id): id is number => typeof id === "number"))];
  const workflows = workflowIds.length > 0 ? await db.select().from(approvalWorkflowsTable).where(inArray(approvalWorkflowsTable.id, workflowIds)) : [];
  for (const approval of approvals) {
    if (approval.documentId == null) continue;
    const steps = approval.workflowId ? workflowSteps(workflows.find(w => w.id === approval.workflowId)) : [];
    const history = Array.isArray(approval.approvers) ? (approval.approvers as any[]).filter(h => h && typeof h === "object") : [];
    out.set(approval.documentId, {
      status: approval.status, currentStep: approval.currentStep, totalSteps: approval.totalSteps,
      stepLabels: steps.length > 0 ? steps.map(stepLabel) : ["主管"],
      comments: approval.comments ?? null,
      history: history.map(h => ({ name: String(h.name ?? ""), action: String(h.action ?? ""), step: Number(h.step) || 1, at: String(h.at ?? ""), comments: h.comments ? String(h.comments) : null })),
    });
  }
  return out;
}

/** 表單要用的選項：專案、部門、付款對象（只給編號與名稱，不含廠商的聯絡與銀行資料） */
router.get("/my-requests/options", async (req, res): Promise<void> => {
  const [projects, departments, payees] = await Promise.all([
    db.select({ id: projectsTable.id, name: projectsTable.name, parentId: projectsTable.parentId }).from(projectsTable).where(eq(projectsTable.isActive, true)).orderBy(projectsTable.name),
    db.select({ id: departmentsTable.id, name: departmentsTable.name }).from(departmentsTable).orderBy(departmentsTable.name),
    db.select({ id: suppliersTable.id, name: suppliersTable.name }).from(suppliersTable).where(eq(suppliersTable.isActive, true)).orderBy(suppliersTable.name),
  ]);
  res.json({ me: me(req), categories: CATEGORIES, projects, departments, payees, finance: isFinance(req) });
});

/** 我送出的申請，最新的在前面；附上審批進度 */
router.get("/my-requests", async (req, res): Promise<void> => {
  const { username } = me(req);
  if (!username) { res.status(401).json({ error: "請重新登入" }); return; }
  const rows = await db.select({
    id: paymentRequestsTable.id, requestNumber: paymentRequestsTable.requestNumber, requestDate: paymentRequestsTable.requestDate,
    amount: paymentRequestsTable.amount, status: paymentRequestsTable.status, remarks: paymentRequestsTable.remarks, createdAt: paymentRequestsTable.createdAt, metadata: paymentRequestsTable.metadata,
    payeeName: suppliersTable.name, projectName: projectsTable.name, departmentName: departmentsTable.name,
  }).from(paymentRequestsTable)
    .leftJoin(suppliersTable, eq(paymentRequestsTable.supplierId, suppliersTable.id))
    .leftJoin(projectsTable, eq(paymentRequestsTable.projectId, projectsTable.id))
    .leftJoin(departmentsTable, eq(paymentRequestsTable.departmentId, departmentsTable.id))
    .where(eq(paymentRequestsTable.requestedBy, username))
    .orderBy(desc(paymentRequestsTable.id)).limit(300);
  const progress = await approvalProgress(rows.map(r => r.id));
  res.json(rows.map(row => {
    const { metadata, ...rest } = row;
    return { ...rest, amount: Number(row.amount), ...requestContent(metadata), approval: progress.get(row.id) ?? null };
  }));
});

/** 送出一張申請（直接進入待審核） */
router.post("/my-requests", async (req, res): Promise<void> => {
  const { username, displayName } = me(req);
  if (!username) { res.status(401).json({ error: "請重新登入" }); return; }
  const body = req.body ?? {};
  const projectId = Number(body.projectId);
  if (!Number.isInteger(projectId) || projectId <= 0) { res.status(400).json({ error: "請選擇專案：每一筆收入與支出都必須歸屬到專案" }); return; }
  // 每一行：付給誰、摘要、金額（跟 Ecount 付款單一樣，一張單可以付給好幾個人，例如暑期講師費）。
  // 舊版畫面整張單只有一個付款對象，沒帶每行對象時沿用整張單的設定
  const lines: RequestLine[] = (Array.isArray(body.lines) ? body.lines : []).slice(0, 30)
    .map((line: any) => ({
      summary: String(line?.summary ?? "").trim().slice(0, 200),
      amount: round2(Number(line?.amount)),
      payTo: (line?.payTo ?? body.payTo) === "other" ? "other" as const : "self" as const,
      payeeId: Number(line?.payeeId ?? body.payeeId) || 0,
      payeeName: String(line?.payeeName ?? body.payeeName ?? "").trim().slice(0, 100),
    }))
    .filter((line: RequestLine) => line.summary || line.amount);
  if (lines.length === 0) { res.status(400).json({ error: "請至少填一行：付給誰、摘要、多少錢" }); return; }
  const bad = lines.findIndex(line => !line.summary || !Number.isFinite(line.amount) || line.amount <= 0);
  if (bad >= 0) { res.status(400).json({ error: `第 ${bad + 1} 行要填摘要，金額要大於 0` }); return; }
  const noPayee = lines.findIndex(line => line.payTo === "other" && !line.payeeId && !line.payeeName);
  if (noPayee >= 0) { res.status(400).json({ error: `第 ${noPayee + 1} 行請選擇或填寫要付給誰` }); return; }
  const total = round2(lines.reduce((sum, line) => sum + line.amount, 0));
  const requestDate = typeof body.requestDate === "string" && body.requestDate ? body.requestDate : todayTaipei();
  if (!isRealDate(requestDate) || requestDate > todayTaipei()) { res.status(400).json({ error: "日期格式不正確，或填在未來" }); return; }
  const category = CATEGORIES.includes(body.category) ? body.category : "其他";
  const memo = String(body.memo ?? body.description ?? "").trim().slice(0, 2000);
  // 財務才能填的欄位；其他人送來一律不收
  const finance = isFinance(req);
  const dueDate = finance && typeof body.dueDate === "string" && body.dueDate ? body.dueDate : null;
  if (dueDate && !isRealDate(dueDate)) { res.status(400).json({ error: "到期日格式不正確" }); return; }
  const paymentMethod = finance && typeof body.paymentMethod === "string" && body.paymentMethod.trim() ? body.paymentMethod.trim().slice(0, 30) : null;
  const bankAccount = finance && typeof body.bankAccount === "string" && body.bankAccount.trim() ? body.bankAccount.trim().slice(0, 60) : null;

  try {
    const result = await db.transaction(async (tx) => {
      const [project] = await tx.select({ id: projectsTable.id }).from(projectsTable).where(eq(projectsTable.id, projectId));
      if (!project) throw new Error("找不到這個專案");
      // 付款對象：付給自己（先墊的錢）用自己的名字；付給別人可以選現有的，或直接填名字（主檔沒有就補建，財務審的時候會看到）
      const resolved = new Map<string, { supplierId: number; payee: string }>();
      const resolvePayee = async (line: RequestLine) => {
        const key = line.payTo === "self" ? "self" : line.payeeId ? `id:${line.payeeId}` : `name:${line.payeeName}`;
        const hit = resolved.get(key);
        if (hit) return hit;
        let out: { supplierId: number; payee: string };
        if (line.payTo === "other" && line.payeeId > 0) {
          const [found] = await tx.select({ id: suppliersTable.id, name: suppliersTable.name }).from(suppliersTable).where(eq(suppliersTable.id, line.payeeId));
          if (!found) throw new Error("找不到這個付款對象");
          out = { supplierId: found.id, payee: found.name };
        } else {
          const payee = line.payTo === "self" ? displayName : line.payeeName;
          const [found] = await tx.select({ id: suppliersTable.id, isActive: suppliersTable.isActive }).from(suppliersTable).where(eq(suppliersTable.name, payee));
          if (found) {
            if (!found.isActive) await tx.update(suppliersTable).set({ isActive: true }).where(eq(suppliersTable.id, found.id));
            out = { supplierId: found.id, payee };
          } else {
            const [made] = await tx.insert(suppliersTable).values({ name: payee, supplierCode: `REQ-${Date.now().toString(36).toUpperCase()}-${resolved.size}`, isActive: true } as any).returning({ id: suppliersTable.id });
            out = { supplierId: made.id, payee };
          }
        }
        resolved.set(key, out);
        return out;
      };
      const stored: StoredRequestLine[] = [];
      for (const line of lines) {
        const who = await resolvePayee(line);
        stored.push({ payee: who.payee, supplierId: who.supplierId, summary: line.summary, amount: line.amount, self: line.payTo === "self" });
      }
      const departmentId = Number.isInteger(Number(body.departmentId)) && Number(body.departmentId) > 0 ? Number(body.departmentId) : null;
      const remarks = [
        `${category}｜申請人 ${displayName}`,
        ...stored.map(line => `・${line.payee}${line.self ? "（自己先墊）" : ""}｜${line.summary}　${line.amount.toLocaleString()}`),
        memo,
      ].filter(Boolean).join("\n");
      const [request] = await tx.insert(paymentRequestsTable).values({
        requestNumber: await nextDocNumber(tx, "payment_requests", "request_number", "PRQ", fallbackNumber),
        // 整張單的付款對象放第一行的人（清單、付款畫面顯示用）；每一行各自的對象存在 metadata.lines
        partyType: "Supplier", supplierId: stored[0].supplierId, requestDate, amount: String(total), status: "Pending",
        projectId, departmentId, remarks, requestedBy: username, dueDate, paymentMethod, bankAccount,
        metadata: { lines: stored, category, memo },
      }).returning();
      await createApprovalRequest({ module: "Accounting", documentType: "PaymentRequest", documentId: request.id, documentNumber: request.requestNumber, requestedBy: username }, tx);
      const payees = [...new Set(stored.map(line => line.payee))];
      const payee = payees.length > 1 ? `${payees[0]} 等 ${payees.length} 人` : payees[0];
      await tx.insert(activitiesTable).values({ type: "create", title: "員工送出付款申請", description: `${request.requestNumber} - ${displayName} → ${payee} - $${total.toFixed(2)}`, module: "Accounting" });
      return { request, payee };
    });
    res.status(201).json({ id: result.request.id, requestNumber: result.request.requestNumber, amount: total, payeeName: result.payee, status: "Pending" });
  } catch (err: any) {
    res.status(400).json({ error: /[㐀-鿿]/.test(err?.message || "") ? err.message : "送出失敗，請稍後再試" });
  }
});

/** 撤回自己送的申請（還沒核准之前）。撤回後這張單作廢，要改內容請重新送一張 */
router.post("/my-requests/:id/cancel", async (req, res): Promise<void> => {
  const { username, displayName } = me(req);
  const id = Number(req.params.id);
  if (!username || !Number.isInteger(id) || id <= 0) { res.status(400).json({ error: "申請編號格式不正確" }); return; }
  try {
    const row = await db.transaction(async (tx) => {
      const [locked] = await tx.select().from(paymentRequestsTable).where(eq(paymentRequestsTable.id, id)).for("update");
      if (!locked || locked.requestedBy !== username) throw Object.assign(new Error("找不到這張申請，或這不是你送出的"), { status: 404 });
      if (locked.status !== "Pending" && locked.status !== "Draft" && locked.status !== "Rejected") throw new Error("這張申請已經核准或付款，不能撤回；有問題請找財務");
      const [updated] = await tx.update(paymentRequestsTable).set({ status: "Cancelled" }).where(eq(paymentRequestsTable.id, id)).returning();
      // 還在等審批的那一筆一起結束，審批的人不用再處理
      await tx.update(approvalRequestsTable).set({ status: "Cancelled", comments: `申請人 ${displayName} 撤回` })
        .where(and(eq(approvalRequestsTable.documentType, "PaymentRequest"), eq(approvalRequestsTable.documentId, id), inArray(approvalRequestsTable.status, ["Pending", "In Progress"])));
      await tx.insert(notificationsTable).values({ title: "付款申請已撤回", message: `${updated.requestNumber} 已由申請人 ${displayName} 撤回`, type: "approval", module: "Accounting", documentType: "PaymentRequest", documentId: id });
      return updated;
    });
    res.json({ id: row.id, status: row.status });
  } catch (err: any) {
    res.status(Number(err?.status) || 400).json({ error: err?.message || "撤回失敗" });
  }
});

/** 只能動自己送的單；回傳那張單（找不到或不是自己的就回 null） */
async function ownRequest(id: number, username: string) {
  if (!username || !Number.isInteger(id) || id <= 0) return null;
  const [row] = await db.select({ id: paymentRequestsTable.id, status: paymentRequestsTable.status, requestedBy: paymentRequestsTable.requestedBy, requestNumber: paymentRequestsTable.requestNumber })
    .from(paymentRequestsTable).where(eq(paymentRequestsTable.id, id));
  return row && row.requestedBy === username ? row : null;
}
/** 還沒核准、付款之前才能補或刪附件 */
const stillEditable = (status: string) => ["Draft", "Pending", "Rejected"].includes(status);

/** 自己這張申請的收據、發票照片 */
router.get("/my-requests/:id/attachments", async (req, res): Promise<void> => {
  const request = await ownRequest(Number(req.params.id), me(req).username);
  if (!request) { res.status(404).json({ error: "找不到這張申請，或這不是你送出的" }); return; }
  res.json(await documentAttachments("PaymentRequest", request.id));
});

/** 附上收據、發票照片（一次最多 10 張，照片或 PDF） */
router.post("/my-requests/:id/attachments", receiptUpload.array("files", MAX_ATTACHMENTS_PER_DOCUMENT), async (req, res): Promise<void> => {
  const { username } = me(req);
  const request = await ownRequest(Number(req.params.id), username);
  if (!request) { res.status(404).json({ error: "找不到這張申請，或這不是你送出的" }); return; }
  if (!stillEditable(request.status)) { res.status(400).json({ error: "這張申請已經核准或付款，不能再補附件；有問題請找財務" }); return; }
  const files = (req.files as Express.Multer.File[] | undefined) ?? [];
  if (files.length === 0) { res.status(400).json({ error: "請選擇要上傳的照片或 PDF" }); return; }
  const existing = await documentAttachments("PaymentRequest", request.id);
  if (existing.length + files.length > MAX_ATTACHMENTS_PER_DOCUMENT) { res.status(400).json({ error: `一張申請最多 ${MAX_ATTACHMENTS_PER_DOCUMENT} 個附件，已經有 ${existing.length} 個` }); return; }
  const saved = [];
  for (const file of files) {
    try {
      saved.push(await saveDocumentAttachment(file, { module: "Accounting", documentType: "PaymentRequest", documentId: request.id, uploadedBy: username, description: `${request.requestNumber} 收據` }));
    } catch {
      res.status(502).json({ error: `「${file.originalname}」上傳失敗，請再試一次`, saved: saved.length }); return;
    }
  }
  res.status(201).json(await documentAttachments("PaymentRequest", request.id));
});

/** 打開自己這張申請的附件 */
router.get("/my-requests/:id/attachments/:attachmentId", async (req, res): Promise<void> => {
  const request = await ownRequest(Number(req.params.id), me(req).username);
  const attachmentId = Number(req.params.attachmentId);
  const list = request ? await documentAttachments("PaymentRequest", request.id) : [];
  if (!list.some(a => a.id === attachmentId)) { res.status(404).json({ error: "找不到這個附件" }); return; }
  await sendAttachment(res, attachmentId);
});

/** 刪掉自己上傳、還沒核准的附件 */
router.delete("/my-requests/:id/attachments/:attachmentId", async (req, res): Promise<void> => {
  const { username } = me(req);
  const request = await ownRequest(Number(req.params.id), username);
  if (!request) { res.status(404).json({ error: "找不到這張申請，或這不是你送出的" }); return; }
  if (!stillEditable(request.status)) { res.status(400).json({ error: "這張申請已經核准或付款，附件不能刪" }); return; }
  const attachmentId = Number(req.params.attachmentId);
  const target = (await documentAttachments("PaymentRequest", request.id)).find(a => a.id === attachmentId);
  if (!target || target.uploadedBy !== username) { res.status(404).json({ error: "找不到這個附件，或不是你上傳的" }); return; }
  await removeAttachment(attachmentId);
  res.sendStatus(204);
});

export default router;
