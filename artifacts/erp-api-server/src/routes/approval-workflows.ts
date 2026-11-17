import { Router, type IRouter } from "express";
import { eq, and, sql, desc } from "drizzle-orm";
import { db, approvalWorkflowsTable, approvalRequestsTable, notificationsTable, leavesTable, paymentRequestsTable, vouchersTable, changeRequestsTable } from "@workspace/erp-db";
import { CHANGE_DOC_TYPE, CHANGE_KIND_LABELS, applyChangeDecision, changeReviewBlock, reviseChangePayload, type ChangeKind } from "../lib/change-requests";
import { assertPeriodOpen } from "../lib/auto-journal";
import { postReimbursementLedger } from "./reimbursement-ai";
import { requireAuth, requireRole } from "../middleware/require-auth";
import { documentAttachments, sendAttachment } from "../lib/document-attachments";
import { workflowSteps, APPROVER_ROLES, stepRole, stepLabel, stepRecipients, resolveStep, type ApprovalStep } from "../utils/approval-helper";

const router: IRouter = Router();
router.use("/approval-workflows", requireAuth);
router.use("/approval-requests", requireAuth);
// 公司擁有者也要能審批與設定流程
const writeRoles = requireRole("super_admin", "owner", "admin", "manager");
// 核准／駁回：凡是可以被設成關卡的角色都要進得來（原本只放主管，會計、財務被設成關卡也審不了）。
// 每一關實際能不能審，下面會再依這一關指定的角色或人檢查。
const decisionRoles = requireRole("super_admin", ...Object.keys(APPROVER_ROLES));
/** 可以代替指定審批人核准的角色 */
const OVERRIDE_ROLES = ["super_admin", "owner", "admin"];

/** 只接受流程定義該有的欄位，避免整包寫入 */
function workflowInput(body: any): { data: Record<string, unknown>; error: string | null } {
  const data: Record<string, unknown> = {};
  for (const key of ["name", "module", "documentType", "description"]) {
    if (body[key] !== undefined) data[key] = body[key] === null ? null : String(body[key]).trim();
  }
  if (body.isActive !== undefined) data.isActive = body.isActive === "No" || body.isActive === false ? "No" : "Yes";
  if (body.steps !== undefined) {
    if (!Array.isArray(body.steps)) return { data, error: "關卡格式不正確" };
    data.steps = body.steps.map((s: any, i: number) => ({
      stepNumber: i + 1,
      // 角色只收系統裡有的角色；舊資料這一欄是自由填的職務說明，改放到 note
      approverRole: APPROVER_ROLES[String(s?.approverRole ?? "").trim()] ? String(s.approverRole).trim() : "",
      approverName: String(s?.approverName ?? "").trim(),
      note: String(s?.note ?? (APPROVER_ROLES[String(s?.approverRole ?? "").trim()] ? "" : s?.approverRole) ?? "").trim().slice(0, 60),
    }));
  }
  return { data, error: null };
}

/** 可以選的審批角色，以及哪些單據會走審批（給設定畫面用） */
router.get("/approval-workflows/options", async (_req, res): Promise<void> => {
  res.json({
    roles: Object.entries(APPROVER_ROLES).map(([value, label]) => ({ value, label })),
    documents: [
      { module: "Accounting", documentType: "PaymentRequest", label: "付款申請（含 AI 報銷、員工請款）", when: "建立或送審時送出審批；全部關卡核准後才能付款" },
      { module: "Purchasing", documentType: "PurchaseOrder", label: "採購訂單", when: "建立採購單時送出審批；核准後才能確認下單" },
      { module: "HR", documentType: "Leave", label: "請假單", when: "員工送出請假時送出審批；核准後才算請假成功" },
      { module: "Accounting", documentType: CHANGE_DOC_TYPE, label: "異動申請（已過帳單據修改、刪除，月份解鎖）", when: "要改或刪已過帳的單據、要解鎖已關帳的月份時送出；核准後系統才執行。沒設流程時由財務或超級管理員其一審；財務送的一律給超級管理員" },
    ],
  });
});

