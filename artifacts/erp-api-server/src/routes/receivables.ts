import { Router, type IRouter } from "express";
import { and, eq, sql } from "drizzle-orm";
import { db, customersTable, invoicesTable, vouchersTable, salesOrdersTable } from "@workspace/erp-db";
import { inArray } from "drizzle-orm";
import { REVENUE_ORDER_STATUSES } from "../lib/auto-journal";
import { orderOutstanding, orderPaymentSummaries } from "../lib/order-payments";
import { requireAuth, requireRole } from "../middleware/require-auth";
import { todayTaipei } from "../lib/inventory-journal";
import { agingParts } from "../lib/payment-terms";
import { creditCheck, customerExposures } from "../lib/credit-limit";
import { round2 } from "../lib/order-payments";
import { daysSince, unbilledOrderReceivables } from "../lib/unbilled-receivables";

/**
 * 應收帳款總覽：一頁看完每個客戶還欠多少、逾期多少、信用額度用了多少、上次什麼時候付錢。
 * 明細仍然在各自的頁面（對帳單、催款、收款單），這裡只做彙總與入口。
 */
const router: IRouter = Router();
router.use("/receivables", requireAuth, requireRole("owner", "admin", "finance_admin", "accountant", "manager"));

router.get("/receivables/overview", async (_req, res): Promise<void> => {
  try {
    const today = todayTaipei();
    const [customers, exposures, openInvoices, lastReceipts] = await Promise.all([
      db.select({ id: customersTable.id, name: customersTable.name, customerCode: customersTable.customerCode, creditLimit: customersTable.creditLimit, phone: customersTable.phone, contactPerson: customersTable.contactPerson }).from(customersTable),
      customerExposures(db),
      db.select().from(invoicesTable).where(and(eq(invoicesTable.invoiceType, "Sales"), sql`${invoicesTable.status} NOT IN ('Paid', 'Cancelled', 'WrittenOff')`)),
      db.select({ customerId: vouchersTable.customerId, lastDate: sql<string>`MAX(${vouchersTable.voucherDate})` })
        .from(vouchersTable).where(and(eq(vouchersTable.voucherType, "Receipt"), sql`${vouchersTable.customerId} IS NOT NULL`)).groupBy(vouchersTable.customerId),
    ]);
    const lastReceipt = new Map(lastReceipts.map(row => [Number(row.customerId), row.lastDate]));

    // 舊系統（Ecount）帶過來、還沒收的銷貨單：金額已經含在「還欠」裡，這裡另外標出來，並算出最早一張是哪一天
    const legacyOrders = await db.select({ id: salesOrdersTable.id, customerId: salesOrdersTable.customerId, orderDate: salesOrdersTable.orderDate, totalAmount: salesOrdersTable.totalAmount })
      .from(salesOrdersTable).where(and(eq(salesOrdersTable.orderSource, "ecount"), inArray(salesOrdersTable.status, REVENUE_ORDER_STATUSES)));
    const legacyPayments = legacyOrders.length > 0 ? await orderPaymentSummaries(db, "sales", legacyOrders.map(o => o.id)) : new Map();
    const legacy = new Map<number, { amount: number; count: number; oldestDate: string }>();
    for (const order of legacyOrders) {
      const open = orderOutstanding(Number(order.totalAmount), legacyPayments.get(order.id));
      if (!(open > 0)) continue;
      const entry = legacy.get(order.customerId) ?? { amount: 0, count: 0, oldestDate: order.orderDate };
      entry.amount += open; entry.count += 1; if (order.orderDate < entry.oldestDate) entry.oldestDate = order.orderDate;
      legacy.set(order.customerId, entry);
    }

    // 逾期：依每張發票（或每一期）的到期日算
    const overdue = new Map<number, { amount: number; count: number; oldestDays: number }>();
    for (const invoice of openInvoices) {
      const outstanding = Number(invoice.outstandingAmount);
      if (!(outstanding > 0) || !invoice.customerId) continue;
      let late = 0, oldest = 0;
      for (const part of agingParts(invoice, outstanding, today)) {
        const days = Math.floor((new Date(today).getTime() - new Date(part.dueDate).getTime()) / 86400000);
        if (days > 0) { late += part.amount; oldest = Math.max(oldest, days); }
      }
      if (late <= 0) continue;
      const entry = overdue.get(invoice.customerId) ?? { amount: 0, count: 0, oldestDays: 0 };
      entry.amount += late; entry.count += 1; entry.oldestDays = Math.max(entry.oldestDays, oldest);
      overdue.set(invoice.customerId, entry);
    }

    const rows = customers.map(customer => {
      const exposure = exposures.get(customer.id) ?? { orders: 0, invoices: 0, total: 0 };
      const late = overdue.get(customer.id) ?? { amount: 0, count: 0, oldestDays: 0 };
      const limit = customer.creditLimit == null ? null : Number(customer.creditLimit);
      const check = creditCheck(limit, exposure.total, 0);
      return {
        customerId: customer.id, customerName: customer.name, customerCode: customer.customerCode,
        contactPerson: customer.contactPerson, phone: customer.phone,
        outstanding: exposure.total, fromOrders: exposure.orders, fromInvoices: exposure.invoices,
        overdueAmount: round2(late.amount), overdueCount: late.count, oldestOverdueDays: late.oldestDays,
        creditLimit: check.limited ? limit : null,
        creditUsedPct: check.limited && limit ? Math.round((exposure.total / limit) * 1000) / 10 : null,
        overLimit: check.limited && !check.ok,
        available: check.limited && limit ? round2(Math.max(0, limit - exposure.total)) : null,
        lastReceiptDate: lastReceipt.get(customer.id) ?? null,
        legacyOutstanding: round2(legacy.get(customer.id)?.amount ?? 0), legacyCount: legacy.get(customer.id)?.count ?? 0, legacyOldestDate: legacy.get(customer.id)?.oldestDate ?? null,
      };
    }).filter(row => row.outstanding > 0 || row.creditLimit != null)
      .sort((a, b) => Number(b.overLimit) - Number(a.overLimit) || b.overdueAmount - a.overdueAmount || b.outstanding - a.outstanding);

    const owing = rows.filter(row => row.outstanding > 0);
    res.json({
      asOfDate: today,
      summary: {
        outstanding: round2(owing.reduce((sum, row) => sum + row.outstanding, 0)),
        overdue: round2(owing.reduce((sum, row) => sum + row.overdueAmount, 0)),
        customers: owing.length,
        overdueCustomers: owing.filter(row => row.overdueAmount > 0).length,
        overLimitCustomers: rows.filter(row => row.overLimit).length,
        legacyOutstanding: round2(owing.reduce((sum, row) => sum + row.legacyOutstanding, 0)),
        legacyCount: owing.reduce((sum, row) => sum + row.legacyCount, 0),
        legacyCustomers: owing.filter(row => row.legacyOutstanding > 0).length,
      },
      rows,
    });
  } catch (err: any) {
    res.status(500).json({ error: `應收帳款總覽產生失敗：${err?.message || "未知錯誤"}` });
  }
});

