import { Router, type IRouter } from "express";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db, invoicesTable, customersTable, suppliersTable, projectsTable, itemsTable, accountsTable, dunningLogsTable, recurringInvoicesTable, budgetsTable, type RecurringItem } from "@workspace/erp-db";
import { requireAuth, requireRole } from "../middleware/require-auth";
import { todayTaipei } from "../lib/inventory-journal";
import { isRealDate } from "../lib/cash-accounts";
import { scheduleStatus } from "../lib/payment-terms";
import { FREQUENCIES, budgetVariance, daysBetween, dunningLevel, nextRunAfter, recurringProblem, spreadAnnual } from "../lib/finance-extras";

const router: IRouter = Router();
const FINANCE = ["owner", "admin", "finance_admin", "accountant"] as const;
router.use("/dunning", requireAuth, requireRole(...FINANCE));
router.use("/recurring-invoices", requireAuth, requireRole(...FINANCE));
router.use("/budgets", requireAuth, requireRole(...FINANCE));

const parseId = (value: unknown): number | null => {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
};
const round2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;
const CHANNELS = ["phone", "email", "line", "letter"];

// ───────────── 催款 ─────────────

/** 已逾期的應收款，依客戶分組。有分期排程的發票只算已經到期的那幾期。 */
router.get("/dunning", async (_req, res): Promise<void> => {
  const today = todayTaipei();
  const invoices = await db.select().from(invoicesTable)
    .where(and(eq(invoicesTable.invoiceType, "Sales"), sql`${invoicesTable.status} NOT IN ('Paid', 'Cancelled', 'WrittenOff', 'Draft')`, sql`${invoicesTable.outstandingAmount} > 0`));
  const overdue = invoices.flatMap(inv => {
    const outstanding = Number(inv.outstandingAmount);
    const hasSchedule = Array.isArray(inv.paymentSchedule) && inv.paymentSchedule.length > 0;
    const status = hasSchedule ? scheduleStatus(inv.paymentSchedule, Number(inv.paidAmount), today) : null;
    const firstOverdue = status?.rows.find(r => r.overdue);
    const dueDate = hasSchedule ? firstOverdue?.dueDate : (inv.dueDate || inv.invoiceDate);
    const amount = hasSchedule ? Math.min(outstanding, status!.overdueAmount) : outstanding;
    if (!dueDate || dueDate >= today || amount <= 0) return [];
    return [{ inv, dueDate, overdueAmount: round2(amount), daysOverdue: daysBetween(dueDate, today) }];
  });
  if (overdue.length === 0) { res.json({ asOfDate: today, customers: [], totalOverdue: 0 }); return; }
  const invoiceIds = overdue.map(o => o.inv.id);
  const [logs, customers] = await Promise.all([
    db.select().from(dunningLogsTable).where(inArray(dunningLogsTable.invoiceId, invoiceIds)).orderBy(desc(dunningLogsTable.id)),
    db.select({ id: customersTable.id, name: customersTable.name, contactPerson: customersTable.contactPerson, phone: customersTable.phone, email: customersTable.email }).from(customersTable),
  ]);
  const customerById = new Map(customers.map(c => [c.id, c]));
  const groups = new Map<number, { customerId: number; customerName: string; contactPerson: string | null; phone: string | null; email: string | null; totalOverdue: number; maxDaysOverdue: number; invoices: any[] }>();
  for (const o of overdue) {
    const customerId = o.inv.customerId || 0;
    const customer = customerById.get(customerId);
    const group = groups.get(customerId) || { customerId, customerName: customer?.name || "未指定客戶", contactPerson: customer?.contactPerson ?? null, phone: customer?.phone ?? null, email: customer?.email ?? null, totalOverdue: 0, maxDaysOverdue: 0, invoices: [] };
    const invoiceLogs = logs.filter(l => l.invoiceId === o.inv.id);
    group.invoices.push({
      invoiceId: o.inv.id, invoiceNumber: o.inv.invoiceNumber, invoiceDate: o.inv.invoiceDate, dueDate: o.dueDate,
      overdueAmount: o.overdueAmount, daysOverdue: o.daysOverdue, suggested: dunningLevel(o.daysOverdue),
      dunCount: invoiceLogs.length, lastDunnedDate: invoiceLogs[0]?.dunnedDate ?? null, lastNote: invoiceLogs[0]?.note ?? null,
    });
    group.totalOverdue = round2(group.totalOverdue + o.overdueAmount);
    group.maxDaysOverdue = Math.max(group.maxDaysOverdue, o.daysOverdue);
    groups.set(customerId, group);
  }
  const list = [...groups.values()].sort((a, b) => b.totalOverdue - a.totalOverdue);
  res.json({ asOfDate: today, customers: list, totalOverdue: round2(list.reduce((s, g) => s + g.totalOverdue, 0)) });
});

