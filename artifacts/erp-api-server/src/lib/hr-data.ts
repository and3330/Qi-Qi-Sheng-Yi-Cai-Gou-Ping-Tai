import { and, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { db, calendarEventsTable, employeesTable, leaveGrantsTable, leavesTable, adminUsersTable, notificationsTable } from "@workspace/erp-db";
import {
  addDays, currentAnnualLeavePeriod, eachDate, isDateString, nextAnnualLeaveGrant, seniorityText,
  type AnnualLeavePeriod,
} from "./hr-rules";

export const ANNUAL_LEAVE = "Annual Leave";

/** 行事曆裡類型是「假日」的日子（國定假日、公司休假），這些日子不算應出勤、請假也不扣天數 */
export async function loadHolidays(from: string, to: string): Promise<Set<string>> {
  const rows = await db.select({
    startDate: calendarEventsTable.startDate,
    endDate: calendarEventsTable.endDate,
  }).from(calendarEventsTable).where(and(
    eq(calendarEventsTable.eventType, "Holiday"),
    eq(calendarEventsTable.status, "Active"),
    lte(calendarEventsTable.startDate, to),
    sql`COALESCE(${calendarEventsTable.endDate}, ${calendarEventsTable.startDate}) >= ${from}`,
  ));
  const out = new Set<string>();
  for (const row of rows) {
    const start = String(row.startDate).slice(0, 10);
    const end = String(row.endDate || row.startDate).slice(0, 10);
    if (!isDateString(start) || !isDateString(end)) continue;
    for (const d of eachDate(start < from ? from : start, end > to ? to : end)) out.add(d);
  }
  return out;
}

type EmployeeRow = typeof employeesTable.$inferSelect;
type GrantRow = typeof leaveGrantsTable.$inferSelect;
type LeaveRow = typeof leavesTable.$inferSelect;

/** 特休要算到哪一天：在職算到今天，已離職算到離職日 */
function asOfFor(emp: Pick<EmployeeRow, "resignationDate">, today: string): string {
  return emp.resignationDate && isDateString(emp.resignationDate) && emp.resignationDate < today ? emp.resignationDate : today;
}

/**
 * 依到職日自動發放特休：替每位在職員工補上「今天所在年資區間」的發放紀錄。
 * 重複執行不會重複發放（同一位員工同一個區間只有一筆）。回傳這次新發放的名單。
 */
export async function ensureAnnualGrants(today: string, onlyEmployeeId?: number): Promise<{ employeeId: number; name: string; days: number; label: string; periodStart: string; periodEnd: string }[]> {
  const employees = await db.select().from(employeesTable).where(and(
    eq(employeesTable.status, "Active"),
    ...(onlyEmployeeId !== undefined ? [eq(employeesTable.id, onlyEmployeeId)] : []),
  ));
  if (employees.length === 0) return [];
  const existing = await db.select().from(leaveGrantsTable).where(and(
    eq(leaveGrantsTable.leaveType, ANNUAL_LEAVE),
    eq(leaveGrantsTable.source, "auto"),
    inArray(leaveGrantsTable.employeeId, employees.map(e => e.id)),
  ));
  const created: Awaited<ReturnType<typeof ensureAnnualGrants>> = [];
  for (const emp of employees) {
    if (emp.resignationDate && isDateString(emp.resignationDate) && emp.resignationDate < today) continue;
    const period = currentAnnualLeavePeriod(emp.dateOfJoining, today);
    if (!period) continue;
    const mine = existing.filter(g => g.employeeId === emp.id);
    if (mine.some(g => g.periodStart === period.periodStart)) continue;
    // 到職日被改過：同一段期間留下的舊發放紀錄（還沒結清的）要拿掉，避免重複計算
    const stale = mine.filter(g => !g.settledAt && g.periodStart <= today && g.periodEnd >= today);
    if (stale.length > 0) await db.delete(leaveGrantsTable).where(inArray(leaveGrantsTable.id, stale.map(g => g.id)));
    const inserted = await db.insert(leaveGrantsTable).values({
      employeeId: emp.id, leaveType: ANNUAL_LEAVE,
      periodStart: period.periodStart, periodEnd: period.periodEnd,
      days: String(period.days), source: "auto",
      note: `${period.label}，依勞基法第 38 條發放 ${period.days} 天`, createdBy: "system",
    }).onConflictDoNothing().returning({ id: leaveGrantsTable.id });
    if (inserted.length === 0) continue;
    created.push({
      employeeId: emp.id, name: `${emp.firstName}${emp.lastName}`.trim() || emp.employeeId,
      days: period.days, label: period.label, periodStart: period.periodStart, periodEnd: period.periodEnd,
    });
  }
  if (created.length > 0) {
    // 通知本人（有綁登入帳號的才通知得到）
    const accounts = await db.select({ employeeId: adminUsersTable.employeeId, username: adminUsersTable.username })
      .from(adminUsersTable).where(inArray(adminUsersTable.employeeId, created.map(c => c.employeeId)));
    for (const c of created) {
      const account = accounts.find(a => a.employeeId === c.employeeId);
      if (!account) continue;
      await db.insert(notificationsTable).values({
        title: "特休已發放",
        message: `您已${c.label}，獲得特休 ${c.days} 天，可使用期間 ${c.periodStart} ~ ${c.periodEnd}。`,
        type: "info", module: "HR", documentType: "Leave", recipient: account.username,
      });
    }
  }
  return created;
}

/** 離職日已經過了、狀態還是在職的員工：改成離職並停用登入帳號。回傳處理的人數。 */
export async function closeResignedEmployees(today: string): Promise<number> {
  const due = await db.update(employeesTable).set({ status: "Inactive" }).where(and(
    eq(employeesTable.status, "Active"),
    sql`${employeesTable.resignationDate} IS NOT NULL AND ${employeesTable.resignationDate} < ${today}`,
  )).returning({ id: employeesTable.id });
  if (due.length > 0) {
    await db.update(adminUsersTable).set({ isActive: false }).where(inArray(adminUsersTable.employeeId, due.map(d => d.id)));
  }
  return due.length;
}

export interface AnnualBalance {
  period: AnnualLeavePeriod | null;
  entitled: number;
  used: number;
  pending: number;
  remaining: number;
  /** 這一期還有幾天到期（還有剩才有意義） */
  daysToExpiry: number | null;
  next: { date: string; days: number; label: string } | null;
  seniority: string;
}

function sumDays(rows: { totalDays: string | number }[]): number {
  return Math.round(rows.reduce((sum, r) => sum + Number(r.totalDays || 0), 0) * 10) / 10;
}

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000);
}

