import { Router, type IRouter } from "express";
import { looseSqlMatch } from "../lib/loose-match";
import { nextDocNumber } from "../lib/doc-number";
import { randomUUID } from "node:crypto";
import { desc, eq, and, sql, inArray } from "drizzle-orm";
import { db, salesOrdersTable, customersTable, itemsTable, activitiesTable, orderTemplatesTable, invoicesTable, deliveryNotesTable, salesReturnsTable, serviceFeesTable } from "@workspace/erp-db";
import {
  ListSalesOrdersQueryParams, CreateSalesOrderBody,
  GetSalesOrderParams, UpdateSalesOrderParams, UpdateSalesOrderBody,
} from "@workspace/erp-api-zod";

import { validateTemplateForProject } from "../lib/template-check";
import { syncSalesOrderJournalEntry, getLockDate, REVENUE_ORDER_STATUSES } from "../lib/auto-journal";
import { friendlyCaughtError } from "../lib/friendly-errors";
import { friendlyValidationError } from "../lib/friendly-errors";
import { requireAuth, requireRole } from "../middleware/require-auth";
import { assertDeletableDraft } from "../lib/document-rules";
import { orderOutstanding, orderPaymentSummaries } from "../lib/order-payments";
import { LEGACY_READONLY_MESSAGE, LEGACY_SOURCE, isLegacySource, LEGACY_SALES_EDITABLE, CONFIRMED_SALES_EDITABLE, LEGACY_EDIT_LIMIT_MESSAGE, keepLegacyFields } from "../lib/legacy";
import { assertCreditLimit } from "../lib/credit-limit";
import { machineOnly } from "../lib/api-key-user";
const router: IRouter = Router();
router.use("/sales-orders", requireAuth);
router.use("/create-sales-order", requireAuth);

function generateOrderNumber(): string {
  return `SO-${String(Date.now()).slice(-8)}-${randomUUID().slice(0, 6).toUpperCase()}`;
}

const SALES_ORDER_STATUSES = new Set(["Draft", "Confirmed", "To Deliver", "Completed", "Cancelled"]);
const SALES_ORDER_TRANSITIONS: Record<string, Set<string>> = {
  Draft: new Set(["Confirmed", "To Deliver", "Completed", "Cancelled"]),
  Confirmed: new Set(["To Deliver", "Completed", "Cancelled"]),
  "To Deliver": new Set(["Completed", "Cancelled"]),
  Completed: new Set(),
  Cancelled: new Set(),
};

async function assertSalesOrderStatusChange(tx: any, order: any, nextStatus: string): Promise<void> {
  if (!SALES_ORDER_STATUSES.has(nextStatus)) throw new Error(`未知的銷貨單狀態「${nextStatus}」`);
  if (nextStatus === order.status) return;
  if (!SALES_ORDER_TRANSITIONS[order.status]?.has(nextStatus)) {
    throw new Error(`無法從「${order.status}」轉換為「${nextStatus}」`);
  }
  if (nextStatus === "Cancelled") {
    const [delivery] = await tx.select({ id: deliveryNotesTable.id }).from(deliveryNotesTable)
      .where(and(eq(deliveryNotesTable.salesOrderId, order.id), sql`${deliveryNotesTable.status} != 'Cancelled'`));
    const [invoice] = await tx.select({ id: invoicesTable.id }).from(invoicesTable)
      .where(and(eq(invoicesTable.salesOrderId, order.id), sql`${invoicesTable.status} != 'Cancelled'`));
    if (delivery || invoice) throw new Error("此銷貨單已有未取消的出貨單或發票，請先處理下游單據後再取消");
  }
  if (nextStatus !== "Completed") return;

  const orderItems = Array.isArray(order.items) ? order.items as any[] : [];
  const lookupIds = orderItems.filter(item => item?.isVirtual === undefined && Number.isInteger(Number(item?.itemId)))
    .map(item => Number(item.itemId));
  const liveVirtual = new Set<number>();
  if (lookupIds.length > 0) {
    const rows = await tx.select({ id: itemsTable.id }).from(itemsTable)
      .where(and(inArray(itemsTable.id, lookupIds), eq(itemsTable.isVirtual, true)));
    for (const row of rows as Array<{ id: number }>) liveVirtual.add(row.id);
  }
  const physical = orderItems.filter(item =>
    item?.isVirtual === false || (item?.isVirtual === undefined && !liveVirtual.has(Number(item?.itemId))),
  );
  if (physical.length === 0) {
    const linked = await tx.select({ status: invoicesTable.status }).from(invoicesTable)
      .where(and(eq(invoicesTable.salesOrderId, order.id), eq(invoicesTable.invoiceType, "Sales")));
    const active = linked.filter((invoice: { status: string }) => invoice.status !== "Cancelled");
    if (active.length === 0 || active.some((invoice: { status: string }) => invoice.status !== "Paid")) {
      throw new Error("純虛擬服務銷貨單須所有銷貨發票收款完成後才能標記完成");
    }
    return;
  }
  const deliveries = await tx.select({ id: deliveryNotesTable.id, items: deliveryNotesTable.items }).from(deliveryNotesTable)
    .where(and(eq(deliveryNotesTable.salesOrderId, order.id), sql`${deliveryNotesTable.status} IN ('Submitted','Completed')`));
  const delivered = new Map<number, number>();
  for (const doc of deliveries) for (const item of (doc.items as any[]) || []) {
    delivered.set(Number(item.itemId), (delivered.get(Number(item.itemId)) || 0) + Number(item.quantity || 0));
  }
  if (deliveries.length > 0) {
    const returns = await tx.select({ items: salesReturnsTable.items }).from(salesReturnsTable)
      .where(and(
        inArray(salesReturnsTable.deliveryNoteId, deliveries.map((doc: { id: number }) => doc.id)),
        sql`${salesReturnsTable.status} NOT IN ('Draft','Cancelled')`,
      ));
    for (const doc of returns) for (const item of (doc.items as any[]) || []) {
      delivered.set(Number(item.itemId), (delivered.get(Number(item.itemId)) || 0) - Number(item.quantity || 0));
    }
  }
  const required = new Map<number, number>();
  for (const item of physical) required.set(Number(item.itemId), (required.get(Number(item.itemId)) || 0) + Number(item.quantity || 0));
  if ([...required].some(([itemId, quantity]) => (delivered.get(itemId) || 0) < quantity)) {
    throw new Error("實體品項尚未全部出貨，不能直接將銷貨單標記完成");
  }
}

