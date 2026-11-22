import { Router, type IRouter } from "express";
import { and, desc, eq, gte, lte, ne, type SQL } from "drizzle-orm";
import {
  db, salesOrdersTable, purchaseOrdersTable, invoicesTable, customersTable, suppliersTable, stockEntriesTable, warehousesTable,
  salarySlipsTable, employeesTable, attendanceTable, leavesTable,
} from "@workspace/erp-db";
import { requireAuth, EMPLOYEE_ROLE } from "../middleware/require-auth";
import { isMenuPathDisabled } from "../middleware/module-guard";
import { customRoleDenial } from "../middleware/permission-guard";
import { customRoleForUser } from "../lib/custom-roles";
import { agingParts } from "../lib/payment-terms";
import { daysSince, unbilledOrderReceivables } from "../lib/unbilled-receivables";
import { todayTaipei } from "../lib/inventory-journal";
import { addDays, addMonths, eachDate, isDateString, summarizeMonth, taipeiToday, workingDates } from "../lib/hr-rules";
import { loadHolidays } from "../lib/hr-data";
import { machineOnly } from "../lib/api-key-user";

/**
 * 報表「點數字看單據」：GET /report-drill/documents?kind=…
 * 營運報表（銷售分析、採購分析、帳齡、庫存）上的數字是從單據加總來的，這裡用跟報表一樣的條件，
 * 把算進那個數字的每一張單列出來；前端每一列都可以點開原單。
 *   sales-orders     銷售分析：customerId / salespersonId / month / itemName ＋ startDate、endDate
 *   purchase-orders  採購分析：supplierId / month / itemName ＋ startDate、endDate
 *   open-invoices    應收、應付帳齡：type=Sales|Purchase ＋ partyId（0＝未指定）＋ bucket（current/d30/d60/d90/d120，可省略）
 *   stock-entries    庫存：itemId ＋ warehouseId（可省略）
 *   salary-slips     薪資彙總：year、month（跟報表一樣，可省略）＋ field（看哪一個金額：gross/net/deductions/laborInsEmployer/healthInsEmployer/pensionEmployer/employer）
 *   attendance       出勤彙總：year、month ＋ employeeId（可省略＝全部員工）＋ metric（present/absent/late/lateMinutes/earlyLeave/hours/overtime/employees）
 * 薪資單、出勤只給看得到薪資彙總、出勤彙總報表的人看（見 hrReportDenial）。
 */
const router: IRouter = Router();
router.use("/report-drill", requireAuth);

interface DrillRow {
  id: number; number: string; date: string | null; party: string | null; status: string | null; amount: number | null; quantity?: number | null; note?: string | null; href: string | null;
  /** 薪資單沒有自己的網址：前端用這三個值把那張薪資單讀出來開視窗 */
  slip?: { employeeId: number; year: number; month: number };
}
const LIMIT = 500;
const cents = (n: number) => Math.round(n * 100) / 100;
const round1 = (n: number) => Math.round(n * 10) / 10;
const itemsOf = (raw: unknown): Array<Record<string, any>> => (Array.isArray(raw) ? raw : []);
const itemNameOf = (i: Record<string, any>) => String(i.itemName || i.name || "未知品項");

/**
 * 人事類明細（薪資單、出勤）的權限：跟 /reports/salary-summary、/reports/attendance-summary 一樣，
 * 只給擁有者、管理員、人資、財務看；那張報表被平台停用、或自訂角色沒有那張報表的檢視權限時，明細也不給看。
 */
const HR_REPORT_ROLES = ["owner", "admin", "hr_admin", "finance_admin"];
async function hrReportDenial(req: any, reportPath: string): Promise<{ status: number; error: string } | null> {
  const tenantId = Number(req.tenantId ?? req.session?.user?.tenantId ?? req.apiKey?.tenantId) || 0;
  if (tenantId > 1 && await isMenuPathDisabled(tenantId, reportPath)) return { status: 403, error: "此模組未開放" };
  if (machineOnly(req)) return null;
  const u = req.session?.user;
  if (!u) return { status: 401, error: "請先登入" };
  if (u.role !== "super_admin" && !HR_REPORT_ROLES.includes(u.role)) return { status: 403, error: "權限不足" };
  if (u.role === "hr_admin" || u.role === "finance_admin") {
    const role = tenantId && u.id ? await customRoleForUser(tenantId, u.id).catch(() => null) : null;
    const denial = role ? customRoleDenial(role, "GET", reportPath) : null;
    if (denial) return { status: 403, error: denial };
  }
  return null;
}

