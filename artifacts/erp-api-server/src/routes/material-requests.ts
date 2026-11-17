import { Router, type IRouter } from "express";
import { desc, eq, inArray } from "drizzle-orm";
import { db, materialRequestsTable, itemsTable, projectsTable, purchaseOrdersTable, notificationsTable, type MaterialRequestItem } from "@workspace/erp-db";
import { requireAuth, requireRole } from "../middleware/require-auth";
import { nextDocNumber } from "../lib/doc-number";
import { todayTaipei } from "../lib/inventory-journal";
import { isRealDate } from "../lib/cash-accounts";

const router: IRouter = Router();
router.use("/material-requests", requireAuth);
// 核准請購等於同意花錢，只給主管與財務
const APPROVERS = ["owner", "admin", "manager", "finance_admin"] as const;

const parseId = (value: unknown): number | null => {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
};

router.get("/material-requests", async (req, res): Promise<void> => {
  const rows = await db.select({ request: materialRequestsTable, projectName: projectsTable.name, orderNumber: purchaseOrdersTable.orderNumber })
    .from(materialRequestsTable)
    .leftJoin(projectsTable, eq(projectsTable.id, materialRequestsTable.projectId))
    .leftJoin(purchaseOrdersTable, eq(purchaseOrdersTable.id, materialRequestsTable.purchaseOrderId))
    .where(req.query.status ? eq(materialRequestsTable.status, String(req.query.status)) : undefined)
    .orderBy(desc(materialRequestsTable.id)).limit(500);
  res.json(rows.map(r => ({ ...r.request, projectName: r.projectName, purchaseOrderNumber: r.orderNumber })));
});

router.post("/material-requests", async (req, res): Promise<void> => {
  const body = req.body || {};
  const projectId = parseId(body.projectId);
  if (!projectId) { res.status(400).json({ error: "請選擇專案：每一筆支出都必須歸屬到專案" }); return; }
  const requestDate = body.requestDate || todayTaipei();
  if (!isRealDate(requestDate)) { res.status(400).json({ error: "日期格式不正確" }); return; }
  if (body.neededBy && !isRealDate(body.neededBy)) { res.status(400).json({ error: "需要日期格式不正確" }); return; }
  if (body.neededBy && body.neededBy < requestDate) { res.status(400).json({ error: "需要日期不能早於請購日期" }); return; }
  const input = Array.isArray(body.items) ? body.items : [];
  if (input.length === 0) { res.status(400).json({ error: "至少要有一個品項" }); return; }
  for (const item of input) {
    if (!parseId(item?.itemId)) { res.status(400).json({ error: "品項無效" }); return; }
    if (!(Number(item?.quantity) > 0)) { res.status(400).json({ error: "數量必須大於 0" }); return; }
  }
  const itemIds = [...new Set<number>(input.map((i: any) => Number(i.itemId)))];
  if (itemIds.length !== input.length) { res.status(400).json({ error: "同一個品項請合併成一列" }); return; }
  try {
    const created = await db.transaction(async (tx) => {
      const [project] = await tx.select({ id: projectsTable.id }).from(projectsTable).where(eq(projectsTable.id, projectId));
      if (!project) throw new Error("找不到這個專案");
      const found = await tx.select({ id: itemsTable.id, itemName: itemsTable.itemName }).from(itemsTable).where(inArray(itemsTable.id, itemIds));
      if (found.length !== itemIds.length) throw new Error("有品項已經不存在");
      const nameById = new Map<number, string>(found.map((i: { id: number; itemName: string }) => [i.id, i.itemName]));
      const items: MaterialRequestItem[] = input.map((i: any) => ({
        itemId: Number(i.itemId), itemName: nameById.get(Number(i.itemId)) || "", quantity: Number(i.quantity),
        note: typeof i.note === "string" ? i.note.trim().slice(0, 100) : "",
      }));
      const requestNumber = await nextDocNumber(tx, "material_requests", "request_number", "MR", () => `MR-${String(Date.now()).slice(-8)}`, requestDate);
      const username = req.session?.user?.username || "api";
      const [row] = await tx.insert(materialRequestsTable).values({
        requestNumber, requestDate, neededBy: body.neededBy || null, projectId,
        departmentId: parseId(body.departmentId),
        requesterName: typeof body.requesterName === "string" && body.requesterName.trim() ? body.requesterName.trim().slice(0, 40) : username,
        items, reason: typeof body.reason === "string" ? body.reason.trim().slice(0, 300) || null : null,
        createdBy: username,
      }).returning();
      await tx.insert(notificationsTable).values({
        title: "新的請購單", message: `${requestNumber}（${row.requesterName}）：${items.map(i => `${i.itemName} × ${i.quantity}`).join("、").slice(0, 200)}`,
        type: "approval", module: "Purchasing", documentType: "MaterialRequest", documentId: row.id,
      } as any);
      return row;
    });
    res.status(201).json(created);
  } catch (err: any) {
    res.status(400).json({ error: err?.message || "送出失敗" });
  }
});

