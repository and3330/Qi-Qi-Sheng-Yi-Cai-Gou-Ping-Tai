import { Router, type IRouter } from "express";
import { and, desc, eq, gte, lte, ne, sql } from "drizzle-orm";
import { db, serviceFeesTable, teachersTable, employeesTable, salesOrdersTable, projectsTable, journalEntriesTable, salarySlipsTable, activitiesTable } from "@workspace/erp-db";
import { requireAuth, requireRole } from "../middleware/require-auth";
import { nextDocNumber } from "../lib/doc-number";
import { postAutoJournal, todayTaipei } from "../lib/inventory-journal";
import { cashLineAccount, isRealDate } from "../lib/cash-accounts";
import { INCOME_TYPES, WITHHOLDING_DEFAULTS, serviceFeeProblem, suggestWithholding, summarizeAnnualFees, type FeeRow } from "../lib/service-fees";

const router: IRouter = Router();
// 服務費牽涉個人所得與薪資，只開放給人資、財務與管理員
router.use("/service-fees", requireAuth, requireRole("owner", "admin", "hr_admin", "finance_admin", "accountant"));

const numeric = (row: typeof serviceFeesTable.$inferSelect) => ({
  ...row,
  hours: row.hours == null ? null : Number(row.hours),
  rate: row.rate == null ? null : Number(row.rate),
  amount: Number(row.amount),
  withholdingTax: Number(row.withholdingTax),
  nhiSupplement: Number(row.nhiSupplement),
  netAmount: Number(row.netAmount),
});

const toFeeRow = (row: typeof serviceFeesTable.$inferSelect): FeeRow => ({
  payeeType: row.payeeType, teacherId: row.teacherId, employeeId: row.employeeId, payeeName: row.payeeName,
  incomeType: row.incomeType, amount: Number(row.amount), withholdingTax: Number(row.withholdingTax),
  nhiSupplement: Number(row.nhiSupplement), netAmount: Number(row.netAmount), status: row.status,
});

// 所得類別與試算用的門檻
router.get("/service-fees/rules", (_req, res): void => {
  res.json({ incomeTypes: INCOME_TYPES, defaults: WITHHOLDING_DEFAULTS });
});

// 試算代扣稅款與補充保費（畫面輸入金額時即時顯示）
router.get("/service-fees/suggest", (req, res): void => {
  const amount = Number(req.query.amount);
  const incomeType = String(req.query.incomeType || "50");
  const payeeType = req.query.payeeType === "employee" ? "employee" : "teacher";
  if (!Number.isFinite(amount) || amount <= 0 || !INCOME_TYPES[incomeType]) { res.status(400).json({ error: "金額或所得類別不正確" }); return; }
  res.json(suggestWithholding({ incomeType, amount, payeeType }));
});

/**
 * 年度所得彙總：這一年實際付給每個人、每種所得類別的總額與代扣金額。
 * 員工另外列出同年度已發放的薪資，方便把授課費與薪資合併申報。
 */