const campusFields = {
  label: salesOrdersTable.label,
  handlerId: salesOrdersTable.handlerId,
  classWeeks: salesOrdersTable.classWeeks,
  courseStartDate: salesOrdersTable.courseStartDate,
  courseEndDate: salesOrdersTable.courseEndDate,
  caseTime: salesOrdersTable.caseTime,
  teacherCode: salesOrdersTable.teacherCode,
  teacherFeePerSession: salesOrdersTable.teacherFeePerSession,
  teacherMaterialFeeMethod: salesOrdersTable.teacherMaterialFeeMethod,
  coursePeriod: salesOrdersTable.coursePeriod,
  warehouseCode: salesOrdersTable.warehouseCode,
  transactionType: salesOrdersTable.transactionType,
  dateDetails: salesOrdersTable.dateDetails,
  remarks: salesOrdersTable.remarks,
  invoiceTaxId: salesOrdersTable.invoiceTaxId,
  invoiceTitle: salesOrdersTable.invoiceTitle,
};

const templateFields = {
  orderSource: salesOrdersTable.orderSource,
  templateId: salesOrdersTable.templateId,
  extraFields: salesOrdersTable.extraFields,
};

router.get("/sales-orders", async (req, res): Promise<void> => {
  const query = ListSalesOrdersQueryParams.safeParse(req.query);
  const conditions = [];
  if (query.success && query.data.status) conditions.push(eq(salesOrdersTable.status, query.data.status));
  if (query.success && query.data.customerId) conditions.push(eq(salesOrdersTable.customerId, query.data.customerId));
  const orderSource = req.query.orderSource as string | undefined;
  const templateId = req.query.templateId as string | undefined;
  if (orderSource) conditions.push(eq(salesOrdersTable.orderSource, orderSource));
  if (templateId) conditions.push(eq(salesOrdersTable.templateId, parseInt(templateId)));
  // 關鍵字：單號、客戶名稱／簡稱／編號、標題；打簡稱也找得到（樂善國小 → 樂善國民小學）
  const search = typeof req.query.search === "string" ? req.query.search.trim() : "";
  const searchMatch = search ? looseSqlMatch(search, [sql`${salesOrdersTable.orderNumber}`, sql`${customersTable.name}`, sql`COALESCE(${customersTable.shortName}, '')`, sql`COALESCE(${customersTable.customerCode}, '')`, sql`COALESCE(${salesOrdersTable.label}, '')`]) : undefined;
  if (searchMatch) conditions.push(searchMatch);

  const orders = await db
    .select({
      id: salesOrdersTable.id,
      orderNumber: salesOrdersTable.orderNumber,
      customerId: salesOrdersTable.customerId,
      customerName: customersTable.name,
      orderDate: salesOrdersTable.orderDate,
      deliveryDate: salesOrdersTable.deliveryDate,
      status: salesOrdersTable.status,
      totalAmount: salesOrdersTable.totalAmount,
      items: salesOrdersTable.items,
      departmentId: salesOrdersTable.departmentId,
      projectId: salesOrdersTable.projectId,
      ...campusFields,
      ...templateFields,
      quotationId: salesOrdersTable.quotationId,
      templateName: orderTemplatesTable.name,
      createdAt: salesOrdersTable.createdAt,
    })
    .from(salesOrdersTable)
    .innerJoin(customersTable, eq(salesOrdersTable.customerId, customersTable.id))
    .leftJoin(orderTemplatesTable, eq(salesOrdersTable.templateId, orderTemplatesTable.id))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(salesOrdersTable.orderDate), desc(salesOrdersTable.id));

  const orderIds = orders.map(o => o.id);
  let invoiceMap: Record<number, string[]> = {};
  if (orderIds.length > 0) {
    const linkedInvoices = await db
      .select({ salesOrderId: invoicesTable.salesOrderId, invoiceNumber: invoicesTable.invoiceNumber })
      .from(invoicesTable)
      .where(sql`${invoicesTable.salesOrderId} IN (${sql.join(orderIds.map(id => sql`${id}`), sql`, `)})`);
    for (const inv of linkedInvoices) {
      if (inv.salesOrderId) {
        if (!invoiceMap[inv.salesOrderId]) invoiceMap[inv.salesOrderId] = [];
        invoiceMap[inv.salesOrderId].push(inv.invoiceNumber);
      }
    }
  }

  // 已收金額＝直接核對這張訂單的收款＋它底下發票被沖銷的金額
  const payments = await orderPaymentSummaries(db, "sales", orderIds);
  res.json(orders.map(o => ({
    ...o,
    totalAmount: Number(o.totalAmount),
    teacherFeePerSession: o.teacherFeePerSession ? Number(o.teacherFeePerSession) : null,
    invoiceNumbers: invoiceMap[o.id] || [],
    receivedAmount: payments.get(o.id)?.paid || 0,
    outstandingAmount: o.status === "Cancelled" ? 0 : orderOutstanding(Number(o.totalAmount), payments.get(o.id)),
  })));
});