/** 記一次催款（可一次記同一個客戶的多張發票） */
router.post("/dunning", async (req, res): Promise<void> => {
  const ids: number[] = Array.isArray(req.body?.invoiceIds) ? req.body.invoiceIds.map(Number).filter((n: number) => Number.isInteger(n) && n > 0) : [];
  if (ids.length === 0) { res.status(400).json({ error: "請選擇要催款的發票" }); return; }
  const channel = CHANNELS.includes(req.body?.channel) ? req.body.channel : "phone";
  const dunnedDate = req.body?.dunnedDate || todayTaipei();
  if (!isRealDate(dunnedDate)) { res.status(400).json({ error: "日期格式不正確" }); return; }
  const note = typeof req.body?.note === "string" ? req.body.note.trim().slice(0, 300) || null : null;
  const invoices = await db.select().from(invoicesTable).where(and(inArray(invoicesTable.id, ids), eq(invoicesTable.invoiceType, "Sales")));
  if (invoices.length === 0) { res.status(404).json({ error: "找不到這些發票" }); return; }
  const counts = await db.select({ invoiceId: dunningLogsTable.invoiceId, count: sql<number>`count(*)::int` }).from(dunningLogsTable)
    .where(inArray(dunningLogsTable.invoiceId, invoices.map(i => i.id))).groupBy(dunningLogsTable.invoiceId);
  const countById = new Map(counts.map(c => [c.invoiceId, c.count]));
  const rows = await db.insert(dunningLogsTable).values(invoices.map(inv => ({
    invoiceId: inv.id, customerId: inv.customerId, level: (countById.get(inv.id) || 0) + 1, dunnedDate, channel,
    overdueAmount: String(inv.outstandingAmount), note, createdBy: req.session?.user?.username || "api",
  }))).returning();
  res.status(201).json({ count: rows.length });
});

router.get("/dunning/logs", async (req, res): Promise<void> => {
  const invoiceId = parseId(req.query.invoiceId);
  const rows = await db.select({ log: dunningLogsTable, invoiceNumber: invoicesTable.invoiceNumber, customerName: customersTable.name })
    .from(dunningLogsTable)
    .leftJoin(invoicesTable, eq(invoicesTable.id, dunningLogsTable.invoiceId))
    .leftJoin(customersTable, eq(customersTable.id, dunningLogsTable.customerId))
    .where(invoiceId ? eq(dunningLogsTable.invoiceId, invoiceId) : undefined)
    .orderBy(desc(dunningLogsTable.id)).limit(300);
  res.json(rows.map(r => ({ ...r.log, overdueAmount: Number(r.log.overdueAmount), invoiceNumber: r.invoiceNumber, customerName: r.customerName })));
});

// ───────────── 定期發票 ─────────────

