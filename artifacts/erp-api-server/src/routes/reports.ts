import { Router, type IRouter } from "express";
import { autoEntryText, parseAutoKey, type AutoEntryText } from "../lib/auto-entry-text";
import { todayTaipei } from "../lib/inventory-journal";
import { summarizeMonth, taipeiToday } from "../lib/hr-rules";
import { loadHolidays } from "../lib/hr-data";
import { listCashAccounts } from "../lib/cash-accounts";
import { agingParts } from "../lib/payment-terms";
import { daysSince, unbilledOrderReceivables } from "../lib/unbilled-receivables";
import { db, vouchersTable, leavesTable, journalEntriesTable, accountsTable, projectsTable, departmentsTable, invoicesTable, customersTable, suppliersTable, salesOrdersTable, purchaseOrdersTable, quotationsTable, itemsTable, warehousesTable, stockEntriesTable, attendanceTable, employeesTable, salarySlipsTable, shiftTypesTable, deliveryNotesTable } from "@workspace/erp-db";
import { eq, lte, gte, and, ne, or, lt, gt, desc, sql, inArray, type SQL } from "drizzle-orm";
import { requireAuth, requireRole } from "../middleware/require-auth";
import { finiteReportNumber, ReportDataIntegrityError, safeJournalLines, validateReportQuery } from "./report-guards";
import { machineOnly } from "../lib/api-key-user";

const router: IRouter = Router();
router.use("/reports", requireAuth);
router.use("/reports", (req, res, next) => {
  const error = validateReportQuery(req.query as Record<string, unknown>);
  if (error) { res.status(400).json({ error }); return; }
  next();
});

interface ReportQuery {
  startDate?: string;
  endDate?: string;
  projectId?: string;
  departmentId?: string;
}

interface OrderItem {
  itemId?: number;
  itemName?: string;
  name?: string;
  qty?: number;
  quantity?: number;
  amount?: number;
  rate?: number;
}

interface AccountRow {
  id: number;
  accountNumber: string;
  accountName: string;
  accountType: string;
  parentAccountId: number | null;
  balance: string;
  isGroup: boolean;
  cashFlowCategory: string | null;
}

const financeReportAccess = [
  requireAuth,
  requireRole("owner", "admin", "finance_admin", "accountant"),
] as const;

function buildDirectChildrenMap(allAccounts: AccountRow[]) {
  const childrenOf: Record<number, number[]> = {};
  for (const a of allAccounts) {
    if (a.parentAccountId) {
      if (!childrenOf[a.parentAccountId]) childrenOf[a.parentAccountId] = [];
      childrenOf[a.parentAccountId].push(a.id);
    }
  }
  return childrenOf;
}

function collectDescendantLeafIds(groupId: number, childrenOf: Record<number, number[]>, accountMap: Map<number, AccountRow>): number[] {
  const children = childrenOf[groupId] || [];
  const leafIds: number[] = [];
  for (const childId of children) {
    const child = accountMap.get(childId);
    if (!child) continue;
    if (child.isGroup) {
      leafIds.push(...collectDescendantLeafIds(childId, childrenOf, accountMap));
    } else {
      leafIds.push(childId);
    }
  }
  return leafIds;
}

async function getAccountBalances(opts: { startDate?: string; endDate?: string; projectId?: number; departmentId?: number }) {
  const allAccounts = await db.select().from(accountsTable).orderBy(accountsTable.accountNumber);

  const conditions = [ne(journalEntriesTable.status, "Draft")];
  if (opts.startDate) conditions.push(gte(journalEntriesTable.entryDate, opts.startDate));
  if (opts.endDate) conditions.push(lte(journalEntriesTable.entryDate, opts.endDate));
  if (opts.projectId) conditions.push(eq(journalEntriesTable.projectId, opts.projectId));
  if (opts.departmentId) {
    conditions.push(or(
      eq(journalEntriesTable.departmentId, opts.departmentId),
      sql`${journalEntriesTable.projectId} IN (
        SELECT id FROM projects WHERE department_id = ${opts.departmentId}
      )`,
    )!);
  }

  const entries = await db
    .select()
    .from(journalEntriesTable)
    .where(and(...conditions));

  const accountTotals: Record<number, { debit: number; credit: number }> = {};
  for (const entry of entries) {
    const lines = safeJournalLines(entry.lines);
    for (const line of lines) {
      if (!accountTotals[line.accountId]) {
        accountTotals[line.accountId] = { debit: 0, credit: 0 };
      }
      accountTotals[line.accountId].debit += line.debit;
      accountTotals[line.accountId].credit += line.credit;
    }
  }

  const accountMap = new Map<number, AccountRow>();
  for (const a of allAccounts) accountMap.set(a.id, a);
  const childrenOf = buildDirectChildrenMap(allAccounts);

  return { allAccounts, accountTotals, accountMap, childrenOf };
}

function groupItemsByParent(
  type: string,
  allAccounts: AccountRow[],
  accountMap: Map<number, AccountRow>,
  childrenOf: Record<number, number[]>,
  detailItems: { accountId: number; accountNumber: string; accountName: string; amount: number }[]
) {
  const topLevelGroups = allAccounts.filter(a => a.accountType === type && a.isGroup && !a.parentAccountId);
  const secondLevelGroups = allAccounts.filter(a => a.accountType === type && a.isGroup && a.parentAccountId != null);

  const useGroups = secondLevelGroups.length > 0 ? secondLevelGroups : topLevelGroups;

  const itemMap = new Map(detailItems.map(i => [i.accountId, i]));

  const grouped = useGroups.map(g => {
    const leafIds = collectDescendantLeafIds(g.id, childrenOf, accountMap);
    const items = leafIds.map(id => itemMap.get(id)).filter(Boolean) as typeof detailItems;
    const subtotal = items.reduce((s, c) => s + c.amount, 0);
    return { groupName: g.accountName, groupNumber: g.accountNumber, items, subtotal };
  }).filter(g => g.items.length > 0);

  const assignedIds = new Set(grouped.flatMap(g => g.items.map(i => i.accountId)));
  const ungrouped = detailItems.filter(i => !assignedIds.has(i.accountId));
  if (ungrouped.length > 0) {
    const label = type === "Asset" ? "其他資產" : type === "Liability" ? "其他負債" : type === "Equity" ? "其他權益" : type === "Income" ? "其他收入" : "其他費用";
    grouped.push({ groupName: label, groupNumber: "9999", items: ungrouped, subtotal: ungrouped.reduce((s, c) => s + c.amount, 0) });
  }

  return grouped;
}

function parseReportQuery(query: ReportQuery) {
  return {
    startDate: query.startDate || undefined,
    endDate: query.endDate || undefined,
    projectId: query.projectId ? Number(query.projectId) : undefined,
    departmentId: query.departmentId ? Number(query.departmentId) : undefined,
  };
}

router.get("/reports/income-statement", ...financeReportAccess, async (req, res): Promise<void> => {
  const opts = parseReportQuery(req.query as ReportQuery);
  const { allAccounts, accountTotals, accountMap, childrenOf } = await getAccountBalances(opts);

  const incomeAccounts = allAccounts.filter(a => a.accountType === "Income" && !a.isGroup);
  const expenseAccounts = allAccounts.filter(a => a.accountType === "Expense" && !a.isGroup);

  const incomeItems = incomeAccounts
    .map(a => {
      const t = accountTotals[a.id];
      const amount = t ? t.credit - t.debit : 0;
      return { accountId: a.id, accountNumber: a.accountNumber, accountName: a.accountName, amount };
    })
    .filter(i => i.amount !== 0);

  const expenseItems = expenseAccounts
    .map(a => {
      const t = accountTotals[a.id];
      const amount = t ? t.debit - t.credit : 0;
      return { accountId: a.id, accountNumber: a.accountNumber, accountName: a.accountName, amount };
    })
    .filter(i => i.amount !== 0);

  const totalIncome = incomeItems.reduce((s, i) => s + i.amount, 0);
  const totalExpense = expenseItems.reduce((s, i) => s + i.amount, 0);

  const groupedIncome = groupItemsByParent("Income", allAccounts, accountMap, childrenOf, incomeItems);
  const groupedExpense = groupItemsByParent("Expense", allAccounts, accountMap, childrenOf, expenseItems);

  let projectBreakdown: Array<{ projectId: number; projectName: string; income: number; expense: number; net: number }> = [];
  if (opts.departmentId && opts.startDate && opts.endDate) {
    const result = await db.execute(sql`
      SELECT p.id AS project_id, p.name AS project_name,
        COALESCE(SUM(CASE WHEN a.account_type = 'Income'
          THEN COALESCE((line->>'credit')::numeric, 0) - COALESCE((line->>'debit')::numeric, 0)
          ELSE 0 END), 0)::float AS income,
        COALESCE(SUM(CASE WHEN a.account_type = 'Expense'
          THEN COALESCE((line->>'debit')::numeric, 0) - COALESCE((line->>'credit')::numeric, 0)
          ELSE 0 END), 0)::float AS expense
      FROM projects p
      LEFT JOIN journal_entries je ON je.project_id = p.id
        AND je.status <> 'Draft'
        AND je.entry_date BETWEEN ${opts.startDate} AND ${opts.endDate}
      LEFT JOIN LATERAL jsonb_array_elements(COALESCE(je.lines, '[]'::jsonb)) line ON true
      LEFT JOIN accounts a ON a.id = NULLIF(line->>'accountId', '')::int
      WHERE p.department_id = ${opts.departmentId}
      GROUP BY p.id, p.name
      ORDER BY p.name
    `);
    projectBreakdown = (result.rows as Array<{ project_id: number; project_name: string; income: number; expense: number }>)
      .map(row => ({
        projectId: Number(row.project_id),
        projectName: row.project_name,
        income: Number(row.income),
        expense: Number(row.expense),
        net: Number(row.income) - Number(row.expense),
      }));
  }

  res.json({
    startDate: opts.startDate || null,
    endDate: opts.endDate || null,
    projectId: opts.projectId || null,
    departmentId: opts.departmentId || null,
    income: groupedIncome,
    expense: groupedExpense,
    totalIncome,
    totalExpense,
    netProfit: totalIncome - totalExpense,
    projectBreakdown,
  });
});