router.post("/sales-orders", async (req, res): Promise<void> => {
  const parsed = CreateSalesOrderBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: friendlyValidationError(parsed.error) }); return; }

  const orderItems = [];
  let totalAmount = 0;
  for (const item of parsed.data.items) {
    let itemName = item.itemName?.trim() || "";
    let isVirtual = false;
    if (item.itemId != null) {
      const [dbItem] = await db.select({ itemName: itemsTable.itemName, isVirtual: itemsTable.isVirtual })
        .from(itemsTable).where(eq(itemsTable.id, item.itemId));
      itemName = dbItem?.itemName || itemName || "Unknown";
      isVirtual = dbItem?.isVirtual === true;
    }
    if (!itemName) continue;
    const amount = item.quantity * item.rate;
    totalAmount += amount;
    orderItems.push({
      itemId: item.itemId ?? null,
      code: item.code?.trim() || null,
      itemName,
      quantity: item.quantity,
      unit: item.unit?.trim() || null,
      rate: item.rate,
      amount,
      summary: item.summary?.trim() || null,
      isVirtual,
    });
  }

  const departmentId = req.body.departmentId ? Number(req.body.departmentId) : null;
  const projectId = req.body.projectId ? Number(req.body.projectId) : null;

  const orderSource = req.body.orderSource?.trim() || "manual";
  const templateIdVal = req.body.templateId ? Number(req.body.templateId) : null;
  const extraFieldsVal = req.body.extraFields || {};

  const tplErr = await validateTemplateForProject(templateIdVal, projectId, extraFieldsVal);
  if (tplErr) { res.status(400).json({ error: tplErr }); return; }

  const [order] = await db.insert(salesOrdersTable).values({
    orderNumber: await nextDocNumber(db, "sales_orders", "order_number", "SO", generateOrderNumber),
    customerId: parsed.data.customerId,
    orderDate: parsed.data.orderDate,
    deliveryDate: parsed.data.deliveryDate,
    totalAmount: String(totalAmount),
    items: orderItems,
    departmentId,
    projectId,
    orderSource,
    templateId: templateIdVal,
    extraFields: extraFieldsVal,
    label: parsed.data.label?.trim() || null,
    handlerId: parsed.data.handlerId ?? null,
    classWeeks: parsed.data.classWeeks ?? null,
    courseStartDate: parsed.data.courseStartDate?.trim() || null,
    courseEndDate: parsed.data.courseEndDate?.trim() || null,
    caseTime: parsed.data.caseTime?.trim() || null,
    teacherCode: parsed.data.teacherCode?.trim() || null,
    teacherFeePerSession: parsed.data.teacherFeePerSession != null ? String(parsed.data.teacherFeePerSession) : null,
    teacherMaterialFeeMethod: parsed.data.teacherMaterialFeeMethod?.trim() || null,
    coursePeriod: parsed.data.coursePeriod?.trim() || null,
    warehouseCode: parsed.data.warehouseCode?.trim() || null,
    transactionType: parsed.data.transactionType?.trim() || null,
    dateDetails: parsed.data.dateDetails?.trim() || null,
    remarks: parsed.data.remarks?.trim() || null,
    invoiceTaxId: parsed.data.invoiceTaxId?.trim() || null,
    invoiceTitle: parsed.data.invoiceTitle?.trim() || null,
  }).returning();

  const [cust] = await db.select({ name: customersTable.name }).from(customersTable).where(eq(customersTable.id, parsed.data.customerId));

  await db.insert(activitiesTable).values({
    type: "create", title: "Sales Order Created",
    description: `${order.orderNumber} for ${cust?.name || "customer"} - $${totalAmount.toFixed(2)}`,
    module: "Sales",
  });

  res.status(201).json({ ...order, customerName: cust?.name || "Unknown", totalAmount });
});

