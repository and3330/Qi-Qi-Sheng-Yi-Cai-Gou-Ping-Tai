import { Router, type IRouter } from "express";
import { eq, sql, desc, and, or, lte, gt, ne } from "drizzle-orm";
import { requireAuth } from "../middleware/require-auth";
import {
  db, employeesTable, customersTable, suppliersTable,
  salesOrdersTable, purchaseOrdersTable, leavesTable,
  projectsTable, leadsTable, opportunitiesTable,
  invoicesTable, activitiesTable, approvalRequestsTable, itemsTable,
  quotationsTable,
} from "@workspace/erp-db";
import { GetRecentActivityQueryParams } from "@workspace/erp-api-zod";
import { daysSince, unbilledOrderReceivables } from "../lib/unbilled-receivables";
import { todayTaipei } from "../lib/inventory-journal";

const router: IRouter = Router();
router.use("/dashboard", requireAuth);

/** 解析儀表板期間篩選（year=YYYY|all, month=1-12|all） */
function parsePeriod(q: any): { year: number | null; month: number | null } {
  const now = new Date();
  const yRaw = String(q.year ?? "");
  const mRaw = String(q.month ?? "");
  const year = yRaw === "all" ? null : /^\d{4}$/.test(yRaw) ? Number(yRaw) : now.getFullYear();
  const month = year === null || mRaw === "all" ? null : /^([1-9]|1[0-2])$/.test(mRaw) ? Number(mRaw) : null;
  return { year, month };
}

router.get("/dashboard/summary", async (req, res): Promise<void> => {
  const { year, month } = parsePeriod(req.query);
  const periodCond = (type: string) => and(
    eq(invoicesTable.invoiceType, type),
    ne(invoicesTable.status, "Cancelled"),
    year !== null ? sql`substr(${invoicesTable.invoiceDate}, 1, 4) = ${String(year)}` : undefined,
    month !== null ? sql`substr(${invoicesTable.invoiceDate}, 6, 2) = ${String(month).padStart(2, "0")}` : undefined,
  );
  const count = (table: any, where?: any) => {
    const q = db.select({ count: sql<number>`COUNT(*)::int` }).from(table);
    return where ? q.where(where) : q;
  };
  const sum = (table: any, where: any) => db.select({ total: sql<number>`COALESCE(SUM(total_amount::numeric), 0)::float` }).from(table).where(where);
  const orderPeriod = (col: any) => [
    year !== null ? sql`substr(${col}, 1, 4) = ${String(year)}` : undefined,
    month !== null ? sql`substr(${col}, 6, 2) = ${String(month).padStart(2, "0")}` : undefined,
  ];

  // 一次全部送出去查，不要一個等一個（儀表板每 15 秒重抓一次）
  const [
    [empCount], [custCount], [supCount], [openSO], [openPO], [pendingLeaves], [activeProj], [openLeads], [openOpps],
    [revenue], [orderRevenue], [invoiceExpenses], [orderExpenses],
  ] = await Promise.all([
    count(employeesTable), count(customersTable), count(suppliersTable),
    count(salesOrdersTable, eq(salesOrdersTable.status, "Draft")),
    count(purchaseOrdersTable, eq(purchaseOrdersTable.status, "Draft")),
    count(leavesTable, eq(leavesTable.status, "Pending")),
    count(projectsTable, eq(projectsTable.status, "Open")),
    count(leadsTable, eq(leadsTable.status, "New")),
    count(opportunitiesTable, eq(opportunitiesTable.status, "Open")),
    sum(invoicesTable, periodCond("Sales")),
    // 未開發票但已成立的銷貨單也認列營收；已開票的不重複算
    sum(salesOrdersTable, and(
      sql`${salesOrdersTable.status} IN ('Confirmed', 'To Deliver', 'Completed')`,
      sql`NOT EXISTS (SELECT 1 FROM invoices i WHERE i.sales_order_id = ${salesOrdersTable.id} AND i.invoice_type = 'Sales' AND i.status != 'Cancelled')`,
      ...orderPeriod(salesOrdersTable.orderDate),
    )),
    sum(invoicesTable, periodCond("Purchase")),
    // 支出跟營收用同一套算法：未收到進項發票但已成立的採購單也算，已開票的不重複算。
    // 少了這段，還沒登進項發票的公司支出永遠是 0，毛利會等於營收。
    sum(purchaseOrdersTable, and(
      sql`${purchaseOrdersTable.status} IN ('Confirmed', 'To Receive', 'Completed')`,
      sql`NOT EXISTS (SELECT 1 FROM invoices i WHERE i.purchase_order_id = ${purchaseOrdersTable.id} AND i.invoice_type = 'Purchase' AND i.status != 'Cancelled')`,
      ...orderPeriod(purchaseOrdersTable.orderDate),
    )),
  ]);
  const expenses = { total: invoiceExpenses.total + orderExpenses.total };

  res.json({
    totalRevenue: revenue.total + orderRevenue.total,
    totalExpenses: expenses.total,
    netProfit: revenue.total + orderRevenue.total - expenses.total,
    totalEmployees: empCount.count,
    totalCustomers: custCount.count,
    totalSuppliers: supCount.count,
    openSalesOrders: openSO.count,
    openPurchaseOrders: openPO.count,
    pendingLeaves: pendingLeaves.count,
    activeProjects: activeProj.count,
    openLeads: openLeads.count,
    openOpportunities: openOpps.count,
  });
});

