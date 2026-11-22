import { Router, type IRouter } from "express";
import { looseSqlMatch } from "../lib/loose-match";
import { eq, ilike, or, sql, and, ne, asc } from "drizzle-orm";
import { db, suppliersTable, activitiesTable, invoicesTable } from "@workspace/erp-db";
import { requireAuth } from "../middleware/require-auth";

const router: IRouter = Router();
router.use("/suppliers", requireAuth);

router.get("/suppliers", async (req, res): Promise<void> => {
  const search = req.query.search as string | undefined;
  const conditions = [];
  if (search) {
    conditions.push(or(
      ilike(suppliersTable.name, `%${search}%`),
      ilike(suppliersTable.supplierCode, `%${search}%`),
      ilike(suppliersTable.shortName, `%${search}%`),
      // 打簡稱也找得到：每個字照順序出現就算
      looseSqlMatch(search, [sql`${suppliersTable.name}`, sql`COALESCE(${suppliersTable.shortName}, '')`]),
    ));
  }
  // 預設只給啟用中的（開單選供應商用）；供應商管理要看全部的帶 includeInactive=1
  if (req.query.includeInactive !== "1") conditions.push(eq(suppliersTable.isActive, true));

  const suppliers = await db
    .select({
      id: suppliersTable.id,
      supplierCode: suppliersTable.supplierCode,
      name: suppliersTable.name,
      shortName: suppliersTable.shortName,
      email: suppliersTable.email,
      phone: suppliersTable.phone,
      mobile: suppliersTable.mobile,
      contactPerson: suppliersTable.contactPerson,
      address: suppliersTable.address,
      city: suppliersTable.city,
      country: suppliersTable.country,
      taxId: suppliersTable.taxId,
      paymentTermId: suppliersTable.paymentTermId,
      category: suppliersTable.category,
      isActive: suppliersTable.isActive,
      createdAt: suppliersTable.createdAt,
      totalOrders: sql<number>`(SELECT COUNT(*) FROM purchase_orders WHERE supplier_id = "suppliers"."id")::int`,
      totalPurchased: sql<number>`COALESCE((SELECT SUM(total_amount::numeric) FROM purchase_orders WHERE supplier_id = "suppliers"."id"), 0)::float`,
    })
    .from(suppliersTable)
    .where(conditions.length > 0 ? sql`${conditions.reduce((a, b) => sql`${a} AND ${b}`)}` : undefined)
    .orderBy(suppliersTable.name);

  res.json(suppliers);
});

router.post("/suppliers", async (req, res): Promise<void> => {
  const { name, supplierCode, shortName, email, phone, mobile, contactPerson, address, city, country, taxId, category } = req.body;
  if (!name) { res.status(400).json({ error: "名稱為必填" }); return; }
  const [sup] = await db.insert(suppliersTable).values({
    name, supplierCode, shortName, email, phone, mobile, contactPerson, address, city, country, taxId, category,
    ...(req.body.isActive === false ? { isActive: false } : {}),
    paymentTermId: (req.body.paymentTermId === null || req.body.paymentTermId === "" ? null : (Number.isInteger(Number(req.body.paymentTermId)) && Number(req.body.paymentTermId) > 0 ? Number(req.body.paymentTermId) : null)),
  }).returning();
  await db.insert(activitiesTable).values({ type: "create", title: "New Supplier", description: `${name} added as supplier`, module: "Purchasing" });
  res.status(201).json({ ...sup, totalOrders: 0, totalPurchased: 0 });
});

router.post("/suppliers/batch", async (req, res): Promise<void> => {
  const { records } = req.body;
  if (!Array.isArray(records) || records.length === 0) {
    res.status(400).json({ error: "records 陣列為必填" });
    return;
  }
  const values = records.map((r: any) => ({
    name: r.name || "未命名",
    supplierCode: r.supplierCode || null,
    shortName: r.shortName || null,
    email: r.email || null,
    phone: r.phone || null,
    mobile: r.mobile || null,
    contactPerson: r.contactPerson || null,
    address: r.address || null,
    city: r.city || null,
    country: r.country || null,
    taxId: r.taxId || null,
    category: r.category || "一般供應商",
    ...(r.isActive === false ? { isActive: false } : {}),
  }));
  const inserted = await db.insert(suppliersTable).values(values).returning();
  res.status(201).json({ count: inserted.length });
});

router.get("/suppliers/:id", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const [sup] = await db.select().from(suppliersTable).where(eq(suppliersTable.id, id));
  if (!sup) { res.status(404).json({ error: "Supplier not found" }); return; }
  res.json({ ...sup, totalOrders: 0, totalPurchased: 0 });
});

router.patch("/suppliers/:id", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const updates: Record<string, unknown> = {};
  const fields = ["name", "supplierCode", "shortName", "email", "phone", "mobile", "contactPerson", "address", "city", "country", "taxId", "category"];
  for (const f of fields) {
    if (req.body[f] !== undefined) updates[f] = req.body[f];
  }
  if (typeof req.body.isActive === "boolean") updates.isActive = req.body.isActive;
  if (req.body.paymentTermId !== undefined) updates.paymentTermId = (req.body.paymentTermId === null || req.body.paymentTermId === "" ? null : (Number.isInteger(Number(req.body.paymentTermId)) && Number(req.body.paymentTermId) > 0 ? Number(req.body.paymentTermId) : null));
  const [sup] = await db.update(suppliersTable).set(updates).where(eq(suppliersTable.id, id)).returning();
  if (!sup) { res.status(404).json({ error: "Supplier not found" }); return; }
  res.json({ ...sup, totalOrders: 0, totalPurchased: 0 });
});

router.delete("/suppliers/:id", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const [sup] = await db.delete(suppliersTable).where(eq(suppliersTable.id, id)).returning();
  if (!sup) { res.status(404).json({ error: "Supplier not found" }); return; }
  res.sendStatus(204);
});

// 供應商未結採購發票（給付款單沖銷選擇用）
router.get("/suppliers/:id/open-invoices", async (req, res): Promise<void> => {
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
      eq(invoicesTable.invoiceType, "Purchase"),
      eq(invoicesTable.supplierId, id),
      ne(invoicesTable.status, "Paid"),
      ne(invoicesTable.status, "Cancelled"),
    ))
    .orderBy(asc(invoicesTable.invoiceDate));
  res.json(rows.map(r => ({
    ...r,
    totalAmount: Number(r.totalAmount),
    paidAmount: Number(r.paidAmount),
    outstandingAmount: Number(r.outstandingAmount),
  })));
});

export default router;
