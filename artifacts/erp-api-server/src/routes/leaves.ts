import { Router, type IRouter, type Request } from "express";
import { eq, and, sql, inArray, lte, gte, desc } from "drizzle-orm";
import { db, leavesTable, employeesTable, activitiesTable, notificationsTable, approvalRequestsTable, leaveGrantsTable, adminUsersTable } from "@workspace/erp-db";
import { createApprovalRequest } from "../utils/approval-helper";
import { requireAuth, requireRole, sessionEmployeeScope } from "../middleware/require-auth";
import { ListLeavesQueryParams, CreateLeaveBody, ApproveLeaveParams, ApproveLeaveBody } from "@workspace/erp-api-zod";
import { LEAVE_TYPES, countLeaveDays, isDateString, leaveLimitProblem, leaveTypeRule, taipeiToday, type DayPart } from "../lib/hr-rules";
import { ANNUAL_LEAVE, annualBalanceFor, annualOverview, ensureAnnualGrants, leavesOfYear, loadHolidays } from "../lib/hr-data";

const router: IRouter = Router();
router.use("/leaves", requireAuth);

const HR_ROLES = ["owner", "admin", "hr_admin"] as const;
const APPROVER_ROLES = [...HR_ROLES, "manager"] as const;

function hasRole(req: Request, roles: readonly string[]): boolean {
  if ((req as any).apiKeyAuth) return true;
  const u = req.session?.user;
  return Boolean(u && (u.role === "super_admin" || roles.includes(u.role)));
}

const employeeName = (e?: { firstName: string; lastName: string } | null) => e ? `${e.firstName}${e.lastName}`.trim() : "Unknown";

/** 把結果通知請假的本人（有綁登入帳號才通知得到） */
async function notifyEmployee(employeeId: number, title: string, message: string, documentId: number): Promise<void> {
  const [account] = await db.select({ username: adminUsersTable.username }).from(adminUsersTable).where(eq(adminUsersTable.employeeId, employeeId));
  if (!account) return;
  await db.insert(notificationsTable).values({ title, message, type: "approval", module: "HR", documentType: "Leave", documentId, recipient: account.username });
}

// ---- 假別清單（含法定天數與給薪規則）----
router.get("/leaves/types", (_req, res): void => {
  res.json(LEAVE_TYPES);
});

// ---- 個人假勤餘額：特休餘額 + 今年各假別已請天數 ----
router.get("/leaves/balance", async (req, res): Promise<void> => {
  const scope = sessionEmployeeScope(req);
  let employeeId = req.query.employeeId !== undefined ? Number(req.query.employeeId) : undefined;
  if (scope.isEmployee) {
    if (!scope.employeeId) { res.status(403).json({ error: "帳號尚未綁定員工，請聯絡管理員" }); return; }
    if (employeeId !== undefined && employeeId !== scope.employeeId) { res.status(403).json({ error: "只能查詢自己的假勤餘額" }); return; }
    employeeId = scope.employeeId;
  } else if (!hasRole(req, APPROVER_ROLES)) {
    // 其他角色只能看自己綁定的員工
    const own = req.session?.user?.employeeId ?? undefined;
    if (!own || (employeeId !== undefined && employeeId !== own)) { res.status(403).json({ error: "權限不足" }); return; }
    employeeId = own;
  }
  if (!employeeId || !Number.isInteger(employeeId)) { res.status(400).json({ error: "請指定員工" }); return; }

  const today = taipeiToday();
  const result = await annualBalanceFor(employeeId, today);
  if (!result) { res.status(404).json({ error: "找不到員工" }); return; }
  const year = today.slice(0, 4);
  const [yearLeaves, holidays] = await Promise.all([
    leavesOfYear(employeeId, year),
    loadHolidays(`${year}-01-01`, `${year}-12-31`),
  ]);
  const usage = LEAVE_TYPES.filter(t => t.code !== ANNUAL_LEAVE).map(t => {
    const mine = yearLeaves.filter(l => l.leaveType === t.code);
    const sum = (status: string) => Math.round(mine.filter(l => l.status === status).reduce((s, l) => s + Number(l.totalDays), 0) * 10) / 10;
    return { code: t.code, label: t.label, yearlyLimit: t.yearlyLimit, used: sum("Approved"), pending: sum("Pending") };
  }).filter(u => u.used > 0 || u.pending > 0 || u.yearlyLimit !== null);
  void holidays;
  res.json({
    employeeId, employeeName: employeeName(result.employee), dateOfJoining: result.employee.dateOfJoining,
    year: Number(year), annual: result.balance, usage,
  });
});