router.get("/service-fees/annual-summary", async (req, res): Promise<void> => {
  const year = Number(req.query.year);
  if (!Number.isInteger(year) || year < 2000 || year > 2100) { res.status(400).json({ error: "年度格式不正確" }); return; }
  const from = `${year}-01-01`, to = `${year}-12-31`;
  const [paidRows, unpaidRows, teachers, employees, slips] = await Promise.all([
    db.select().from(serviceFeesTable).where(and(eq(serviceFeesTable.status, "Paid"), gte(serviceFeesTable.paidDate, from), lte(serviceFeesTable.paidDate, to))),
    db.select().from(serviceFeesTable).where(and(eq(serviceFeesTable.status, "Confirmed"), lte(serviceFeesTable.serviceDate, to))),
    db.select({ id: teachersTable.id, teacherId: teachersTable.teacherId, idNumber: teachersTable.idNumber, address: teachersTable.registeredAddress }).from(teachersTable),
    db.select({ id: employeesTable.id, employeeId: employeesTable.employeeId }).from(employeesTable),
    db.select({
      employeeId: salarySlipsTable.employeeId,
      gross: sql<string>`COALESCE(SUM(${salarySlipsTable.grossSalary}), 0)`,
      count: sql<number>`count(*)::int`,
    }).from(salarySlipsTable).where(and(eq(salarySlipsTable.year, year), sql`lower(${salarySlipsTable.status}) = 'paid'`)).groupBy(salarySlipsTable.employeeId),
  ]);
  const teacherById = new Map(teachers.map(t => [t.id, t]));
  const employeeById = new Map(employees.map(e => [e.id, e]));
  const salaryByEmployee = new Map(slips.map(s => [s.employeeId, { gross: Number(s.gross), count: s.count }]));
  const rows = summarizeAnnualFees(paidRows.map(toFeeRow), unpaidRows.map(toFeeRow)).map(item => {
    const teacher = item.payeeType === "teacher" && item.payeeId ? teacherById.get(item.payeeId) : undefined;
    const employee = item.payeeType === "employee" && item.payeeId ? employeeById.get(item.payeeId) : undefined;
    const salary = employee ? salaryByEmployee.get(employee.id) : undefined;
    return {
      ...item,
      incomeTypeLabel: INCOME_TYPES[item.incomeType]?.label || item.incomeType,
      payeeCode: teacher?.teacherId || employee?.employeeId || "",
      idNumber: teacher?.idNumber || "",
      address: teacher?.address || "",
      // 員工：同年度已發放的薪資，與授課費合計就是這個人全年從公司拿到的薪資所得
      salaryGross: item.incomeType === "50" && salary ? salary.gross : 0,
      salarySlipCount: item.incomeType === "50" && salary ? salary.count : 0,
    };
  });
  const sum = (key: "gross" | "withholdingTax" | "nhiSupplement" | "net" | "unpaid") => Math.round(rows.reduce((s, r) => s + r[key], 0) * 100) / 100;
  res.json({
    year, rows,
    totals: { gross: sum("gross"), withholdingTax: sum("withholdingTax"), nhiSupplement: sum("nhiSupplement"), net: sum("net"), unpaid: sum("unpaid") },
    missingIdNumber: rows.filter(r => r.payeeType === "teacher" && r.gross > 0 && !r.idNumber).map(r => r.payeeName),
  });
});

router.get("/service-fees", async (req, res): Promise<void> => {
  const conditions = [];
  if (isRealDate(req.query.from)) conditions.push(gte(serviceFeesTable.serviceDate, req.query.from));
  if (isRealDate(req.query.to)) conditions.push(lte(serviceFeesTable.serviceDate, req.query.to));
  if (req.query.salesOrderId) conditions.push(eq(serviceFeesTable.salesOrderId, Number(req.query.salesOrderId)));
  if (req.query.projectId) conditions.push(eq(serviceFeesTable.projectId, Number(req.query.projectId)));
  if (req.query.status) conditions.push(eq(serviceFeesTable.status, String(req.query.status)));
  const rows = await db.select({
    fee: serviceFeesTable,
    projectName: projectsTable.name,
    orderNumber: salesOrdersTable.orderNumber,
  }).from(serviceFeesTable)
    .leftJoin(projectsTable, eq(projectsTable.id, serviceFeesTable.projectId))
    .leftJoin(salesOrdersTable, eq(salesOrdersTable.id, serviceFeesTable.salesOrderId))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(serviceFeesTable.serviceDate), desc(serviceFeesTable.id))
    .limit(1000);
  res.json(rows.map(r => ({ ...numeric(r.fee), projectName: r.projectName, orderNumber: r.orderNumber, incomeTypeLabel: INCOME_TYPES[r.fee.incomeType]?.label || r.fee.incomeType })));
});

/**
 * 登錄一筆服務費：立刻認列成本（借 勞務成本／貸 應付費用），歸到專案與部門。
 * 付款是另一個動作，付款時才扣稅款與補充保費。
 */
