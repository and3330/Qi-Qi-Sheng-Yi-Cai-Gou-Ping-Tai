import { Router, type IRouter } from "express";
import { looseSqlMatch } from "../lib/loose-match";
import { todayTaipei } from "../lib/inventory-journal";
import { eq, ilike, or, sql, and, ne, lte, asc } from "drizzle-orm";
import { db, customersTable, activitiesTable, invoicesTable, invoiceSettlementsTable, vouchersTable } from "@workspace/erp-db";
import { requireAuth } from "../middleware/require-auth";
import { safeJsonDatabaseErrorHandler } from "../middleware/safe-json-db-error";
import {
  CUSTOMER_CONFLICT_MESSAGE, CustomerInputError, conflictField, findCustomerConflict,
  lockCustomerMaster, normalizeCustomerInput, type CustomerInput,
} from "../lib/customer-master";

const router: IRouter = Router();
router.use("/customers", requireAuth);

router.get("/customers", async (req, res): Promise<void> => {
  const search = req.query.search as string | undefined;
  const category = req.query.category as string | undefined;
  const conditions = [];
  if (search) {
    conditions.push(or(
      ilike(customersTable.name, `%${search}%`),
      ilike(customersTable.customerCode, `%${search}%`),
      ilike(customersTable.shortName, `%${search}%`),
      ilike(customersTable.contactPerson, `%${search}%`),
      // 打簡稱也找得到：每個字照順序出現就算（樂善國小 → 樂善國民小學）
      looseSqlMatch(search, [sql`${customersTable.name}`, sql`COALESCE(${customersTable.shortName}, '')`]),
    ));
  }
  if (category) conditions.push(eq(customersTable.category, category));
  // 預設只給啟用中的（開單選客戶用）；客戶管理、對帳單等要看全部的帶 includeInactive=1
  if (req.query.includeInactive !== "1") conditions.push(eq(customersTable.isActive, true));

  const customers = await db
    .select({
      id: customersTable.id,
      customerCode: customersTable.customerCode,
      name: customersTable.name,
      shortName: customersTable.shortName,
      email: customersTable.email,
      phone: customersTable.phone,
      mobile: customersTable.mobile,
      contactPerson: customersTable.contactPerson,
      salesPerson: customersTable.salesPerson,
      address: customersTable.address,
      city: customersTable.city,
      country: customersTable.country,
      taxId: customersTable.taxId,
      paymentTermId: customersTable.paymentTermId,
      creditLimit: customersTable.creditLimit,
      category: customersTable.category,
      remarks: customersTable.remarks,
      isActive: customersTable.isActive,
      createdAt: customersTable.createdAt,
      totalOrders: sql<number>`(SELECT COUNT(*) FROM sales_orders WHERE customer_id = "customers"."id")::int`,
      totalSpent: sql<number>`COALESCE((SELECT SUM(total_amount::numeric) FROM sales_orders WHERE customer_id = "customers"."id"), 0)::float`,
    })
    .from(customersTable)
    .where(conditions.length > 0 ? sql`${conditions.reduce((a, b) => sql`${a} AND ${b}`)}` : undefined)
    .orderBy(customersTable.name);

  res.json(customers);
});

/** 信用額度：沒傳回 undefined（不動）；空白或 0 存成 null（不限） */
function parseCreditLimit(raw: unknown): string | null | undefined {
  if (raw === undefined) return undefined;
  if (raw === null || raw === "") return null;
  const value = Math.round(Number(raw) * 100) / 100;
  if (!Number.isFinite(value) || value < 0) throw new Error("信用額度必須是 0 以上的數字");
  return value === 0 ? null : String(value);
}

// Human customer creation. Also the target of human confirmation of AI customer drafts
// (routes/ai-drafts.ts dispatches here inside its own transaction; this nests as a SAVEPOINT).
router.post("/customers", async (req, res): Promise<void> => {
  let input;
  try { input = normalizeCustomerInput(req.body); }
  catch (error) {
    if (error instanceof CustomerInputError) { res.status(error.status).json(error.body); return; }
    throw error;
  }
  let creditLimit: string | null | undefined;
  try { creditLimit = parseCreditLimit(req.body?.creditLimit); }
  catch (error: any) { res.status(400).json({ error: error.message }); return; }
  const outcome = await db.transaction(async (tx) => {
    await lockCustomerMaster(tx);
    const conflict = await findCustomerConflict(tx, input);
    if (conflict) return { ok: false, conflict } as const;
    const [created] = await tx.insert(customersTable).values({ ...(req.body?.isActive === false ? { isActive: false } : {}), ...(req.body.paymentTermId === undefined ? input : { ...input, paymentTermId: (req.body.paymentTermId === null || req.body.paymentTermId === "" ? null : (Number.isInteger(Number(req.body.paymentTermId)) && Number(req.body.paymentTermId) > 0 ? Number(req.body.paymentTermId) : null)) }), ...(creditLimit === undefined ? {} : { creditLimit }) }).returning();
    await tx.insert(activitiesTable).values({
      type: "create",
      title: "New Customer",
      description: `${input.name} added as customer`,
      module: "Sales",
    });
    return { ok: true, created } as const;
  });
  if (!outcome.ok) {
    res.status(409).json({ error: CUSTOMER_CONFLICT_MESSAGE[outcome.conflict], field: outcome.conflict });
    return;
  }
  res.status(201).json({ ...outcome.created, totalOrders: 0, totalSpent: 0 });
});