/** 核准或退回 */
router.post("/material-requests/:id/review", requireRole(...APPROVERS), async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  const decision = req.body?.decision === "approve" ? "Approved" : req.body?.decision === "reject" ? "Rejected" : null;
  if (!id || !decision) { res.status(400).json({ error: "格式不正確" }); return; }
  const note = typeof req.body?.note === "string" ? req.body.note.trim().slice(0, 200) || null : null;
  if (decision === "Rejected" && !note) { res.status(400).json({ error: "請填寫退回原因" }); return; }
  const [existing] = await db.select().from(materialRequestsTable).where(eq(materialRequestsTable.id, id));
  if (!existing) { res.status(404).json({ error: "找不到這張請購單" }); return; }
  if (existing.status !== "Submitted") { res.status(400).json({ error: "只有待核准的請購單可以核准或退回" }); return; }
  const [row] = await db.update(materialRequestsTable).set({ status: decision, reviewedBy: req.session?.user?.username || "api", reviewNote: note })
    .where(eq(materialRequestsTable.id, id)).returning();
  res.json(row);
});

/** 採購單建立之後呼叫，把請購單標成已轉採購 */
router.post("/material-requests/:id/ordered", requireRole(...APPROVERS, "accountant"), async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  const purchaseOrderId = parseId(req.body?.purchaseOrderId);
  if (!id || !purchaseOrderId) { res.status(400).json({ error: "格式不正確" }); return; }
  const [existing] = await db.select().from(materialRequestsTable).where(eq(materialRequestsTable.id, id));
  if (!existing) { res.status(404).json({ error: "找不到這張請購單" }); return; }
  if (existing.status !== "Approved") { res.status(400).json({ error: "只有已核准的請購單可以轉採購" }); return; }
  const [order] = await db.select({ id: purchaseOrdersTable.id }).from(purchaseOrdersTable).where(eq(purchaseOrdersTable.id, purchaseOrderId));
  if (!order) { res.status(400).json({ error: "找不到這張採購單" }); return; }
  const [row] = await db.update(materialRequestsTable).set({ status: "Ordered", purchaseOrderId }).where(eq(materialRequestsTable.id, id)).returning();
  res.json(row);
});

router.post("/material-requests/:id/cancel", async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  if (!id) { res.status(400).json({ error: "格式不正確" }); return; }
  const [existing] = await db.select().from(materialRequestsTable).where(eq(materialRequestsTable.id, id));
  if (!existing) { res.status(404).json({ error: "找不到這張請購單" }); return; }
  if (!["Submitted", "Approved"].includes(existing.status)) { res.status(400).json({ error: "這張請購單已經結束，不能取消" }); return; }
  const user = req.session?.user;
  const isApprover = (APPROVERS as readonly string[]).includes(user?.role || "");
  if (!isApprover && existing.createdBy !== user?.username) { res.status(403).json({ error: "只能取消自己提出的請購單" }); return; }
  const [row] = await db.update(materialRequestsTable).set({ status: "Cancelled" }).where(eq(materialRequestsTable.id, id)).returning();
  res.json(row);
});

export default router;