router.post("/service-fees", async (req, res): Promise<void> => {
  const body = req.body || {};
  const payeeType = body.payeeType === "employee" ? "employee" : body.payeeType === "teacher" ? "teacher" : null;
  if (!payeeType) { res.status(400).json({ error: "請選擇對象是外聘講師還是員工" }); return; }
  const payeeId = Number(payeeType === "teacher" ? body.teacherId : body.employeeId);
  if (!Number.isInteger(payeeId) || payeeId <= 0) { res.status(400).json({ error: payeeType === "teacher" ? "請選擇講師" : "請選擇員工" }); return; }
  const projectId = Number(body.projectId);
  if (!Number.isInteger(projectId) || projectId <= 0) { res.status(400).json({ error: "請選擇專案：每一筆支出都必須歸屬到專案" }); return; }
  if (!isRealDate(body.serviceDate)) { res.status(400).json({ error: "請填寫服務日期" }); return; }
  const incomeType = String(body.incomeType || "50");
  if (!INCOME_TYPES[incomeType]) { res.status(400).json({ error: "所得類別無效" }); return; }

  const hours = body.hours === undefined || body.hours === null || body.hours === "" ? null : Number(body.hours);
  const rate = body.rate === undefined || body.rate === null || body.rate === "" ? null : Number(body.rate);
  const amount = Math.round((Number(body.amount) || (hours && rate ? hours * rate : 0)) * 100) / 100;
  const suggestion = suggestWithholding({ incomeType, amount: amount > 0 ? amount : 0, payeeType });
  // 代扣金額可以手動覆寫（非居住者、同日多筆合併等情況算法不同）
  const withholdingTax = body.withholdingTax === undefined || body.withholdingTax === "" ? suggestion.withholdingTax : Math.round(Number(body.withholdingTax));
  const nhiSupplement = body.nhiSupplement === undefined || body.nhiSupplement === "" ? suggestion.nhiSupplement : Math.round(Number(body.nhiSupplement));
  const problem = serviceFeeProblem({ amount, withholdingTax, nhiSupplement, hours, rate });
  if (problem) { res.status(400).json({ error: problem }); return; }

  try {
    const created = await db.transaction(async (tx) => {
      let payeeName = "";
      let departmentId: number | null = body.departmentId ? Number(body.departmentId) : null;
      if (payeeType === "teacher") {
        const [teacher] = await tx.select().from(teachersTable).where(eq(teachersTable.id, payeeId));
        if (!teacher) throw new Error("找不到這位講師");
        payeeName = teacher.name;
      } else {
        const [employee] = await tx.select().from(employeesTable).where(eq(employeesTable.id, payeeId));
        if (!employee) throw new Error("找不到這位員工");
        payeeName = `${employee.firstName}${employee.lastName}`;
        departmentId = departmentId ?? employee.departmentId ?? null;
      }
      const [project] = await tx.select({ id: projectsTable.id }).from(projectsTable).where(eq(projectsTable.id, projectId));
      if (!project) throw new Error("找不到這個專案");
      let salesOrderId: number | null = null;
      if (body.salesOrderId) {
        const [order] = await tx.select({ id: salesOrdersTable.id, status: salesOrdersTable.status, departmentId: salesOrdersTable.departmentId })
          .from(salesOrdersTable).where(eq(salesOrdersTable.id, Number(body.salesOrderId)));
        if (!order) throw new Error("找不到這張銷貨單");
        if (order.status === "Cancelled") throw new Error("這張銷貨單已取消，不能再登錄成本");
        salesOrderId = order.id;
        departmentId = departmentId ?? order.departmentId ?? null;
      }

      const feeNumber = await nextDocNumber(tx, "service_fees", "fee_number", "SF", () => `SF-${String(Date.now()).slice(-8)}`, body.serviceDate);
      const [fee] = await tx.insert(serviceFeesTable).values({
        feeNumber, payeeType, payeeName,
        teacherId: payeeType === "teacher" ? payeeId : null,
        employeeId: payeeType === "employee" ? payeeId : null,
        salesOrderId, projectId, departmentId,
        serviceDate: body.serviceDate,
        description: typeof body.description === "string" ? body.description.trim().slice(0, 500) || null : null,
        hours: hours == null ? null : String(hours), rate: rate == null ? null : String(rate),
        amount: String(amount), incomeType,
        withholdingTax: String(withholdingTax), nhiSupplement: String(nhiSupplement),
        netAmount: String(Math.round((amount - withholdingTax - nhiSupplement) * 100) / 100),
        createdBy: req.session?.user?.username || "api",
      }).returning();

      const je = await postAutoJournal(tx, {
        key: `SF${fee.id}`,
        entryDate: body.serviceDate,
        description: `自動分錄 - 服務費 ${feeNumber} ${payeeName}`,
        action: "登錄服務費",
        projectId, departmentId,
        lines: [
          { accountName: "勞務成本", debit: amount, credit: 0, description: `${feeNumber} ${payeeName} 服務費` },
          { accountName: "應付費用", debit: 0, credit: amount, description: `${feeNumber} 應付 ${payeeName}` },
        ],
      });
      const [updated] = await tx.update(serviceFeesTable).set({ journalEntryId: je?.id ?? null }).where(eq(serviceFeesTable.id, fee.id)).returning();
      await tx.insert(activitiesTable).values({ type: "create", title: "登錄服務費", description: `${feeNumber} ${payeeName} ${amount}`, module: "HR" });
      return updated;
    });
    res.status(201).json(numeric(created));
  } catch (err: any) {
    res.status(400).json({ error: err?.message || "登錄失敗" });
  }
});