// ---- 特休總覽（人資）----
router.get("/leaves/annual-overview", requireRole(...HR_ROLES), async (_req, res): Promise<void> => {
  res.json(await annualOverview(taipeiToday()));
});

// 立即執行一次自動發放（平常每天早上會自動跑，也會在查餘額時補發）
router.post("/leaves/annual-grants/run", requireRole(...HR_ROLES), async (_req, res): Promise<void> => {
  const created = await ensureAnnualGrants(taipeiToday());
  res.json({ created });
});

// 手動調整特休（可為負數）：系統上線前已休掉的天數、公司多給的天數、遞延的天數
router.post("/leaves/annual-grants", requireRole(...HR_ROLES), async (req, res): Promise<void> => {
  const employeeId = Number(req.body?.employeeId);
  const days = Number(req.body?.days);
  const note = typeof req.body?.note === "string" ? req.body.note.trim() : "";
  if (!Number.isInteger(employeeId)) { res.status(400).json({ error: "請選擇員工" }); return; }
  if (!Number.isFinite(days) || days === 0 || Math.abs(days) > 60 || Math.round(days * 2) !== days * 2) {
    res.status(400).json({ error: "天數請填 0.5 的倍數（可為負數），且不可為 0" }); return;
  }
  if (!note) { res.status(400).json({ error: "請填寫調整原因" }); return; }
  const today = taipeiToday();
  const result = await annualBalanceFor(employeeId, today);
  if (!result) { res.status(404).json({ error: "找不到員工" }); return; }
  const period = result.balance.period;
  if (!period) { res.status(400).json({ error: "這位員工到職未滿半年，還沒有特休可以調整" }); return; }
  if (result.balance.remaining + days < 0) { res.status(400).json({ error: `調整後特休會變成負數（目前剩 ${result.balance.remaining} 天）` }); return; }
  const [row] = await db.insert(leaveGrantsTable).values({
    employeeId, leaveType: ANNUAL_LEAVE, periodStart: today < period.periodStart ? period.periodStart : today,
    periodEnd: period.periodEnd, days: String(days), source: "manual", note,
    createdBy: req.session?.user?.username || "api",
  }).returning();
  await db.insert(activitiesTable).values({
    type: "update", title: "調整特休", module: "HR",
    description: `${employeeName(result.employee)} 特休 ${days > 0 ? "+" : ""}${days} 天：${note}`,
  });
  res.status(201).json(row);
});

// 期滿或離職沒休完的特休：折發工資後標記已結清
router.post("/leaves/annual-grants/:id/settle", requireRole(...HR_ROLES), async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) { res.status(400).json({ error: "格式不正確" }); return; }
  const overview = await annualOverview(taipeiToday());
  const item = overview.unsettled.find(u => u.grantId === id);
  if (!item) { res.status(404).json({ error: "找不到待結清的特休（可能已經結清）" }); return; }
  const note = typeof req.body?.note === "string" ? req.body.note.trim() : "";
  const [row] = await db.update(leaveGrantsTable).set({
    settledAt: new Date(), settledDays: String(item.unusedDays), settledAmount: String(item.amount),
    settledNote: note || `折發工資 ${item.unusedDays} 天`,
  }).where(and(eq(leaveGrantsTable.id, id), sql`${leaveGrantsTable.settledAt} IS NULL`)).returning();
  if (!row) { res.status(409).json({ error: "這筆特休已經結清" }); return; }
  await db.insert(activitiesTable).values({
    type: "update", title: "特休結清", module: "HR",
    description: `${item.employeeName} ${item.periodStart}~${item.periodEnd} 未休 ${item.unusedDays} 天，折發 ${item.amount} 元`,
  });
  res.json(row);
});