async function cleanRecurring(body: any): Promise<{ error?: string; values?: any }> {
  const problem = recurringProblem(body);
  if (problem) return { error: problem };
  const isSales = body.invoiceType === "Sales";
  const partyId = Number(isSales ? body.customerId : body.supplierId);
  const [party] = isSales
    ? await db.select({ id: customersTable.id }).from(customersTable).where(eq(customersTable.id, partyId))
    : await db.select({ id: suppliersTable.id }).from(suppliersTable).where(eq(suppliersTable.id, partyId));
  if (!party) return { error: isSales ? "找不到這個客戶" : "找不到這個供應商" };
  const [project] = await db.select({ id: projectsTable.id }).from(projectsTable).where(eq(projectsTable.id, Number(body.projectId)));
  if (!project) return { error: "找不到這個專案" };
  const itemIds = [...new Set((body.items as any[]).map(i => Number(i.itemId)))];
  const found = await db.select({ id: itemsTable.id, itemName: itemsTable.itemName }).from(itemsTable).where(inArray(itemsTable.id, itemIds));
  if (found.length !== itemIds.length) return { error: "有品項已經不存在" };
  const nameById = new Map(found.map(i => [i.id, i.itemName]));
  const items: RecurringItem[] = (body.items as any[]).map(i => ({ itemId: Number(i.itemId), itemName: nameById.get(Number(i.itemId)) || "", quantity: Number(i.quantity), rate: Number(i.rate) }));
  return {
    values: {
      name: String(body.name).trim().slice(0, 60), invoiceType: body.invoiceType,
      customerId: isSales ? partyId : null, supplierId: isSales ? null : partyId,
      projectId: Number(body.projectId), items,
      taxType: typeof body.taxType === "string" && body.taxType ? body.taxType : "taxable",
      frequency: String(body.frequency), nextRunDate: body.nextRunDate, endDate: body.endDate || null,
      isActive: body.isActive !== false,
      note: typeof body.note === "string" ? body.note.trim().slice(0, 200) || null : null,
    },
  };
}

router.get("/recurring-invoices", async (_req, res): Promise<void> => {
  const today = todayTaipei();
  const rows = await db.select({ tpl: recurringInvoicesTable, customerName: customersTable.name, supplierName: suppliersTable.name, projectName: projectsTable.name })
    .from(recurringInvoicesTable)
    .leftJoin(customersTable, eq(customersTable.id, recurringInvoicesTable.customerId))
    .leftJoin(suppliersTable, eq(suppliersTable.id, recurringInvoicesTable.supplierId))
    .leftJoin(projectsTable, eq(projectsTable.id, recurringInvoicesTable.projectId))
    .orderBy(recurringInvoicesTable.nextRunDate);
  res.json(rows.map(r => ({
    ...r.tpl,
    partyName: r.customerName || r.supplierName || "—", projectName: r.projectName,
    frequencyLabel: FREQUENCIES[r.tpl.frequency]?.label || r.tpl.frequency,
    amount: round2(r.tpl.items.reduce((s, i) => s + i.quantity * i.rate, 0)),
    due: r.tpl.isActive && r.tpl.nextRunDate <= today,
  })));
});

router.post("/recurring-invoices", async (req, res): Promise<void> => {
  const { error, values } = await cleanRecurring(req.body || {});
  if (error) { res.status(400).json({ error }); return; }
  const [row] = await db.insert(recurringInvoicesTable).values({ ...values, createdBy: req.session?.user?.username || "api" }).returning();
  res.status(201).json(row);
});

router.put("/recurring-invoices/:id", async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  if (!id) { res.status(400).json({ error: "格式不正確" }); return; }
  const { error, values } = await cleanRecurring(req.body || {});
  if (error) { res.status(400).json({ error }); return; }
  const [row] = await db.update(recurringInvoicesTable).set(values).where(eq(recurringInvoicesTable.id, id)).returning();
  if (!row) { res.status(404).json({ error: "找不到這個範本" }); return; }
  res.json(row);
});

router.delete("/recurring-invoices/:id", async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  if (!id) { res.status(400).json({ error: "格式不正確" }); return; }
  await db.delete(recurringInvoicesTable).where(eq(recurringInvoicesTable.id, id));
  res.status(204).end();
});

/**
 * 這一期的發票開好之後呼叫：記下開了哪一張，並把下次開立日往後推一期。
 * 發票本身由畫面走一般的開發票流程建立（會入帳、套付款條件），這裡不另外寫一套。
 */