router.get("/sales-orders/:id", async (req, res): Promise<void> => {
  const params = GetSalesOrderParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: friendlyValidationError(params.error) }); return; }
  const [order] = await db
    .select({
      id: salesOrdersTable.id, orderNumber: salesOrdersTable.orderNumber,
      customerId: salesOrdersTable.customerId, customerName: customersTable.name,
      orderDate: salesOrdersTable.orderDate, deliveryDate: salesOrdersTable.deliveryDate,
      status: salesOrdersTable.status, totalAmount: salesOrdersTable.totalAmount,
      items: salesOrdersTable.items, departmentId: salesOrdersTable.departmentId,
      projectId: salesOrdersTable.projectId,
      ...campusFields,
      ...templateFields,
      quotationId: salesOrdersTable.quotationId,
      templateName: orderTemplatesTable.name,
      createdAt: salesOrdersTable.createdAt,
    })
    .from(salesOrdersTable)
    .innerJoin(customersTable, eq(salesOrdersTable.customerId, customersTable.id))
    .leftJoin(orderTemplatesTable, eq(salesOrdersTable.templateId, orderTemplatesTable.id))
    .where(eq(salesOrdersTable.id, params.data.id));
  if (!order) { res.status(404).json({ error: "找不到銷貨單" }); return; }
  const orderItems = Array.isArray(order.items) ? order.items as {
    itemId?: number | null; quantity?: number; qty?: number; amount?: number; rate?: number;
  }[] : [];
  const itemIds = [...new Set(orderItems.map(item => item.itemId).filter((id): id is number => typeof id === "number"))];
  const costs = itemIds.length > 0
    ? await db.select({
        id: itemsTable.id,
        movingAvgCost: itemsTable.movingAvgCost,
        buyingPrice: itemsTable.buyingPrice,
      }).from(itemsTable).where(sql`${itemsTable.id} IN (${sql.join(itemIds.map(id => sql`${id}`), sql`, `)})`)
    : [];
  const costMap = new Map(costs.map(item => [
    item.id,
    Number(item.movingAvgCost) || Number(item.buyingPrice) || 0,
  ]));
  const itemsWithMargin = orderItems.map(item => {
    const quantity = Number(item.quantity ?? item.qty ?? 0);
    const amount = Number(item.amount ?? (quantity * Number(item.rate ?? 0)));
    const unitCost = item.itemId ? (costMap.get(item.itemId) ?? 0) : 0;
    const cost = unitCost * quantity;
    const grossProfit = amount - cost;
    return { ...item, unitCost, cost, grossProfit, marginPct: amount !== 0 ? (grossProfit / amount) * 100 : 0 };
  });
  const totalRevenue = itemsWithMargin.reduce((sum, item) => sum + Number(item.amount ?? 0), 0);
  const itemCost = itemsWithMargin.reduce((sum, item) => sum + item.cost, 0);
  // 服務型訂單的成本主要是人：把登錄在這張單上的講師與服務費也算進來，毛利才是真的
  const [feeSum] = await db.select({ total: sql<string>`COALESCE(SUM(${serviceFeesTable.amount}), 0)`, count: sql<number>`count(*)::int` })
    .from(serviceFeesTable)
    .where(sql`${serviceFeesTable.salesOrderId} = ${params.data.id} AND ${serviceFeesTable.status} <> ${"Voided"}`);
  const serviceCost = Number(feeSum?.total) || 0;
  const totalCost = itemCost + serviceCost;
  const totalGrossProfit = totalRevenue - totalCost;
  res.json({
    ...order,
    totalAmount: Number(order.totalAmount),
    items: itemsWithMargin,
    marginTotals: {
      revenue: totalRevenue,
      cost: totalCost,
      itemCost,
      serviceCost,
      serviceFeeCount: feeSum?.count ?? 0,
      grossProfit: totalGrossProfit,
      marginPct: totalRevenue !== 0 ? (totalGrossProfit / totalRevenue) * 100 : 0,
    },
    teacherFeePerSession: order.teacherFeePerSession ? Number(order.teacherFeePerSession) : null,
  });
});

router.post("/create-sales-order", async (req, res): Promise<void> => {
  const {
    schoolName, date, time, instructor, courseItem, amount, status, notes,
    label, handlerId, classWeeks, courseStartDate, courseEndDate, caseTime,
    teacherCode, teacherFeePerSession, teacherMaterialFeeMethod,
    coursePeriod, warehouseCode, transactionType, dateDetails, remarks,
    departmentId, projectId,
    orderSource: reqOrderSource, templateId: reqTemplateId, extraFields: reqExtraFields,
  } = req.body;

  if (!schoolName || !date || !courseItem || amount == null) {
    res.status(400).json({ error: "必填欄位：學校名稱、日期、課程項目、金額" }); return;
  }

  const parsedAmount = Number(amount);
  if (!isFinite(parsedAmount) || parsedAmount <= 0) {
    res.status(400).json({ error: "金額必須為有效正數" }); return;
  }

  const customers = await db.select().from(customersTable).where(eq(customersTable.name, schoolName));
  let customerId = customers[0]?.id;
  if (!customerId) {
    const [newCust] = await db.insert(customersTable).values({ name: schoolName, customerCode: `C-${Date.now().toString().slice(-6)}` }).returning();
    customerId = newCust.id;
  }

  const quickTplErr = await validateTemplateForProject(reqTemplateId, projectId);
  if (quickTplErr) { res.status(400).json({ error: quickTplErr }); return; }

  const items = await db.select().from(itemsTable).where(eq(itemsTable.itemName, courseItem));
  const itemId = items[0]?.id;
  const itemName = items[0]?.itemName || courseItem;

  const orderItems = [{
    itemId: itemId || 0,
    itemName,
    quantity: 1,
    rate: parsedAmount,
    amount: parsedAmount,
    isVirtual: items[0]?.isVirtual === true,
  }];

  const [order] = await db.insert(salesOrdersTable).values({
    orderNumber: await nextDocNumber(db, "sales_orders", "order_number", "SO", generateOrderNumber),
    customerId,
    orderDate: date,
    deliveryDate: date,
    totalAmount: String(parsedAmount),
    items: orderItems,
    status: status === "已成交" ? "Confirmed" : status === "已取消" ? "Cancelled" : "Draft",
    departmentId: departmentId ? Number(departmentId) : null,
    projectId: projectId ? Number(projectId) : null,
    orderSource: reqOrderSource || "quick_entry",
    templateId: reqTemplateId ? Number(reqTemplateId) : null,
    extraFields: reqExtraFields || {},
    label: label || null,
    handlerId: handlerId ? Number(handlerId) : null,
    classWeeks: classWeeks ? Number(classWeeks) : null,
    courseStartDate: courseStartDate || null,
    courseEndDate: courseEndDate || null,
    caseTime: caseTime || time || null,
    teacherCode: teacherCode || instructor || null,
    teacherFeePerSession: teacherFeePerSession ? String(teacherFeePerSession) : null,
    teacherMaterialFeeMethod: teacherMaterialFeeMethod || null,
    coursePeriod: coursePeriod || null,
    warehouseCode: warehouseCode || null,
    transactionType: transactionType || null,
    dateDetails: dateDetails || null,
    remarks: remarks || notes || null,
  }).returning();

  // 已成交（Confirmed）且未開發票 → 立即認列營收分錄
  if (order.status === "Confirmed") {
    try {
      await db.transaction(async (tx) => { await syncSalesOrderJournalEntry(tx, order.id); });
    } catch (err: any) {
      await db.delete(salesOrdersTable).where(eq(salesOrdersTable.id, order.id));
      res.status(400).json({ error: friendlyCaughtError(err, "建立營收分錄失敗") }); return;
    }
  }

  await db.insert(activitiesTable).values({
    type: "create",
    title: "快速錄單",
    description: `${order.orderNumber} - ${schoolName} - ${courseItem} - $${parsedAmount.toFixed(0)}`,
    module: "Sales",
  });

  res.status(201).json({ success: true, orderNumber: order.orderNumber, orderId: order.id });
});