router.get("/reports/balance-sheet", ...financeReportAccess, async (req, res): Promise<void> => {
  const opts = parseReportQuery(req.query as ReportQuery);
  const balOpts = { ...opts, startDate: undefined };
  const { allAccounts, accountTotals, accountMap, childrenOf } = await getAccountBalances(balOpts);

  const includeStaticBalance = !opts.projectId && !opts.departmentId;

  const buildSection = (type: string, balanceFn: (d: number, c: number) => number) => {
    const details = allAccounts.filter(a => a.accountType === type && !a.isGroup);

    const items = details
      .map(a => {
        const t = accountTotals[a.id];
        const txBalance = t ? balanceFn(t.debit, t.credit) : 0;
        const staticBalance = includeStaticBalance ? Number(a.balance) : 0;
        return { accountId: a.id, accountNumber: a.accountNumber, accountName: a.accountName, amount: txBalance + staticBalance };
      })
      .filter(i => i.amount !== 0);

    const grouped = groupItemsByParent(type, allAccounts, accountMap, childrenOf, items);
    const total = items.reduce((s, i) => s + i.amount, 0);
    return { groups: grouped, total };
  };

  const assets = buildSection("Asset", (d, c) => d - c);
  const liabilities = buildSection("Liability", (d, c) => c - d);
  const equity = buildSection("Equity", (d, c) => c - d);

  const retainedEarnings = (() => {
    const incomeDetails = allAccounts.filter(a => a.accountType === "Income" && !a.isGroup);
    const expenseDetails = allAccounts.filter(a => a.accountType === "Expense" && !a.isGroup);
    let totalIncome = 0;
    let totalExpense = 0;
    for (const a of incomeDetails) {
      const t = accountTotals[a.id];
      if (t) totalIncome += t.credit - t.debit;
    }
    for (const a of expenseDetails) {
      const t = accountTotals[a.id];
      if (t) totalExpense += t.debit - t.credit;
    }
    return totalIncome - totalExpense;
  })();

  res.json({
    endDate: opts.endDate || null,
    projectId: opts.projectId || null,
    departmentId: opts.departmentId || null,
    assets,
    liabilities,
    equity: {
      groups: equity.groups,
      total: equity.total,
      retainedEarnings,
      totalWithRetainedEarnings: equity.total + retainedEarnings,
    },
    totalAssets: Math.round(assets.total * 100) / 100,
    totalLiabilitiesAndEquity: Math.round((liabilities.total + equity.total + retainedEarnings) * 100) / 100,
    isBalanced: Math.abs(assets.total - (liabilities.total + equity.total + retainedEarnings)) < 0.01,
  });
});

async function getCrossAccountTotals(opts: { startDate?: string; endDate?: string }, dimension: "project" | "department") {
  const allAccounts = await db.select().from(accountsTable).orderBy(accountsTable.accountNumber);

  const conditions = [ne(journalEntriesTable.status, "Draft")];
  if (opts.startDate) conditions.push(gte(journalEntriesTable.entryDate, opts.startDate));
  if (opts.endDate) conditions.push(lte(journalEntriesTable.entryDate, opts.endDate));

  const entries = await db.select().from(journalEntriesTable).where(and(...conditions));

  const totalsByDim: Record<string, Record<number, { debit: number; credit: number }>> = {};
  const overallTotals: Record<number, { debit: number; credit: number }> = {};

  for (const entry of entries) {
    const dimKey = dimension === "project"
      ? (entry.projectId ? String(entry.projectId) : "__none__")
      : (entry.departmentId ? String(entry.departmentId) : "__none__");

    if (!totalsByDim[dimKey]) totalsByDim[dimKey] = {};
    const lines = safeJournalLines(entry.lines);
    for (const line of lines) {
      if (!totalsByDim[dimKey][line.accountId]) totalsByDim[dimKey][line.accountId] = { debit: 0, credit: 0 };
      totalsByDim[dimKey][line.accountId].debit += line.debit;
      totalsByDim[dimKey][line.accountId].credit += line.credit;

      if (!overallTotals[line.accountId]) overallTotals[line.accountId] = { debit: 0, credit: 0 };
      overallTotals[line.accountId].debit += line.debit;
      overallTotals[line.accountId].credit += line.credit;
    }
  }

  const accountMap = new Map<number, AccountRow>();
  for (const a of allAccounts) accountMap.set(a.id, a);

  return { allAccounts, overallTotals, totalsByDim, accountMap, childrenOf: buildDirectChildrenMap(allAccounts) };
}

router.get("/reports/income-statement/cross", ...financeReportAccess, async (req, res): Promise<void> => {
  const { startDate, endDate, dimension } = req.query as { startDate?: string; endDate?: string; dimension?: string };
  const dim = (dimension === "department" ? "department" : "project") as "project" | "department";

  const { allAccounts, overallTotals, totalsByDim, accountMap } = await getCrossAccountTotals({ startDate, endDate }, dim);

  const columns: { id: string; name: string }[] = [];
  if (dim === "project") {
    const projects = await db.select({ id: projectsTable.id, name: projectsTable.name }).from(projectsTable).orderBy(projectsTable.name);
    for (const p of projects) columns.push({ id: String(p.id), name: p.name });
  } else {
    const depts = await db.select({ id: departmentsTable.id, name: departmentsTable.name }).from(departmentsTable).orderBy(departmentsTable.name);
    for (const d of depts) columns.push({ id: String(d.id), name: d.name });
  }
  columns.push({ id: "__none__", name: "未分類" });

  const incomeAccounts = allAccounts.filter(a => a.accountType === "Income" && !a.isGroup);
  const expenseAccounts = allAccounts.filter(a => a.accountType === "Expense" && !a.isGroup);

  const buildRows = (accts: AccountRow[], amountFn: (d: number, c: number) => number) => {
    return accts.map(a => {
      const ot = overallTotals[a.id];
      const totalAmount = ot ? amountFn(ot.debit, ot.credit) : 0;
      const breakdown: Record<string, number> = {};
      for (const col of columns) {
        const dt = totalsByDim[col.id]?.[a.id];
        breakdown[col.id] = dt ? amountFn(dt.debit, dt.credit) : 0;
      }
      return { accountId: a.id, accountNumber: a.accountNumber, accountName: a.accountName, totalAmount, breakdown };
    }).filter(r => r.totalAmount !== 0 || Object.values(r.breakdown).some(v => v !== 0));
  };

  const incomeRows = buildRows(incomeAccounts, (d, c) => c - d);
  const expenseRows = buildRows(expenseAccounts, (d, c) => d - c);

  const totalIncome = incomeRows.reduce((s, r) => s + r.totalAmount, 0);
  const totalExpense = expenseRows.reduce((s, r) => s + r.totalAmount, 0);

  const columnTotals: Record<string, { income: number; expense: number; net: number }> = {};
  for (const col of columns) {
    const colIncome = incomeRows.reduce((s, r) => s + (r.breakdown[col.id] || 0), 0);
    const colExpense = expenseRows.reduce((s, r) => s + (r.breakdown[col.id] || 0), 0);
    columnTotals[col.id] = { income: colIncome, expense: colExpense, net: colIncome - colExpense };
  }

  const activeColumns = columns.filter(col => {
    const ct = columnTotals[col.id];
    return ct && (ct.income !== 0 || ct.expense !== 0);
  });

  res.json({
    startDate: startDate || null,
    endDate: endDate || null,
    dimension: dim,
    columns: activeColumns,
    incomeRows,
    expenseRows,
    totalIncome,
    totalExpense,
    netProfit: totalIncome - totalExpense,
    columnTotals,
  });
});

router.get("/reports/balance-sheet/cross", ...financeReportAccess, async (req, res): Promise<void> => {
  const { endDate, dimension } = req.query as { endDate?: string; dimension?: string };
  const dim = (dimension === "department" ? "department" : "project") as "project" | "department";

  const { allAccounts, overallTotals, totalsByDim, accountMap } = await getCrossAccountTotals({ endDate }, dim);

  const columns: { id: string; name: string }[] = [];
  if (dim === "project") {
    const projects = await db.select({ id: projectsTable.id, name: projectsTable.name }).from(projectsTable).orderBy(projectsTable.name);
    for (const p of projects) columns.push({ id: String(p.id), name: p.name });
  } else {
    const depts = await db.select({ id: departmentsTable.id, name: departmentsTable.name }).from(departmentsTable).orderBy(departmentsTable.name);
    for (const d of depts) columns.push({ id: String(d.id), name: d.name });
  }
  columns.push({ id: "__none__", name: "未分類" });

  const buildSectionRows = (type: string, balanceFn: (d: number, c: number) => number) => {
    const details = allAccounts.filter(a => a.accountType === type && !a.isGroup);
    return details.map(a => {
      const ot = overallTotals[a.id];
      const staticBal = Number(a.balance);
      const totalAmount = (ot ? balanceFn(ot.debit, ot.credit) : 0) + staticBal;
      const breakdown: Record<string, number> = {};
      for (const col of columns) {
        const dt = totalsByDim[col.id]?.[a.id];
        breakdown[col.id] = dt ? balanceFn(dt.debit, dt.credit) : 0;
      }
      if (staticBal !== 0) {
        breakdown["__none__"] = (breakdown["__none__"] || 0) + staticBal;
      }
      return { accountId: a.id, accountNumber: a.accountNumber, accountName: a.accountName, totalAmount, breakdown };
    }).filter(r => r.totalAmount !== 0 || Object.values(r.breakdown).some(v => v !== 0));
  };

  const assetRows = buildSectionRows("Asset", (d, c) => d - c);
  const liabilityRows = buildSectionRows("Liability", (d, c) => c - d);
  const equityRows = buildSectionRows("Equity", (d, c) => c - d);

  const totalAssets = assetRows.reduce((s, r) => s + r.totalAmount, 0);
  const totalLiabilities = liabilityRows.reduce((s, r) => s + r.totalAmount, 0);
  const totalEquity = equityRows.reduce((s, r) => s + r.totalAmount, 0);

  const incomeAccounts = allAccounts.filter(a => a.accountType === "Income" && !a.isGroup);
  const expenseAccounts = allAccounts.filter(a => a.accountType === "Expense" && !a.isGroup);
  let retainedTotal = 0;
  const retainedBreakdown: Record<string, number> = {};
  for (const a of incomeAccounts) {
    const ot = overallTotals[a.id];
    if (ot) retainedTotal += ot.credit - ot.debit;
    for (const col of columns) {
      const dt = totalsByDim[col.id]?.[a.id];
      if (dt) retainedBreakdown[col.id] = (retainedBreakdown[col.id] || 0) + (dt.credit - dt.debit);
    }
  }
  for (const a of expenseAccounts) {
    const ot = overallTotals[a.id];
    if (ot) retainedTotal -= ot.debit - ot.credit;
    for (const col of columns) {
      const dt = totalsByDim[col.id]?.[a.id];
      if (dt) retainedBreakdown[col.id] = (retainedBreakdown[col.id] || 0) - (dt.debit - dt.credit);
    }
  }

  const columnTotals: Record<string, { assets: number; liabilities: number; equity: number; retained: number }> = {};
  for (const col of columns) {
    columnTotals[col.id] = {
      assets: assetRows.reduce((s, r) => s + (r.breakdown[col.id] || 0), 0),
      liabilities: liabilityRows.reduce((s, r) => s + (r.breakdown[col.id] || 0), 0),
      equity: equityRows.reduce((s, r) => s + (r.breakdown[col.id] || 0), 0),
      retained: retainedBreakdown[col.id] || 0,
    };
  }

  const activeColumns = columns.filter(col => {
    const ct = columnTotals[col.id];
    return ct && (ct.assets !== 0 || ct.liabilities !== 0 || ct.equity !== 0 || ct.retained !== 0);
  });

  res.json({
    endDate: endDate || null,
    dimension: dim,
    columns: activeColumns,
    assetRows,
    liabilityRows,
    equityRows,
    retainedEarnings: { totalAmount: retainedTotal, breakdown: retainedBreakdown },
    totalAssets,
    totalLiabilities,
    totalEquity,
    totalEquityWithRetained: totalEquity + retainedTotal,
    columnTotals,
  });
});