router.get("/approval-workflows", async (_req, res): Promise<void> => {
  const rows = await db.select().from(approvalWorkflowsTable).orderBy(desc(approvalWorkflowsTable.createdAt));
  res.json(rows);
});

router.post("/approval-workflows", writeRoles, async (req, res): Promise<void> => {
  const { data, error } = workflowInput(req.body);
  if (error) { res.status(400).json({ error }); return; }
  if (!data.name || !data.module || !data.documentType) { res.status(400).json({ error: "請填寫流程名稱、模組與文件類型" }); return; }
  const [row] = await db.insert(approvalWorkflowsTable).values({ steps: [], ...data } as any).returning();
  res.status(201).json(row);
});

router.get("/approval-workflows/:id", async (req, res): Promise<void> => {
  const [row] = await db.select().from(approvalWorkflowsTable).where(eq(approvalWorkflowsTable.id, Number(req.params.id)));
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  res.json(row);
});

router.patch("/approval-workflows/:id", writeRoles, async (req, res): Promise<void> => {
  const { data, error } = workflowInput(req.body);
  if (error) { res.status(400).json({ error }); return; }
  if (Object.keys(data).length === 0) { res.status(400).json({ error: "沒有可更新的欄位" }); return; }
  const [row] = await db.update(approvalWorkflowsTable).set(data).where(eq(approvalWorkflowsTable.id, Number(req.params.id))).returning();
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  res.json(row);
});

router.delete("/approval-workflows/:id", writeRoles, async (req, res): Promise<void> => {
  const [row] = await db.delete(approvalWorkflowsTable).where(eq(approvalWorkflowsTable.id, Number(req.params.id))).returning();
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  res.sendStatus(204);
});