router.patch("/sales-orders/:id", async (req, res): Promise<void> => {
  const params = UpdateSalesOrderParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: friendlyValidationError(params.error) }); return; }
  const parsed = UpdateSalesOrderBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: friendlyValidationError(parsed.error) }); return; }

  if (req.body.templateId !== undefined || req.body.projectId !== undefined) {
    const [existing] = await db
      .select({ templateId: salesOrdersTable.templateId, projectId: salesOrdersTable.projectId })
      .from(salesOrdersTable).where(eq(salesOrdersTable.id, params.data.id));
    if (!existing) { res.status(404).json({ error: "找不到銷貨單" }); return; }
    const finalTpl = req.body.templateId !== undefined ? req.body.templateId : existing.templateId;
    const finalProj = req.body.projectId !== undefined ? req.body.projectId : existing.projectId;
    const tplErr = await validateTemplateForProject(finalTpl, finalProj);
    if (tplErr) { res.status(400).json({ error: tplErr }); return; }
  }

  const updateData: any = {};
  const contentFields = [
    "customerId", "orderDate", "deliveryDate", "items", "departmentId", "projectId",
    "templateId", "orderSource", "extraFields", "label", "handlerId", "classWeeks",
    "courseStartDate", "courseEndDate", "caseTime", "teacherCode", "teacherFeePerSession",
    "teacherMaterialFeeMethod", "coursePeriod", "warehouseCode", "transactionType",
    "dateDetails", "remarks", "invoiceTaxId", "invoiceTitle",
  ];
  const wantsContentEdit = contentFields.some((field) => req.body[field] !== undefined);
  if (wantsContentEdit && req.body.status !== undefined) {
    res.status(400).json({ error: "請先儲存內容變更，再另行變更狀態" }); return;
  }
  for (const [key, value] of Object.entries(parsed.data)) {
    if (value === undefined) continue;
    if (key === "items" && Array.isArray(value)) {
      const newItems = [];
      let newTotal = 0;
      for (const raw of value as any[]) {
        const itemName = String(raw.itemName || "").trim();
        if (!itemName) continue;
        const quantity = Number(raw.quantity) || 0;
        const rate = Number(raw.rate) || 0;
        const amount = quantity * rate;
        let isVirtual = false;
        if (raw.itemId != null) {
          const [dbItem] = await db.select({ isVirtual: itemsTable.isVirtual })
            .from(itemsTable).where(eq(itemsTable.id, Number(raw.itemId)));
          isVirtual = dbItem?.isVirtual === true;
        }
        newTotal += amount;
        newItems.push({
          itemId: raw.itemId ?? null,
          code: typeof raw.code === "string" && raw.code.trim() ? raw.code.trim() : null,
          itemName,
          quantity,
          unit: typeof raw.unit === "string" && raw.unit.trim() ? raw.unit.trim() : null,
          rate,
          amount,
          summary: typeof raw.summary === "string" && raw.summary.trim() ? raw.summary.trim() : null,
          isVirtual,
        });
      }
      updateData.items = newItems;
      updateData.totalAmount = String(newTotal);
      continue;
    }
    if (key === "teacherFeePerSession") {
      updateData[key] = value != null ? String(value) : null;
    } else if (typeof value === "string" && value.trim() === "") {
      updateData[key] = null;
    } else {
      updateData[key] = value;
    }
  }

  let order: any;
  try {
    order = await db.transaction(async (tx) => {
      const [locked] = await tx.select()
        .from(salesOrdersTable).where(eq(salesOrdersTable.id, params.data.id)).for("update");
      if (!locked) return null;
      const touched = Object.keys(updateData);
      // 模板欄位是整包送來的：歷史標記（legacy…）一律保留，不會被畫面蓋掉
      if (updateData.extraFields !== undefined) updateData.extraFields = keepLegacyFields(locked.extraFields, updateData.extraFields);
      if (isLegacySource(locked.orderSource)) {
        // 歷史單：只能改不影響帳的欄位
        if (req.body.status !== undefined || touched.length === 0 || touched.some(key => !LEGACY_SALES_EDITABLE.has(key))) throw new Error(LEGACY_EDIT_LIMIT_MESSAGE);
      } else if (wantsContentEdit && locked.status !== "Draft") {
        // 已成立的單：標題、備註、課程資訊這類說明性的欄位還是可以補；金額、品項、客戶、專案不行
        if (touched.some(key => !CONFIRMED_SALES_EDITABLE.has(key))) {
          throw new Error(`這張銷貨單已經成立（目前狀態：${locked.status}），只能改標題、備註、承辦人與課程資訊；品項、金額、客戶、專案要改請先退回草稿`);
        }
      }
      if (req.body.status !== undefined) await assertSalesOrderStatusChange(tx, locked, req.body.status);
      // 訂單要成立（開始算應收）時檢查客戶信用額度；老闆或財務可以明確放行
      if (req.body.status !== undefined && REVENUE_ORDER_STATUSES.includes(req.body.status) && !REVENUE_ORDER_STATUSES.includes(locked.status)) {
        const role = (req as any).session?.user?.role;
        const canOverride = machineOnly(req) ? false : ["owner", "admin", "finance_admin", "super_admin"].includes(role);
        await assertCreditLimit(tx, locked, canOverride && req.body.overrideCreditLimit === true);
      }
      const [updated] = await tx.update(salesOrdersTable).set(updateData).where(eq(salesOrdersTable.id, params.data.id)).returning();
      // 狀態/金額/日期/部門變動後同步營收分錄（成立→建立、取消/草稿→刪除、金額變動→重建）
      await syncSalesOrderJournalEntry(tx, params.data.id);
      return updated;
    });
  } catch (err: any) {
    res.status(400).json({ error: friendlyCaughtError(err, "更新銷貨單失敗"), ...(err?.code === "CREDIT_LIMIT" ? { code: "CREDIT_LIMIT" } : {}) }); return;
  }
  if (!order) { res.status(404).json({ error: "找不到銷貨單" }); return; }
  res.json({ ...order, totalAmount: Number(order.totalAmount), customerName: "Customer" });
});