// ---- 假單 ----
router.get("/leaves", async (req, res): Promise<void> => {
  const query = ListLeavesQueryParams.safeParse(req.query);
  const scope = sessionEmployeeScope(req);
  let employeeId = query.success ? query.data.employeeId : undefined;
  if (scope.isEmployee) {
    if (!scope.employeeId) { res.status(403).json({ error: "帳號尚未綁定員工，請聯絡管理員" }); return; }
    if (employeeId !== undefined && employeeId !== scope.employeeId) { res.status(403).json({ error: "只能查詢自己的請假紀錄" }); return; }
    employeeId = scope.employeeId;
  }
  const conditions = [];
  if (employeeId) conditions.push(eq(leavesTable.employeeId, employeeId));
  if (query.success && query.data.status) conditions.push(eq(leavesTable.status, query.data.status));
  // 只看某段期間有重疊的假單（打卡月曆用）
  const from = req.query.from, to = req.query.to;
  if (isDateString(from)) conditions.push(gte(leavesTable.toDate, from));
  if (isDateString(to)) conditions.push(lte(leavesTable.fromDate, to));

  const records = await db
    .select({
      id: leavesTable.id,
      employeeId: leavesTable.employeeId,
      employeeName: sql<string>`${employeesTable.firstName} || ${employeesTable.lastName}`,
      employeeCode: employeesTable.employeeId,
      leaveType: leavesTable.leaveType,
      fromDate: leavesTable.fromDate,
      toDate: leavesTable.toDate,
      totalDays: leavesTable.totalDays,
      reason: leavesTable.reason,
      status: leavesTable.status,
      createdAt: leavesTable.createdAt,
    })
    .from(leavesTable)
    .innerJoin(employeesTable, eq(leavesTable.employeeId, employeesTable.id))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(leavesTable.createdAt));

  res.json(records.map(r => ({ ...r, totalDays: Number(r.totalDays) })));
});