/** 用已經讀進來的發放紀錄與假單算一位員工的特休餘額 */
export function computeAnnualBalance(emp: Pick<EmployeeRow, "dateOfJoining" | "resignationDate">, today: string, grants: GrantRow[], leaves: LeaveRow[], excludeLeaveId?: number): AnnualBalance {
  const asOf = asOfFor(emp, today);
  const period = currentAnnualLeavePeriod(emp.dateOfJoining, asOf);
  const next = emp.resignationDate && emp.resignationDate <= today ? null : nextAnnualLeaveGrant(emp.dateOfJoining, today);
  const seniority = seniorityText(emp.dateOfJoining, asOf);
  if (!period) return { period: null, entitled: 0, used: 0, pending: 0, remaining: 0, daysToExpiry: null, next, seniority };
  const inPeriod = (d: string) => d >= period.periodStart && d <= period.periodEnd;
  const entitled = Math.round(grants.filter(g => g.leaveType === ANNUAL_LEAVE && inPeriod(g.periodStart))
    .reduce((sum, g) => sum + Number(g.days), 0) * 10) / 10;
  const mine = leaves.filter(l => l.leaveType === ANNUAL_LEAVE && inPeriod(l.fromDate) && l.id !== excludeLeaveId);
  const used = sumDays(mine.filter(l => l.status === "Approved"));
  const pending = sumDays(mine.filter(l => l.status === "Pending"));
  return {
    period, entitled, used, pending,
    remaining: Math.round((entitled - used - pending) * 10) / 10,
    daysToExpiry: daysBetween(today, period.periodEnd),
    next, seniority,
  };
}