router.delete("/sales-orders/:id", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "銷貨單編號格式不正確" }); return; }
  let deleted: any;
  try {
    deleted = await db.transaction(async (tx) => {
      const [locked] = await tx.select().from(salesOrdersTable).where(eq(salesOrdersTable.id, id)).for("update");
      if (!locked) return null;
      if (isLegacySource(locked.orderSource)) throw new Error(LEGACY_READONLY_MESSAGE);
      assertDeletableDraft("銷貨單", locked.status, "取消");
      // 先把狀態視為刪除 → 移除自動分錄（含關帳日檢查），再刪訂單
      if (locked.journalEntryId) {
        await tx.update(salesOrdersTable).set({ status: "Cancelled" }).where(eq(salesOrdersTable.id, id));
        await syncSalesOrderJournalEntry(tx, id);
      }
      const [row] = await tx.delete(salesOrdersTable).where(eq(salesOrdersTable.id, id)).returning();
      return row;
    });
  } catch (err: any) {
    res.status(400).json({ error: friendlyCaughtError(err, "刪除銷貨單失敗") }); return;
  }
  if (!deleted) { res.status(404).json({ error: "找不到銷貨單" }); return; }
  res.status(204).send();
});

// 歷史訂單補建營收分錄：把「已成立（Confirmed/Completed）且未開發票、尚無分錄」的銷貨單一次補進帳務報表。
// dryRun=true 只回傳摘要；關帳日(含)以前的訂單預設跳過，includeLocked=true 才納入。冪等：已有分錄者不會重複建立。
/**
 * 搬家用：把舊系統的銷貨單寫進正式的銷貨單資料。
 * 這些單不會再認列營收、不會動庫存（帳已經由舊系統的傳票搬進來）。同一個單號已經有的會跳過，可以重跑。
 */
/**
 * 歷史銷貨單「可能相關」的舊訂貨單（放在歷史單據裡）。
 * 舊系統沒有留下銷貨單是從哪張訂貨單轉的，所以只能用線索找：
 *   同客戶＋同標題，或同客戶＋同開課日期＋同上課時間。找到的只是「可能相關」，不代表一定是同一筆。
 */