/**
 * 應收沖帳清單：全公司還沒收清、還沒開發票的銷貨單，一張一列（含舊系統帶過來的）。
 * 在這裡勾選同一個客戶的幾張單，就可以開一張收款單把它們沖掉。算法跟帳齡表、儀表板同一套。
 */
router.get("/receivables/open-items", async (_req, res): Promise<void> => {
  try {
    const today = todayTaipei();
    const [orders, customers] = await Promise.all([
      unbilledOrderReceivables(db),
      db.select({ id: customersTable.id, name: customersTable.name, customerCode: customersTable.customerCode }).from(customersTable),
    ]);
    const byId = new Map(customers.map(c => [c.id, c]));
    const rows = orders.map(o => ({
      id: o.id, orderNumber: o.orderNumber, orderDate: o.orderDate, label: o.label, legacy: o.legacy, projectId: o.projectId,
      customerId: o.customerId, customerCode: byId.get(o.customerId)?.customerCode ?? null, customerName: byId.get(o.customerId)?.name ?? "未指定",
      outstanding: o.outstanding, days: daysSince(o.orderDate, today),
    }));
    res.json({ asOfDate: today, count: rows.length, total: round2(rows.reduce((sum, r) => sum + r.outstanding, 0)), rows });
  } catch (err: any) {
    res.status(500).json({ error: `應收沖帳清單產生失敗：${err?.message || "未知錯誤"}` });
  }
});

/** 某個客戶還沒收清的銷貨單（一張一張列出來，含舊系統帶過來的） */
router.get("/receivables/customers/:id/open-orders", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) { res.status(400).json({ error: "客戶編號格式不正確" }); return; }
  const orders = await db.select({ id: salesOrdersTable.id, orderNumber: salesOrdersTable.orderNumber, orderDate: salesOrdersTable.orderDate, totalAmount: salesOrdersTable.totalAmount, projectId: salesOrdersTable.projectId, orderSource: salesOrdersTable.orderSource, label: salesOrdersTable.label })
    .from(salesOrdersTable).where(and(eq(salesOrdersTable.customerId, id), inArray(salesOrdersTable.status, REVENUE_ORDER_STATUSES)));
  const payments = orders.length > 0 ? await orderPaymentSummaries(db, "sales", orders.map(o => o.id)) : new Map();
  const today = todayTaipei();
  res.json(orders.map(order => {
    const total = Number(order.totalAmount), outstanding = orderOutstanding(total, payments.get(order.id));
    return {
      id: order.id, orderNumber: order.orderNumber, orderDate: order.orderDate, label: order.label, legacy: order.orderSource === "ecount", projectId: order.projectId ?? null,
      totalAmount: total, paidAmount: round2(total - outstanding), outstanding,
      days: Math.max(0, Math.floor((new Date(today).getTime() - new Date(order.orderDate).getTime()) / 86400000)),
    };
  }).filter(order => order.outstanding > 0).sort((a, b) => a.orderDate.localeCompare(b.orderDate)));
});

export default router;
