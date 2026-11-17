import { and, eq, inArray, sql } from "drizzle-orm";
import { adminUsersTable, approvalRequestsTable, approvalWorkflowsTable, changeRequestsTable, notificationsTable, activitiesTable, auditLogsTable } from "@workspace/erp-db";
import { nextDocNumber } from "./doc-number";
import { stepRecipients, resolveStep, workflowSteps } from "../utils/approval-helper";

/**
 * 異動申請（老闆 2026-11-16）
 * - 已過帳的單據要修改、要刪除，關帳月份要解鎖，都先送申請，核准後系統才執行。
 * - 財務（財務管理員、會計）或超級管理員（含擁有者）其中一人核准即可。
 * - 財務自己送的申請，只能由超級管理員（含擁有者）核准。
 * - 審批流程設定頁可以另外設「異動申請」的關卡；有設就照設定走，但「財務送的給超級管理員」這條一直有效。
 */
import { CHANGE_DOC_TYPE, CHANGE_KIND_LABELS, DOC_TARGET_PREFIX, changeReviewerRoles, payloadDiff, type ChangeKind } from "./change-review";
export * from "./change-review";

/** 帳號表沒有自動分公司，要自己限定「同一家公司」，不然會把別家公司的財務、老闆也算進來 */
const sameCompany = () => sql`${adminUsersTable.tenantId} = current_setting('app.tenant_id', true)::int`;

export interface SubmitChange {
  kind: ChangeKind; targetType: string; targetId: number | null; targetNumber: string | null;
  title: string; payload?: Record<string, unknown>; original?: Record<string, unknown> | null; reason: string;
}

/**
 * 除了申請人自己，還有沒有人可以審。只有一個擁有者帳號的公司，擁有者自己送的申請沒有人能審，
 * 這時不卡住：一樣要寫原因、一樣留紀錄，但直接執行。
 */
export async function hasOtherReviewer(tx: any, user: { username: string; role?: string | null }): Promise<boolean> {
  const [workflow] = await tx.select().from(approvalWorkflowsTable)
    .where(and(eq(approvalWorkflowsTable.documentType, CHANGE_DOC_TYPE), eq(approvalWorkflowsTable.isActive, "Yes")));
  if (workflowSteps(workflow).length > 0) return true;
  const users = await tx.select({ username: adminUsersTable.username }).from(adminUsersTable)
    .where(and(sameCompany(), inArray(adminUsersTable.role, changeReviewerRoles(user.role)), eq(adminUsersTable.isActive, true)));
  return users.some((u: { username: string }) => u.username !== user.username);
}
export const NO_REVIEWER_NOTE = "沒有其他可以審核的人，系統直接執行";