router.post("/leaves", async (req, res): Promise<void> => {
  const parsed = CreateLeaveBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "請假資料格式不正確" }); return; }
  const { employeeId, leaveType, fromDate, toDate } = parsed.data;

  const scope = sessionEmployeeScope(req);
  if (scope.isEmployee) {
    if (!scope.employeeId) { res.status(403).json({ error: "帳號尚未綁定員工，請聯絡管理員" }); return; }
    if (employeeId !== scope.employeeId) { res.status(403).json({ error: "只能替自己提出請假申請" }); return; }
  } else if (!hasRole(req, APPROVER_ROLES) && req.session?.user?.employeeId !== employeeId) {
    res.status(403).json({ error: "只能替自己提出請假申請" }); return;
  }
  const isHr = !scope.isEmployee && hasRole(req, HR_ROLES);

  const rule = leaveTypeRule(leaveType);
  if (!rule) { res.status(400).json({ error: "沒有這個假別" }); return; }
  if (!isDateString(fromDate) || !isDateString(toDate)) { res.status(400).json({ error: "請填寫正確的起訖日期" }); return; }
  if (toDate < fromDate) { res.status(400).json({ error: "結束日不可早於起始日" }); return; }
  const dayPart: DayPart = ["am", "pm"].includes(req.body?.dayPart) ? req.body.dayPart : "full";
  if (dayPart !== "full" && fromDate !== toDate) { res.status(400).json({ error: "半天假只能請單一天" }); return; }
  if (dayPart !== "full" && rule.calendarDays) { res.status(400).json({ error: `${rule.label}不能請半天` }); return; }

  const [emp] = await db.select().from(employeesTable).where(eq(employeesTable.id, employeeId));
  if (!emp) { res.status(404).json({ error: "找不到員工" }); return; }
  if (emp.status !== "Active") { res.status(400).json({ error: "這位員工不是在職狀態，不能請假" }); return; }
  if (fromDate < emp.dateOfJoining) { res.status(400).json({ error: "請假日期不可早於到職日" }); return; }

  const holidays = await loadHolidays(fromDate, toDate);
  const totalDays = countLeaveDays({ leaveType, fromDate, toDate, dayPart, holidays });
  if (totalDays <= 0) { res.status(400).json({ error: "這段期間都是假日，不需要請假" }); return; }

  // 同一位員工的假不能重疊（兩張半天假排在同一天除外）
  const overlapping = await db.select().from(leavesTable).where(and(
    eq(leavesTable.employeeId, employeeId),
    inArray(leavesTable.status, ["Pending", "Approved"]),
    lte(leavesTable.fromDate, toDate),
    gte(leavesTable.toDate, fromDate),
  ));
  const overlapDays = overlapping.reduce((sum, l) => sum + (l.fromDate === l.toDate ? Number(l.totalDays) : 1), 0);
  if (overlapping.length > 0 && !(fromDate === toDate && overlapDays + totalDays <= 1)) {
    const hit = overlapping[0];
    res.status(409).json({ error: `這段期間已經有假單（${hit.fromDate} ~ ${hit.toDate}），請勿重複申請` }); return;
  }

  if (leaveType === ANNUAL_LEAVE) {
    const today = taipeiToday();
    const result = await annualBalanceFor(employeeId, today);
    const balance = result?.balance;
    if (!balance?.period) { res.status(400).json({ error: "到職滿半年才有特休" }); return; }
    if (fromDate < balance.period.periodStart || fromDate > balance.period.periodEnd) {
      res.status(400).json({ error: `特休只能排在這一期的使用期間內（${balance.period.periodStart} ~ ${balance.period.periodEnd}）` }); return;
    }
    if (totalDays > balance.remaining) {
      res.status(400).json({ error: `特休剩 ${balance.remaining} 天，不夠請 ${totalDays} 天` }); return;
    }
  } else if (!isHr) {
    // 法定上限：員工自己申請時擋下來；人資代為建立時可以放寬（公司優於法令）
    const problem = leaveLimitProblem({
      leaveType, fromDate, requestedDays: totalDays,
      existing: await leavesOfYear(employeeId, fromDate.slice(0, 4)),
    });
    if (problem) { res.status(400).json({ error: problem }); return; }
  }

  const partLabel = dayPart === "am" ? "【上午】" : dayPart === "pm" ? "【下午】" : "";
  const reason = `${partLabel}${(parsed.data.reason || "").trim()}` || null;
  const [record] = await db.insert(leavesTable).values({
    employeeId, leaveType, fromDate, toDate, reason, totalDays: String(totalDays),
  }).returning();

  const empName = employeeName(emp);
  await db.insert(activitiesTable).values({
    type: "create", title: "請假申請", module: "HR",
    description: `${empName} 申請${rule.label} ${totalDays} 天（${fromDate} ~ ${toDate}）`,
  });
  await createApprovalRequest({
    module: "HR",
    documentType: "Leave",
    documentId: record.id,
    documentNumber: `LEAVE-${record.id}`,
    // 用登入帳號當申請人，審批結果的通知才送得到本人；主管代為建立時才用員工姓名
    requestedBy: scope.isEmployee ? (req.session?.user?.username || empName) : empName,
  });
  await db.insert(notificationsTable).values({
    title: "新請假申請",
    message: `${empName} 申請${rule.label} ${totalDays} 天（${fromDate} ~ ${toDate}）`,
    type: "approval", module: "HR", documentType: "Leave", documentId: record.id,
  });

  res.status(201).json({ ...record, employeeName: empName, totalDays });
});

/** 假單有結果後，把還在跑的審批請求一起收掉 */
async function closeApprovalRequests(leaveId: number, status: string, actor?: string): Promise<void> {
  const pending = await db.select().from(approvalRequestsTable).where(and(
    eq(approvalRequestsTable.documentType, "Leave"),
    eq(approvalRequestsTable.documentId, leaveId),
    inArray(approvalRequestsTable.status, ["Pending", "In Progress"]),
  ));
  for (const requestRow of pending) {
    const prev = Array.isArray(requestRow.approvers) ? requestRow.approvers as unknown[] : [];
    await db.update(approvalRequestsTable).set({
      status,
      approvers: actor ? [...prev, { name: actor, action: status, at: new Date().toISOString() }] : prev,
    }).where(eq(approvalRequestsTable.id, requestRow.id));
  }
}