router.get("/sales-orders/:id/related-legacy-orders", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) { res.status(400).json({ error: "訂單編號格式不正確" }); return; }
  const [order] = await db.select({
    orderSource: salesOrdersTable.orderSource, label: salesOrdersTable.label, courseStartDate: salesOrdersTable.courseStartDate, caseTime: salesOrdersTable.caseTime,
    customerCode: customersTable.customerCode, customerName: customersTable.name,
  }).from(salesOrdersTable).innerJoin(customersTable, eq(salesOrdersTable.customerId, customersTable.id)).where(eq(salesOrdersTable.id, id));
  if (!order) { res.status(404).json({ error: "找不到銷貨單" }); return; }
  if (!isLegacySource(order.orderSource)) { res.json([]); return; }
  const title = (order.label || "").trim(), start = (order.courseStartDate || "").replace(/-/g, ""), time = (order.caseTime || "").trim();
  if (!title && !(start && time)) { res.json([]); return; }
  // 客戶用編碼對（沒有編碼的舊單用名稱）；線索都在明細第一列（Ecount 的表頭欄位每一列都會重複）
  const result = await db.execute(sql`
    SELECT id, doc_number AS "docNumber", doc_date AS "docDate", total::float AS total, line_count AS "lineCount", staff_name AS "staffName", lines->0 AS head
    FROM legacy_documents
    WHERE doc_type = '訂貨單'
      AND (${order.customerCode ? sql`lines->0->>'客戶/供應商編碼' = ${order.customerCode}` : sql`party_name = ${order.customerName}`})
      AND ((${title} <> '' AND lines->0->>'標題名稱' = ${title})
        OR (${start} <> '' AND ${time} <> '' AND lines->0->>'開課日期' = ${start} AND lines->0->>'案件時間' = ${time}))
    ORDER BY doc_date DESC, id DESC LIMIT 10`);
  const rows = ((result as any).rows ?? result) as Array<{ id: number; docNumber: string; docDate: string | null; total: number | null; lineCount: number; staffName: string | null; head: Record<string, string> | null }>;
  // 線索越多的排越前面：標題、開課日期、上課時間都相同的最可能是同一筆
  const rank = (reason: string): number => (reason === "同標題、同開課日期與上課時間" ? 0 : reason === "同標題" ? 1 : 2);
  res.json(rows.map(row => {
    const head = row.head ?? {};
    const sameTitle = !!title && head["標題名稱"] === title, sameCourse = !!start && !!time && head["開課日期"] === start && head["案件時間"] === time;
    const pick = (key: string) => (typeof head[key] === "string" && head[key].trim() ? head[key].trim() : null);
    return {
      id: row.id, docNumber: row.docNumber, docDate: row.docDate, total: row.total, lineCount: row.lineCount, staffName: row.staffName,
      title: pick("標題名稱"), reason: sameTitle && sameCourse ? "同標題、同開課日期與上課時間" : sameTitle ? "同標題" : "同開課日期與上課時間",
      info: {
        社團品牌: pick("社團品牌"), 社團名稱: pick("社團名稱"), 上課項目: pick("上課項目"), 上課星期: pick("上課星期"), 初始上課人數: pick("初始上課人數"),
        聯絡窗口: pick("聯絡窗口"), 老師: pick("教師姓名") ?? pick("教師名稱"), 助教: pick("助教名稱"), 客戶地址: pick("客戶地址"),
      },
    };
  }).sort((x, y) => rank(x.reason) - rank(y.reason)));
});

const legacyText = (value: unknown, max: number): string | null => (typeof value === "string" && value.trim() ? value.trim().slice(0, max) : null);
const legacyDate = (value: unknown): string | null => (/^\d{4}-\d{2}-\d{2}$/.test(String(value ?? "")) ? String(value) : null);