/** 送出異動申請：同一張單已經有一張在審的，就不再開新的。沒有其他審核人時直接執行，回傳 autoApplied */
export async function submitChangeRequest(tx: any, input: SubmitChange, user: { username: string; role?: string | null }): Promise<{ changeRequest: any; approval: any; autoApplied?: string }> {
  if (!input.reason.trim()) throw Object.assign(new Error("請寫原因，審核的人才知道為什麼要改"), { status: 400 });
  const pendingSame = await tx.select({ id: changeRequestsTable.id, requestNumber: changeRequestsTable.requestNumber }).from(changeRequestsTable)
    .where(and(eq(changeRequestsTable.targetType, input.targetType), input.targetId == null ? eq(changeRequestsTable.kind, input.kind) : eq(changeRequestsTable.targetId, input.targetId), eq(changeRequestsTable.status, "Pending")));
  if (pendingSame.length > 0) throw Object.assign(new Error(`這張已經有一張異動申請 ${pendingSame[0].requestNumber} 在審核中，請等審核完再送`), { status: 400 });

  const requestNumber = await nextDocNumber(tx, "change_requests", "request_number", "CHG", () => `CHG-${Date.now()}`);
  const [cr] = await tx.insert(changeRequestsTable).values({
    requestNumber, kind: input.kind, targetType: input.targetType, targetId: input.targetId, targetNumber: input.targetNumber,
    title: input.title, payload: input.payload ?? {}, original: input.original ?? null, reason: input.reason.trim().slice(0, 500),
    requestedBy: user.username, requestedRole: user.role ?? null,
  }).returning();

  const [workflow] = await tx.select().from(approvalWorkflowsTable)
    .where(and(eq(approvalWorkflowsTable.documentType, CHANGE_DOC_TYPE), eq(approvalWorkflowsTable.isActive, "Yes")));
  const steps = workflowSteps(workflow);
  const [approval] = await tx.insert(approvalRequestsTable).values({
    documentType: CHANGE_DOC_TYPE, documentId: cr.id, documentNumber: requestNumber, requestedBy: user.username,
    workflowId: workflow?.id, totalSteps: steps.length || 1, approvers: [], comments: input.title,
  }).returning();

  // 沒有其他人可以審（例如公司只有一個擁有者帳號）：直接執行，申請單和紀錄照留
  if (steps.length === 0 && !(await hasOtherReviewer(tx, user))) {
    await tx.update(approvalRequestsTable).set({ status: "Approved", comments: NO_REVIEWER_NOTE, approvers: [{ name: user.username, action: "Approved", step: 1, at: new Date().toISOString(), comments: NO_REVIEWER_NOTE }] }).where(eq(approvalRequestsTable.id, approval.id));
    await applyChangeDecision(tx, cr.id, "Approved", user.username, "", {}, true);
    const [done] = await tx.select().from(changeRequestsTable).where(eq(changeRequestsTable.id, cr.id));
    return { changeRequest: done ?? cr, approval, autoApplied: done?.result || "已執行" };
  }

  // 沒設流程：通知財務與超級管理員（財務送的只通知超級管理員）；有設流程：通知第一關
  let recipients: (string | null)[];
  if (steps.length > 0) recipients = await stepRecipients(tx, await resolveStep(tx, steps[0], user.username));
  else {
    const users = await tx.select({ username: adminUsersTable.username }).from(adminUsersTable)
      .where(and(sameCompany(), inArray(adminUsersTable.role, changeReviewerRoles(user.role)), eq(adminUsersTable.isActive, true)));
    recipients = users.map((u: { username: string }) => u.username).filter((u: string) => u !== user.username);
    if (recipients.length === 0) recipients = [null];
  }
  await tx.insert(notificationsTable).values(recipients.map(r => ({
    title: "新審批請求", message: `${user.username} 送出異動申請 ${requestNumber}：${input.title}`,
    type: "approval", module: "Accounting", documentType: CHANGE_DOC_TYPE, documentId: cr.id, recipient: r,
  })));
  await tx.insert(activitiesTable).values({ type: "create", title: "送出異動申請", module: "Accounting", description: `${requestNumber} ${input.title}：${input.reason.trim().slice(0, 200)}` });
  return { changeRequest: cr, approval };
}

/** 核准後真正執行的動作，依「targetType:kind」登記（解鎖、刪除、修改各自在自己的檔案登記） */
export interface ChangeContext { cookie?: string }
export type ChangeHandler = (tx: any, cr: typeof changeRequestsTable.$inferSelect, ctx: ChangeContext) => Promise<string | void>;
const handlers = new Map<string, ChangeHandler>();
export function registerChangeHandler(targetType: string, kind: ChangeKind, handler: ChangeHandler) { handlers.set(`${targetType}:${kind}`, handler); }
/** 一般單據（targetType「doc:資料表」）共用的執行方式：重送原本的請求 */
export function registerDocReplayHandler(handler: ChangeHandler) { handlers.set(`${DOC_TARGET_PREFIX}*:replay`, handler); }

/** 審核人改內容時先檢查（例如分錄借貸要平衡）。回傳 null＝沒問題 */
export type PayloadCheck = (payload: unknown) => Promise<string | null>;
const checks = new Map<string, PayloadCheck>();
export function registerPayloadCheck(targetType: string, kind: ChangeKind, check: PayloadCheck) { checks.set(`${targetType}:${kind}`, check); }

/**
 * 審核人直接修改申請內容（老闆 2026-11-16：審核人可改）。只有「修改」類可以改；
 * 檢查通過才存，回傳改了什麼（記進審批歷程）。
 */
