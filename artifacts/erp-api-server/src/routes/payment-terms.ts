import { Router, type IRouter } from "express";
import { eq, sql } from "drizzle-orm";
import { db, paymentTermsTable, customersTable, suppliersTable, invoicesTable } from "@workspace/erp-db";
import { requireAuth, requireRole } from "../middleware/require-auth";
import { buildSchedule, normalizeInstallments, scheduleStatus, termProblem, type Installment } from "../lib/payment-terms";
import { todayTaipei } from "../lib/inventory-journal";

const router: IRouter = Router();
const FINANCE = ["owner", "admin", "finance_admin", "accountant"] as const;
// 讀取開放給所有登入的人（開單、建客戶時要選）；新增修改只給財務
router.use("/payment-terms", requireAuth);

const parseId = (value: unknown): number | null => {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
};

const describe = (installments: Installment[]) =>
  installments.map(i => `${i.label} ${i.percent}%（${i.days === 0 ? "發票日" : `${i.days} 天`}）`).join("、");

router.get("/payment-terms", async (_req, res): Promise<void> => {
  const [terms, customers, suppliers] = await Promise.all([
    db.select().from(paymentTermsTable).orderBy(paymentTermsTable.id),
    db.select({ termId: customersTable.paymentTermId, count: sql<number>`count(*)::int` }).from(customersTable).groupBy(customersTable.paymentTermId),
    db.select({ termId: suppliersTable.paymentTermId, count: sql<number>`count(*)::int` }).from(suppliersTable).groupBy(suppliersTable.paymentTermId),
  ]);
  const count = (rows: Array<{ termId: number | null; count: number }>, id: number) => rows.find(r => r.termId === id)?.count || 0;
  res.json(terms.map(t => ({
    ...t,
    summary: describe(t.installments as Installment[]),
    customerCount: count(customers, t.id),
    supplierCount: count(suppliers, t.id),
  })));
});

router.post("/payment-terms", requireRole(...FINANCE), async (req, res): Promise<void> => {
  const installments = normalizeInstallments(req.body?.installments);
  const problem = termProblem(req.body?.name, installments);
  if (problem) { res.status(400).json({ error: problem }); return; }
  const name = String(req.body.name).trim();
  const [dup] = await db.select({ id: paymentTermsTable.id }).from(paymentTermsTable).where(eq(paymentTermsTable.name, name));
  if (dup) { res.status(409).json({ error: `已經有「${name}」這個付款條件` }); return; }
  const [row] = await db.insert(paymentTermsTable).values({
    name, installments: installments!, isActive: req.body.isActive !== false,
    note: typeof req.body.note === "string" ? req.body.note.trim().slice(0, 200) || null : null,
  }).returning();
  res.status(201).json(row);
});

router.put("/payment-terms/:id", requireRole(...FINANCE), async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  if (!id) { res.status(400).json({ error: "格式不正確" }); return; }
  const [existing] = await db.select().from(paymentTermsTable).where(eq(paymentTermsTable.id, id));
  if (!existing) { res.status(404).json({ error: "找不到這個付款條件" }); return; }
  const installments = req.body?.installments === undefined ? (existing.installments as Installment[]) : normalizeInstallments(req.body.installments);
  const name = req.body?.name === undefined ? existing.name : req.body.name;
  const problem = termProblem(name, installments);
  if (problem) { res.status(400).json({ error: problem }); return; }
  const cleanName = String(name).trim();
  if (cleanName !== existing.name) {
    const [dup] = await db.select({ id: paymentTermsTable.id }).from(paymentTermsTable).where(eq(paymentTermsTable.name, cleanName));
    if (dup) { res.status(409).json({ error: `已經有「${cleanName}」這個付款條件` }); return; }
  }
  // 修改條件只影響之後開的發票；已經開出去的發票排程不會跟著變
  const [row] = await db.update(paymentTermsTable).set({
    name: cleanName, installments: installments!,
    isActive: req.body?.isActive === undefined ? existing.isActive : req.body.isActive !== false,
    note: req.body?.note === undefined ? existing.note : (typeof req.body.note === "string" ? req.body.note.trim().slice(0, 200) || null : null),
  }).where(eq(paymentTermsTable.id, id)).returning();
  res.json(row);
});