router.post("/recurring-invoices/:id/mark-run", async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  const invoiceId = parseId(req.body?.invoiceId);
  if (!id || !invoiceId) { res.status(400).json({ error: "格式不正確" }); return; }
  try {
    const updated = await db.transaction(async (tx) => {
      const [tpl] = await tx.select().from(recurringInvoicesTable).where(eq(recurringInvoicesTable.id, id)).for("update");
      if (!tpl) throw Object.assign(new Error("找不到這個範本"), { status: 404 });
      const [invoice] = await tx.select({ id: invoicesTable.id }).from(invoicesTable).where(eq(invoicesTable.id, invoiceId));
      if (!invoice) throw new Error("找不到這張發票");
      if (tpl.lastInvoiceId === invoiceId) return tpl;
      const next = nextRunAfter(tpl.nextRunDate, tpl.frequency);
      const [row] = await tx.update(recurringInvoicesTable).set({
        lastRunDate: tpl.nextRunDate, lastInvoiceId: invoiceId, runCount: tpl.runCount + 1, nextRunDate: next,
        // 下一期已經超過結束日期就自動停用
        isActive: tpl.endDate && next > tpl.endDate ? false : tpl.isActive,
      }).where(eq(recurringInvoicesTable.id, id)).returning();
      return row;
    });
    res.json(updated);
  } catch (err: any) {
    res.status(Number(err?.status) || 400).json({ error: err?.message || "更新失敗" });
  }
});

/** 跳過這一期不開（例如客戶這個月暫停） */
router.post("/recurring-invoices/:id/skip", async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  if (!id) { res.status(400).json({ error: "格式不正確" }); return; }
  const [tpl] = await db.select().from(recurringInvoicesTable).where(eq(recurringInvoicesTable.id, id));
  if (!tpl) { res.status(404).json({ error: "找不到這個範本" }); return; }
  const next = nextRunAfter(tpl.nextRunDate, tpl.frequency);
  const [row] = await db.update(recurringInvoicesTable).set({ nextRunDate: next, isActive: tpl.endDate && next > tpl.endDate ? false : tpl.isActive }).where(eq(recurringInvoicesTable.id, id)).returning();
  res.json(row);
});

// ───────────── 預算（分科目、分月） ─────────────

/** 一個年度所有收入、費用科目的每月預算與實際 */
router.get("/budgets", async (req, res): Promise<void> => {
  const year = Number(req.query.year);
  if (!Number.isInteger(year) || year < 2000 || year > 2100) { res.status(400).json({ error: "年度格式不正確" }); return; }
  const [accounts, budgets, actualResult] = await Promise.all([
    db.select({ id: accountsTable.id, accountNumber: accountsTable.accountNumber, accountName: accountsTable.accountName, accountType: accountsTable.accountType })
      .from(accountsTable).where(and(eq(accountsTable.isGroup, false), inArray(accountsTable.accountType, ["Income", "Expense"]))).orderBy(accountsTable.accountNumber),
    db.select().from(budgetsTable).where(eq(budgetsTable.fiscalYear, year)),
    db.execute(sql`
      SELECT (l->>'accountId')::int AS "accountId", substring(je.entry_date from 6 for 2)::int AS month,
             COALESCE(SUM((l->>'debit')::numeric), 0)::float AS debit, COALESCE(SUM((l->>'credit')::numeric), 0)::float AS credit
      FROM journal_entries je, jsonb_array_elements(je.lines) l
      WHERE je.status <> 'Draft' AND je.entry_date >= ${`${year}-01-01`} AND je.entry_date <= ${`${year}-12-31`} AND (l->>'accountId') IS NOT NULL
      GROUP BY 1, 2`),
  ]);
  const actualRows = ((actualResult as any).rows ?? actualResult) as Array<{ accountId: number; month: number; debit: number; credit: number }>;
  const today = todayTaipei();
  const throughMonth = year < Number(today.slice(0, 4)) ? 12 : year > Number(today.slice(0, 4)) ? 0 : Number(today.slice(5, 7));
  const rows = accounts.map(account => {
    const budget = Array.from({ length: 12 }, () => 0);
    const actual = Array.from({ length: 12 }, () => 0);
    for (const b of budgets) if (b.accountId === account.id && b.month >= 1 && b.month <= 12) budget[b.month - 1] = Number(b.amount);
    for (const a of actualRows) {
      if (Number(a.accountId) !== account.id || a.month < 1 || a.month > 12) continue;
      // 收入科目：貸方減借方；費用科目：借方減貸方
      actual[a.month - 1] = round2(account.accountType === "Income" ? a.credit - a.debit : a.debit - a.credit);
    }
    const annualBudget = round2(budget.reduce((s, n) => s + n, 0));
    const ytdBudget = round2(budget.slice(0, throughMonth).reduce((s, n) => s + n, 0));
    const ytdActual = round2(actual.reduce((s, n) => s + n, 0));
    return { ...account, budget, actual, annualBudget, ytdBudget, ytdActual, ...budgetVariance(account.accountType, ytdBudget, ytdActual) };
  }).filter(r => r.annualBudget !== 0 || r.ytdActual !== 0 || req.query.all === "1");
  const total = (type: string, key: "annualBudget" | "ytdBudget" | "ytdActual") => round2(rows.filter(r => r.accountType === type).reduce((s, r) => s + r[key], 0));
  res.json({
    year, throughMonth, rows,
    totals: {
      income: { annualBudget: total("Income", "annualBudget"), ytdBudget: total("Income", "ytdBudget"), ytdActual: total("Income", "ytdActual") },
      expense: { annualBudget: total("Expense", "annualBudget"), ytdBudget: total("Expense", "ytdBudget"), ytdActual: total("Expense", "ytdActual") },
    },
  });
});