router.get("/reports/cash-flow", ...financeReportAccess, async (req, res): Promise<void> => {
  const { startDate, endDate } = req.query as { startDate?: string; endDate?: string };
  if (!startDate || !endDate) {
    res.status(400).json({ error: "請提供起始與結束日期" });
    return;
  }
  const conditions = [ne(journalEntriesTable.status, "Draft")];
  conditions.push(gte(journalEntriesTable.entryDate, startDate));
  conditions.push(lte(journalEntriesTable.entryDate, endDate));

  const entries = await db.select().from(journalEntriesTable).where(and(...conditions));
  const allAccounts = await db.select().from(accountsTable).orderBy(accountsTable.accountNumber);
  const accountMap = new Map(allAccounts.map(a => [a.id, a]));

  const operating: { accountId: number; accountName: string; accountNumber: string; amount: number }[] = [];
  const investing: { accountId: number; accountName: string; accountNumber: string; amount: number }[] = [];
  const financing: { accountId: number; accountName: string; accountNumber: string; amount: number }[] = [];

  const totals: Record<number, number> = {};
  for (const entry of entries) {
    const lines = safeJournalLines(entry.lines);
    for (const line of lines) {
      const amt = line.debit - line.credit;
      totals[line.accountId] = (totals[line.accountId] || 0) + amt;
    }
  }

  // 哪些科目是現金：跟收付款選帳戶用同一套判斷（看科目名稱與上層科目）。
  // 原本只認 1101、1102 開頭的科目編號，預設科目表的現金是 1111、銀行存款是 1113，
  // 結果一個現金科目都認不到：期初期末都是 0，銀行存款還被列成營業活動。
  const cashAccountIds = new Set((await listCashAccounts(db)).map(a => a.id));

  // 沒有手動指定分類的科目，依科目性質歸類
  const categoryOf = (acc: typeof allAccounts[number]): "operating" | "investing" | "financing" => {
    if (acc.cashFlowCategory === "operating" || acc.cashFlowCategory === "investing" || acc.cashFlowCategory === "financing") return acc.cashFlowCategory;
    const num = acc.accountNumber, name = acc.accountName;
    if (acc.accountType === "Equity") return "financing";
    if (acc.accountType === "Liability") return /借款|股利|股東往來|業主/.test(name) ? "financing" : "operating";
    if (acc.accountType === "Asset") {
      // 累計折舊不是現金支出，留在營業活動跟折舊費用互相抵銷
      if (/累[計積]折舊|累計攤銷|備抵/.test(name)) return "operating";
      if (/^1(12|3|4|5|6|7|8)/.test(num) || /投資|土地|房屋|建物|設備|器具|固定資產|保證金/.test(name)) return "investing";
    }
    return "operating";
  };

  for (const [accId, net] of Object.entries(totals)) {
    if (Math.abs(net) < 0.005) continue;
    const id = Number(accId);
    if (cashAccountIds.has(id)) continue;
    const acc = accountMap.get(id);
    if (!acc) continue;
    // 複式簿記：一個科目借方增加，現金那一邊就是流出。所以每個非現金科目對現金的影響都是「貸方 − 借方」。
    // 原本只有收入的方向是對的，費用和應收的正負號都反了。
    const item = { accountId: id, accountName: acc.accountName, accountNumber: acc.accountNumber, amount: Math.round(-net * 100) / 100 };
    const category = categoryOf(acc);
    if (category === "operating") operating.push(item);
    else if (category === "investing") investing.push(item);
    else financing.push(item);
  }

  const cents = (n: number) => Math.round(n * 100) / 100;
  const totalOperating = cents(operating.reduce((s, i) => s + i.amount, 0));
  const totalInvesting = cents(investing.reduce((s, i) => s + i.amount, 0));
  const totalFinancing = cents(financing.reduce((s, i) => s + i.amount, 0));

  const periodCashChange = cents(Array.from(cashAccountIds).reduce((sum, id) => sum + (totals[id] || 0), 0));
  const staticCashBalance = allAccounts
    .filter(a => cashAccountIds.has(a.id))
    .reduce((sum, a) => sum + Number(a.balance || 0), 0);
  let openingMovement = 0;
  if (cashAccountIds.size > 0) {
    const cashIds = Array.from(cashAccountIds);
    const openingResult = await db.execute(sql`
      SELECT COALESCE(SUM(
        COALESCE((line->>'debit')::numeric, 0) - COALESCE((line->>'credit')::numeric, 0)
      ), 0)::float AS movement
      FROM journal_entries je
      CROSS JOIN LATERAL jsonb_array_elements(je.lines) line
      WHERE je.entry_date < ${startDate}
        AND je.status <> 'Draft'
        AND NULLIF(line->>'accountId', '')::int IN (${sql.join(cashIds.map(id => sql`${id}`), sql`, `)})
    `);
    openingMovement = Number((openingResult.rows[0] as { movement?: number } | undefined)?.movement || 0);
  }
  const openingCash = cents(staticCashBalance + openingMovement);
  const closingCash = cents(openingCash + periodCashChange);

  res.json({
    startDate: startDate || null,
    endDate: endDate || null,
    operating: operating.filter(i => i.amount !== 0),
    investing: investing.filter(i => i.amount !== 0),
    financing: financing.filter(i => i.amount !== 0),
    totalOperating,
    totalInvesting,
    totalFinancing,
    netCashChange: periodCashChange,
    openingCash,
    closingCash,
  });
});

router.get("/reports/trial-balance", ...financeReportAccess, async (req, res): Promise<void> => {
  const { startDate, endDate } = req.query as { startDate?: string; endDate?: string };
  const allAccounts = await db.select().from(accountsTable).orderBy(accountsTable.accountNumber);

  const conditions = [ne(journalEntriesTable.status, "Draft")];
  if (startDate) conditions.push(gte(journalEntriesTable.entryDate, startDate));
  if (endDate) conditions.push(lte(journalEntriesTable.entryDate, endDate));

  const entries = await db.select().from(journalEntriesTable).where(and(...conditions));
  const totals: Record<number, { debit: number; credit: number }> = {};
  for (const entry of entries) {
    const lines = safeJournalLines(entry.lines);
    for (const line of lines) {
      if (!totals[line.accountId]) totals[line.accountId] = { debit: 0, credit: 0 };
      totals[line.accountId].debit += line.debit;
      totals[line.accountId].credit += line.credit;
    }
  }

  const rows = allAccounts
    .filter(a => !a.isGroup)
    .map(a => {
      const t = totals[a.id] || { debit: 0, credit: 0 };
      const staticBal = Number(a.balance);
      let debitBalance = 0;
      let creditBalance = 0;
      if (a.accountType === "Asset" || a.accountType === "Expense") {
        const net = t.debit - t.credit + staticBal;
        if (net >= 0) debitBalance = net; else creditBalance = -net;
      } else {
        const net = t.credit - t.debit + staticBal;
        if (net >= 0) creditBalance = net; else debitBalance = -net;
      }
      return {
        accountId: a.id,
        accountNumber: a.accountNumber,
        accountName: a.accountName,
        accountType: a.accountType,
        debit: t.debit,
        credit: t.credit,
        debitBalance,
        creditBalance,
      };
    })


  // 四捨五入到分，避免浮點數讓合計出現 0.0000000001 的尾數
  const cents = (n: number) => Math.round(n * 100) / 100;
  const totalDebit = cents(rows.reduce((s, r) => s + r.debit, 0));
  const totalCredit = cents(rows.reduce((s, r) => s + r.credit, 0));
  const totalDebitBalance = cents(rows.reduce((s, r) => s + r.debitBalance, 0));
  const totalCreditBalance = cents(rows.reduce((s, r) => s + r.creditBalance, 0));

  res.json({
    startDate: startDate || null,
    endDate: endDate || null,
    rows,
    totalDebit,
    totalCredit,
    totalDebitBalance,
    totalCreditBalance,
    isBalanced: Math.abs(totalDebitBalance - totalCreditBalance) < 0.01,
  });
});

/**
 * 總分類帳（多科目版，照 Ecount）：科目可以複選；選上層科目會帶出底下全部科目。
 * 可再依部門、專案篩選。有篩部門或專案時，期初只算篩得到的分錄（科目的開帳餘額沒有分部門，不算進去）。
 */