router.get("/dashboard/todos", async (req, res): Promise<void> => {
  const sessionUser = (req as any).session?.user;
  const username = sessionUser?.username || sessionUser?.name;
  if (!username) {
    res.status(401).json({ error: "無法識別登入使用者" });
    return;
  }

  const now = new Date();
  const periodStartMonth = Math.floor(now.getMonth() / 2) * 2;
  const periodStart = `${now.getFullYear()}-${String(periodStartMonth + 1).padStart(2, "0")}-01`;
  const periodEndDate = new Date(now.getFullYear(), periodStartMonth + 2, 0);
  const periodEnd = `${periodEndDate.getFullYear()}-${String(periodEndDate.getMonth() + 1).padStart(2, "0")}-${String(periodEndDate.getDate()).padStart(2, "0")}`;

  const pendingCondition = and(
    sql`${approvalRequestsTable.status} IN ('Pending', 'In Progress')`,
    or(
      sql`jsonb_array_length(${approvalRequestsTable.approvers}) = 0`,
      sql`${approvalRequestsTable.approvers} @> ${JSON.stringify([username])}::jsonb`,
    ),
  );
  const overdueCondition = and(
    eq(invoicesTable.invoiceType, "Sales"),
    ne(invoicesTable.status, "Cancelled"),
    gt(invoicesTable.outstandingAmount, "0"),
    sql`TO_DATE(COALESCE(NULLIF(${invoicesTable.dueDate}, ''), ${invoicesTable.invoiceDate}), 'YYYY-MM-DD') < CURRENT_DATE - INTERVAL '30 days'`,
  );
  const lowStockCondition = and(
    gt(itemsTable.reorderLevel, "0"),
    lte(itemsTable.currentStock, itemsTable.reorderLevel),
    eq(itemsTable.status, "Active"),
  );
  const vatCondition = and(
    sql`${invoicesTable.invoiceDate} >= ${periodStart}`,
    sql`${invoicesTable.invoiceDate} <= ${periodEnd}`,
    ne(invoicesTable.status, "Cancelled"),
  );
  const draftCutoff = sql`NOW() - INTERVAL '14 days'`;

  const [
    pendingSummary, pendingRows, overdueSummary, overdueRows,
    lowStockSummary, lowStockRows, vat, quotationDrafts, orderDrafts,
  ] = await Promise.all([
    db.select({ count: sql<number>`COUNT(*)::int` }).from(approvalRequestsTable).where(pendingCondition),
    db.select({
      id: approvalRequestsTable.id,
      documentType: approvalRequestsTable.documentType,
      documentNumber: approvalRequestsTable.documentNumber,
      requestedBy: approvalRequestsTable.requestedBy,
      createdAt: approvalRequestsTable.createdAt,
    }).from(approvalRequestsTable).where(pendingCondition).orderBy(approvalRequestsTable.createdAt).limit(5),
    db.select({
      count: sql<number>`COUNT(*)::int`,
      total: sql<number>`COALESCE(SUM(${invoicesTable.outstandingAmount}::numeric), 0)::float`,
    }).from(invoicesTable).where(overdueCondition),
    db.select({
      id: invoicesTable.id,
      invoiceNumber: invoicesTable.invoiceNumber,
      customerName: customersTable.name,
      outstandingAmount: sql<number>`${invoicesTable.outstandingAmount}::float`,
      dueDate: invoicesTable.dueDate,
      invoiceDate: invoicesTable.invoiceDate,
    }).from(invoicesTable).leftJoin(customersTable, eq(invoicesTable.customerId, customersTable.id))
      .where(overdueCondition)
      .orderBy(desc(invoicesTable.outstandingAmount)).limit(5),
    db.select({ count: sql<number>`COUNT(*)::int` }).from(itemsTable).where(lowStockCondition),
    db.select({
      id: itemsTable.id,
      itemCode: itemsTable.itemCode,
      itemName: itemsTable.itemName,
      currentStock: sql<number>`${itemsTable.currentStock}::float`,
      reorderLevel: sql<number>`${itemsTable.reorderLevel}::float`,
      unit: itemsTable.unit,
    }).from(itemsTable).where(lowStockCondition)
      .orderBy(sql`(${itemsTable.currentStock}::numeric - ${itemsTable.reorderLevel}::numeric)`).limit(5),
    db.select({
      outputTax: sql<number>`COALESCE(SUM(CASE WHEN ${invoicesTable.invoiceType} = 'Sales' AND ${invoicesTable.taxType} IN ('taxable', 'zero_rated') THEN ${invoicesTable.taxAmount}::numeric ELSE 0 END), 0)::float`,
      inputTax: sql<number>`COALESCE(SUM(CASE WHEN ${invoicesTable.invoiceType} = 'Purchase' AND ${invoicesTable.taxType} = 'taxable' THEN ${invoicesTable.taxAmount}::numeric ELSE 0 END), 0)::float`,
    }).from(invoicesTable).where(vatCondition),
    db.select({ count: sql<number>`COUNT(*)::int` }).from(quotationsTable)
      .where(and(eq(quotationsTable.status, "Draft"), lte(quotationsTable.createdAt, draftCutoff))),
    db.select({ count: sql<number>`COUNT(*)::int` }).from(salesOrdersTable)
      .where(and(eq(salesOrdersTable.status, "Draft"), lte(salesOrdersTable.createdAt, draftCutoff))),
  ]);

  // 逾期應收也算還沒開發票的未收銷貨單（含舊系統搬來的）：單據日期起超過 30 天，跟發票的算法一樣
  const today = todayTaipei();
  const lateOrders = (await unbilledOrderReceivables(db)).filter(o => daysSince(o.orderDate, today) > 30);
  const lateOrderTotal = lateOrders.reduce((sum, o) => sum + o.outstanding, 0);

  const vatRow = vat[0] || { outputTax: 0, inputTax: 0 };
  res.json({
    pendingApprovals: { count: pendingSummary[0]?.count || 0, rows: pendingRows },
    overdueReceivables: {
      count: (overdueSummary[0]?.count || 0) + lateOrders.length,
      total: Math.round(((overdueSummary[0]?.total || 0) + lateOrderTotal) * 100) / 100,
      rows: overdueRows, unbilledOrders: lateOrders.length, unbilledTotal: Math.round(lateOrderTotal * 100) / 100,
    },
    lowStock: { count: lowStockSummary[0]?.count || 0, rows: lowStockRows },
    vatEstimate: {
      periodStart, periodEnd,
      outputTax: vatRow.outputTax || 0,
      inputTax: vatRow.inputTax || 0,
      payableTax: (vatRow.outputTax || 0) - (vatRow.inputTax || 0),
    },
    draftDocsAging: {
      count: (quotationDrafts[0]?.count || 0) + (orderDrafts[0]?.count || 0),
      quotations: quotationDrafts[0]?.count || 0,
      salesOrders: orderDrafts[0]?.count || 0,
    },
  });
});