// Batch import applies the same trim / required name / 統編 / same-tenant duplicate rules
// (against existing customers and within the batch). Any violation rejects the whole batch.
router.post("/customers/batch", async (req, res): Promise<void> => {
  const { records } = req.body ?? {};
  if (!Array.isArray(records) || records.length === 0) {
    res.status(400).json({ error: "records 陣列為必填" });
    return;
  }
  const values: Array<CustomerInput & { category: string }> = [];
  for (const [index, record] of records.entries()) {
    try {
      const input = normalizeCustomerInput(record);
      values.push({ ...input, category: input.category ?? "一般客戶", ...(record?.isActive === false ? { isActive: false } : {}) });
    } catch (error) {
      if (error instanceof CustomerInputError) { res.status(error.status).json({ ...error.body, index }); return; }
      throw error;
    }
  }
  for (const [index, value] of values.entries()) {
    const conflict = conflictField(values.slice(0, index), value);
    if (conflict) {
      res.status(409).json({ error: `批次資料內重複：${CUSTOMER_CONFLICT_MESSAGE[conflict].replace("同租戶已有", "")}`, field: conflict, index });
      return;
    }
  }
  const outcome = await db.transaction(async (tx) => {
    await lockCustomerMaster(tx);
    for (const [index, value] of values.entries()) {
      const conflict = await findCustomerConflict(tx, value);
      if (conflict) return { ok: false, conflict, index } as const;
    }
    const inserted = await tx.insert(customersTable).values(values).returning();
    return { ok: true, count: inserted.length } as const;
  });
  if (!outcome.ok) {
    res.status(409).json({ error: CUSTOMER_CONFLICT_MESSAGE[outcome.conflict], field: outcome.conflict, index: outcome.index });
    return;
  }
  res.status(201).json({ count: outcome.count });
});

router.get("/customers/:id", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const [cust] = await db.select().from(customersTable).where(eq(customersTable.id, id));
  if (!cust) { res.status(404).json({ error: "Customer not found" }); return; }
  res.json({ ...cust, totalOrders: 0, totalSpent: 0 });
});

router.patch("/customers/:id", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const updates: Record<string, unknown> = {};
  const fields = ["name", "customerCode", "shortName", "email", "phone", "mobile", "contactPerson", "salesPerson", "address", "city", "country", "taxId", "category", "remarks"];
  for (const f of fields) {
    if (req.body[f] !== undefined) updates[f] = req.body[f];
  }
  if (typeof req.body.isActive === "boolean") updates.isActive = req.body.isActive;
  if (req.body.paymentTermId !== undefined) updates.paymentTermId = (req.body.paymentTermId === null || req.body.paymentTermId === "" ? null : (Number.isInteger(Number(req.body.paymentTermId)) && Number(req.body.paymentTermId) > 0 ? Number(req.body.paymentTermId) : null));
  try { const limit = parseCreditLimit(req.body.creditLimit); if (limit !== undefined) updates.creditLimit = limit; }
  catch (error: any) { res.status(400).json({ error: error.message }); return; }
  const [cust] = await db.update(customersTable).set(updates).where(eq(customersTable.id, id)).returning();
  if (!cust) { res.status(404).json({ error: "Customer not found" }); return; }
  res.json({ ...cust, totalOrders: 0, totalSpent: 0 });
});

// 客戶未結發票（給收款單沖銷選擇用）
router.get("/customers/:id/open-invoices", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const rows = await db.select({
    id: invoicesTable.id,
    invoiceNumber: invoicesTable.invoiceNumber,
    invoiceDate: invoicesTable.invoiceDate,
    dueDate: invoicesTable.dueDate,
    status: invoicesTable.status,
    totalAmount: invoicesTable.totalAmount,
    paidAmount: invoicesTable.paidAmount,
    outstandingAmount: invoicesTable.outstandingAmount,
  })
    .from(invoicesTable)
    .where(and(
      eq(invoicesTable.invoiceType, "Sales"),
      eq(invoicesTable.customerId, id),
      ne(invoicesTable.status, "Paid"),
      ne(invoicesTable.status, "Cancelled"),
      ne(invoicesTable.status, "WrittenOff"),
    ))
    .orderBy(asc(invoicesTable.invoiceDate));
  res.json(rows.map(r => ({
    ...r,
    totalAmount: Number(r.totalAmount),
    paidAmount: Number(r.paidAmount),
    outstandingAmount: Number(r.outstandingAmount),
  })));
});