export async function reviseChangePayload(tx: any, changeRequestId: number, payload: unknown): Promise<string> {
  const [cr] = await tx.select().from(changeRequestsTable).where(eq(changeRequestsTable.id, changeRequestId)).for("update");
  if (!cr || cr.status !== "Pending") throw Object.assign(new Error("這張申請已經結束，不能再改"), { status: 400 });
  if (cr.kind !== "edit") throw Object.assign(new Error("只有修改申請可以由審核人改內容"), { status: 400 });
  if (!payload || typeof payload !== "object") throw Object.assign(new Error("修改內容格式不正確"), { status: 400 });
  // 一般單據：只能改送出的欄位內容，網址和方法不能換
  if (String(cr.targetType).startsWith(DOC_TARGET_PREFIX)) {
    const before = (cr.payload ?? {}) as { body?: Record<string, unknown> };
    const body = (payload as { body?: unknown }).body;
    if (!body || typeof body !== "object" || Array.isArray(body)) throw Object.assign(new Error("修改內容格式不正確"), { status: 400 });
    const allowed = Object.keys(before.body ?? {});
    const next = { ...(before.body ?? {}) } as Record<string, unknown>;
    for (const k of allowed) if (k in (body as object)) next[k] = (body as Record<string, unknown>)[k];
    const diff = payloadDiff(before.body, next);
    if (!diff) return "";
    await tx.update(changeRequestsTable).set({ payload: { ...before, body: next } }).where(eq(changeRequestsTable.id, cr.id));
    return diff;
  }
  const check = checks.get(`${cr.targetType}:${cr.kind}`);
  const problem = check ? await check(payload) : null;
  if (problem) throw Object.assign(new Error(problem), { status: 400 });
  const diff = payloadDiff(cr.payload, payload);
  if (!diff) return "";
  await tx.update(changeRequestsTable).set({ payload }).where(eq(changeRequestsTable.id, cr.id));
  return diff;
}

/** 審批有了最終結果：核准就執行，執行失敗整筆審批退回（錯誤訊息給審核的人看）；駁回就結案 */
/** 異動對象在稽核紀錄裡的類型名稱（H 從這裡讀） */
const AUDIT_DOC_TYPE: Record<string, string> = { journal_entry: "journal_entries", voucher: "vouchers", period: "accounting_settings" };
const auditDocType = (t: string) => AUDIT_DOC_TYPE[t] ?? (t.startsWith(DOC_TARGET_PREFIX) ? t.slice(DOC_TARGET_PREFIX.length) : t);

export async function applyChangeDecision(tx: any, changeRequestId: number, decision: "Approved" | "Rejected", approver = "", revised = "", ctx: ChangeContext = {}, selfApplied = false): Promise<void> {
  const [cr] = await tx.select().from(changeRequestsTable).where(eq(changeRequestsTable.id, changeRequestId)).for("update");
  if (!cr || cr.status !== "Pending") return;
  if (decision === "Rejected") {
    await tx.update(changeRequestsTable).set({ status: "Rejected" }).where(eq(changeRequestsTable.id, cr.id));
    return;
  }
  const own = handlers.get(`${cr.targetType}:${cr.kind}`);
  const replay = !own && String(cr.targetType).startsWith(DOC_TARGET_PREFIX) ? handlers.get(`${DOC_TARGET_PREFIX}*:replay`) : undefined;
  if (!own && !replay) throw Object.assign(new Error("系統還不支援這種異動，請聯絡管理員"), { status: 400 });
  // 自己的資料表異動（分錄、傳票、鎖帳）在同一筆交易裡做，先做再記
  let result: string | void = own ? await own(tx, cr, ctx) : `已${cr.title}`;
  await tx.update(changeRequestsTable).set({ status: "Approved", result: result || "已執行", appliedAt: new Date() }).where(eq(changeRequestsTable.id, cr.id));
  // 寫進那張單的 H：誰申請、誰核准、審核人改了什麼
  const who = selfApplied ? `${cr.requestedBy} 自行執行（${NO_REVIEWER_NOTE}，${cr.requestNumber}）` : `${cr.requestedBy} 申請、${approver || "審核人"} 核准（${cr.requestNumber}）`;
  const summary = `${who}${revised ? `；審核人修改：${revised}` : ""}；原因：${cr.reason}`;
  await tx.insert(auditLogsTable).values({
    action: cr.kind === "delete" ? "delete" : "update", module: "Accounting", documentType: auditDocType(cr.targetType),
    documentId: cr.targetId, documentNumber: cr.targetNumber, userName: approver || null,
    oldValues: cr.original ?? null, newValues: { changeRequest: cr.requestNumber, kind: cr.kind, summary, payload: cr.payload },
    description: `${CHANGE_KIND_LABELS[cr.kind as ChangeKind] ?? cr.kind} ${cr.targetNumber ?? ""}（異動申請 ${cr.requestNumber}）`,
  });
  await tx.insert(activitiesTable).values({ type: "update", title: "異動申請已執行", module: "Accounting", description: `${cr.requestNumber} ${cr.title}${result ? "：" + result : ""}` });
  // 一般單據是把原本的請求重送一次，那一次自己存檔、不跟這筆交易一起退回。
  // 所以放在最後：前面的紀錄都寫好了才重送，重送失敗整筆退回；重送成功後只剩存檔，不會出現「單據改了、申請還在待審」。
  if (replay) await replay(tx, cr, ctx);
}