router.delete("/payment-terms/:id", requireRole(...FINANCE), async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  if (!id) { res.status(400).json({ error: "格式不正確" }); return; }
  const [[customer], [supplier], [invoice]] = await Promise.all([
    db.select({ count: sql<number>`count(*)::int` }).from(customersTable).where(eq(customersTable.paymentTermId, id)),
    db.select({ count: sql<number>`count(*)::int` }).from(suppliersTable).where(eq(suppliersTable.paymentTermId, id)),
    db.select({ count: sql<number>`count(*)::int` }).from(invoicesTable).where(eq(invoicesTable.paymentTermId, id)),
  ]);
  const used = (customer?.count || 0) + (supplier?.count || 0) + (invoice?.count || 0);
  if (used > 0) { res.status(400).json({ error: "已經有客戶、供應商或發票使用這個付款條件，不能刪除。可以改成停用" }); return; }
  await db.delete(paymentTermsTable).where(eq(paymentTermsTable.id, id));
  res.status(204).end();
});

/** 一張發票的分期狀況：每一期應收多少、已收多少、有沒有逾期 */
router.get("/payment-terms/invoice/:invoiceId", async (req, res): Promise<void> => {
  const invoiceId = parseId(req.params.invoiceId);
  if (!invoiceId) { res.status(400).json({ error: "格式不正確" }); return; }
  const [invoice] = await db.select().from(invoicesTable).where(eq(invoicesTable.id, invoiceId));
  if (!invoice) { res.status(404).json({ error: "找不到發票" }); return; }
  const status = scheduleStatus(invoice.paymentSchedule, Number(invoice.paidAmount), todayTaipei());
  res.json({ invoiceId, paymentTermId: invoice.paymentTermId, dueDate: invoice.dueDate, ...status });
});

/** 替已經開好的發票換付款條件（或取消分期）。到期日會改成新排程的最後一期。 */
router.put("/payment-terms/invoice/:invoiceId", requireRole(...FINANCE), async (req, res): Promise<void> => {
  const invoiceId = parseId(req.params.invoiceId);
  if (!invoiceId) { res.status(400).json({ error: "格式不正確" }); return; }
  const [invoice] = await db.select().from(invoicesTable).where(eq(invoicesTable.id, invoiceId));
  if (!invoice) { res.status(404).json({ error: "找不到發票" }); return; }
  if (["Cancelled", "WrittenOff"].includes(invoice.status)) { res.status(400).json({ error: "已取消或已列呆帳的發票不能改付款條件" }); return; }
  const termId = req.body?.paymentTermId === null || req.body?.paymentTermId === "" ? null : parseId(req.body?.paymentTermId);
  if (termId === null) {
    if (req.body?.paymentTermId !== null && req.body?.paymentTermId !== "") { res.status(400).json({ error: "付款條件無效" }); return; }
    const [row] = await db.update(invoicesTable).set({ paymentTermId: null, paymentSchedule: null }).where(eq(invoicesTable.id, invoiceId)).returning();
    res.json({ invoiceId, paymentTermId: null, dueDate: row.dueDate, ...scheduleStatus(null, Number(row.paidAmount), todayTaipei()) });
    return;
  }
  const [term] = await db.select().from(paymentTermsTable).where(eq(paymentTermsTable.id, termId));
  if (!term || !term.isActive) { res.status(400).json({ error: "找不到這個付款條件，或已經停用" }); return; }
  const schedule = buildSchedule(Number(invoice.totalAmount), invoice.invoiceDate, term.installments as Installment[]);
  const [row] = await db.update(invoicesTable).set({
    paymentTermId: term.id, paymentSchedule: schedule, dueDate: schedule[schedule.length - 1].dueDate,
  }).where(eq(invoicesTable.id, invoiceId)).returning();
  res.json({ invoiceId, paymentTermId: term.id, dueDate: row.dueDate, ...scheduleStatus(schedule, Number(row.paidAmount), todayTaipei()) });
});

export default router;