// 客戶對帳單
router.get("/customers/:id/statement", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const asOf = (req.query.asOf as string) || todayTaipei();

  const [customer] = await db.select().from(customersTable).where(eq(customersTable.id, id));
  if (!customer) { res.status(404).json({ error: "Customer not found" }); return; }

  // 該客戶 截至 asOf 的所有銷貨發票（不含已取消）
  const allInvoices = await db.select({
    id: invoicesTable.id,
    invoiceNumber: invoicesTable.invoiceNumber,
    invoiceDate: invoicesTable.invoiceDate,
    dueDate: invoicesTable.dueDate,
    status: invoicesTable.status,
    totalAmount: invoicesTable.totalAmount,
    paidAmount: invoicesTable.paidAmount,
    outstandingAmount: invoicesTable.outstandingAmount,
    salesOrderId: invoicesTable.salesOrderId,
  })
    .from(invoicesTable)
    .where(and(
      eq(invoicesTable.invoiceType, "Sales"),
      eq(invoicesTable.customerId, id),
      ne(invoicesTable.status, "Cancelled"),
      lte(invoicesTable.invoiceDate, asOf),
    ))
    .orderBy(asc(invoicesTable.invoiceDate));

  // 每張發票的沖銷紀錄
  const invoiceIds = allInvoices.map(i => i.id);
  const settlements = invoiceIds.length > 0 ? await db.select({
    id: invoiceSettlementsTable.id,
    invoiceId: invoiceSettlementsTable.invoiceId,
    voucherId: invoiceSettlementsTable.voucherId,
    amount: invoiceSettlementsTable.amount,
    voucherNumber: vouchersTable.voucherNumber,
    voucherDate: vouchersTable.voucherDate,
  })
    .from(invoiceSettlementsTable)
    .leftJoin(vouchersTable, eq(invoiceSettlementsTable.voucherId, vouchersTable.id))
    .where(and(
      sql`${invoiceSettlementsTable.invoiceId} = ANY(${invoiceIds})`,
      lte(vouchersTable.voucherDate, asOf),
      ne(vouchersTable.status, "Cancelled"),
    )) : [];

  const settMap = new Map<number, any[]>();
  for (const s of settlements) {
    const arr = settMap.get(s.invoiceId) || [];
    arr.push({ ...s, amount: Number(s.amount) });
    settMap.set(s.invoiceId, arr);
  }

  const today = new Date(asOf);
  const invoices = allInvoices.map(inv => {
    const applied = settMap.get(inv.id) || [];
    const appliedSum = applied.reduce((s, a) => s + a.amount, 0);
    const total = Number(inv.totalAmount);
    // 已轉呆帳的發票：餘額已由呆帳分錄沖銷，不再列為未收
    const writtenOff = inv.status === "WrittenOff";
    const outstanding = writtenOff ? 0 : Math.max(0, Math.round((total - appliedSum) * 100) / 100);
    const due = inv.dueDate || inv.invoiceDate;
    const daysPast = Math.floor((today.getTime() - new Date(due).getTime()) / 86400000);
    return {
      ...inv,
      totalAmount: total,
      paidAmount: Math.round(appliedSum * 100) / 100,
      outstandingAmount: outstanding,
      applied,
      daysPast,
      isOverdue: outstanding > 0 && daysPast > 0,
    };
  });

  const open = invoices.filter(i => i.outstandingAmount > 0);
  const summary = {
    asOf,
    totalInvoiced: invoices.reduce((s, i) => s + i.totalAmount, 0),
    totalPaid: invoices.reduce((s, i) => s + i.paidAmount, 0),
    totalOutstanding: open.reduce((s, i) => s + i.outstandingAmount, 0),
    overdueOutstanding: open.filter(i => i.isOverdue).reduce((s, i) => s + i.outstandingAmount, 0),
    openCount: open.length,
    aging: { current: 0, d30: 0, d60: 0, d90: 0, d120: 0 },
  };
  for (const i of open) {
    if (i.daysPast <= 0) summary.aging.current += i.outstandingAmount;
    else if (i.daysPast <= 30) summary.aging.d30 += i.outstandingAmount;
    else if (i.daysPast <= 60) summary.aging.d60 += i.outstandingAmount;
    else if (i.daysPast <= 90) summary.aging.d90 += i.outstandingAmount;
    else summary.aging.d120 += i.outstandingAmount;
  }

  res.json({ customer, summary, invoices });
});

router.delete("/customers/:id", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const [cust] = await db.delete(customersTable).where(eq(customersTable.id, id)).returning();
  if (!cust) { res.status(404).json({ error: "Customer not found" }); return; }
  res.sendStatus(204);
});

// Express 5 forwards rejected async handlers here. Keep this scoped to the
// customer router so database failures can never fall through to HTML errors.
router.use("/customers", safeJsonDatabaseErrorHandler);

export default router;