router.patch("/leaves/:id/approve", requireRole(...APPROVER_ROLES), async (req, res): Promise<void> => {
  const params = ApproveLeaveParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: "格式不正確" }); return; }
  const parsed = ApproveLeaveBody.safeParse(req.body);
  if (!parsed.success || !["Approved", "Rejected"].includes(parsed.data.status)) {
    res.status(400).json({ error: "只能核准或駁回" }); return;
  }
  const status = parsed.data.status as "Approved" | "Rejected";

  const [existing] = await db.select().from(leavesTable).where(eq(leavesTable.id, params.data.id));
  if (!existing) { res.status(404).json({ error: "找不到假單" }); return; }
  if (existing.status !== "Pending") { res.status(409).json({ error: "這張假單已經處理過了" }); return; }

  // 核准特休前再確認一次餘額（送出後可能又有別的假單先被核准）
  if (status === "Approved" && existing.leaveType === ANNUAL_LEAVE) {
    const result = await annualBalanceFor(existing.employeeId, taipeiToday(), existing.id);
    if (result && Number(existing.totalDays) > result.balance.remaining) {
      res.status(400).json({ error: `特休剩 ${result.balance.remaining} 天，不夠核准這張 ${Number(existing.totalDays)} 天的假單` }); return;
    }
  }

  const [record] = await db.update(leavesTable).set({ status })
    .where(and(eq(leavesTable.id, existing.id), eq(leavesTable.status, "Pending"))).returning();
  if (!record) { res.status(409).json({ error: "這張假單已經處理過了" }); return; }

  await closeApprovalRequests(record.id, status, req.session?.user?.username);
  const label = leaveTypeRule(record.leaveType)?.label || record.leaveType;
  await notifyEmployee(record.employeeId, status === "Approved" ? "請假已核准" : "請假已駁回",
    `您的${label}（${record.fromDate} ~ ${record.toDate}，${Number(record.totalDays)} 天）${status === "Approved" ? "已核准" : "已被駁回"}`, record.id);

  const [emp] = await db.select({ firstName: employeesTable.firstName, lastName: employeesTable.lastName }).from(employeesTable).where(eq(employeesTable.id, record.employeeId));
  res.json({ ...record, employeeName: employeeName(emp), totalDays: Number(record.totalDays) });
});

// 取消假單：本人只能取消還沒審核的；人資可以取消已核准的（銷假），特休天數會還回去
router.patch("/leaves/:id/cancel", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) { res.status(400).json({ error: "格式不正確" }); return; }
  const [existing] = await db.select().from(leavesTable).where(eq(leavesTable.id, id));
  if (!existing) { res.status(404).json({ error: "找不到假單" }); return; }

  const scope = sessionEmployeeScope(req);
  const isApprover = !scope.isEmployee && hasRole(req, APPROVER_ROLES);
  const isOwner = (scope.isEmployee ? scope.employeeId : req.session?.user?.employeeId) === existing.employeeId;
  if (!isApprover && !isOwner) { res.status(403).json({ error: "只能取消自己的假單" }); return; }
  if (existing.status === "Pending") {
    // 本人或主管都可以取消
  } else if (existing.status === "Approved") {
    if (!isApprover) { res.status(403).json({ error: "已核准的假單請找主管或人資銷假" }); return; }
  } else {
    res.status(409).json({ error: "這張假單已經結束，不能取消" }); return;
  }

  const [record] = await db.update(leavesTable).set({ status: "Cancelled" })
    .where(and(eq(leavesTable.id, id), eq(leavesTable.status, existing.status))).returning();
  if (!record) { res.status(409).json({ error: "這張假單剛剛已經被處理" }); return; }
  await closeApprovalRequests(id, "Cancelled", req.session?.user?.username);
  if (!isOwner || existing.status === "Approved") {
    const label = leaveTypeRule(record.leaveType)?.label || record.leaveType;
    await notifyEmployee(record.employeeId, "假單已取消", `您的${label}（${record.fromDate} ~ ${record.toDate}）已被取消`, id);
  }
  res.json({ ...record, totalDays: Number(record.totalDays) });
});

export default router;