router.get("/approval-requests", async (req, res): Promise<void> => {
  // 單據已經取消、作廢或刪掉了，審批就沒有意義：自動改成「已撤銷」，不會再卡在待審
  await db.execute(sql`
    UPDATE approval_requests a SET status = 'Cancelled'
    WHERE a.status IN ('Pending', 'In Progress') AND (
      (a.document_type = 'PurchaseOrder' AND NOT EXISTS (SELECT 1 FROM purchase_orders o WHERE o.id = a.document_id AND o.status NOT IN ('Cancelled', 'Voided')))
      OR (a.document_type = 'PaymentRequest' AND NOT EXISTS (SELECT 1 FROM payment_requests r WHERE r.id = a.document_id AND r.status NOT IN ('Cancelled', 'Voided')))
      OR (a.document_type = 'Leave' AND NOT EXISTS (SELECT 1 FROM leaves l WHERE l.id = a.document_id AND l.status <> 'Cancelled'))
      OR (a.document_type = 'ChangeRequest' AND NOT EXISTS (SELECT 1 FROM change_requests c WHERE c.id = a.document_id AND c.status = 'Pending'))
    )`);
  const conditions: any[] = [];
  if (req.query.status) conditions.push(eq(approvalRequestsTable.status, req.query.status as string));
  if (req.query.documentType) conditions.push(eq(approvalRequestsTable.documentType, req.query.documentType as string));
  const rows = await db.select().from(approvalRequestsTable).where(conditions.length > 0 ? and(...conditions) : undefined).orderBy(desc(approvalRequestsTable.createdAt));
  // 每一筆附上單據的重點，審批的人在清單上就看得到金額與對象
  const idsOf = (type: string) => rows.filter(r => r.documentType === type).map(r => r.documentId);
  const summary = new Map<string, { amount: number | null; party: string | null; project: string | null; note: string | null }>();
  const paymentIds = idsOf("PaymentRequest"), orderIds = idsOf("PurchaseOrder");
  if (paymentIds.length > 0) {
    const found: any = await db.execute(sql`
      SELECT r.id, r.amount::float AS amount, COALESCE(s.name, c.name) AS party, p.name AS project, split_part(COALESCE(r.remarks, ''), E'\\n', 1) AS note
      FROM payment_requests r LEFT JOIN suppliers s ON s.id = r.supplier_id LEFT JOIN customers c ON c.id = r.customer_id LEFT JOIN projects p ON p.id = r.project_id
      WHERE r.id IN (${sql.join(paymentIds.map(id => sql`${id}`), sql`, `)})`);
    for (const row of (found.rows ?? found)) summary.set(`PaymentRequest:${row.id}`, { amount: Number(row.amount), party: row.party, project: row.project, note: row.note || null });
  }
  if (orderIds.length > 0) {
    const found: any = await db.execute(sql`
      SELECT o.id, (o.total_amount * o.exchange_rate)::float AS amount, s.name AS party, p.name AS project
      FROM purchase_orders o LEFT JOIN suppliers s ON s.id = o.supplier_id LEFT JOIN projects p ON p.id = o.project_id
      WHERE o.id IN (${sql.join(orderIds.map(id => sql`${id}`), sql`, `)})`);
    for (const row of (found.rows ?? found)) summary.set(`PurchaseOrder:${row.id}`, { amount: Number(row.amount), party: row.party, project: row.project, note: null });
  }
  const changeIds = idsOf(CHANGE_DOC_TYPE).filter((id): id is number => typeof id === "number");
  const changes = new Map<number, { requestedBy: string; requestedRole: string | null }>();
  if (changeIds.length > 0) {
    const found = await db.select().from(changeRequestsTable).where(sql`${changeRequestsTable.id} IN (${sql.join(changeIds.map(id => sql`${id}`), sql`, `)})`);
    for (const c of found) {
      changes.set(c.id, { requestedBy: c.requestedBy, requestedRole: c.requestedRole });
      summary.set(`${CHANGE_DOC_TYPE}:${c.id}`, { amount: null, party: null, project: null, note: c.title });
    }
  }
  const workflowIds = [...new Set(rows.map(r => r.workflowId).filter((id): id is number => typeof id === "number"))];
  const workflows = workflowIds.length > 0 ? await db.select().from(approvalWorkflowsTable).where(sql`${approvalWorkflowsTable.id} IN (${sql.join(workflowIds.map(id => sql`${id}`), sql`, `)})`) : [];
  const stepsOf = new Map(workflows.map(w => [w.id, workflowSteps(w)]));
  res.json(await Promise.all(rows.map(async row => {
    const steps = row.workflowId ? stepsOf.get(row.workflowId) ?? [] : [];
    const open = row.status === "Pending" || row.status === "In Progress";
    const current = open ? await resolveStep(db, steps[row.currentStep - 1], row.requestedBy) : steps[row.currentStep - 1];
    return {
      ...row, summary: summary.get(`${row.documentType}:${row.documentId}`) ?? null,
      workflowName: workflows.find(w => w.id === row.workflowId)?.name ?? null,
      // 每一關由誰審；沒有設定流程的單據是「任何主管都可以審」
      stepLabels: steps.length > 0 ? steps.map(stepLabel) : ["任何主管"],
      currentStepLabel: stepLabel(current),
      canDecide: decisionBlock(row, current, (req as any).session?.user, row.documentType === CHANGE_DOC_TYPE ? changes.get(row.documentId ?? 0) : undefined) === null,
    };
  })));
});

