import { eq, and, desc, isNotNull, sql } from "drizzle-orm";
import { db, approvalWorkflowsTable, approvalRequestsTable, notificationsTable, adminUsersTable, employeesTable, departmentsTable } from "@workspace/erp-db";

/** 帳號表沒有自動分公司：找主管、找審批人都要限定同一家公司，不然會找到別家公司同名或同角色的帳號 */
const sameCompany = () => sql`${adminUsersTable.tenantId} = current_setting('app.tenant_id', true)::int`;

/**
 * 審批流程的一關。
 * approverRole：這一關由哪個「角色」審（主管、會計、財務管理員…），有這個角色的人都可以審。
 * approverName：另外可以指定某一個人的登入帳號（選填）；有填就只有那個人能審。
 * note：職務說明，只是給人看的文字。
 */
export interface ApprovalStep { stepNumber?: number; approverName?: string; approverRole?: string; note?: string; /** 換人審時給人看的說明 */ label?: string }

/** 可以當審批關卡的角色（老闆 2026-11-15：審批步驟應該是選角色） */
export const APPROVER_ROLES: Record<string, string> = {
  manager: "主管", accountant: "會計", finance_admin: "財務管理員", hr_admin: "人資管理員", admin: "管理員", owner: "擁有者（老闆）",
};
export const stepRole = (step: ApprovalStep | undefined): string | null => (step?.approverRole && APPROVER_ROLES[step.approverRole] ? step.approverRole : null);
/** 這一關要給人看的名稱：指定的人 > 角色 > 沒指定 */
export const stepLabel = (step: ApprovalStep | undefined): string =>
  step?.label || step?.approverName?.trim() || (stepRole(step) ? APPROVER_ROLES[stepRole(step)!] : "") || "任何主管";

/**
 * 找某個帳號的直屬主管帳號：申請人所在部門的主管；主管是自己或部門沒設主管，就往上一層部門找。
 * 找不到（沒綁員工、沒部門、整條線都沒設主管）回傳 null。
 */
export async function directSupervisor(executor: any, account: { employeeId: number | null }): Promise<{ username: string; displayName: string } | null> {
  if (!account.employeeId) return null;
  const [emp] = await executor.select({ departmentId: employeesTable.departmentId }).from(employeesTable).where(eq(employeesTable.id, account.employeeId));
  let deptId: number | null = emp?.departmentId ?? null;
  for (let hop = 0; deptId && hop < 10; hop++) {
    const [dept] = await executor.select({ managerId: departmentsTable.managerId, parentId: departmentsTable.parentId }).from(departmentsTable).where(eq(departmentsTable.id, deptId));
    if (!dept) return null;
    if (dept.managerId && dept.managerId !== account.employeeId) {
      const [boss] = await executor.select({ username: adminUsersTable.username, displayName: adminUsersTable.displayName })
        .from(adminUsersTable).where(and(sameCompany(), eq(adminUsersTable.employeeId, dept.managerId), eq(adminUsersTable.isActive, true)));
      if (boss) return boss;
    }
    deptId = dept.parentId ?? null;
  }
  return null;
}

/**
 * 老闆 2026-11-15：申請人剛好就是這一關指定的人（不能審自己的單），改由申請人的直屬主管審；
 * 找不到直屬主管就交給老闆或管理員（他們本來就能代審任何一關）。其他情況原樣回傳。
 */
export async function resolveStep(executor: any, step: ApprovalStep | undefined, requestedBy: string | null | undefined): Promise<ApprovalStep | undefined> {
  const designated = step?.approverName?.trim();
  if (!step || !designated || !requestedBy) return step;
  const [requester] = await executor.select({ username: adminUsersTable.username, displayName: adminUsersTable.displayName, employeeId: adminUsersTable.employeeId })
    .from(adminUsersTable).where(and(sameCompany(), eq(adminUsersTable.username, requestedBy)));
  const isSelf = designated === requestedBy || (!!requester && (designated === requester.username || designated === requester.displayName));
  if (!isSelf) return step;
  const boss = requester ? await directSupervisor(executor, requester) : null;
  if (boss) return { ...step, approverName: boss.username, approverRole: "", label: `${boss.displayName}（${requester?.displayName || requestedBy} 的直屬主管）` };
  return { ...step, approverName: "", approverRole: "owner", label: `老闆或管理員（${requester?.displayName || requestedBy} 沒有直屬主管）` };
}