router.post("/sales-orders/legacy-import", requireRole("owner", "admin"), async (req, res): Promise<void> => {
  const documents: any[] = Array.isArray(req.body?.documents) ? req.body.documents : [];
  if (documents.length === 0 || documents.length > 500) { res.status(400).json({ error: "一次請送 1 到 500 張" }); return; }
  const values = [];
  for (const [index, d] of documents.entries()) {
    const orderNumber = typeof d?.orderNumber === "string" ? d.orderNumber.trim().slice(0, 60) : "";
    const customerId = Number(d?.customerId);
    const total = Math.round(Number(d?.totalAmount) * 100) / 100;
    const paid = Math.round(Number(d?.legacyPaid ?? total) * 100) / 100;
    if (!orderNumber || !Number.isInteger(customerId) || customerId <= 0 || !/^\d{4}-\d{2}-\d{2}$/.test(String(d?.orderDate || "")) || !Number.isFinite(total)) {
      res.status(400).json({ error: `第 ${index + 1} 張的單號、客戶、日期或金額不正確` }); return;
    }
    if (!Number.isFinite(paid) || paid < 0 || paid > Math.max(total, 0) + 0.005) { res.status(400).json({ error: `第 ${index + 1} 張（${orderNumber}）已收金額不正確` }); return; }
    const items = (Array.isArray(d.items) ? d.items : []).slice(0, 500).map((line: any) => ({
      itemId: Number.isInteger(Number(line?.itemId)) && Number(line.itemId) > 0 ? Number(line.itemId) : null,
      itemName: String(line?.itemName ?? "").slice(0, 300), quantity: Number(line?.quantity) || 0, rate: Number(line?.rate) || 0, amount: Number(line?.amount) || 0,
      ...(line?.summary ? { summary: String(line.summary).slice(0, 300) } : {}),
      ...(line?.code ? { code: String(line.code).slice(0, 60) } : {}),
      ...(line?.specification ? { specification: String(line.specification).slice(0, 200) } : {}),
      ...(Number.isFinite(Number(line?.untaxedRate)) && Number(line.untaxedRate) !== 0 ? { untaxedRate: Number(line.untaxedRate) } : {}),
      ...(Number.isFinite(Number(line?.netAmount)) && Number(line.netAmount) !== 0 ? { netAmount: Number(line.netAmount) } : {}),
      ...(Number.isFinite(Number(line?.taxAmount)) && Number(line.taxAmount) !== 0 ? { taxAmount: Number(line.taxAmount) } : {}),
      // 歷史單一律不動庫存
      isVirtual: true,
    }));
    values.push({
      orderNumber, customerId, orderDate: String(d.orderDate), status: "Completed", totalAmount: String(total), items,
      projectId: Number.isInteger(Number(d.projectId)) && Number(d.projectId) > 0 ? Number(d.projectId) : null,
      departmentId: Number.isInteger(Number(d.departmentId)) && Number(d.departmentId) > 0 ? Number(d.departmentId) : null,
      handlerId: Number.isInteger(Number(d.handlerId)) && Number(d.handlerId) > 0 ? Number(d.handlerId) : null,
      // 舊單上的課程資訊，直接放進銷貨單原本就有的欄位
      courseStartDate: legacyDate(d.courseStartDate), courseEndDate: legacyDate(d.courseEndDate),
      classWeeks: Number.isInteger(Number(d.classWeeks)) && Number(d.classWeeks) > 0 && Number(d.classWeeks) < 1000 ? Number(d.classWeeks) : null,
      caseTime: legacyText(d.caseTime, 100), coursePeriod: legacyText(d.coursePeriod, 50), teacherCode: legacyText(d.teacherCode, 100),
      teacherFeePerSession: Number(d.teacherFeePerSession) > 0 && Number(d.teacherFeePerSession) < 10_000_000 ? String(Math.round(Number(d.teacherFeePerSession) * 100) / 100) : null,
      teacherMaterialFeeMethod: legacyText(d.teacherMaterialFeeMethod, 100), warehouseCode: legacyText(d.warehouseCode, 100), dateDetails: legacyText(d.dateDetails, 500),
      transactionType: ["營業稅", "免稅", "零稅率"].includes(d.transactionType) ? d.transactionType : null,
      // 建立時間用單據日期，清單才會照原本的先後排
      createdAt: new Date(`${String(d.orderDate)}T00:00:00+08:00`),
      orderSource: LEGACY_SOURCE, label: typeof d.label === "string" ? d.label.slice(0, 200) || null : null,
      remarks: typeof d.remarks === "string" ? d.remarks.slice(0, 1000) || null : null,
      extraFields: {
        legacy: true, legacySource: LEGACY_SOURCE, legacyDocNumber: String(d.legacyDocNumber ?? "").slice(0, 80), legacyStaff: String(d.legacyStaff ?? "").slice(0, 60), legacyPaid: paid,
        ...(legacyText(d.legacyAddress, 300) ? { legacyAddress: legacyText(d.legacyAddress, 300) } : {}),
        ...(legacyText(d.legacyCoursePeriodName, 60) ? { legacyCoursePeriodName: legacyText(d.legacyCoursePeriodName, 60) } : {}),
      },
    });
  }
  try {
    const inserted = await db.insert(salesOrdersTable).values(values as any).onConflictDoNothing().returning({ id: salesOrdersTable.id });
    res.status(201).json({ inserted: inserted.length, skipped: values.length - inserted.length });
  } catch (err: any) {
    res.status(400).json({ error: /[㐀-鿿]/.test(err?.message || "") ? err.message : "寫入失敗，請確認客戶與專案都存在" });
  }
});

router.post("/sales-orders/backfill-journal-entries", requireRole("owner", "admin", "accountant"), async (req, res): Promise<void> => {
  const dryRun = req.body?.dryRun === true;
  const includeLocked = req.body?.includeLocked === true;
  const lockDate = await getLockDate(db);

  const candidates = await db.select({
    id: salesOrdersTable.id,
    orderNumber: salesOrdersTable.orderNumber,
    orderDate: salesOrdersTable.orderDate,
    totalAmount: salesOrdersTable.totalAmount,
    status: salesOrdersTable.status,
  }).from(salesOrdersTable).where(and(
    sql`${salesOrdersTable.status} IN ('Confirmed', 'To Deliver', 'Completed')`,
    sql`${salesOrdersTable.journalEntryId} IS NULL`,
    sql`${salesOrdersTable.totalAmount}::numeric > 0`,
    sql`NOT EXISTS (SELECT 1 FROM invoices i WHERE i.sales_order_id = ${salesOrdersTable.id} AND i.invoice_type = 'Sales' AND i.status != 'Cancelled')`,
  ));

  let created = 0, skippedLocked = 0, failed = 0;
  const errors: string[] = [];
  for (const o of candidates) {
    const isLocked = !!lockDate && o.orderDate <= lockDate;
    if (isLocked && !includeLocked) { skippedLocked++; continue; }
    if (dryRun) { created++; continue; }
    try {
      await db.transaction(async (tx) => {
        await tx.select({ id: salesOrdersTable.id }).from(salesOrdersTable).where(eq(salesOrdersTable.id, o.id)).for("update");
        const jeId = await syncSalesOrderJournalEntry(tx, o.id, { bypassLockDate: includeLocked && isLocked });
        if (jeId) created++;
      });
    } catch (err: any) {
      failed++;
      if (errors.length < 10) errors.push(`${o.orderNumber}: ${err.message}`);
    }
  }

  if (!dryRun && created > 0) {
    await db.insert(activitiesTable).values({
      type: "create", title: "補建銷貨單營收分錄",
      description: `共補建 ${created} 筆未開發票訂單的營收分錄`,
      module: "Accounting",
    });
  }
  res.json({ dryRun, totalCandidates: candidates.length, created, skippedLocked, failed, errors });
});

export default router;