router.post("/approval-requests", async (req, res): Promise<void> => {
  const { workflowId, documentType, documentId, documentNumber, totalSteps, approvers, comments } = req.body;
  if (!documentType || !documentId) { res.status(400).json({ error: "Missing required fields" }); return; }
  // 申請人由登入身分決定，不可由前端指定（防止冒名）
  const sessionUser = (req as any).session?.user;
  const requestedBy = sessionUser?.username || sessionUser?.name || req.body.requestedBy;
  if (!requestedBy) { res.status(400).json({ error: "無法識別申請人" }); return; }
  const [row] = await db.insert(approvalRequestsTable).values({ workflowId, documentType, documentId, documentNumber, requestedBy, totalSteps: totalSteps || 1, approvers: approvers || [], comments }).returning();
  // 通知各審批人；未指定審批人時為全域通知
  const approverNames: (string | null)[] = Array.isArray(approvers) && approvers.length > 0
    ? approvers.map((a: any) => (typeof a === "string" ? a : a?.name || a?.approverName)).filter(Boolean)
    : [null];
  await db.insert(notificationsTable).values((approverNames.length > 0 ? approverNames : [null]).map(r => ({
    title: "新審批請求", message: `${requestedBy} 提交了 ${documentType} ${documentNumber || ""} 的審批請求`,
    type: "approval", module: "System", documentType, documentId, recipient: r,
  })));
  res.status(201).json(row);
});

/** 這一關目前登入的人能不能審；不能的話回傳原因 */
function decisionBlock(request: { status: string; requestedBy: string | null }, step: ApprovalStep | undefined, actor: { username?: string; displayName?: string; role?: string } | undefined, change?: { requestedBy: string; requestedRole: string | null }): string | null {
  if (request.status !== "Pending" && request.status !== "In Progress") return "這筆審批已經結束";
  if (!actor) return "請先登入";
  // 異動申請：財務或超級管理員其一；財務送的只能給超級管理員（不受下面「擁有者／管理員可代審」影響）
  if (change) { const why = changeReviewBlock(actor, change); if (why) return why; }
  if (actor.username && request.requestedBy && actor.username === request.requestedBy) return "不可審批自己提交的申請";
  if (!["super_admin", ...Object.keys(APPROVER_ROLES)].includes(actor.role || "")) return "你的角色不能審批";
  if (OVERRIDE_ROLES.includes(actor.role || "")) return null;
  const designated = step?.approverName?.trim();
  if (designated) return designated === actor.username || designated === actor.displayName ? null : `這一關指定由「${designated}」審批`;
  const role = stepRole(step);
  if (role && actor.role !== role) return `這一關要由「${APPROVER_ROLES[role]}」審批`;
  return null;
}

const rowsOf = (result: any): any[] => (result?.rows ?? result) as any[];

/** 審批的人（有審批角色）與申請人自己，可以看這張單的附件 */
const canSeeAttachments = (request: { requestedBy: string | null }, actor: { username?: string; role?: string } | undefined): boolean =>
  !!actor && (["super_admin", ...Object.keys(APPROVER_ROLES)].includes(actor.role || "") || (!!actor.username && actor.username === request.requestedBy));

/** 打開審批單據上的附件（收據、發票照片）。只給看得到這筆審批的人，而且附件一定要屬於這張單 */
router.get("/approval-requests/:id/attachments/:attachmentId", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  const attachmentId = Number(req.params.attachmentId);
  if (!Number.isInteger(id) || id <= 0 || !Number.isInteger(attachmentId) || attachmentId <= 0) { res.status(400).json({ error: "編號格式不正確" }); return; }
  const [request] = await db.select().from(approvalRequestsTable).where(eq(approvalRequestsTable.id, id));
  if (!request) { res.status(404).json({ error: "找不到這筆審批" }); return; }
  if (!canSeeAttachments(request, (req as any).session?.user)) { res.status(403).json({ error: "你沒有權限看這張單的附件" }); return; }
  let voucherId: number | null = null;
  if (request.documentType === "PaymentRequest") {
    const [r] = rowsOf(await db.execute(sql`SELECT metadata FROM payment_requests WHERE id = ${request.documentId}`));
    voucherId = Number((r?.metadata as any)?.voucherId) || null;
  }
  const list = await documentAttachments(request.documentType, request.documentId, voucherId);
  if (!list.some(a => a.id === attachmentId)) { res.status(404).json({ error: "這個附件不屬於這張單" }); return; }
  await sendAttachment(res, attachmentId);
});

