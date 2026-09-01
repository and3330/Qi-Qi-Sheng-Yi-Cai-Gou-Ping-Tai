import { Router, type IRouter } from "express";
import { and, eq, gte, lte, ne, sql, type SQL } from "drizzle-orm";
import {
  db,
  erpAccountsTable,
  erpJournalEntriesTable,
  erpInvoicesTable,
  erpCustomersTable,
  suppliersTable,
  salesOrdersTable,
  salesOrderItemsTable,
  purchaseOrdersTable,
  purchaseOrderItemsTable,
  type ErpAccount,
  type ErpJournalLine,
} from "@workspace/db";
import { requireErpMenu } from "../middlewares/requireErp";

const router: IRouter = Router();

const isDate = (s: unknown): s is string =>
  typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);

/* ---------- 共用：科目餘額彙總 ---------- */

function buildDirectChildrenMap(allAccounts: ErpAccount[]) {
  const childrenOf: Record<number, number[]> = {};
  for (const a of allAccounts) {
    if (a.parentAccountId) {
      if (!childrenOf[a.parentAccountId]) childrenOf[a.parentAccountId] = [];
      childrenOf[a.parentAccountId].push(a.id);
    }
  }
  return childrenOf;
}

async function getAccountBalances(opts: { startDate?: string; endDate?: string }) {
  const allAccounts = await db
    .select()
    .from(erpAccountsTable)
    .orderBy(erpAccountsTable.accountNumber);

  const conditions: SQL[] = [ne(erpJournalEntriesTable.status, "Draft")];
  if (opts.startDate)
    conditions.push(gte(erpJournalEntriesTable.entryDate, opts.startDate));
  if (opts.endDate)
    conditions.push(lte(erpJournalEntriesTable.entryDate, opts.endDate));

  const entries = await db
    .select()
    .from(erpJournalEntriesTable)
    .where(and(...conditions));

  const accountTotals: Record<number, { debit: number; credit: number }> = {};
  for (const entry of entries) {
    const lines = entry.lines as ErpJournalLine[];
    for (const line of lines) {
      if (!line.accountId) continue;
      if (!accountTotals[line.accountId])
        accountTotals[line.accountId] = { debit: 0, credit: 0 };
      accountTotals[line.accountId].debit += Number(line.debit || 0);
      accountTotals[line.accountId].credit += Number(line.credit || 0);
    }
  }

  const accountMap = new Map<number, ErpAccount>();
  for (const a of allAccounts) accountMap.set(a.id, a);
  const childrenOf = buildDirectChildrenMap(allAccounts);

  return { allAccounts, accountTotals, accountMap, childrenOf };
}

interface ReportItem {
  accountId: number;
  accountNumber: string;
  accountName: string;
  amount: number;
}

/** 依直接父科目分組（父為彙總科目）；無父者歸入「其他」 */
function groupItemsByParent(
  allAccounts: ErpAccount[],
  accountMap: Map<number, ErpAccount>,
  items: ReportItem[],
) {
  const groups: Record<
    string,
    { groupName: string; groupNumber: string; items: ReportItem[] }
  > = {};
  const ungrouped: ReportItem[] = [];
  for (const item of items) {
    const acc = accountMap.get(item.accountId);
    const parent = acc?.parentAccountId
      ? accountMap.get(acc.parentAccountId)
      : undefined;
    if (parent) {
      const key = parent.accountNumber;
      if (!groups[key])
        groups[key] = {
          groupName: parent.accountName,
          groupNumber: parent.accountNumber,
          items: [],
        };
      groups[key].items.push(item);
    } else {
      ungrouped.push(item);
    }
  }
  const grouped = Object.values(groups)
    .sort((a, b) => a.groupNumber.localeCompare(b.groupNumber))
    .map((g) => ({
      ...g,
      subtotal: g.items.reduce((s, i) => s + i.amount, 0),
    }));
  if (ungrouped.length > 0) {
    grouped.push({
      groupName: "其他",
      groupNumber: "9999",
      items: ungrouped,
      subtotal: ungrouped.reduce((s, i) => s + i.amount, 0),
    });
  }
  return grouped;
}

/* ---------- 損益表 ---------- */