router.get("/reports/general-ledger/multi", ...financeReportAccess, async (req, res): Promise<void> => {
  const q = req.query as Record<string, string | undefined>;
  let ids = String(q.accountIds || "").split(",").map(Number).filter(n => Number.isInteger(n) && n > 0);
  // 跟 Ecount 一樣：沒選科目就查全部科目（比較慢，前端會先提醒）
  const queryAll = ids.length === 0 && q.all === "1";
  if (ids.length === 0 && !queryAll) { res.json({ accounts: [] }); return; }
  const startDate = q.startDate || undefined, endDate = q.endDate || undefined;
  const departmentId = Number(q.departmentId) || null, projectId = Number(q.projectId) || null;
  const hideEmpty = q.hideEmpty !== "0";
  // 報表「點數字看明細」用的額外條件，讓明細的合計跟報表上那個數字算法一致：
  //   accountTypes  只看這幾類科目（Income,Expense…），搭配 all=1
  //   exactDimension 部門只認分錄自己掛的部門，不把「專案屬於這個部門」算進來
  //   excludeInternal 不含內部轉撥分錄（BU 報表的營收、費用不算內部轉撥）
  //   party          只看這個對象的行（分錄行說明「對象｜摘要」的對象）
  const accountTypes = String(q.accountTypes || "").split(",").map(t => t.trim()).filter(Boolean);
  const exactDimension = q.exactDimension === "1", excludeInternal = q.excludeInternal === "1";
  const partyFilter = typeof q.party === "string" && q.party.trim() ? q.party.trim() : null;

  const all = await db.select().from(accountsTable);
  const childrenOf = new Map<number, number[]>();
  for (const a of all) if (a.parentAccountId) childrenOf.set(a.parentAccountId, [...(childrenOf.get(a.parentAccountId) ?? []), a.id]);
  if (queryAll) ids = all.map(a => a.id);
  // 選到上層科目：一路展開到最底層
  const leaf = new Set<number>();
  const expand = (id: number, depth = 0) => {
    const kids = childrenOf.get(id);
    if (kids && kids.length > 0 && depth < 10) kids.forEach(k => expand(k, depth + 1));
    else leaf.add(id);
  };
  ids.forEach(id => expand(id));
  const byId = new Map(all.map(a => [a.id, a]));
  const targets = [...leaf].map(id => byId.get(id)).filter((a): a is NonNullable<typeof a> => !!a)
    .filter(a => accountTypes.length === 0 || accountTypes.includes(String(a.accountType)))
    .sort((a, b) => String(a.accountNumber).localeCompare(String(b.accountNumber), "zh-Hant", { numeric: true }));

  const conditions: SQL[] = [ne(journalEntriesTable.status, "Draft")];
  if (endDate) conditions.push(lte(journalEntriesTable.entryDate, endDate));
  if (departmentId) conditions.push(exactDimension
    ? eq(journalEntriesTable.departmentId, departmentId)
    : sql`(${journalEntriesTable.departmentId} = ${departmentId} OR ${journalEntriesTable.projectId} IN (SELECT id FROM projects WHERE department_id = ${departmentId}))`);
  if (projectId) conditions.push(eq(journalEntriesTable.projectId, projectId));
  if (excludeInternal) conditions.push(sql`${journalEntriesTable.isInternalTransfer} IS NOT TRUE`);
  const entries = await db.select().from(journalEntriesTable).where(and(...conditions)).orderBy(journalEntriesTable.entryDate, journalEntriesTable.id);
  const projects = new Map((await db.select({ id: projectsTable.id, name: projectsTable.name, departmentId: projectsTable.departmentId }).from(projectsTable)).map(p => [p.id, p]));
  const departments = new Map((await db.select({ id: departmentsTable.id, name: departmentsTable.name }).from(departmentsTable)).map(d => [d.id, d.name]));
  const money = (n: number) => Math.round(n * 100) / 100;
  const filtered = Boolean(departmentId || projectId);

  type Row = { date: string; entryId: number; reference: string | null; party: string | null; summary: string; debit: number; credit: number; balance: number; department: string | null; project: string | null };
  const sections = new Map(targets.map(a => [a.id, {
    account: { id: a.id, accountNumber: a.accountNumber, accountName: a.accountName, accountType: a.accountType },
    openingBalance: filtered || partyFilter !== null ? 0 : finiteReportNumber(a.balance), balance: filtered || partyFilter !== null ? 0 : finiteReportNumber(a.balance),
    totalDebit: 0, totalCredit: 0, rows: [] as Row[],
  }]));

  // 系統流程產生的分錄：「日期-號碼」顯示來源單號（例如 PRQ-202611-0026），點下去可以開來源單據
  const sourceCache = new Map<number, Promise<AutoEntryText | null>>();
  const sourceOf = (entry: { id: number; entryNumber: string }) => {
    if (!sourceCache.has(entry.id)) sourceCache.set(entry.id, parseAutoKey(entry.entryNumber) ? autoEntryText(db, entry.entryNumber).catch(() => null) : Promise.resolve(null));
    return sourceCache.get(entry.id)!;
  };
  // 收款單、付款單開出的分錄：號碼顯示單號（PY-…、RC-…），不是分錄號
  const voucherNumbers = new Map<number, string>();
  const shownIds = entries.filter(e => !startDate || e.entryDate >= startDate).map(e => e.id);
  for (let i = 0; i < shownIds.length; i += 5000) {
    const chunk = shownIds.slice(i, i + 5000);
    const rows = await db.select({ je: vouchersTable.journalEntryId, no: vouchersTable.voucherNumber }).from(vouchersTable).where(inArray(vouchersTable.journalEntryId, chunk));
    for (const r of rows) if (r.je) voucherNumbers.set(r.je, r.no);
  }

  for (const entry of entries) {
    const before = Boolean(startDate) && entry.entryDate < startDate!;
    for (const line of safeJournalLines(entry.lines)) {
      const s = sections.get(line.accountId);
      if (!s) continue;
      if (partyFilter !== null) {
        const text = String((line as any).description || "");
        if ((text.includes("｜") ? text.split("｜")[0].trim() : "") !== partyFilter) continue;
      }
      const natural = s.account.accountType === "Asset" || s.account.accountType === "Expense";
      s.balance = money(s.balance + (natural ? line.debit - line.credit : line.credit - line.debit));
      if (before) { s.openingBalance = s.balance; continue; }
      s.totalDebit = money(s.totalDebit + line.debit);
      s.totalCredit = money(s.totalCredit + line.credit);
      // 分錄行說明是「對象｜摘要」（Ecount 搬來的格式）；沒有就用整張分錄的說明
      const lineText = String((line as any).description || "");
      const [party, ...rest] = lineText.includes("｜") ? lineText.split("｜") : ["", lineText];
      const ecount = /^Ecount\s+([^\s｜]+)｜/.exec(entry.description || "");
      const project = entry.projectId ? projects.get(entry.projectId) : undefined;
      const deptId = entry.departmentId ?? project?.departmentId ?? null;
      const source = ecount ? null : await sourceOf(entry);
      s.rows.push({
        date: entry.entryDate, entryId: entry.id, reference: ecount ? ecount[1] : source?.sourceNumber ?? voucherNumbers.get(entry.id) ?? entry.entryNumber,
        party: party.trim() || null,
        // 舊的系統分錄說明開頭是「自動分錄 - 」，報表上拿掉，只留內容
        summary: (rest.join("｜").trim() || entry.description || "").replace(/^自動分錄 - /, ""),
        debit: line.debit, credit: line.credit, balance: s.balance,
        department: deptId ? departments.get(deptId) ?? null : null, project: project?.name ?? null,
      });
    }
  }

  const accounts = [...sections.values()]
    .filter(s => !hideEmpty || s.rows.length > 0 || Math.abs(s.openingBalance) > 0.005)
    .map(({ balance, ...s }) => ({ ...s, closingBalance: balance }));
  res.json({ startDate: startDate ?? null, endDate: endDate ?? null, filteredByDimension: filtered, accounts });
});

router.get("/reports/general-ledger", ...financeReportAccess, async (req, res): Promise<void> => {
  const { accountId, startDate, endDate } = req.query as { accountId?: string; startDate?: string; endDate?: string };
  if (!accountId) { res.json({ rows: [], account: null }); return; }
  const parsedAccountId = Number(accountId);

  const [account] = await db.select().from(accountsTable).where(eq(accountsTable.id, parsedAccountId)).limit(1);
  if (!account) { res.status(404).json({ error: "科目不存在" }); return; }

  // 起始日之前的分錄也要讀：它們不列在明細裡，但要算進期初餘額
  const conditions = [ne(journalEntriesTable.status, "Draft")];
  if (endDate) conditions.push(lte(journalEntriesTable.entryDate, endDate));

  const entries = await db.select().from(journalEntriesTable).where(and(...conditions)).orderBy(journalEntriesTable.entryDate, journalEntriesTable.id);
  const money = (n: number) => Math.round(n * 100) / 100;

  interface LedgerRow { date: string; entryId: number; reference: string | null; description: string | null; debit: number; credit: number; balance: number }
  const rows: LedgerRow[] = [];
  let runningBalance = finiteReportNumber(account.balance);
  let openingBalance = runningBalance;

  for (const entry of entries) {
    const beforePeriod = Boolean(startDate) && entry.entryDate < startDate!;
    const lines = safeJournalLines(entry.lines);
    for (const line of lines) {
      if (line.accountId === parsedAccountId) {
        const debit = line.debit;
        const credit = line.credit;
        if (account.accountType === "Asset" || account.accountType === "Expense") {
          runningBalance = money(runningBalance + debit - credit);
        } else {
          runningBalance = money(runningBalance + credit - debit);
        }
        if (beforePeriod) { openingBalance = runningBalance; continue; }
        rows.push({
          date: entry.entryDate,
          entryId: entry.id,
          reference: entry.entryNumber,
          description: entry.description,
          debit,
          credit,
          balance: runningBalance,
        });
      }
    }
  }

  res.json({
    account: { id: account.id, accountNumber: account.accountNumber, accountName: account.accountName, accountType: account.accountType },
    startDate: startDate || null,
    endDate: endDate || null,
    openingBalance,
    rows,
    closingBalance: runningBalance,
  });
});

