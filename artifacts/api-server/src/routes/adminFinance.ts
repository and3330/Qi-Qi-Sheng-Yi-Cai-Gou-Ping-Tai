import { Router, type IRouter } from "express";
import { and, desc, eq, gte, inArray, lte, sql, type SQL } from "drizzle-orm";
import {
  db,
  expensesTable,
  ordersTable,
  orderItemsTable,
  profitShareRecordsTable,
  type Expense,
} from "@workspace/db";
import { CreateAdminExpenseBody } from "@workspace/api-zod";
import { requireAdmin } from "../middlewares/requireMember";

const router: IRouter = Router();

const EXPENSE_CATEGORIES = [
  "purchase",
  "operating",
  "logistics",
  "marketing",
  "other",
];

function endOfDay(to: string) {
  const end = new Date(to);
  end.setDate(end.getDate() + 1);
  return end;
}

function serializeExpense(e: Expense) {
  return {
    id: e.id,
    category: e.category,
    title: e.title,
    amount: e.amount,
    note: e.note,
    spentAt: e.spentAt.toISOString(),
    createdAt: e.createdAt.toISOString(),
  };
}

router.get("/admin/expenses", requireAdmin, async (req, res) => {
  const from = typeof req.query.from === "string" ? req.query.from : "";
  const to = typeof req.query.to === "string" ? req.query.to : "";
  const category =
    typeof req.query.category === "string" ? req.query.category : "";

  const conds: SQL[] = [];
  if (from) conds.push(gte(expensesTable.spentAt, new Date(from)));
  if (to) conds.push(lte(expensesTable.spentAt, endOfDay(to)));
  if (EXPENSE_CATEGORIES.includes(category))
    conds.push(eq(expensesTable.category, category));

  const rows = await db
    .select()
    .from(expensesTable)
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(expensesTable.spentAt))
    .limit(500);
  res.json(rows.map(serializeExpense));
});

router.post("/admin/expenses", requireAdmin, async (req, res) => {
  const parsed = CreateAdminExpenseBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "支出資料不完整" });
    return;
  }
  const [row] = await db
    .insert(expensesTable)
    .values({
      category: parsed.data.category,
      title: parsed.data.title,
      amount: parsed.data.amount,
      note: parsed.data.note ?? null,
      spentAt: parsed.data.spentAt ? new Date(parsed.data.spentAt) : new Date(),
      createdBy: req.member!.id,
    })
    .returning();
  res.status(201).json(serializeExpense(row));
});

router.delete("/admin/expenses/:id", requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const deleted = await db
    .delete(expensesTable)
    .where(eq(expensesTable.id, id))
    .returning({ id: expensesTable.id });
  if (!deleted.length) {
    res.status(404).json({ error: "找不到此支出紀錄" });
    return;
  }
  res.status(204).end();
});

router.get("/admin/finance/ledger", requireAdmin, async (req, res) => {
  const from = typeof req.query.from === "string" ? req.query.from : "";
  const to = typeof req.query.to === "string" ? req.query.to : "";
  const kind = typeof req.query.kind === "string" ? req.query.kind : "";

  const orderConds: SQL[] = [sql`${ordersTable.status} in ('paid', 'shipped', 'completed')`];
  if (from) orderConds.push(gte(ordersTable.createdAt, new Date(from)));
  if (to) orderConds.push(lte(ordersTable.createdAt, endOfDay(to)));
  const orders =
    kind === "expense"
      ? []
      : await db
          .select({
            orderNo: ordersTable.orderNo,
            totalAmount: ordersTable.totalAmount,
            createdAt: ordersTable.createdAt,
          })
          .from(ordersTable)
          .where(and(...orderConds));

  const expenseConds: SQL[] = [];
  if (from) expenseConds.push(gte(expensesTable.spentAt, new Date(from)));
  if (to) expenseConds.push(lte(expensesTable.spentAt, endOfDay(to)));
  const expenses =
    kind === "income"
      ? []
      : await db
          .select()
          .from(expensesTable)
          .where(expenseConds.length ? and(...expenseConds) : undefined);

  const entries = [
    ...orders.map((o) => ({
      date: o.createdAt.toISOString(),
      kind: "income" as const,
      category: "order",
      title: `訂單收款 ${o.orderNo}`,
      amount: o.totalAmount,
      refNo: o.orderNo,
    })),
    ...expenses.map((e) => ({
      date: e.spentAt.toISOString(),
      kind: "expense" as const,
      category: e.category,
      title: e.title,
      amount: e.amount,
      refNo: null,
    })),
  ].sort((a, b) => (a.date < b.date ? 1 : -1));

  const incomeTotal = orders.reduce((s, o) => s + o.totalAmount, 0);
  const expenseTotal = expenses.reduce((s, e) => s + e.amount, 0);

  res.json({
    from: from || null,
    to: to || null,
    incomeTotal,
    expenseTotal,
    net: incomeTotal - expenseTotal,
    entries: entries.slice(0, 800),
  });
});