/** 這一關要通知誰：有指定人就通知那個人；指定角色就通知所有有這個角色的帳號；都沒指定就全域通知 */
export async function stepRecipients(executor: any, step: ApprovalStep | undefined): Promise<(string | null)[]> {
  const name = step?.approverName?.trim();
  if (name) {
    // 舊設定填的是姓名（例如「簡培芳」），通知要送到登入帳號（pei）才收得到
    const [byUsername] = await executor.select({ username: adminUsersTable.username }).from(adminUsersTable).where(and(sameCompany(), eq(adminUsersTable.username, name)));
    if (byUsername) return [byUsername.username];
    const [byName] = await executor.select({ username: adminUsersTable.username }).from(adminUsersTable).where(and(sameCompany(), eq(adminUsersTable.displayName, name)));
    return [byName?.username ?? name];
  }
  const role = stepRole(step);
  if (!role) return [null];
  const users = await executor.select({ username: adminUsersTable.username }).from(adminUsersTable).where(and(sameCompany(), eq(adminUsersTable.role, role)));
  return users.length > 0 ? users.map((u: { username: string }) => u.username) : [null];
}

/** 流程定義的關卡，整理成乾淨的陣列 */
export function workflowSteps(workflow: { steps?: unknown } | null | undefined): ApprovalStep[] {
  return Array.isArray(workflow?.steps) ? (workflow!.steps as ApprovalStep[]) : [];
}

/**
 * 這張單據是否還被審批卡住。回傳 null 表示可以往下走，否則回傳要給使用者看的原因。
 * 只有「有設定審批流程」的單據類型才會卡：沒設定流程時審批請求只是通知，不擋作業。
 */
export async function approvalBlockReason(executor: any, documentType: string, documentId: number): Promise<string | null> {
  const [latest] = await executor.select({ status: approvalRequestsTable.status, currentStep: approvalRequestsTable.currentStep, totalSteps: approvalRequestsTable.totalSteps })
    .from(approvalRequestsTable)
    .where(and(
      eq(approvalRequestsTable.documentType, documentType),
      eq(approvalRequestsTable.documentId, documentId),
      isNotNull(approvalRequestsTable.workflowId),
    ))
    .orderBy(desc(approvalRequestsTable.id))
    .limit(1);
  if (!latest) return null;
  if (latest.status === "Pending" || latest.status === "In Progress") {
    return `這張單據還在審批中（第 ${latest.currentStep}/${latest.totalSteps} 關），核准後才能繼續`;
  }
  if (latest.status === "Rejected") return "這張單據的審批已被駁回，不能繼續";
  return null;
}

export async function createApprovalRequest(opts: {
  module: string;
  documentType: string;
  documentId: number;
  documentNumber: string;
  requestedBy: string;
}, executor: any = db) {
  const [workflow] = await executor.select().from(approvalWorkflowsTable)
    .where(and(
      eq(approvalWorkflowsTable.module, opts.module),
      eq(approvalWorkflowsTable.documentType, opts.documentType),
      eq(approvalWorkflowsTable.isActive, "Yes"),
    ));

  const steps = workflowSteps(workflow);
  const totalSteps = steps.length || 1;
  const approvers: string[] = [];

  const [req] = await executor.insert(approvalRequestsTable).values({
    documentType: opts.documentType,
    documentId: opts.documentId,
    documentNumber: opts.documentNumber,
    requestedBy: opts.requestedBy,
    workflowId: workflow?.id,
    totalSteps,
    approvers,
  }).returning();

  // 只通知第一關的審批人；後面的關卡輪到時才通知（沒指定審批人時為全域通知）
  const recipients = await stepRecipients(executor, await resolveStep(executor, steps[0], opts.requestedBy));
  await executor.insert(notificationsTable).values(recipients.map((r: string | null) => ({
    title: `新審批請求`,
    message: `${opts.requestedBy} 提交了 ${opts.documentType} ${opts.documentNumber} 待審批`,
    type: "approval",
    module: opts.module,
    documentType: opts.documentType,
    documentId: opts.documentId,
    recipient: r,
  })));

  return req;
}