/** 單筆審批的完整內容：單據重點、明細、審批歷程，以及我能不能審 */
router.get("/approval-requests/:id/detail", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) { res.status(400).json({ error: "審批編號格式不正確" }); return; }
  const [request] = await db.select().from(approvalRequestsTable).where(eq(approvalRequestsTable.id, id));
  if (!request) { res.status(404).json({ error: "找不到這筆審批" }); return; }
  const [workflow] = request.workflowId ? await db.select().from(approvalWorkflowsTable).where(eq(approvalWorkflowsTable.id, request.workflowId)) : [];
  const steps = workflowSteps(workflow);
  const actor = (req as any).session?.user;
  const docId = request.documentId;

  let document: Record<string, unknown> | null = null;
  let voucherId: number | null = null;
  if (docId && request.documentType === "PaymentRequest") {
    const [r] = rowsOf(await db.execute(sql`
      SELECT r.request_number, r.request_date, r.due_date, r.amount::float AS amount, r.status, r.payment_method, r.remarks, r.requested_by, r.metadata,
             COALESCE(s.name, c.name) AS party, p.name AS project, d.name AS department
      FROM payment_requests r LEFT JOIN suppliers s ON s.id = r.supplier_id LEFT JOIN customers c ON c.id = r.customer_id
      LEFT JOIN projects p ON p.id = r.project_id LEFT JOIN departments d ON d.id = r.department_id
      WHERE r.id = ${docId}`));
    if (r) {
      const meta = (r.metadata || {}) as any;
      voucherId = Number(meta.voucherId) || null;
      document = {
        kind: "PaymentRequest", number: r.request_number, status: r.status, amount: r.amount,
        fields: [["付款對象", r.party], ["申請日期", r.request_date], ["希望付款日", r.due_date], ["付款方式", r.payment_method], ["專案", r.project], ["部門", r.department], ["申請人", r.requested_by], ["發票號碼", meta.invoiceNumber]].filter(([, v]) => v),
        lines: Array.isArray(meta.items) ? meta.items.map((it: any) => ({ name: String(it.description || ""), amount: Number(it.amount) || 0 })) : [],
        remarks: r.remarks || "",
        link: `/accounting/payment-requests?open=${docId}`,
      };
    }
  } else if (docId && request.documentType === "PurchaseOrder") {
    const [o] = rowsOf(await db.execute(sql`
      SELECT o.order_number, o.order_date, o.expected_date, o.status, o.total_amount::float AS total, o.currency, o.exchange_rate::float AS rate, o.items,
             s.name AS supplier, p.name AS project, d.name AS department
      FROM purchase_orders o LEFT JOIN suppliers s ON s.id = o.supplier_id LEFT JOIN projects p ON p.id = o.project_id LEFT JOIN departments d ON d.id = o.department_id
      WHERE o.id = ${docId}`));
    if (o) {
      document = {
        kind: "PurchaseOrder", number: o.order_number, status: o.status, amount: Math.round(o.total * (o.rate || 1) * 100) / 100,
        fields: [["供應商", o.supplier], ["下單日期", o.order_date], ["預計到貨", o.expected_date], ["幣別", o.currency !== "TWD" ? `${o.currency}（匯率 ${o.rate}）` : null], ["專案", o.project], ["部門", o.department]].filter(([, v]) => v),
        lines: (Array.isArray(o.items) ? o.items : []).map((it: any) => ({ name: String(it.itemName || it.name || ""), qty: Number(it.quantity) || 0, unit: it.unit || "", price: Number(it.rate ?? it.unitPrice) || 0, amount: Number(it.amount) || 0 })),
        remarks: "",
        link: `/purchasing/orders/${docId}`,
      };
    }
  } else if (docId && request.documentType === "Leave") {
    const [l] = rowsOf(await db.execute(sql`
      SELECT l.leave_type, l.from_date, l.to_date, l.total_days::float AS days, l.reason, l.status, e.first_name || e.last_name AS employee, d.name AS department
      FROM leaves l LEFT JOIN employees e ON e.id = l.employee_id LEFT JOIN departments d ON d.id = e.department_id
      WHERE l.id = ${docId}`));
    if (l) {
      document = {
        kind: "Leave", number: request.documentNumber, status: l.status, amount: null,
        fields: [["員工", l.employee], ["部門", l.department], ["假別", l.leave_type], ["期間", l.from_date === l.to_date ? l.from_date : `${l.from_date} ～ ${l.to_date}`], ["天數", `${l.days} 天`]].filter(([, v]) => v),
        lines: [],
        remarks: l.reason || "",
        link: "/hr/leaves",
      };
    }
  }

  let change: { requestedBy: string; requestedRole: string | null } | undefined;
  if (docId && request.documentType === CHANGE_DOC_TYPE) {
    const [c] = await db.select().from(changeRequestsTable).where(eq(changeRequestsTable.id, docId));
    if (c) {
      change = { requestedBy: c.requestedBy, requestedRole: c.requestedRole };
      document = {
        kind: CHANGE_DOC_TYPE, number: c.requestNumber, status: c.status, amount: null,
        fields: [["異動種類", CHANGE_KIND_LABELS[c.kind as ChangeKind] ?? c.kind], ["內容", c.title], ["單據", c.targetNumber], ["申請人", c.requestedBy], ["執行結果", c.result]].filter(([, v]) => v),
        lines: [],
        remarks: c.reason,
        change: { kind: c.kind, targetType: c.targetType, targetId: c.targetId, payload: c.payload, original: c.original },
        link: null,
      };
    }
  }
  const currentStep = await resolveStep(db, steps[request.currentStep - 1], request.requestedBy);
  res.json({
    request: { ...request, workflowName: workflow?.name ?? null },
    steps: (steps.length > 0 ? steps : [{}]).map((s, i) => ({
      step: i + 1, label: stepLabel(i + 1 === request.currentStep ? currentStep : s), note: s.note || "",
      state: request.status === "Approved" || i + 1 < request.currentStep ? "done" : i + 1 === request.currentStep ? (request.status === "Rejected" ? "rejected" : request.status === "Cancelled" ? "cancelled" : "current") : "waiting",
    })),
    history: Array.isArray(request.approvers) ? request.approvers : [],
    document,
    documentMissing: !document,
    attachments: canSeeAttachments(request, actor) ? await documentAttachments(request.documentType, docId, voucherId) : [],
    canDecide: decisionBlock(request, currentStep, actor, change) === null,
    decideBlockedReason: decisionBlock(request, currentStep, actor, change),
  });
});