router.get("/reports/ar-aging", async (req, res): Promise<void> => {
  const today = todayTaipei();
  const invoices = await db.select().from(invoicesTable).where(
    and(eq(invoicesTable.invoiceType, "Sales"), ne(invoicesTable.status, "Paid"), ne(invoicesTable.status, "Cancelled"), ne(invoicesTable.status, "WrittenOff"))
  );
  const customers = await db.select().from(customersTable);
  const customerMap = new Map(customers.map(c => [c.id, c]));

  const aging: Record<number, { customerId: number; customerName: string; customerCode: string | null; current: number; d30: number; d60: number; d90: number; d120: number; total: number; unbilled: number }> = {};
  const rowOf = (custId: number) => {
    if (!aging[custId]) {
      const cust = customerMap.get(custId);
      aging[custId] = { customerId: custId, customerName: cust?.name || "未指定", customerCode: cust?.customerCode || null, current: 0, d30: 0, d60: 0, d90: 0, d120: 0, total: 0, unbilled: 0 };
    }
    return aging[custId];
  };

  for (const inv of invoices) {
    const outstanding = Number(inv.outstandingAmount);
    if (outstanding <= 0) continue;
    const custId = inv.customerId || 0;
    rowOf(custId);
    // 有分期排程的發票，每一期各自依自己的到期日歸到帳齡區間
    for (const part of agingParts(inv, outstanding, today)) {
      const daysPast = Math.max(0, Math.floor((new Date(today).getTime() - new Date(part.dueDate).getTime()) / 86400000));
      if (daysPast <= 0) aging[custId].current += part.amount;
      else if (daysPast <= 30) aging[custId].d30 += part.amount;
      else if (daysPast <= 60) aging[custId].d60 += part.amount;
      else if (daysPast <= 90) aging[custId].d90 += part.amount;
      else aging[custId].d120 += part.amount;
    }
    aging[custId].total += outstanding;
  }

  // 還沒開發票的未收銷貨單（含舊系統搬來的）：沒有到期日，從單據日期起算
  for (const order of await unbilledOrderReceivables(db)) {
    const row = rowOf(order.customerId || 0);
    const daysPast = daysSince(order.orderDate, today);
    if (daysPast <= 0) row.current += order.outstanding;
    else if (daysPast <= 30) row.d30 += order.outstanding;
    else if (daysPast <= 60) row.d60 += order.outstanding;
    else if (daysPast <= 90) row.d90 += order.outstanding;
    else row.d120 += order.outstanding;
    row.total += order.outstanding;
    row.unbilled += order.outstanding;
  }

  const rows = Object.values(aging).sort((a, b) => b.total - a.total);
  const summary = {
    current: rows.reduce((s, r) => s + r.current, 0),
    d30: rows.reduce((s, r) => s + r.d30, 0),
    d60: rows.reduce((s, r) => s + r.d60, 0),
    d90: rows.reduce((s, r) => s + r.d90, 0),
    d120: rows.reduce((s, r) => s + r.d120, 0),
    total: rows.reduce((s, r) => s + r.total, 0),
    unbilled: rows.reduce((s, r) => s + r.unbilled, 0),
  };

  res.json({ asOfDate: today, rows, summary });
});

router.get("/reports/ap-aging", async (req, res): Promise<void> => {
  const today = todayTaipei();
  const invoices = await db.select().from(invoicesTable).where(
    and(eq(invoicesTable.invoiceType, "Purchase"), ne(invoicesTable.status, "Paid"), ne(invoicesTable.status, "Cancelled"))
  );
  const suppliers = await db.select().from(suppliersTable);
  const supplierMap = new Map(suppliers.map(s => [s.id, s]));

  const aging: Record<number, { supplierId: number; supplierName: string; supplierCode: string | null; current: number; d30: number; d60: number; d90: number; d120: number; total: number }> = {};

  for (const inv of invoices) {
    const outstanding = Number(inv.outstandingAmount);
    if (outstanding <= 0) continue;
    const supId = inv.supplierId || 0;
    if (!aging[supId]) {
      const sup = supplierMap.get(supId);
      aging[supId] = { supplierId: supId, supplierName: sup?.name || "未指定", supplierCode: sup?.supplierCode || null, current: 0, d30: 0, d60: 0, d90: 0, d120: 0, total: 0 };
    }
    // 有分期排程的發票，每一期各自依自己的到期日歸到帳齡區間
    for (const part of agingParts(inv, outstanding, today)) {
      const daysPast = Math.max(0, Math.floor((new Date(today).getTime() - new Date(part.dueDate).getTime()) / 86400000));
      if (daysPast <= 0) aging[supId].current += part.amount;
      else if (daysPast <= 30) aging[supId].d30 += part.amount;
      else if (daysPast <= 60) aging[supId].d60 += part.amount;
      else if (daysPast <= 90) aging[supId].d90 += part.amount;
      else aging[supId].d120 += part.amount;
    }
    aging[supId].total += outstanding;
  }

  const rows = Object.values(aging).sort((a, b) => b.total - a.total);
  const summary = {
    current: rows.reduce((s, r) => s + r.current, 0),
    d30: rows.reduce((s, r) => s + r.d30, 0),
    d60: rows.reduce((s, r) => s + r.d60, 0),
    d90: rows.reduce((s, r) => s + r.d90, 0),
    d120: rows.reduce((s, r) => s + r.d120, 0),
    total: rows.reduce((s, r) => s + r.total, 0),
  };

  res.json({ asOfDate: today, rows, summary });
});