/** 付款：借 應付費用／貸 銀行（實付）、代扣稅款、代扣補充保費 */
router.post("/service-fees/:id/pay", requireRole("owner", "admin", "finance_admin", "accountant"), async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) { res.status(400).json({ error: "格式不正確" }); return; }
  const paidDate = req.body?.paidDate || todayTaipei();
  if (!isRealDate(paidDate)) { res.status(400).json({ error: "付款日期格式不正確" }); return; }
  try {
    const paid = await db.transaction(async (tx) => {
      const [fee] = await tx.select().from(serviceFeesTable).where(eq(serviceFeesTable.id, id)).for("update");
      if (!fee) throw Object.assign(new Error("找不到這筆服務費"), { status: 404 });
      if (fee.status !== "Confirmed") throw new Error(fee.status === "Paid" ? "這筆已經付款" : "這筆已經作廢");
      const cash = await cashLineAccount(tx, req.body?.cashAccountId);
      const amount = Number(fee.amount), tax = Number(fee.withholdingTax), nhi = Number(fee.nhiSupplement), net = Number(fee.netAmount);
      const je = await postAutoJournal(tx, {
        key: `SFP${fee.id}`,
        entryDate: paidDate,
        description: `自動分錄 - 支付服務費 ${fee.feeNumber} ${fee.payeeName}`,
        action: "支付服務費",
        projectId: fee.projectId, departmentId: fee.departmentId,
        lines: [
          { accountName: "應付費用", debit: amount, credit: 0, description: `${fee.feeNumber} 沖銷應付` },
          { ...cash, debit: 0, credit: net, description: `${fee.feeNumber} 實付 ${fee.payeeName}` },
          { accountName: "代扣稅款", debit: 0, credit: tax, description: `${fee.feeNumber} 代扣所得稅` },
          { accountName: "代扣補充保費", debit: 0, credit: nhi, description: `${fee.feeNumber} 代扣二代健保補充保費` },
        ],
      });
      const [row] = await tx.update(serviceFeesTable).set({ status: "Paid", paidDate, paymentJournalEntryId: je?.id ?? null })
        .where(eq(serviceFeesTable.id, id)).returning();
      return row;
    });
    res.json(numeric(paid));
  } catch (err: any) {
    res.status(Number(err?.status) || 400).json({ error: err?.message || "付款失敗" });
  }
});

/** 作廢：已入帳的分錄各開一張沖銷分錄，紀錄保留 */
router.post("/service-fees/:id/void", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) { res.status(400).json({ error: "格式不正確" }); return; }
  const reason = typeof req.body?.reason === "string" ? req.body.reason.trim().slice(0, 200) : "";
  if (!reason) { res.status(400).json({ error: "請填寫作廢原因" }); return; }
  try {
    const voided = await db.transaction(async (tx) => {
      const [fee] = await tx.select().from(serviceFeesTable).where(eq(serviceFeesTable.id, id)).for("update");
      if (!fee) throw Object.assign(new Error("找不到這筆服務費"), { status: 404 });
      if (fee.status === "Voided") throw new Error("這筆已經作廢");
      const entryIds = [fee.journalEntryId, fee.paymentJournalEntryId].filter((n): n is number => typeof n === "number");
      for (const entryId of entryIds) {
        const [original] = await tx.select().from(journalEntriesTable).where(and(eq(journalEntriesTable.id, entryId), ne(journalEntriesTable.status, "Reversed")));
        if (!original) continue;
        const lines = (Array.isArray(original.lines) ? (original.lines as any[]) : []).map(line => ({ ...line, debit: Number(line.credit) || 0, credit: Number(line.debit) || 0 }));
        await postAutoJournal(tx, {
          key: `SFV${fee.id}`, entryDate: todayTaipei(),
          description: `作廢沖銷 - 服務費 ${fee.feeNumber}：${reason}`, action: "作廢服務費",
          projectId: original.projectId, departmentId: original.departmentId, lines,
        });
        await tx.update(journalEntriesTable).set({ status: "Reversed" }).where(eq(journalEntriesTable.id, original.id));
      }
      const [row] = await tx.update(serviceFeesTable).set({
        status: "Voided",
        description: [fee.description, `〔作廢 ${req.session?.user?.username || "api"}〕${reason}`].filter(Boolean).join("；"),
      }).where(eq(serviceFeesTable.id, id)).returning();
      await tx.insert(activitiesTable).values({ type: "update", title: "服務費作廢", description: `${fee.feeNumber} - ${reason}`, module: "HR" });
      return row;
    });
    res.json(numeric(voided));
  } catch (err: any) {
    res.status(Number(err?.status) || 400).json({ error: err?.message || "作廢失敗" });
  }
});

export default router;