router.patch("/approval-requests/:id", decisionRoles, async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) { res.status(400).json({ error: "審批編號格式不正確" }); return; }
  const decision = req.body.status;
  if (decision !== "Approved" && decision !== "Rejected") {
    res.status(400).json({ error: "只能核准或駁回" }); return;
  }
  const comments = typeof req.body.comments === "string" ? req.body.comments.trim().slice(0, 500) : "";
  if (decision === "Rejected" && !comments) { res.status(400).json({ error: "駁回請寫原因，申請人才知道要怎麼改" }); return; }
  const actor = (req as any).session?.user as { username?: string; displayName?: string; role?: string } | undefined;
  const actorName = actor?.username || "";

  let outcome: { row: any; before: any; isFinal: boolean; nextApprover: string | null; nextRecipients: (string | null)[] };
  try {
    outcome = await db.transaction(async tx => {
      // 以列鎖 + 條件檢查避免兩位主管同時審批造成重複過帳
      const [locked] = await tx.select().from(approvalRequestsTable)
        .where(eq(approvalRequestsTable.id, id)).for("update");
      if (!locked) throw Object.assign(new Error("找不到這筆審批"), { status: 404 });
      if (locked.status !== "Pending" && locked.status !== "In Progress") {
        throw Object.assign(new Error(`此審批已是「${locked.status}」狀態，無法重複審批`), { status: 400 });
      }
      // 防止自我審批
      if (actorName && locked.requestedBy && actorName === locked.requestedBy) {
        throw Object.assign(new Error("不可審批自己提交的申請"), { status: 403 });
      }

      if (locked.documentType === CHANGE_DOC_TYPE && locked.documentId) {
        const [c] = await tx.select({ requestedBy: changeRequestsTable.requestedBy, requestedRole: changeRequestsTable.requestedRole }).from(changeRequestsTable).where(eq(changeRequestsTable.id, locked.documentId));
        const why = c ? changeReviewBlock(actor, c) : null;
        if (why) throw Object.assign(new Error(why), { status: 403 });
      }
      const [workflow] = locked.workflowId
        ? await tx.select().from(approvalWorkflowsTable).where(eq(approvalWorkflowsTable.id, locked.workflowId))
        : [];
      const steps = workflowSteps(workflow);
      const currentStepDef = await resolveStep(tx, steps[locked.currentStep - 1], locked.requestedBy);
      const designated = currentStepDef?.approverName?.trim();
      // 這一關有指定審批人：只有本人，或擁有者／管理員可以代為處理
      if (designated && actor && !OVERRIDE_ROLES.includes(actor.role || "")
        && designated !== actor.username && designated !== actor.displayName) {
        throw Object.assign(new Error(`這一關指定由「${designated}」審批`), { status: 403 });
      }
      // 這一關指定角色：要有那個角色（擁有者／管理員可以代為處理）
      const requiredRole = designated ? null : stepRole(currentStepDef);
      if (requiredRole && actor && !OVERRIDE_ROLES.includes(actor.role || "") && actor.role !== requiredRole) {
        throw Object.assign(new Error(`這一關要由「${APPROVER_ROLES[requiredRole]}」審批`), { status: 403 });
      }

      // 審核人直接改了異動申請的內容（只有核准時才採用）：檢查後存起來，改了什麼記進歷程
      let revised = "";
      if (decision === "Approved" && locked.documentType === CHANGE_DOC_TYPE && locked.documentId && req.body?.changePayload !== undefined) {
        revised = await reviseChangePayload(tx, locked.documentId, req.body.changePayload);
      }
      const history = [
        ...(Array.isArray(locked.approvers) ? (locked.approvers as any[]) : []),
        { name: actorName || "API", action: decision, step: locked.currentStep, at: new Date().toISOString(), ...(comments ? { comments } : {}), ...(revised ? { revised } : {}) },
      ];
      // 駁回就結束；核准要走完所有關卡才算通過
      const isFinal = decision === "Rejected" || locked.currentStep >= locked.totalSteps;
      const [updated] = await tx.update(approvalRequestsTable).set(isFinal
        ? { status: decision, approvers: history, ...(comments ? { comments } : {}) }
        : { status: "In Progress", currentStep: locked.currentStep + 1, approvers: history },
      ).where(eq(approvalRequestsTable.id, id)).returning();

      if (isFinal) await applyDecisionToDocument(tx, locked, decision, actorName || "API", revised, { cookie: req.headers.cookie });
      return { row: updated, before: locked, isFinal, nextApprover: isFinal ? null : ((await resolveStep(tx, steps[locked.currentStep], locked.requestedBy))?.approverName?.trim() || null), nextRecipients: isFinal ? [] : await stepRecipients(tx, await resolveStep(tx, steps[locked.currentStep], locked.requestedBy)) };
    });
  } catch (err: any) {
    const status = Number(err?.status) || 400;
    const msg = err?.message || "Unknown error";
    res.status(status).json({ error: err?.status ? msg : "審批處理失敗：" + msg });
    return;
  }

  const { before, isFinal, nextApprover, row } = outcome;
  const docLabel = `${before.documentType} ${before.documentNumber || ""}`.trim();
  if (isFinal) {
    // 結果通知送給申請人
    const label = decision === "Approved" ? "已核准" : "已駁回";
    await db.insert(notificationsTable).values({ title: `審批${label}`, message: `${docLabel} ${label}${comments ? "：" + comments : ""}`, type: "approval", module: "System", documentType: before.documentType, documentId: before.documentId, recipient: before.requestedBy });
  } else {
    // 還有下一關：通知下一位審批人
    await db.insert(notificationsTable).values((outcome.nextRecipients.length > 0 ? outcome.nextRecipients : [nextApprover]).map(recipient => ({ title: "新審批請求", message: `${docLabel} 已通過第 ${before.currentStep} 關，輪到您審批（第 ${row.currentStep}/${row.totalSteps} 關）`, type: "approval", module: "System", documentType: before.documentType, documentId: before.documentId, recipient })));
  }
  res.json(row);
});