router.get(
  "/erp/reports/income-statement",
  requireErpMenu("/reports/financial"),
  async (req, res): Promise<void> => {
    const { startDate, endDate } = req.query as Record<string, string>;
    const opts = {
      startDate: isDate(startDate) ? startDate : undefined,
      endDate: isDate(endDate) ? endDate : undefined,
    };
    const { allAccounts, accountTotals, accountMap } = await getAccountBalances(opts);

    const makeItems = (type: string, fn: (d: number, c: number) => number) =>
      allAccounts
        .filter((a) => a.accountType === type && !a.isGroup)
        .map((a) => {
          const t = accountTotals[a.id];
          return {
            accountId: a.id,
            accountNumber: a.accountNumber,
            accountName: a.accountName,
            amount: t ? fn(t.debit, t.credit) : 0,
          };
        })
        .filter((i) => i.amount !== 0);

    const incomeItems = makeItems("Income", (d, c) => c - d);
    const expenseItems = makeItems("Expense", (d, c) => d - c);
    const totalIncome = incomeItems.reduce((s, i) => s + i.amount, 0);
    const totalExpense = expenseItems.reduce((s, i) => s + i.amount, 0);

    res.json({
      startDate: opts.startDate || null,
      endDate: opts.endDate || null,
      income: groupItemsByParent(allAccounts, accountMap, incomeItems),
      expense: groupItemsByParent(allAccounts, accountMap, expenseItems),
      totalIncome,
      totalExpense,
      netProfit: totalIncome - totalExpense,
    });
  },
);

/* ---------- 資產負債表 ---------- */

router.get(
  "/erp/reports/balance-sheet",
  requireErpMenu("/reports/financial"),
  async (req, res): Promise<void> => {
    const { endDate } = req.query as Record<string, string>;
    const { allAccounts, accountTotals, accountMap } = await getAccountBalances({
      endDate: isDate(endDate) ? endDate : undefined,
    });

    const buildSection = (type: string, fn: (d: number, c: number) => number) => {
      const items = allAccounts
        .filter((a) => a.accountType === type && !a.isGroup)
        .map((a) => {
          const t = accountTotals[a.id];
          const txBalance = t ? fn(t.debit, t.credit) : 0;
          return {
            accountId: a.id,
            accountNumber: a.accountNumber,
            accountName: a.accountName,
            amount: txBalance + a.balance,
          };
        })
        .filter((i) => i.amount !== 0);
      return {
        groups: groupItemsByParent(allAccounts, accountMap, items),
        total: items.reduce((s, i) => s + i.amount, 0),
      };
    };

    const assets = buildSection("Asset", (d, c) => d - c);
    const liabilities = buildSection("Liability", (d, c) => c - d);
    const equity = buildSection("Equity", (d, c) => c - d);

    let retainedEarnings = 0;
    for (const a of allAccounts) {
      if (a.isGroup) continue;
      const t = accountTotals[a.id];
      if (!t) continue;
      if (a.accountType === "Income") retainedEarnings += t.credit - t.debit;
      if (a.accountType === "Expense") retainedEarnings -= t.debit - t.credit;
    }

    res.json({
      endDate: isDate(endDate) ? endDate : null,
      assets,
      liabilities,
      equity: {
        groups: equity.groups,
        total: equity.total,
        retainedEarnings,
        totalWithRetainedEarnings: equity.total + retainedEarnings,
      },
      totalAssets: assets.total,
      totalLiabilitiesAndEquity: liabilities.total + equity.total + retainedEarnings,
      isBalanced:
        Math.abs(assets.total - (liabilities.total + equity.total + retainedEarnings)) === 0,
    });
  },
);

/* ---------- 現金流量表 ---------- */