router.get("/admin/finance/pnl", requireAdmin, async (req, res) => {
  const from = typeof req.query.from === "string" ? req.query.from : "";
  const to = typeof req.query.to === "string" ? req.query.to : "";

  const orderConds: SQL[] = [sql`${ordersTable.status} in ('paid', 'shipped', 'completed')`];
  if (from) orderConds.push(gte(ordersTable.createdAt, new Date(from)));
  if (to) orderConds.push(lte(ordersTable.createdAt, endOfDay(to)));
  const orders = await db
    .select({
      id: ordersTable.id,
      totalAmount: ordersTable.totalAmount,
      createdAt: ordersTable.createdAt,
    })
    .from(ordersTable)
    .where(and(...orderConds));

  const orderIds = orders.map((o) => o.id);
  const items = orderIds.length
    ? await db
        .select({
          orderId: orderItemsTable.orderId,
          cost: sql<number>`${orderItemsTable.unitCost} * ${orderItemsTable.quantity}`,
        })
        .from(orderItemsTable)
        .where(inArray(orderItemsTable.orderId, orderIds))
    : [];
  const costByOrder = new Map<number, number>();
  for (const it of items)
    costByOrder.set(it.orderId, (costByOrder.get(it.orderId) ?? 0) + Number(it.cost));

  const expenseConds: SQL[] = [];
  if (from) expenseConds.push(gte(expensesTable.spentAt, new Date(from)));
  if (to) expenseConds.push(lte(expensesTable.spentAt, endOfDay(to)));
  const expenses = await db
    .select({ amount: expensesTable.amount, spentAt: expensesTable.spentAt })
    .from(expensesTable)
    .where(expenseConds.length ? and(...expenseConds) : undefined);

  const psConds: SQL[] = [];
  if (from) psConds.push(gte(profitShareRecordsTable.createdAt, new Date(from)));
  if (to) psConds.push(lte(profitShareRecordsTable.createdAt, endOfDay(to)));
  const shares = await db
    .select({
      amount: profitShareRecordsTable.amount,
      createdAt: profitShareRecordsTable.createdAt,
    })
    .from(profitShareRecordsTable)
    .where(psConds.length ? and(...psConds) : undefined);

  const monthKey = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  type MonthRow = {
    month: string;
    revenue: number;
    cogs: number;
    grossProfit: number;
    expenses: number;
    profitShare: number;
    netProfit: number;
  };
  const months = new Map<string, MonthRow>();
  const monthFor = (d: Date) => {
    const k = monthKey(d);
    let m = months.get(k);
    if (!m) {
      m = {
        month: k,
        revenue: 0,
        cogs: 0,
        grossProfit: 0,
        expenses: 0,
        profitShare: 0,
        netProfit: 0,
      };
      months.set(k, m);
    }
    return m;
  };

  for (const o of orders) {
    const m = monthFor(o.createdAt);
    m.revenue += o.totalAmount;
    m.cogs += costByOrder.get(o.id) ?? 0;
  }
  for (const e of expenses) monthFor(e.spentAt).expenses += e.amount;
  for (const s of shares) monthFor(s.createdAt).profitShare += s.amount;

  const rows = [...months.values()]
    .map((m) => ({
      ...m,
      grossProfit: m.revenue - m.cogs,
      netProfit: m.revenue - m.cogs - m.expenses - m.profitShare,
    }))
    .sort((a, b) => a.month.localeCompare(b.month));

  const revenue = rows.reduce((s, m) => s + m.revenue, 0);
  const cogs = rows.reduce((s, m) => s + m.cogs, 0);
  const expenseTotal = rows.reduce((s, m) => s + m.expenses, 0);
  const profitShareTotal = rows.reduce((s, m) => s + m.profitShare, 0);

  res.json({
    from: from || null,
    to: to || null,
    revenue,
    cogs,
    grossProfit: revenue - cogs,
    expenseTotal,
    profitShareTotal,
    netProfit: revenue - cogs - expenseTotal - profitShareTotal,
    months: rows,
  });
});

export default router;