/** 讀一位員工的特休餘額（會先補發放紀錄） */
export async function annualBalanceFor(employeeId: number, today: string, excludeLeaveId?: number): Promise<{ employee: EmployeeRow; balance: AnnualBalance } | null> {
  const [employee] = await db.select().from(employeesTable).where(eq(employeesTable.id, employeeId));
  if (!employee) return null;
  await ensureAnnualGrants(today, employeeId);
  const [grants, leaves] = await Promise.all([
    db.select().from(leaveGrantsTable).where(eq(leaveGrantsTable.employeeId, employeeId)),
    db.select().from(leavesTable).where(and(eq(leavesTable.employeeId, employeeId), eq(leavesTable.leaveType, ANNUAL_LEAVE))),
  ]);
  return { employee, balance: computeAnnualBalance(employee, today, grants, leaves, excludeLeaveId) };
}

export interface UnsettledGrant {
  grantId: number; employeeId: number; employeeCode: string; employeeName: string;
  periodStart: string; periodEnd: string; reason: "expired" | "resigned";
  entitled: number; used: number; unusedDays: number; dailyWage: number; amount: number;
}

/** 全公司特休總覽：每個人的餘額，加上期滿或離職還沒結清的特休 */
export async function annualOverview(today: string) {
  await ensureAnnualGrants(today);
  const [employees, grants, leaves] = await Promise.all([
    db.select().from(employeesTable),
    db.select().from(leaveGrantsTable).where(eq(leaveGrantsTable.leaveType, ANNUAL_LEAVE)),
    db.select().from(leavesTable).where(and(eq(leavesTable.leaveType, ANNUAL_LEAVE), inArray(leavesTable.status, ["Approved", "Pending"]))),
  ]);
  const name = (e: EmployeeRow) => `${e.firstName}${e.lastName}`.trim() || e.employeeId;
  const rows = employees.filter(e => e.status === "Active").map(e => ({
    employeeId: e.id, employeeCode: e.employeeId, employeeName: name(e), dateOfJoining: e.dateOfJoining,
    ...computeAnnualBalance(e, today, grants.filter(g => g.employeeId === e.id), leaves.filter(l => l.employeeId === e.id)),
  })).sort((a, b) => a.employeeCode.localeCompare(b.employeeCode));

  const unsettled: UnsettledGrant[] = [];
  for (const grant of grants) {
    if (grant.source !== "auto" || grant.settledAt) continue;
    const emp = employees.find(e => e.id === grant.employeeId);
    if (!emp) continue;
    const resigned = Boolean(emp.resignationDate && isDateString(emp.resignationDate) && emp.resignationDate <= today) || emp.status === "Inactive";
    const expired = grant.periodEnd < today;
    if (!resigned && !expired) continue;
    const inPeriod = (d: string) => d >= grant.periodStart && d <= grant.periodEnd;
    const entitled = grants.filter(g => g.employeeId === emp.id && inPeriod(g.periodStart)).reduce((sum, g) => sum + Number(g.days), 0);
    const used = sumDays(leaves.filter(l => l.employeeId === emp.id && l.status === "Approved" && inPeriod(l.fromDate)));
    const unusedDays = Math.round((entitled - used) * 10) / 10;
    if (unusedDays <= 0) continue;
    const dailyWage = Math.round((Number(emp.salary) || 0) / 30);
    unsettled.push({
      grantId: grant.id, employeeId: emp.id, employeeCode: emp.employeeId, employeeName: name(emp),
      periodStart: grant.periodStart, periodEnd: grant.periodEnd, reason: expired ? "expired" : "resigned",
      entitled: Math.round(entitled * 10) / 10, used, unusedDays, dailyWage, amount: Math.round(unusedDays * dailyWage),
    });
  }
  unsettled.sort((a, b) => a.periodEnd.localeCompare(b.periodEnd));
  return { today, rows, unsettled };
}

/** 一位員工某一年已核准或待審的假單（檢查年度上限用） */
export async function leavesOfYear(employeeId: number, year: string, excludeLeaveId?: number): Promise<LeaveRow[]> {
  const rows = await db.select().from(leavesTable).where(and(
    eq(leavesTable.employeeId, employeeId),
    inArray(leavesTable.status, ["Approved", "Pending"]),
    lte(leavesTable.fromDate, `${year}-12-31`),
    gte(leavesTable.toDate, `${year}-01-01`),
  ));
  return rows.filter(r => r.id !== excludeLeaveId);
}

export { addDays };