router.get("/dashboard/recent-activity", async (req, res): Promise<void> => {
  const query = GetRecentActivityQueryParams.safeParse(req.query);
  const limit = query.success ? query.data.limit ?? 10 : 10;

  const activities = await db.select().from(activitiesTable).orderBy(desc(activitiesTable.createdAt)).limit(limit);
  res.json(activities);
});

router.get("/dashboard/revenue-chart", async (req, res): Promise<void> => {
  try {
    const yRaw = String(req.query.year ?? "");
    const year = /^\d{4}$/.test(yRaw) ? Number(yRaw) : new Date().getFullYear();

    // 營收＝銷項發票（不含作廢）＋未開發票但已成立的銷貨單，避免重複計算
    const salesByMonth = await db.select({
      monthNum: sql<number>`EXTRACT(MONTH FROM TO_DATE(invoice_date, 'YYYY-MM-DD'))::int`,
      total: sql<number>`COALESCE(SUM(total_amount::numeric), 0)::float`,
    }).from(invoicesTable)
      .where(sql`invoice_type = 'Sales' AND status != 'Cancelled' AND invoice_date IS NOT NULL AND invoice_date != '' AND substr(invoice_date, 1, 4) = ${String(year)}`)
      .groupBy(sql`EXTRACT(MONTH FROM TO_DATE(invoice_date, 'YYYY-MM-DD'))`);

    const orderSalesByMonth = await db.select({
      monthNum: sql<number>`EXTRACT(MONTH FROM TO_DATE(order_date, 'YYYY-MM-DD'))::int`,
      total: sql<number>`COALESCE(SUM(total_amount::numeric), 0)::float`,
    }).from(salesOrdersTable)
      .where(sql`status IN ('Confirmed', 'To Deliver', 'Completed') AND order_date IS NOT NULL AND order_date != '' AND substr(order_date, 1, 4) = ${String(year)}
        AND NOT EXISTS (SELECT 1 FROM invoices i WHERE i.sales_order_id = ${salesOrdersTable.id} AND i.invoice_type = 'Sales' AND i.status != 'Cancelled')`)
      .groupBy(sql`EXTRACT(MONTH FROM TO_DATE(order_date, 'YYYY-MM-DD'))`);

    const purchasesByMonth = await db.select({
      monthNum: sql<number>`EXTRACT(MONTH FROM TO_DATE(invoice_date, 'YYYY-MM-DD'))::int`,
      total: sql<number>`COALESCE(SUM(total_amount::numeric), 0)::float`,
    }).from(invoicesTable)
      .where(sql`invoice_type = 'Purchase' AND status != 'Cancelled' AND invoice_date IS NOT NULL AND invoice_date != '' AND substr(invoice_date, 1, 4) = ${String(year)}`)
      .groupBy(sql`EXTRACT(MONTH FROM TO_DATE(invoice_date, 'YYYY-MM-DD'))`);

    const orderPurchasesByMonth = await db.select({
      monthNum: sql<number>`EXTRACT(MONTH FROM TO_DATE(order_date, 'YYYY-MM-DD'))::int`,
      total: sql<number>`COALESCE(SUM(total_amount::numeric), 0)::float`,
    }).from(purchaseOrdersTable)
      .where(sql`status IN ('Confirmed', 'To Receive', 'Completed') AND order_date IS NOT NULL AND order_date != '' AND substr(order_date, 1, 4) = ${String(year)}
        AND NOT EXISTS (SELECT 1 FROM invoices i WHERE i.purchase_order_id = ${purchaseOrdersTable.id} AND i.invoice_type = 'Purchase' AND i.status != 'Cancelled')`)
      .groupBy(sql`EXTRACT(MONTH FROM TO_DATE(order_date, 'YYYY-MM-DD'))`);

    const months = ["1月", "2月", "3月", "4月", "5月", "6月", "7月", "8月", "9月", "10月", "11月", "12月"];

    const salesMap = new Map(salesByMonth.map(r => [r.monthNum, r.total]));
    for (const r of orderSalesByMonth) salesMap.set(r.monthNum, (salesMap.get(r.monthNum) || 0) + r.total);
    const purchMap = new Map(purchasesByMonth.map(r => [r.monthNum, r.total]));
    for (const r of orderPurchasesByMonth) purchMap.set(r.monthNum, (purchMap.get(r.monthNum) || 0) + r.total);

    const data = months.map((month, idx) => {
      const m = idx + 1;
      return {
        month,
        revenue: Math.round(salesMap.get(m) || 0),
        expenses: Math.round(purchMap.get(m) || 0),
      };
    });

    res.json(data);
  } catch (err) {
    // 以前失敗時回一整年的 0，畫面看起來像「今年沒有營收」；現在老實回錯誤，讓畫面說讀不出來
    req.log?.error?.({ err }, "dashboard revenue-chart failed");
    res.status(500).json({ error: "營收圖表讀取失敗" });
  }
});

export default router;