router.get("/reports/budget-vs-actual", ...financeReportAccess, async (req, res): Promise<void> => {
  const { startDate, endDate, dimension } = req.query as { startDate?: string; endDate?: string; dimension?: string };
  const dim = dimension === "project" ? "project" : "department";

  const conditions = [ne(journalEntriesTable.status, "Draft")];
  if (startDate) conditions.push(gte(journalEntriesTable.entryDate, startDate));
  if (endDate) conditions.push(lte(journalEntriesTable.entryDate, endDate));

  const entries = await db.select().from(journalEntriesTable).where(and(...conditions));
  const allAccounts = await db.select().from(accountsTable);
  const accountMap = new Map(allAccounts.map(a => [a.id, a]));

  const actualByDim: Record<string, { income: number; expense: number }> = {};
  for (const entry of entries) {
    const key = dim === "project" ? String(entry.projectId || 0) : String(entry.departmentId || 0);
    if (!actualByDim[key]) actualByDim[key] = { income: 0, expense: 0 };
    const lines = safeJournalLines(entry.lines);
    for (const line of lines) {
      const acc = accountMap.get(line.accountId);
      if (!acc) continue;
      if (acc.accountType === "Income") actualByDim[key].income += line.credit - line.debit;
      if (acc.accountType === "Expense") actualByDim[key].expense += line.debit - line.credit;
    }
  }

  interface DimInfo { name: string; budgetIncome: number; budgetExpense: number }
  const dimInfo: Record<string, DimInfo> = {};
  if (dim === "project") {
    const projects = await db.select().from(projectsTable);
    for (const p of projects) dimInfo[String(p.id)] = { name: p.name, budgetIncome: Number(p.budgetIncome), budgetExpense: Number(p.budgetExpense) };
  } else {
    const depts = await db.select().from(departmentsTable);
    for (const d of depts) dimInfo[String(d.id)] = { name: d.name, budgetIncome: Number(d.budgetIncome), budgetExpense: Number(d.budgetExpense) };
  }

  const allKeys = new Set([...Object.keys(actualByDim).filter(k => k !== "0"), ...Object.keys(dimInfo)]);

  const rows = Array.from(allKeys)
    .map(k => {
      const info = dimInfo[k] || { name: `#${k}`, budgetIncome: 0, budgetExpense: 0 };
      const actual = actualByDim[k] || { income: 0, expense: 0 };
      return {
        id: Number(k),
        name: info.name,
        budgetIncome: info.budgetIncome,
        budgetExpense: info.budgetExpense,
        actualIncome: actual.income,
        actualExpense: actual.expense,
        varianceIncome: info.budgetIncome - actual.income,
        varianceExpense: info.budgetExpense - actual.expense,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  res.json({
    startDate: startDate || null,
    endDate: endDate || null,
    dimension: dim,
    rows,
    totals: {
      budgetIncome: rows.reduce((s, r) => s + r.budgetIncome, 0),
      budgetExpense: rows.reduce((s, r) => s + r.budgetExpense, 0),
      actualIncome: rows.reduce((s, r) => s + r.actualIncome, 0),
      actualExpense: rows.reduce((s, r) => s + r.actualExpense, 0),
    },
  });
});

router.get("/reports/sales-analysis", async (req, res): Promise<void> => {
  const { startDate, endDate, groupBy } = req.query as { startDate?: string; endDate?: string; groupBy?: string };
  const dim = groupBy || "customer";

  const conditions: SQL[] = [];
  if (startDate) conditions.push(gte(salesOrdersTable.orderDate, startDate));
  if (endDate) conditions.push(lte(salesOrdersTable.orderDate, endDate));

  const orders = conditions.length > 0
    ? await db.select().from(salesOrdersTable).where(and(...conditions))
    : await db.select().from(salesOrdersTable);

  const customers = await db.select().from(customersTable);
  const customerMap = new Map(customers.map(c => [c.id, c]));
  const employees = await db.select().from(employeesTable);
  const employeeMap = new Map(employees.map(e => [e.id, e]));

  if (dim === "salesperson") {
    const bySalesperson: Record<number, { name: string; orderCount: number; totalAmount: number }> = {};
    for (const o of orders) {
      const spId = o.salespersonId || 0;
      if (!bySalesperson[spId]) {
        const emp = employeeMap.get(spId);
        bySalesperson[spId] = { name: emp ? `${emp.firstName}${emp.lastName}`.trim() : "未指定", orderCount: 0, totalAmount: 0 };
      }
      bySalesperson[spId].orderCount++;
      bySalesperson[spId].totalAmount += Number(o.totalAmount);
    }
    const rows = Object.entries(bySalesperson).map(([id, v]) => ({ id: Number(id), ...v })).sort((a, b) => b.totalAmount - a.totalAmount);
    res.json({ dimension: dim, startDate: startDate || null, endDate: endDate || null, rows, totalOrders: orders.length, totalAmount: rows.reduce((s, r) => s + r.totalAmount, 0) });
  } else if (dim === "customer") {
    const byCustomer: Record<number, { name: string; orderCount: number; totalAmount: number }> = {};
    for (const o of orders) {
      if (!byCustomer[o.customerId]) {
        const c = customerMap.get(o.customerId);
        byCustomer[o.customerId] = { name: c?.name || "未知", orderCount: 0, totalAmount: 0 };
      }
      byCustomer[o.customerId].orderCount++;
      byCustomer[o.customerId].totalAmount += Number(o.totalAmount);
    }
    const rows = Object.entries(byCustomer).map(([id, v]) => ({ id: Number(id), ...v })).sort((a, b) => b.totalAmount - a.totalAmount);
    res.json({ dimension: dim, startDate: startDate || null, endDate: endDate || null, rows, totalOrders: orders.length, totalAmount: rows.reduce((s, r) => s + r.totalAmount, 0) });
  } else if (dim === "month") {
    const byMonth: Record<string, { orderCount: number; totalAmount: number }> = {};
    for (const o of orders) {
      const month = o.orderDate.substring(0, 7);
      if (!byMonth[month]) byMonth[month] = { orderCount: 0, totalAmount: 0 };
      byMonth[month].orderCount++;
      byMonth[month].totalAmount += Number(o.totalAmount);
    }
    const rows = Object.entries(byMonth).map(([month, v]) => ({ month, ...v })).sort((a, b) => a.month.localeCompare(b.month));
    res.json({ dimension: dim, startDate: startDate || null, endDate: endDate || null, rows, totalOrders: orders.length, totalAmount: rows.reduce((s, r) => s + r.totalAmount, 0) });
  } else {
    const byItem: Record<string, { itemName: string; quantity: number; totalAmount: number }> = {};
    for (const o of orders) {
      const items = o.items as OrderItem[];
      for (const item of items) {
        const name = item.itemName || item.name || "未知品項";
        if (!byItem[name]) byItem[name] = { itemName: name, quantity: 0, totalAmount: 0 };
        byItem[name].quantity += Number(item.qty || item.quantity || 0);
        byItem[name].totalAmount += Number(item.amount || 0);
      }
    }
    const rows = Object.values(byItem).sort((a, b) => b.totalAmount - a.totalAmount);
    res.json({ dimension: dim, startDate: startDate || null, endDate: endDate || null, rows, totalOrders: orders.length, totalAmount: rows.reduce((s, r) => s + r.totalAmount, 0) });
  }
});

router.get("/reports/gross-margin", async (req, res): Promise<void> => {
  const { startDate, endDate, projectId } = req.query as ReportQuery;
  const conditions: SQL[] = [];
  conditions.push(or(
    eq(salesOrdersTable.status, "Confirmed"),
    eq(salesOrdersTable.status, "Completed"),
  )!);
  if (startDate) conditions.push(gte(salesOrdersTable.orderDate, startDate));
  if (endDate) conditions.push(lte(salesOrdersTable.orderDate, endDate));
  if (projectId) {
    const id = Number(projectId);
    if (!Number.isInteger(id) || id <= 0) {
      res.status(400).json({ error: "專案 ID 無效" }); return;
    }
    conditions.push(eq(salesOrdersTable.projectId, id));
  }

  const orders = await db.select({
    id: salesOrdersTable.id,
    orderNumber: salesOrdersTable.orderNumber,
    orderDate: salesOrdersTable.orderDate,
    status: salesOrdersTable.status,
    customerName: customersTable.name,
    projectId: salesOrdersTable.projectId,
    items: salesOrdersTable.items,
  }).from(salesOrdersTable)
    .innerJoin(customersTable, eq(salesOrdersTable.customerId, customersTable.id))
    .where(and(...conditions))
    .orderBy(salesOrdersTable.orderDate);

  const allItems = await db.select({
    id: itemsTable.id,
    movingAvgCost: itemsTable.movingAvgCost,
    buyingPrice: itemsTable.buyingPrice,
  }).from(itemsTable);
  const costMap = new Map(allItems.map(item => [
    item.id,
    Number(item.movingAvgCost) || Number(item.buyingPrice) || 0,
  ]));

  // 出貨成本快照：以訂單的已提交/已完成出貨單明細，計算各品項的加權平均快照成本
  const orderIds = orders.map(o => o.id);
  const snapshotCost = new Map<string, { qty: number; cost: number }>();
  if (orderIds.length > 0) {
    const dns = await db.select({ salesOrderId: deliveryNotesTable.salesOrderId, items: deliveryNotesTable.items })
      .from(deliveryNotesTable)
      .where(and(
        sql`${deliveryNotesTable.salesOrderId} IN (${sql.join(orderIds.map(id => sql`${id}`), sql`, `)})`,
        sql`${deliveryNotesTable.status} IN ('Submitted','Completed')`,
      ));
    for (const dn of dns) {
      for (const it of (Array.isArray(dn.items) ? dn.items : []) as Array<OrderItem & { unitCost?: number }>) {
        if (it.unitCost === undefined || it.unitCost === null || !it.itemId) continue;
        const key = `${dn.salesOrderId}:${it.itemId}`;
        const prev = snapshotCost.get(key) || { qty: 0, cost: 0 };
        const qty = Number(it.quantity ?? it.qty ?? 0);
        snapshotCost.set(key, { qty: prev.qty + qty, cost: prev.cost + qty * Number(it.unitCost) });
      }
    }
  }

  const rows = orders.map(order => {
    const items = (Array.isArray(order.items) ? order.items : [] as unknown[]) as OrderItem[];
    const marginItems = items.map(item => {
      const quantity = Number(item.quantity ?? item.qty ?? 0);
      const revenue = Number(item.amount ?? (quantity * Number(item.rate ?? 0)));
      // 優先用出貨當下的成本快照；無快照（未出貨/舊資料）時 fallback 現行移動平均成本
      const snap = item.itemId ? snapshotCost.get(`${order.id}:${item.itemId}`) : undefined;
      const hasSnapshot = !!snap && snap.qty > 0;
      const unitCost = hasSnapshot ? snap.cost / snap.qty : (item.itemId ? (costMap.get(item.itemId) ?? 0) : 0);
      const cost = unitCost * quantity;
      const grossProfit = revenue - cost;
      return {
        itemId: item.itemId ?? null,
        itemName: item.itemName || item.name || "未知品項",
        quantity,
        revenue,
        unitCost,
        cost,
        grossProfit,
        marginPct: revenue !== 0 ? (grossProfit / revenue) * 100 : 0,
        // snapshot=出貨成本快照；current=現行成本估算（未出貨或舊資料無快照）
        costSource: hasSnapshot ? "snapshot" : "current",
      };
    });
    const revenue = marginItems.reduce((sum, item) => sum + item.revenue, 0);
    const cost = marginItems.reduce((sum, item) => sum + item.cost, 0);
    const grossProfit = revenue - cost;
    return {
      id: order.id,
      orderNumber: order.orderNumber,
      orderDate: order.orderDate,
      status: order.status,
      customerName: order.customerName,
      projectId: order.projectId,
      revenue,
      cost,
      grossProfit,
      marginPct: revenue !== 0 ? (grossProfit / revenue) * 100 : 0,
      items: marginItems,
    };
  });
  const revenue = rows.reduce((sum, row) => sum + row.revenue, 0);
  const cost = rows.reduce((sum, row) => sum + row.cost, 0);
  const grossProfit = revenue - cost;
  res.json({
    startDate: startDate || null,
    endDate: endDate || null,
    projectId: projectId ? Number(projectId) : null,
    rows,
    totals: {
      revenue,
      cost,
      grossProfit,
      marginPct: revenue !== 0 ? (grossProfit / revenue) * 100 : 0,
    },
  });
});

router.get(
  "/reports/monthly-digest",
  requireAuth,
  requireRole("owner", "admin", "finance_admin", "accountant"),
  async (req, res): Promise<void> => {
  const year = Number(req.query.year);
  const month = Number(req.query.month);
  if (!Number.isInteger(year) || year < 2000 || year > 2100 || !Number.isInteger(month) || month < 1 || month > 12) {
    res.status(400).json({ error: "請提供有效的年份與月份" });
    return;
  }

  const monthText = String(month).padStart(2, "0");
  const startDate = `${year}-${monthText}-01`;
  const nextMonthDate = new Date(Date.UTC(year, month, 1));
  const nextMonth = nextMonthDate.toISOString().slice(0, 10);
  const endDate = new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
  const vatStartMonth = month % 2 === 1 ? month : month - 1;
  const vatStartDate = `${year}-${String(vatStartMonth).padStart(2, "0")}-01`;
  const vatEndDate = new Date(Date.UTC(year, vatStartMonth + 1, 0)).toISOString().slice(0, 10);

  const createdStart = new Date(`${startDate}T00:00:00Z`);
  const createdEnd = new Date(`${nextMonth}T00:00:00Z`);

  const [
    revenueRow,
    customerRows,
    projectResult,
    expenseResult,
    vatRow,
    outstandingRow,
    orderCountRow,
    quotationCountRow,
    invoiceCountRow,
  ] = await Promise.all([
    // 營收＝銷項發票（未稅）＋未開發票但已成立（Confirmed/Completed）的銷貨單（全額），避免重複計算
    db.execute(sql`
      SELECT (
        (SELECT COALESCE(SUM(net_amount), 0) FROM invoices
          WHERE invoice_date >= ${startDate} AND invoice_date <= ${endDate}
            AND invoice_type = 'Sales' AND status != 'Cancelled')
        +
        (SELECT COALESCE(SUM(total_amount::numeric), 0) FROM sales_orders so
          WHERE so.order_date >= ${startDate} AND so.order_date <= ${endDate}
            AND so.status IN ('Confirmed', 'To Deliver', 'Completed')
            AND NOT EXISTS (SELECT 1 FROM invoices i WHERE i.sales_order_id = so.id AND i.invoice_type = 'Sales' AND i.status != 'Cancelled'))
      )::float AS revenue
    `).then((r: any) => (r.rows ?? r)[0] as { revenue: number }),
    // 客戶營收與整體營收採同一口徑：發票（未稅）＋未開發票成立訂單（全額）
    db.execute(sql`
      SELECT id, name, SUM(revenue)::float AS revenue FROM (
        SELECT i.customer_id AS id, COALESCE(c.name, '未指定客戶') AS name, COALESCE(SUM(i.net_amount), 0) AS revenue
        FROM invoices i LEFT JOIN customers c ON c.id = i.customer_id
        WHERE i.invoice_date >= ${startDate} AND i.invoice_date <= ${endDate}
          AND i.invoice_type = 'Sales' AND i.status != 'Cancelled'
        GROUP BY i.customer_id, c.name
        UNION ALL
        SELECT so.customer_id, COALESCE(c.name, '未指定客戶'), COALESCE(SUM(so.total_amount::numeric), 0)
        FROM sales_orders so LEFT JOIN customers c ON c.id = so.customer_id
        WHERE so.order_date >= ${startDate} AND so.order_date <= ${endDate}
          AND so.status IN ('Confirmed', 'To Deliver', 'Completed')
          AND NOT EXISTS (SELECT 1 FROM invoices i WHERE i.sales_order_id = so.id AND i.invoice_type = 'Sales' AND i.status != 'Cancelled')
        GROUP BY so.customer_id, c.name
      ) t GROUP BY id, name ORDER BY SUM(revenue) DESC LIMIT 5
    `).then((r: any) => (r.rows ?? r) as Array<{ id: number | null; name: string; revenue: number }>),
    db.execute(sql`
      WITH project_margin AS (
        SELECT
          so.project_id AS id,
          COALESCE(p.name, '未指定專案') AS name,
          COALESCE(SUM(COALESCE((line->>'amount')::numeric,
            COALESCE((line->>'quantity')::numeric, (line->>'qty')::numeric, 0)
              * COALESCE((line->>'rate')::numeric, 0))), 0) AS revenue,
          COALESCE(SUM(
            COALESCE((line->>'quantity')::numeric, (line->>'qty')::numeric, 0)
              * COALESCE(NULLIF(i.moving_avg_cost, 0), i.buying_price, 0)
          ), 0) AS cost
        FROM sales_orders so
        LEFT JOIN projects p ON p.id = so.project_id
        LEFT JOIN LATERAL jsonb_array_elements(so.items) line ON true
        LEFT JOIN items i ON i.id = NULLIF(line->>'itemId', '')::int
        WHERE so.order_date BETWEEN ${startDate} AND ${endDate}
          AND so.status IN ('Confirmed', 'Completed')
        GROUP BY so.project_id, p.name
      )
      SELECT id, name, revenue::float, cost::float, (revenue - cost)::float AS net,
        SUM(revenue) OVER ()::float AS total_revenue,
        SUM(cost) OVER ()::float AS total_cost
      FROM project_margin
      ORDER BY net DESC
      LIMIT 5
    `),
    db.execute(sql`
      SELECT COALESCE(SUM(
        COALESCE((line->>'debit')::numeric, 0) - COALESCE((line->>'credit')::numeric, 0)
      ), 0)::float AS expenses
      FROM journal_entries je
      CROSS JOIN LATERAL jsonb_array_elements(je.lines) line
      JOIN accounts a ON a.id = NULLIF(line->>'accountId', '')::int
      WHERE je.entry_date BETWEEN ${startDate} AND ${endDate}
        AND je.status <> 'Draft'
        AND a.account_type = 'Expense'
    `),
    db.select({
      outputTax: sql<number>`COALESCE(SUM(CASE WHEN ${invoicesTable.invoiceType} = 'Sales' AND ${invoicesTable.taxType} IN ('taxable', 'zero_rated') THEN ${invoicesTable.taxAmount} ELSE 0 END), 0)::float`,
      inputTax: sql<number>`COALESCE(SUM(CASE WHEN ${invoicesTable.invoiceType} = 'Purchase' AND ${invoicesTable.taxType} = 'taxable' THEN ${invoicesTable.taxAmount} ELSE 0 END), 0)::float`,
    }).from(invoicesTable).where(and(
      gte(invoicesTable.invoiceDate, vatStartDate),
      lte(invoicesTable.invoiceDate, vatEndDate),
      ne(invoicesTable.status, "Cancelled"),
    )).then(rows => rows[0]),
    db.select({
      receivables: sql<number>`COALESCE(SUM(CASE WHEN ${invoicesTable.invoiceType} = 'Sales' THEN ${invoicesTable.outstandingAmount} ELSE 0 END), 0)::float`,
      overdue30: sql<number>`COALESCE(SUM(CASE WHEN ${invoicesTable.invoiceType} = 'Sales' AND (${endDate}::date - COALESCE(${invoicesTable.dueDate}, ${invoicesTable.invoiceDate})::date) > 30 THEN ${invoicesTable.outstandingAmount} ELSE 0 END), 0)::float`,
      payables: sql<number>`COALESCE(SUM(CASE WHEN ${invoicesTable.invoiceType} = 'Purchase' THEN ${invoicesTable.outstandingAmount} ELSE 0 END), 0)::float`,
    }).from(invoicesTable).where(and(
      lte(invoicesTable.invoiceDate, endDate),
      ne(invoicesTable.status, "Paid"),
      ne(invoicesTable.status, "Cancelled"),
      gt(invoicesTable.outstandingAmount, "0"),
    )).then(rows => rows[0]),
    db.select({ count: sql<number>`COUNT(*)::int` }).from(salesOrdersTable)
      .where(and(gte(salesOrdersTable.createdAt, createdStart), lt(salesOrdersTable.createdAt, createdEnd)))
      .then(rows => rows[0]),
    db.select({ count: sql<number>`COUNT(*)::int` }).from(quotationsTable)
      .where(and(gte(quotationsTable.createdAt, createdStart), lt(quotationsTable.createdAt, createdEnd)))
      .then(rows => rows[0]),
    db.select({ count: sql<number>`COUNT(*)::int` }).from(invoicesTable)
      .where(and(gte(invoicesTable.createdAt, createdStart), lt(invoicesTable.createdAt, createdEnd)))
      .then(rows => rows[0]),
  ]);

  const projectRows = projectResult.rows as Array<{
    id: number | null; name: string; revenue: number; cost: number; net: number;
    total_revenue: number; total_cost: number;
  }>;
  const outputTax = Number(vatRow?.outputTax || 0);
  const inputTax = Number(vatRow?.inputTax || 0);
  const grossProfitRevenue = Number(projectRows[0]?.total_revenue || 0);
  const totalCost = Number(projectRows[0]?.total_cost || 0);
  res.json({
    year,
    month,
    startDate,
    endDate,
    revenue: Number(revenueRow?.revenue || 0),
    grossProfit: grossProfitRevenue - totalCost,
    expenses: Number((expenseResult.rows[0] as { expenses?: number } | undefined)?.expenses || 0),
    vatEstimate: outputTax - inputTax,
    vatPeriod: { startDate: vatStartDate, endDate: vatEndDate, outputTax, inputTax },
    receivablesOutstanding: Number(outstandingRow?.receivables || 0),
    receivablesOverdue30: Number(outstandingRow?.overdue30 || 0),
    payablesOutstanding: Number(outstandingRow?.payables || 0),
    topCustomers: customerRows.map(row => ({ ...row, revenue: Number(row.revenue) })),
    topProjects: projectRows.map(({ total_revenue: _totalRevenue, total_cost: _totalCost, ...row }) => row),
    counts: {
      orders: Number(orderCountRow?.count || 0),
      quotations: Number(quotationCountRow?.count || 0),
      invoices: Number(invoiceCountRow?.count || 0),
    },
  });
});

router.get("/reports/purchase-analysis", async (req, res): Promise<void> => {
  const { startDate, endDate, groupBy } = req.query as { startDate?: string; endDate?: string; groupBy?: string };
  const dim = groupBy || "supplier";

  const conditions: SQL[] = [];
  if (startDate) conditions.push(gte(purchaseOrdersTable.orderDate, startDate));
  if (endDate) conditions.push(lte(purchaseOrdersTable.orderDate, endDate));

  const orders = conditions.length > 0
    ? await db.select().from(purchaseOrdersTable).where(and(...conditions))
    : await db.select().from(purchaseOrdersTable);

  const suppliers = await db.select().from(suppliersTable);
  const supplierMap = new Map(suppliers.map(s => [s.id, s]));

  if (dim === "supplier") {
    const bySup: Record<number, { name: string; orderCount: number; totalAmount: number }> = {};
    for (const o of orders) {
      if (!bySup[o.supplierId]) {
        const s = supplierMap.get(o.supplierId);
        bySup[o.supplierId] = { name: s?.name || "未知", orderCount: 0, totalAmount: 0 };
      }
      bySup[o.supplierId].orderCount++;
      bySup[o.supplierId].totalAmount += Number(o.totalAmount);
    }
    const rows = Object.entries(bySup).map(([id, v]) => ({ id: Number(id), ...v })).sort((a, b) => b.totalAmount - a.totalAmount);
    res.json({ dimension: dim, startDate: startDate || null, endDate: endDate || null, rows, totalOrders: orders.length, totalAmount: rows.reduce((s, r) => s + r.totalAmount, 0) });
  } else if (dim === "item") {
    const byItem: Record<string, { itemName: string; quantity: number; totalAmount: number }> = {};
    for (const o of orders) {
      const items = o.items as { itemName?: string; name?: string; qty?: number; quantity?: number; amount?: number }[];
      for (const item of items) {
        const name = item.itemName || item.name || "未知品項";
        if (!byItem[name]) byItem[name] = { itemName: name, quantity: 0, totalAmount: 0 };
        byItem[name].quantity += Number(item.qty || item.quantity || 0);
        byItem[name].totalAmount += Number(item.amount || 0);
      }
    }
    const rows = Object.values(byItem).sort((a, b) => b.totalAmount - a.totalAmount);
    res.json({ dimension: dim, startDate: startDate || null, endDate: endDate || null, rows, totalOrders: orders.length, totalAmount: rows.reduce((s, r) => s + r.totalAmount, 0) });
  } else {
    const byMonth: Record<string, { orderCount: number; totalAmount: number }> = {};
    for (const o of orders) {
      const month = o.orderDate.substring(0, 7);
      if (!byMonth[month]) byMonth[month] = { orderCount: 0, totalAmount: 0 };
      byMonth[month].orderCount++;
      byMonth[month].totalAmount += Number(o.totalAmount);
    }
    const rows = Object.entries(byMonth).map(([month, v]) => ({ month, ...v })).sort((a, b) => a.month.localeCompare(b.month));
    res.json({ dimension: dim, startDate: startDate || null, endDate: endDate || null, rows, totalOrders: orders.length, totalAmount: rows.reduce((s, r) => s + r.totalAmount, 0) });
  }
});

router.get("/reports/inventory-status", async (req, res): Promise<void> => {
  const items = await db.select().from(itemsTable).orderBy(itemsTable.itemCode);
  const warehouses = await db.select().from(warehousesTable);
  const stockEntries = await db.select().from(stockEntriesTable);
  const warehouseMap = new Map(warehouses.map(w => [w.id, w]));

  const stockByItemWarehouse: Record<string, number> = {};
  for (const se of stockEntries) {
    const key = `${se.itemId}-${se.warehouseId}`;
    if (!stockByItemWarehouse[key]) stockByItemWarehouse[key] = 0;
    const qty = Number(se.quantity);
    if (se.entryType === "Receipt") stockByItemWarehouse[key] += qty;
    else if (se.entryType === "Issue") stockByItemWarehouse[key] -= qty;
    else if (se.entryType === "Transfer") stockByItemWarehouse[key] -= qty;
  }

  const rows = items.map(item => {
    const currentStock = Number(item.currentStock);
    const reorderLevel = Number(item.reorderLevel);
    const warehouseBreakdown = warehouses.map(w => ({
      warehouseId: w.id,
      warehouseName: w.name,
      qty: stockByItemWarehouse[`${item.id}-${w.id}`] || 0,
    })).filter(wb => wb.qty !== 0);
    return {
      itemId: item.id,
      itemCode: item.itemCode,
      itemName: item.itemName,
      itemGroup: item.itemGroup,
      unit: item.unit,
      currentStock,
      reorderLevel,
      sellingPrice: Number(item.sellingPrice),
      buyingPrice: Number(item.buyingPrice),
      // 庫存金額用移動平均成本（沒有才用進價），跟帳上存貨同一個基礎；自製品沒有進價，用進價算會變成 0
      unitCost: Number(item.movingAvgCost) || Number(item.buyingPrice) || 0,
      stockValue: Math.round(currentStock * (Number(item.movingAvgCost) || Number(item.buyingPrice) || 0) * 100) / 100,
      belowReorder: reorderLevel > 0 && currentStock < reorderLevel,
      warehouseBreakdown,
    };
  });

  const totalItems = rows.length;
  const totalStockValue = Math.round(rows.reduce((s, r) => s + r.stockValue, 0) * 100) / 100;
  const belowReorderCount = rows.filter(r => r.belowReorder).length;

  res.json({ rows, totalItems, totalStockValue, belowReorderCount });
});

function requirePayrollOrHr(req: any, res: any): boolean {
  if (machineOnly(req)) return true;
  const u = req.session?.user;
  if (!u) { res.status(401).json({ error: "請先登入" }); return false; }
  if (u.role === "super_admin" || ["owner","admin","hr_admin","finance_admin"].includes(u.role)) return true;
  res.status(403).json({ error: "權限不足" });
  return false;
}

router.get("/reports/attendance-summary", async (req, res): Promise<void> => {
  if (!requirePayrollOrHr(req, res)) return;
  const { year, month } = req.query as { year?: string; month?: string };
  const y = year ? Number(year) : new Date().getFullYear();
  const m = month ? Number(month) : new Date().getMonth() + 1;
  if (!Number.isInteger(y) || y < 1900 || y > 2200 || !Number.isInteger(m) || m < 1 || m > 12) {
    res.status(400).json({ error: "year、month 格式不正確" }); return;
  }

  const startDate = `${y}-${String(m).padStart(2, "0")}-01`;
  const endDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const endDate = `${y}-${String(m).padStart(2, "0")}-${String(endDay).padStart(2, "0")}`;

  // 跟「出勤月結」用同一套算法（扣掉假日、算進已核准的假）。
  // 原本只數打卡紀錄：沒打卡也沒請假的曠職永遠是 0，出勤率永遠 100%，應出勤天數還把週末算進去。
  const [allEmployees, attendance, leaves, holidays] = await Promise.all([
    db.select().from(employeesTable),
    db.select().from(attendanceTable).where(and(gte(attendanceTable.date, startDate), lte(attendanceTable.date, endDate))),
    db.select().from(leavesTable).where(and(eq(leavesTable.status, "Approved"), lte(leavesTable.fromDate, endDate), gte(leavesTable.toDate, startDate))),
    loadHolidays(startDate, endDate),
  ]);
  const employees = allEmployees.filter(e => e.status === "Active" || (e.resignationDate && e.resignationDate >= startDate));
  const today = taipeiToday();

  const rows = employees.map(emp => {
    const stats = summarizeMonth({
      year: y, month: m, today, joinDate: emp.dateOfJoining, resignationDate: emp.resignationDate, holidays,
      records: attendance.filter(a => a.employeeId === emp.id),
      approvedLeaves: leaves.filter(l => l.employeeId === emp.id),
    });
    // 應該來上班的天數＝應出勤天數扣掉請假；出勤率＝實際出勤 ÷ 應該來的天數
    const expected = Math.max(0, stats.workingDays - stats.leaveDays);
    return {
      // 員工的資料編號（點數字看明細用）；employeeId 是畫面上顯示的員工編號
      id: emp.id,
      employeeId: emp.employeeId,
      employeeName: `${emp.firstName}${emp.lastName}`,
      department: emp.departmentId,
      present: stats.presentDays,
      absent: stats.absentDays,
      leaveDays: stats.leaveDays,
      workingDays: stats.workingDays,
      late: stats.lateCount,
      totalLateMinutes: stats.totalLateMinutes,
      earlyLeave: stats.earlyLeaveCount,
      totalHours: Math.round(stats.totalWorkingHours * 10) / 10,
      totalOvertimeHours: Math.round(stats.totalOvertimeHours * 10) / 10,
      attendanceRate: expected > 0 ? Math.min(100, Math.round((stats.presentDays / expected) * 100)) : 0,
    };
  });

  res.json({
    year: y,
    month: m,
    workingDays: summarizeMonth({ year: y, month: m, today, holidays, records: [], approvedLeaves: [] }).workingDays,
    rows,
    summary: {
      totalEmployees: rows.length,
      avgAttendanceRate: rows.length > 0 ? Math.round(rows.reduce((s, r) => s + r.attendanceRate, 0) / rows.length) : 0,
      totalLate: rows.reduce((s, r) => s + r.late, 0),
      totalAbsent: rows.reduce((s, r) => s + r.absent, 0),
      totalEarlyLeave: rows.reduce((s, r) => s + r.earlyLeave, 0),
      totalLateMinutes: rows.reduce((s, r) => s + r.totalLateMinutes, 0),
      totalOvertimeHours: Math.round(rows.reduce((s, r) => s + r.totalOvertimeHours, 0) * 10) / 10,
    },
  });
});

router.get("/reports/salary-summary", async (req, res): Promise<void> => {
  if (!requirePayrollOrHr(req, res)) return;
  const { year, month } = req.query as { year?: string; month?: string };
  const y = year === undefined ? undefined : Number(year);
  const m = month === undefined ? undefined : Number(month);
  if ((y !== undefined && (!Number.isInteger(y) || y < 1900 || y > 2200))
      || (m !== undefined && (!Number.isInteger(m) || m < 1 || m > 12))) {
    res.status(400).json({ error: "year、month 格式不正確" }); return;
  }

  const conditions: SQL[] = [];
  if (y !== undefined) conditions.push(eq(salarySlipsTable.year, y));
  if (m !== undefined) conditions.push(eq(salarySlipsTable.month, m));

  const slips = conditions.length > 0
    ? await db.select().from(salarySlipsTable).where(and(...conditions))
    : await db.select().from(salarySlipsTable);

  const employees = await db.select().from(employeesTable);
  const empMap = new Map(employees.map(e => [e.id, e]));

  const byMonth: Record<string, {
    period: string; count: number; grossTotal: number; netTotal: number;
    laborInsEmp: number; laborInsEmpr: number; healthInsEmp: number; healthInsEmpr: number;
    pensionEmpr: number; deductions: number;
  }> = {};

  for (const s of slips) {
    const key = `${s.year}-${String(s.month).padStart(2, "0")}`;
    if (!byMonth[key]) byMonth[key] = {
      period: key, count: 0, grossTotal: 0, netTotal: 0,
      laborInsEmp: 0, laborInsEmpr: 0, healthInsEmp: 0, healthInsEmpr: 0,
      pensionEmpr: 0, deductions: 0,
    };
    byMonth[key].count++;
    byMonth[key].grossTotal += s.grossSalary;
    byMonth[key].netTotal += s.netSalary;
    byMonth[key].laborInsEmp += s.laborInsuranceEmployee;
    byMonth[key].laborInsEmpr += s.laborInsuranceEmployer;
    byMonth[key].healthInsEmp += s.healthInsuranceEmployee;
    byMonth[key].healthInsEmpr += s.healthInsuranceEmployer;
    byMonth[key].pensionEmpr += s.pensionEmployer;
    byMonth[key].deductions += s.totalDeductions;
  }

  const rows = Object.values(byMonth).sort((a, b) => a.period.localeCompare(b.period));

  const detailRows = slips.map(s => {
    const emp = empMap.get(s.employeeId);
    return {
      // 點金額開這張薪資單用
      id: s.id, employeeId: s.employeeId, year: s.year, month: s.month,
      employeeName: emp ? `${emp.firstName}${emp.lastName}` : `#${s.employeeId}`,
      period: `${s.year}-${String(s.month).padStart(2, "0")}`,
      grossSalary: s.grossSalary,
      netSalary: s.netSalary,
      totalDeductions: s.totalDeductions,
      status: s.status,
    };
  });

  res.json({
    year: y ?? null,
    month: m ?? null,
    monthlyRows: rows,
    detailRows,
    totals: {
      slipCount: slips.length,
      grossTotal: slips.reduce((s, r) => s + r.grossSalary, 0),
      netTotal: slips.reduce((s, r) => s + r.netSalary, 0),
      deductionsTotal: slips.reduce((s, r) => s + r.totalDeductions, 0),
      laborInsEmployer: slips.reduce((s, r) => s + r.laborInsuranceEmployer, 0),
      healthInsEmployer: slips.reduce((s, r) => s + r.healthInsuranceEmployer, 0),
      pensionEmployer: slips.reduce((s, r) => s + r.pensionEmployer, 0),
    },
  });
});

router.use((err: unknown, _req: unknown, res: any, next: (error?: unknown) => void) => {
  if (err instanceof ReportDataIntegrityError) {
    res.status(422).json({ error: err.message });
    return;
  }
  next(err);
});

export default router;