router.get(
  "/erp/reports/cash-flow",
  requireErpMenu("/reports/financial"),
  async (req, res): Promise<void> => {
    const { startDate, endDate } = req.query as Record<string, string>;
    if (!isDate(startDate) || !isDate(endDate)) {
      res.status(400).json({ error: "請提供起始與結束日期" });
      return;
    }
    const entries = await db
      .select()
      .from(erpJournalEntriesTable)
      .where(
        and(
          ne(erpJournalEntriesTable.status, "Draft"),
          gte(erpJournalEntriesTable.entryDate, startDate),
          lte(erpJournalEntriesTable.entryDate, endDate),
        ),
      );
    const allAccounts = await db
      .select()
      .from(erpAccountsTable)
      .orderBy(erpAccountsTable.accountNumber);
    const accountMap = new Map(allAccounts.map((a) => [a.id, a]));

    const totals: Record<number, number> = {};
    for (const entry of entries) {
      for (const line of entry.lines as ErpJournalLine[]) {
        if (!line.accountId) continue;
        totals[line.accountId] =
          (totals[line.accountId] || 0) +
          (Number(line.debit || 0) - Number(line.credit || 0));
      }
    }

    const heuristic = (a: ErpAccount): string | null => {
      if (a.cashFlowCategory) return a.cashFlowCategory;
      const num = a.accountNumber;
      if (num.startsWith("111")) return "cash";
      if (num.startsWith("15")) return "investing";
      if (num.startsWith("2") || num.startsWith("3")) return "financing";
      return "operating";
    };

    const cashAccountIds = new Set(
      allAccounts.filter((a) => !a.isGroup && heuristic(a) === "cash").map((a) => a.id),
    );

    const operating: any[] = [];
    const investing: any[] = [];
    const financing: any[] = [];
    for (const [accIdStr, net] of Object.entries(totals)) {
      if (net === 0) continue;
      const acc = accountMap.get(Number(accIdStr));
      if (!acc) continue;
      const category = heuristic(acc);
      if (!category || category === "cash") continue;
      const item = {
        accountName: acc.accountName,
        accountNumber: acc.accountNumber,
        amount: net,
      };
      // 非現金科目的淨變動反向即為現金影響（間接法簡化）
      if (category === "operating") operating.push({ ...item, amount: -net });
      else if (category === "investing") investing.push({ ...item, amount: -net });
      else financing.push({ ...item, amount: -net });
    }

    const totalOperating = operating.reduce((s, i) => s + i.amount, 0);
    const totalInvesting = investing.reduce((s, i) => s + i.amount, 0);
    const totalFinancing = financing.reduce((s, i) => s + i.amount, 0);

    const periodCashChange = Array.from(cashAccountIds).reduce(
      (sum, id) => sum + (totals[id] || 0),
      0,
    );
    const staticCashBalance = allAccounts
      .filter((a) => cashAccountIds.has(a.id))
      .reduce((sum, a) => sum + a.balance, 0);

    let openingMovement = 0;
    if (cashAccountIds.size > 0) {
      const cashIds = Array.from(cashAccountIds);
      const openingResult = await db.execute(sql`
        SELECT COALESCE(SUM(
          COALESCE((line->>'debit')::numeric, 0) - COALESCE((line->>'credit')::numeric, 0)
        ), 0)::float AS movement
        FROM erp_journal_entries je
        CROSS JOIN LATERAL jsonb_array_elements(je.lines) line
        WHERE je.entry_date < ${startDate}
          AND je.status <> 'Draft'
          AND NULLIF(line->>'accountId', '')::int IN (${sql.join(
            cashIds.map((id) => sql`${id}`),
            sql`, `,
          )})
      `);
      openingMovement = Number(
        (openingResult.rows[0] as { movement?: number } | undefined)?.movement || 0,
      );
    }
    const openingCash = staticCashBalance + openingMovement;

    res.json({
      startDate,
      endDate,
      operating,
      investing,
      financing,
      totalOperating,
      totalInvesting,
      totalFinancing,
      netCashChange: periodCashChange,
      openingCash,
      closingCash: openingCash + periodCashChange,
    });
  },
);

/* ---------- 試算表 ---------- */