const SALARY_FIELDS: Record<string, (s: typeof salarySlipsTable.$inferSelect) => number> = {
  gross: s => s.grossSalary, net: s => s.netSalary, deductions: s => s.totalDeductions,
  laborInsEmployer: s => s.laborInsuranceEmployer, healthInsEmployer: s => s.healthInsuranceEmployer, pensionEmployer: s => s.pensionEmployer,
  employer: s => s.laborInsuranceEmployer + s.healthInsuranceEmployer + s.pensionEmployer,
};
const ATTENDANCE_METRICS = ["present", "absent", "late", "lateMinutes", "earlyLeave", "hours", "overtime", "employees"] as const;
type AttendanceMetric = (typeof ATTENDANCE_METRICS)[number];
// 跟 lib/hr-rules.ts summarizeMonth 算「出勤」的狀態一樣；下面每位員工都會拿 summarizeMonth 的結果核對
const PRESENT_STATUS = new Set(["present", "late", "early leave", "early_leave", "early-leave"]);

router.get("/report-drill/documents", async (req, res): Promise<void> => {
  const role = machineOnly(req) ? null : req.session?.user?.role;
  if (role === EMPLOYEE_ROLE) { res.status(403).json({ error: "權限不足" }); return; }
  const q = req.query as Record<string, string | undefined>;
  const kind = String(q.kind || "");
  const startDate = q.startDate || undefined, endDate = q.endDate || undefined;
  const month = q.month && /^\d{4}-\d{2}$/.test(q.month) ? q.month : undefined;
  const itemName = typeof q.itemName === "string" && q.itemName ? q.itemName : undefined;
  const num = (v: string | undefined) => (v === undefined || v === "" ? undefined : Number(v));
  let rows: DrillRow[] = [];
  let quantityTotal: number | null | undefined;

  if (kind === "sales-orders" || kind === "purchase-orders") {
    const sales = kind === "sales-orders";
    const table = sales ? salesOrdersTable : purchaseOrdersTable;
    const conditions: SQL[] = [];
    if (startDate) conditions.push(gte(table.orderDate, startDate));
    if (endDate) conditions.push(lte(table.orderDate, endDate));
    const partyId = num(sales ? q.customerId : q.supplierId);
    if (partyId !== undefined && Number.isInteger(partyId)) conditions.push(sales ? eq(salesOrdersTable.customerId, partyId) : eq(purchaseOrdersTable.supplierId, partyId));
    const orders: any[] = conditions.length > 0 ? await db.select().from(table).where(and(...conditions)).orderBy(desc(table.orderDate)) : await db.select().from(table).orderBy(desc(table.orderDate));
    const names = new Map<number, string>((sales
      ? await db.select({ id: customersTable.id, name: customersTable.name }).from(customersTable)
      : await db.select({ id: suppliersTable.id, name: suppliersTable.name }).from(suppliersTable)).map(r => [r.id, r.name]));
    const salespersonId = sales ? num(q.salespersonId) : undefined;
    for (const o of orders) {
      if (month && String(o.orderDate).slice(0, 7) !== month) continue;
      if (salespersonId !== undefined && (o.salespersonId || 0) !== salespersonId) continue;
      let amount = Number(o.totalAmount), quantity: number | null = null;
      if (itemName) {
        const hits = itemsOf(o.items).filter(i => itemNameOf(i) === itemName);
        if (hits.length === 0) continue;
        amount = hits.reduce((s, i) => s + Number(i.amount || 0), 0);
        quantity = hits.reduce((s, i) => s + Number(i.qty || i.quantity || 0), 0);
      }
      rows.push({
        id: o.id, number: o.orderNumber, date: o.orderDate, party: names.get(sales ? o.customerId : o.supplierId) ?? null, status: o.status,
        amount: cents(amount), quantity, href: sales ? `/sales/orders/${o.id}` : `/purchasing/orders/${o.id}`,
      });
    }
  } else if (kind === "open-invoices") {
    const sales = q.type !== "Purchase";
    const partyId = num(q.partyId);
    const bucket = q.bucket && ["current", "d30", "d60", "d90", "d120"].includes(q.bucket) ? q.bucket : undefined;
    const today = todayTaipei();
    // 條件跟應收帳齡、應付帳齡報表一樣：應收不含已收、取消、呆帳；應付不含已付、取消
    const conditions: SQL[] = [eq(invoicesTable.invoiceType, sales ? "Sales" : "Purchase"), ne(invoicesTable.status, "Paid"), ne(invoicesTable.status, "Cancelled")];
    if (sales) conditions.push(ne(invoicesTable.status, "WrittenOff"));
    const invoices = await db.select().from(invoicesTable).where(and(...conditions)).orderBy(invoicesTable.invoiceDate);
    const names = new Map<number, string>((sales
      ? await db.select({ id: customersTable.id, name: customersTable.name }).from(customersTable)
      : await db.select({ id: suppliersTable.id, name: suppliersTable.name }).from(suppliersTable)).map(r => [r.id, r.name]));
    const bucketOf = (days: number) => (days <= 0 ? "current" : days <= 30 ? "d30" : days <= 60 ? "d60" : days <= 90 ? "d90" : "d120");
    for (const inv of invoices) {
      const outstanding = Number(inv.outstandingAmount);
      if (outstanding <= 0) continue;
      const owner = (sales ? inv.customerId : inv.supplierId) || 0;
      if (partyId !== undefined && owner !== partyId) continue;
      let amount = outstanding, oldest = 0;
      const parts = agingParts(inv, outstanding, today).map(p => ({ amount: p.amount, days: Math.max(0, Math.floor((new Date(today).getTime() - new Date(p.dueDate).getTime()) / 86400000)) }));
      if (bucket) {
        const hits = parts.filter(p => bucketOf(p.days) === bucket);
        if (hits.length === 0) continue;
        amount = hits.reduce((s, p) => s + p.amount, 0);
        oldest = Math.max(...hits.map(p => p.days));
      } else oldest = Math.max(0, ...parts.map(p => p.days));
      rows.push({
        id: inv.id, number: inv.invoiceNumber, date: inv.invoiceDate, party: names.get(owner) ?? "未指定", status: inv.status, amount: cents(amount),
        note: oldest > 0 ? `逾期 ${oldest} 天` : "未到期", href: sales ? `/sales/invoices?open=${inv.id}` : `/purchasing/invoices?open=${inv.id}`,
      });
    }
    // 應收：還沒開發票的未收銷貨單也算（跟應收帳齡報表同一套算法）
    if (sales) {
      for (const order of await unbilledOrderReceivables(db, partyId !== undefined && partyId > 0 ? partyId : undefined)) {
        if (partyId !== undefined && (order.customerId || 0) !== partyId) continue;
        const days = daysSince(order.orderDate, today);
        if (bucket && bucketOf(days) !== bucket) continue;
        rows.push({
          id: -order.id, number: order.orderNumber, date: order.orderDate, party: names.get(order.customerId) ?? "未指定", status: order.status, amount: cents(order.outstanding),
          note: `還沒開發票${order.legacy ? "（舊系統）" : ""}・單據日起 ${days} 天`, href: `/sales/orders/${order.id}`,
        });
      }
    }
  } else if (kind === "stock-entries") {
    const itemId = num(q.itemId);
    if (itemId === undefined || !Number.isInteger(itemId) || itemId <= 0) { res.status(400).json({ error: "缺少品項" }); return; }
    const warehouseId = num(q.warehouseId);
    const conditions: SQL[] = [eq(stockEntriesTable.itemId, itemId)];
    if (warehouseId !== undefined && Number.isInteger(warehouseId) && warehouseId > 0) conditions.push(eq(stockEntriesTable.warehouseId, warehouseId));
    const entries = await db.select().from(stockEntriesTable).where(and(...conditions)).orderBy(desc(stockEntriesTable.createdAt), desc(stockEntriesTable.id));
    const warehouses = new Map<number, string>((await db.select({ id: warehousesTable.id, name: warehousesTable.name }).from(warehousesTable)).map(w => [w.id, w.name]));
    const TYPE: Record<string, string> = { Receipt: "入庫", Issue: "出庫", Transfer: "調撥" };
    rows = entries.map(e => {
      const qty = Number(e.quantity) * (e.entryType === "Receipt" ? 1 : -1);
      const when = e.createdAt instanceof Date ? new Date(e.createdAt.getTime() + 8 * 3600_000).toISOString().slice(0, 10) : String(e.createdAt ?? "").slice(0, 10);
      return {
        id: e.id, number: e.source || `異動 #${e.id}`, date: when, party: (e.warehouseId && warehouses.get(e.warehouseId)) || null, status: TYPE[e.entryType] ?? e.entryType,
        amount: e.amount == null ? null : cents(Number(e.amount)), quantity: qty, note: e.remarks || null, href: null,
      };
    });
  } else if (kind === "salary-slips") {
    const denied = await hrReportDenial(req, "/reports/salary-summary");
    if (denied) { res.status(denied.status).json({ error: denied.error }); return; }
    const y = num(q.year), m = num(q.month);
    if ((y !== undefined && (!Number.isInteger(y) || y < 1900 || y > 2200)) || (m !== undefined && (!Number.isInteger(m) || m < 1 || m > 12))) {
      res.status(400).json({ error: "year、month 格式不正確" }); return;
    }
    const pick = SALARY_FIELDS[q.field || "net"];
    if (!pick) { res.status(400).json({ error: "不支援的金額欄位" }); return; }
    // 條件跟薪資彙總報表一樣：只看年度、月份，不分狀態（草稿也算）
    const conditions: SQL[] = [];
    if (y !== undefined) conditions.push(eq(salarySlipsTable.year, y));
    if (m !== undefined) conditions.push(eq(salarySlipsTable.month, m));
    const slips = conditions.length > 0 ? await db.select().from(salarySlipsTable).where(and(...conditions)) : await db.select().from(salarySlipsTable);
    const emps = new Map((await db.select({ id: employeesTable.id, code: employeesTable.employeeId, firstName: employeesTable.firstName, lastName: employeesTable.lastName }).from(employeesTable)).map(e => [e.id, e]));
    rows = slips.map(s => {
      const emp = emps.get(s.employeeId);
      return {
        id: s.id, number: emp?.code ?? `#${s.employeeId}`, date: `${s.year}-${String(s.month).padStart(2, "0")}`, party: emp ? `${emp.firstName}${emp.lastName}` : `#${s.employeeId}`,
        status: s.status, amount: pick(s), href: null, slip: { employeeId: s.employeeId, year: s.year, month: s.month },
      };
    }).sort((a, b) => String(a.date).localeCompare(String(b.date)) || a.number.localeCompare(b.number, "zh-Hant", { numeric: true }));
  } else if (kind === "attendance") {
    const denied = await hrReportDenial(req, "/reports/attendance-summary");
    if (denied) { res.status(denied.status).json({ error: denied.error }); return; }
    const y = num(q.year), m = num(q.month);
    if (y === undefined || m === undefined || !Number.isInteger(y) || y < 1900 || y > 2200 || !Number.isInteger(m) || m < 1 || m > 12) {
      res.status(400).json({ error: "year、month 格式不正確" }); return;
    }
    const metric = (ATTENDANCE_METRICS as readonly string[]).includes(q.metric || "") ? q.metric as AttendanceMetric : null;
    if (!metric) { res.status(400).json({ error: "不支援的出勤項目" }); return; }
    const employeeId = num(q.employeeId);
    const mm = String(m).padStart(2, "0");
    const startDate = `${y}-${mm}-01`;
    const endDate = `${y}-${mm}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, "0")}`;
    // 讀的資料、算進哪些員工，都跟出勤彙總報表一樣
    const [allEmployees, attendance, leaves, holidays] = await Promise.all([
      db.select().from(employeesTable),
      db.select().from(attendanceTable).where(and(gte(attendanceTable.date, startDate), lte(attendanceTable.date, endDate))),
      db.select().from(leavesTable).where(and(eq(leavesTable.status, "Approved"), lte(leavesTable.fromDate, endDate), gte(leavesTable.toDate, startDate))),
      loadHolidays(startDate, endDate),
    ]);
    const employees = allEmployees.filter(e => e.status === "Active" || (e.resignationDate && e.resignationDate >= startDate))
      .filter(e => employeeId === undefined || e.id === employeeId)
      .sort((a, b) => String(a.employeeId).localeCompare(String(b.employeeId), "zh-Hant", { numeric: true }));
    const today = taipeiToday();
    let sum = 0, synthetic = 0;
    for (const emp of employees) {
      const name = `${emp.firstName}${emp.lastName}`;
      if (metric === "employees") {
        rows.push({ id: emp.id, number: emp.employeeId, date: emp.dateOfJoining ?? null, party: name, status: emp.status, amount: null, href: null });
        continue;
      }
      const records = attendance.filter(a => a.employeeId === emp.id).sort((a, b) => a.date.localeCompare(b.date));
      const approvedLeaves = leaves.filter(l => l.employeeId === emp.id);
      const stats = summarizeMonth({ year: y, month: m, today, joinDate: emp.dateOfJoining, resignationDate: emp.resignationDate, holidays, records, approvedLeaves });
      const recordNote = (a: (typeof records)[number]) => [
        a.checkIn || a.checkOut ? `${a.checkIn ?? "沒打卡"}～${a.checkOut ?? "沒打卡"}` : "",
        a.lateMinutes > 0 ? `遲到 ${a.lateMinutes} 分` : "", a.earlyLeaveMinutes > 0 ? `早退 ${a.earlyLeaveMinutes} 分` : "", a.note || "",
      ].filter(Boolean).join("・") || null;
      const push = (a: (typeof records)[number], quantity: number) => rows.push({ id: a.id, number: emp.employeeId, date: a.date, party: name, status: a.status, amount: null, quantity, note: recordNote(a), href: null });
      // 每一種數字列出的紀錄，跟 summarizeMonth 算那個數字用的是同一批；expected 是報表上那一格的值，最後核對
      let mine = 0, expected = 0;
      if (metric === "present") {
        for (const a of records) if (PRESENT_STATUS.has(a.status.toLowerCase())) { push(a, 1); mine += 1; }
        expected = stats.presentDays;
      } else if (metric === "late" || metric === "lateMinutes") {
        for (const a of records) if (a.lateMinutes > 0) { const v = metric === "late" ? 1 : a.lateMinutes; push(a, v); mine += v; }
        expected = metric === "late" ? stats.lateCount : stats.totalLateMinutes;
      } else if (metric === "earlyLeave") {
        for (const a of records) if (a.earlyLeaveMinutes > 0) { push(a, 1); mine += 1; }
        expected = stats.earlyLeaveCount;
      } else if (metric === "hours" || metric === "overtime") {
        for (const a of records) { const v = Number((metric === "hours" ? a.workingHours : a.overtimeHours) || 0); if (v) { push(a, v); mine += v; } }
        // 報表把時數四捨五入到小數一位；加總順序不同可能差在最後一位，所以差不到 0.05 就當作一樣，合計用報表的值
        expected = round1(metric === "hours" ? stats.totalWorkingHours : stats.totalOvertimeHours);
        if (Math.abs(mine - expected) <= 0.051) mine = expected;
      } else {
        // 缺勤＝打卡紀錄寫「缺勤」的日子，加上「該上班、已經過去、沒打卡也沒請假」的日子（後面這種沒有紀錄可以開）
        const monthEnd = addDays(addMonths(startDate, 1), -1);
        const from = emp.dateOfJoining && isDateString(emp.dateOfJoining) && emp.dateOfJoining > startDate ? emp.dateOfJoining : startDate;
        const to = emp.resignationDate && isDateString(emp.resignationDate) && emp.resignationDate < monthEnd ? emp.resignationDate : monthEnd;
        const leaveDates = new Set<string>();
        for (const l of approvedLeaves) {
          const s = l.fromDate > startDate ? l.fromDate : startDate, e = l.toDate < monthEnd ? l.toDate : monthEnd;
          if (s <= e) for (const d of eachDate(s, e)) leaveDates.add(d);
        }
        for (const a of records) if (a.status.toLowerCase() === "on leave") leaveDates.add(a.date);
        const recorded = new Set(records.map(a => a.date));
        const seen = new Set<string>();
        for (const a of records) if (a.status.toLowerCase() === "absent" && !seen.has(a.date)) { seen.add(a.date); push(a, 1); mine += 1; }
        for (const d of from <= to ? workingDates(from, to, holidays) : []) {
          if (d >= today || recorded.has(d) || leaveDates.has(d) || seen.has(d)) continue;
          seen.add(d); mine += 1;
          rows.push({ id: -(++synthetic), number: emp.employeeId, date: d, party: name, status: "Absent", amount: null, quantity: 1, note: "沒有打卡，也沒有請假", href: null });
        }
        expected = stats.absentDays;
      }
      // 明細和報表對不起來就不給看，免得列出一份跟數字不一樣的清單
      if (Math.abs(mine - expected) > 0.001) { res.status(500).json({ error: `${name} 的明細和報表上的數字對不起來（明細 ${mine}、報表 ${expected}），請通知系統管理員` }); return; }
      sum += expected;
    }
    quantityTotal = metric === "employees" ? null : round1(sum);
  } else {
    res.status(400).json({ error: "不支援的明細種類" }); return;
  }

  const total = cents(rows.reduce((s, r) => s + (r.amount ?? 0), 0));
  const quantity = quantityTotal !== undefined ? quantityTotal : rows.some(r => r.quantity != null) ? cents(rows.reduce((s, r) => s + (r.quantity ?? 0), 0)) : null;
  res.json({ count: rows.length, total, quantity, truncated: rows.length > LIMIT, rows: rows.slice(0, LIMIT) });
});

export default router;