/** 設定一個科目一整年的預算：給 12 個月的金額，或只給年度金額由系統平均分到各月 */
router.put("/budgets", async (req, res): Promise<void> => {
  const year = Number(req.body?.year);
  const accountId = parseId(req.body?.accountId);
  if (!Number.isInteger(year) || year < 2000 || year > 2100 || !accountId) { res.status(400).json({ error: "年度或科目不正確" }); return; }
  let months: number[];
  if (Array.isArray(req.body?.months)) {
    months = req.body.months.map((n: unknown) => round2(Number(n)));
    if (months.length !== 12 || months.some(n => !Number.isFinite(n) || n < 0)) { res.status(400).json({ error: "請填 12 個月的金額，不能是負數" }); return; }
  } else {
    const annual = Number(req.body?.annual);
    if (!Number.isFinite(annual) || annual < 0) { res.status(400).json({ error: "年度預算必須是 0 以上的數字" }); return; }
    months = spreadAnnual(annual);
  }
  const [account] = await db.select({ id: accountsTable.id, isGroup: accountsTable.isGroup, accountType: accountsTable.accountType }).from(accountsTable).where(eq(accountsTable.id, accountId));
  if (!account || account.isGroup || !["Income", "Expense"].includes(account.accountType)) { res.status(400).json({ error: "只能替收入或費用的明細科目設定預算" }); return; }
  await db.transaction(async (tx) => {
    await tx.delete(budgetsTable).where(and(eq(budgetsTable.fiscalYear, year), eq(budgetsTable.accountId, accountId)));
    const values = months.map((amount, index) => ({ fiscalYear: year, accountId, month: index + 1, amount: String(amount), updatedBy: req.session?.user?.username || "api" })).filter(v => Number(v.amount) > 0);
    if (values.length > 0) await tx.insert(budgetsTable).values(values);
  });
  res.json({ year, accountId, months });
});

/** 可以設定預算的科目清單 */
router.get("/budgets/accounts", async (_req, res): Promise<void> => {
  const accounts = await db.select({ id: accountsTable.id, accountNumber: accountsTable.accountNumber, accountName: accountsTable.accountName, accountType: accountsTable.accountType })
    .from(accountsTable).where(and(eq(accountsTable.isGroup, false), inArray(accountsTable.accountType, ["Income", "Expense"]))).orderBy(accountsTable.accountNumber);
  res.json(accounts);
});

export default router;