router.get(
  "/erp/reports/trial-balance",
  requireErpMenu("/reports/financial"),
  async (req, res): Promise<void> => {
    const { startDate, endDate } = req.query as Record<string, string>;
    const { allAccounts, accountTotals } = await getAccountBalances({
      startDate: isDate(startDate) ? startDate : undefined,
      endDate: isDate(endDate) ? endDate : undefined,
    });

    const rows = allAccounts
      .filter((a) => !a.isGroup)
      .map((a) => {
        const t = accountTotals[a.id] || { debit: 0, credit: 0 };
        let debitBalance = 0;
        let creditBalance = 0;
        if (a.accountType === "Asset" || a.accountType === "Expense") {
          const net = t.debit - t.credit + a.balance;
          if (net >= 0) debitBalance = net;
          else creditBalance = -net;
        } else {
          const net = t.credit - t.debit + a.balance;
          if (net >= 0) creditBalance = net;
          else debitBalance = -net;
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
      .filter((r) => r.debit !== 0 || r.credit !== 0 || r.debitBalance !== 0 || r.creditBalance !== 0);

    const totalDebitBalance = rows.reduce((s, r) => s + r.debitBalance, 0);
    const totalCreditBalance = rows.reduce((s, r) => s + r.creditBalance, 0);
    res.json({
      startDate: isDate(startDate) ? startDate : null,
      endDate: isDate(endDate) ? endDate : null,
      rows,
      totalDebit: rows.reduce((s, r) => s + r.debit, 0),
      totalCredit: rows.reduce((s, r) => s + r.credit, 0),
      totalDebitBalance,
      totalCreditBalance,
      isBalanced: totalDebitBalance === totalCreditBalance,
    });
  },
);

/* ---------- 總帳（單科目明細） ---------- */

router.get(
  "/erp/reports/general-ledger",
  requireErpMenu("/reports/financial"),
  async (req, res): Promise<void> => {
    const { accountId, startDate, endDate } = req.query as Record<string, string>;
    if (!accountId) {
      res.json({ rows: [], account: null });
      return;
    }
    const [account] = await db
      .select()
      .from(erpAccountsTable)
      .where(eq(erpAccountsTable.id, Number(accountId)))
      .limit(1);
    if (!account) {
      res.status(404).json({ error: "科目不存在" });
      return;
    }
    const conditions: SQL[] = [ne(erpJournalEntriesTable.status, "Draft")];
    if (isDate(startDate))
      conditions.push(gte(erpJournalEntriesTable.entryDate, startDate));
    if (isDate(endDate))
      conditions.push(lte(erpJournalEntriesTable.entryDate, endDate));
    const entries = await db
      .select()
      .from(erpJournalEntriesTable)
      .where(and(...conditions))
      .orderBy(erpJournalEntriesTable.entryDate, erpJournalEntriesTable.id);

    const rows: any[] = [];
    let runningBalance = account.balance;
    for (const entry of entries) {
      for (const line of entry.lines as ErpJournalLine[]) {
        if (line.accountId !== Number(accountId)) continue;
        const debit = Number(line.debit || 0);
        const credit = Number(line.credit || 0);
        if (account.accountType === "Asset" || account.accountType === "Expense") {
          runningBalance += debit - credit;
        } else {
          runningBalance += credit - debit;
        }
        rows.push({
          date: entry.entryDate,
          entryId: entry.id,
          entryNumber: entry.entryNumber,
          reference: entry.reference,
          description: line.description || entry.description,
          debit,
          credit,
          balance: runningBalance,
        });
      }
    }
    res.json({
      account: {
        id: account.id,
        accountNumber: account.accountNumber,
        accountName: account.accountName,
        accountType: account.accountType,
      },
      rows,
    });
  },
);

/* ---------- AR/AP 帳齡 ---------- */

async function agingReport(invoiceType: "Sales" | "Purchase") {
  const today = new Date().toISOString().split("T")[0];
  const invoices = await db
    .select({
      id: erpInvoicesTable.id,
      customerId: erpInvoicesTable.customerId,
      customerName: erpCustomersTable.name,
      supplierId: erpInvoicesTable.supplierId,
      supplierName: suppliersTable.name,
      invoiceDate: erpInvoicesTable.invoiceDate,
      dueDate: erpInvoicesTable.dueDate,
      outstandingAmount: erpInvoicesTable.outstandingAmount,
    })
    .from(erpInvoicesTable)
    .leftJoin(erpCustomersTable, eq(erpInvoicesTable.customerId, erpCustomersTable.id))
    .leftJoin(suppliersTable, eq(erpInvoicesTable.supplierId, suppliersTable.id))
    .where(
      and(
        eq(erpInvoicesTable.invoiceType, invoiceType),
        ne(erpInvoicesTable.status, "Paid"),
        ne(erpInvoicesTable.status, "Cancelled"),
      ),
    );

  const aging: Record<
    number,
    {
      partyId: number;
      partyName: string;
      current: number;
      d30: number;
      d60: number;
      d90: number;
      d120: number;
      total: number;
    }
  > = {};
  for (const inv of invoices) {
    const outstanding = inv.outstandingAmount;
    if (outstanding <= 0) continue;
    const partyId = (invoiceType === "Sales" ? inv.customerId : inv.supplierId) || 0;
    const partyName =
      (invoiceType === "Sales" ? inv.customerName : inv.supplierName) || "未指定";
    if (!aging[partyId])
      aging[partyId] = {
        partyId,
        partyName,
        current: 0,
        d30: 0,
        d60: 0,
        d90: 0,
        d120: 0,
        total: 0,
      };
    const dueDate = inv.dueDate || inv.invoiceDate;
    const daysPast = Math.max(
      0,
      Math.floor(
        (new Date(today).getTime() - new Date(dueDate).getTime()) / 86400000,
      ),
    );
    if (daysPast <= 0) aging[partyId].current += outstanding;
    else if (daysPast <= 30) aging[partyId].d30 += outstanding;
    else if (daysPast <= 60) aging[partyId].d60 += outstanding;
    else if (daysPast <= 90) aging[partyId].d90 += outstanding;
    else aging[partyId].d120 += outstanding;
    aging[partyId].total += outstanding;
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
  return { asOfDate: today, rows, summary };
}

router.get(
  "/erp/reports/ar-aging",
  requireErpMenu("/reports/aging"),
  async (_req, res): Promise<void> => {
    res.json(await agingReport("Sales"));
  },
);

router.get(
  "/erp/reports/ap-aging",
  requireErpMenu("/reports/aging"),
  async (_req, res): Promise<void> => {
    res.json(await agingReport("Purchase"));
  },
);

/* ---------- 銷售分析 ---------- */

router.get(
  "/erp/reports/sales-analysis",
  requireErpMenu("/reports/analysis"),
  async (req, res): Promise<void> => {
    const { startDate, endDate, groupBy } = req.query as Record<string, string>;
    const dim = groupBy === "month" || groupBy === "product" ? groupBy : "customer";

    const conditions: SQL[] = [ne(salesOrdersTable.status, "cancelled")];
    if (isDate(startDate))
      conditions.push(gte(salesOrdersTable.createdAt, new Date(startDate)));
    if (isDate(endDate))
      conditions.push(lte(salesOrdersTable.createdAt, new Date(endDate + "T23:59:59")));

    const orders = await db
      .select()
      .from(salesOrdersTable)
      .where(and(...conditions));
    const totalAmountAll = orders.reduce((s, o) => s + o.totalAmount, 0);

    if (dim === "customer") {
      const byCustomer: Record<string, { name: string; orderCount: number; totalAmount: number }> = {};
      for (const o of orders) {
        const key = o.customerId != null ? String(o.customerId) : "0";
        if (!byCustomer[key])
          byCustomer[key] = {
            name: o.customerName || "未指定",
            orderCount: 0,
            totalAmount: 0,
          };
        byCustomer[key].orderCount++;
        byCustomer[key].totalAmount += o.totalAmount;
      }
      const rows = Object.entries(byCustomer)
        .map(([id, v]) => ({ id: Number(id), ...v }))
        .sort((a, b) => b.totalAmount - a.totalAmount);
      res.json({
        dimension: dim,
        startDate: startDate || null,
        endDate: endDate || null,
        rows,
        totalOrders: orders.length,
        totalAmount: totalAmountAll,
      });
    } else if (dim === "month") {
      const byMonth: Record<string, { orderCount: number; totalAmount: number }> = {};
      for (const o of orders) {
        const month = o.createdAt.toISOString().substring(0, 7);
        if (!byMonth[month]) byMonth[month] = { orderCount: 0, totalAmount: 0 };
        byMonth[month].orderCount++;
        byMonth[month].totalAmount += o.totalAmount;
      }
      const rows = Object.entries(byMonth)
        .map(([month, v]) => ({ month, ...v }))
        .sort((a, b) => a.month.localeCompare(b.month));
      res.json({
        dimension: dim,
        startDate: startDate || null,
        endDate: endDate || null,
        rows,
        totalOrders: orders.length,
        totalAmount: totalAmountAll,
      });
    } else {
      const orderIds = orders.map((o) => o.id);
      const items = orderIds.length
        ? await db
            .select()
            .from(salesOrderItemsTable)
            .where(
              sql`${salesOrderItemsTable.salesOrderId} IN (${sql.join(
                orderIds.map((i) => sql`${i}`),
                sql`, `,
              )})`,
            )
        : [];
      const byItem: Record<string, { itemName: string; quantity: number; totalAmount: number }> = {};
      for (const it of items) {
        const key = it.productName || "未知品項";
        if (!byItem[key]) byItem[key] = { itemName: key, quantity: 0, totalAmount: 0 };
        byItem[key].quantity += it.quantity;
        byItem[key].totalAmount += it.unitPrice * it.quantity;
      }
      const rows = Object.values(byItem).sort((a, b) => b.totalAmount - a.totalAmount);
      res.json({
        dimension: dim,
        startDate: startDate || null,
        endDate: endDate || null,
        rows,
        totalOrders: orders.length,
        totalAmount: totalAmountAll,
      });
    }
  },
);

/* ---------- 採購分析 ---------- */

router.get(
  "/erp/reports/purchase-analysis",
  requireErpMenu("/reports/analysis"),
  async (req, res): Promise<void> => {
    const { startDate, endDate, groupBy } = req.query as Record<string, string>;
    const dim = groupBy === "month" || groupBy === "product" ? groupBy : "supplier";

    const conditions: SQL[] = [ne(purchaseOrdersTable.status, "cancelled")];
    if (isDate(startDate))
      conditions.push(gte(purchaseOrdersTable.createdAt, new Date(startDate)));
    if (isDate(endDate))
      conditions.push(
        lte(purchaseOrdersTable.createdAt, new Date(endDate + "T23:59:59")),
      );

    const orders = await db
      .select({
        id: purchaseOrdersTable.id,
        supplierId: purchaseOrdersTable.supplierId,
        supplierName: suppliersTable.name,
        totalAmount: purchaseOrdersTable.totalAmount,
        createdAt: purchaseOrdersTable.createdAt,
      })
      .from(purchaseOrdersTable)
      .leftJoin(suppliersTable, eq(purchaseOrdersTable.supplierId, suppliersTable.id))
      .where(and(...conditions));
    const totalAmountAll = orders.reduce((s, o) => s + o.totalAmount, 0);

    if (dim === "supplier") {
      const bySupplier: Record<string, { name: string; orderCount: number; totalAmount: number }> = {};
      for (const o of orders) {
        const key = String(o.supplierId);
        if (!bySupplier[key])
          bySupplier[key] = {
            name: o.supplierName || "未知",
            orderCount: 0,
            totalAmount: 0,
          };
        bySupplier[key].orderCount++;
        bySupplier[key].totalAmount += o.totalAmount;
      }
      const rows = Object.entries(bySupplier)
        .map(([id, v]) => ({ id: Number(id), ...v }))
        .sort((a, b) => b.totalAmount - a.totalAmount);
      res.json({
        dimension: dim,
        startDate: startDate || null,
        endDate: endDate || null,
        rows,
        totalOrders: orders.length,
        totalAmount: totalAmountAll,
      });
    } else if (dim === "month") {
      const byMonth: Record<string, { orderCount: number; totalAmount: number }> = {};
      for (const o of orders) {
        const month = o.createdAt.toISOString().substring(0, 7);
        if (!byMonth[month]) byMonth[month] = { orderCount: 0, totalAmount: 0 };
        byMonth[month].orderCount++;
        byMonth[month].totalAmount += o.totalAmount;
      }
      const rows = Object.entries(byMonth)
        .map(([month, v]) => ({ month, ...v }))
        .sort((a, b) => a.month.localeCompare(b.month));
      res.json({
        dimension: dim,
        startDate: startDate || null,
        endDate: endDate || null,
        rows,
        totalOrders: orders.length,
        totalAmount: totalAmountAll,
      });
    } else {
      const orderIds = orders.map((o) => o.id);
      const items = orderIds.length
        ? await db
            .select()
            .from(purchaseOrderItemsTable)
            .where(
              sql`${purchaseOrderItemsTable.purchaseOrderId} IN (${sql.join(
                orderIds.map((i) => sql`${i}`),
                sql`, `,
              )})`,
            )
        : [];
      const byItem: Record<string, { itemName: string; quantity: number; totalAmount: number }> = {};
      for (const it of items) {
        const key = it.productName || "未知品項";
        if (!byItem[key]) byItem[key] = { itemName: key, quantity: 0, totalAmount: 0 };
        byItem[key].quantity += it.quantity;
        byItem[key].totalAmount += it.unitCost * it.quantity;
      }
      const rows = Object.values(byItem).sort((a, b) => b.totalAmount - a.totalAmount);
      res.json({
        dimension: dim,
        startDate: startDate || null,
        endDate: endDate || null,
        rows,
        totalOrders: orders.length,
        totalAmount: totalAmountAll,
      });
    }
  },
);

export default router;