/** 審批有了最終結果後，把結果寫回對應的單據 */
async function applyDecisionToDocument(tx: any, request: { documentType: string; documentId: number | null }, decision: "Approved" | "Rejected", approver = "", revised = "", ctx: { cookie?: string } = {}): Promise<void> {
  if (!request.documentId) return;

  // 異動申請：核准就執行（解鎖、刪除、修改），駁回就結案
  if (request.documentType === CHANGE_DOC_TYPE) {
    await applyChangeDecision(tx, request.documentId, decision, approver, revised, ctx);
    return;
  }

  // 請假：同步請假單狀態（月結請假天數隨之反映）
  if (request.documentType === "Leave") {
    // 只動還在待審的假單：已取消或已處理過的不會被審批中心改回來
    await tx.update(leavesTable).set({ status: decision }).where(and(eq(leavesTable.id, request.documentId), eq(leavesTable.status, "Pending")));
    return;
  }

  if (request.documentType === "PaymentRequest") {
    const [pr] = await tx.select().from(paymentRequestsTable)
      .where(eq(paymentRequestsTable.id, request.documentId)).for("update");
    if (!pr) return;
    const meta = pr.metadata as any;
    if (meta?.aiReimbursement) {
      // AI 報銷（延後過帳）：簽核通過才建立分錄與採購發票；駁回則作廢請款單，不留任何帳務
      if (decision === "Approved") {
        if (!meta.postedAt) { // 冪等保護：只過帳一次
          await assertPeriodOpen(tx, String(meta.date), "報銷入帳");
          const { invoice } = await postReimbursementLedger(tx, meta);
          await tx.update(paymentRequestsTable)
            .set({ status: "Approved", invoiceId: invoice.id, metadata: { ...meta, postedAt: new Date().toISOString() } })
            .where(eq(paymentRequestsTable.id, pr.id));
        }
      } else {
        await tx.update(paymentRequestsTable).set({ status: "Rejected" }).where(eq(paymentRequestsTable.id, pr.id));
        if (meta.voucherId) {
          await tx.update(vouchersTable).set({ status: "Cancelled" }).where(eq(vouchersTable.id, Number(meta.voucherId)));
        }
      }
      return;
    }
    // 一般付款申請：還沒處理的才跟著審批結果走，已付款或已取消的不動
    if (pr.status === "Draft" || pr.status === "Pending") {
      await tx.update(paymentRequestsTable).set({ status: decision }).where(eq(paymentRequestsTable.id, pr.id));
    }
  }
  // 採購訂單不改狀態：核准後由承辦人確認下單；未核准前在採購訂單那邊會被擋下
}

export default router;
