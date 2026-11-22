import { Router, type IRouter } from "express";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { db, changeRequestsTable, approvalRequestsTable, customersTable } from "@workspace/erp-db";
import { requireAuth } from "../middleware/require-auth";
import { isRealDate, listCashAccounts } from "../lib/cash-accounts";
import { todayTaipei } from "../lib/inventory-journal";
import { unbilledOrderReceivables } from "../lib/unbilled-receivables";
import { looseSqlMatch } from "../lib/loose-match";
import { CHANGE_DOC_TYPE } from "../lib/change-review";
import { AGENT_TARGET, submitStaffReceiptReview } from "../mcp/agent-review";
import { documentAttachments, receiptUpload, saveDocumentAttachment, sendAttachment, MAX_ATTACHMENTS_PER_DOCUMENT } from "../lib/document-attachments";

/**
 * 我的申請 › 收款申請（老闆 2026-11-18）：員工收到客戶的款項，從這裡申請開收款單。
 * 送出後不入帳，先給財務確認錢真的進來了；財務核准時，系統用財務的身分開收款單入帳（跟 AI 助理開的是同一套，見 mcp/agent-review）。
 * 員工只看得到、撤回得了自己送的；可以附匯款截圖，財務在審批內容裡看得到。
 */
const router: IRouter = Router();
router.use("/my-receipt-requests", requireAuth);

const me = (req: any) => {
  const user = req.session?.user ?? {};
  return { username: String(user.username || ""), displayName: String(user.displayName || user.username || ""), role: user.role ? String(user.role) : null };
};
const round2 = (n: number) => Math.round(n * 100) / 100;

/** 這是「我的申請」送出的收款申請（不是別種異動申請） */
const isReceiptRequest = (payload: unknown) => {
  const p = (payload ?? {}) as { method?: string; path?: string; body?: { voucherType?: string } };
  return p.method === "POST" && p.path === "/vouchers" && p.body?.voucherType === "收款單";
};

async function ownRequest(id: number, username: string) {
  if (!Number.isInteger(id) || id <= 0 || !username) return null;
  const [row] = await db.select().from(changeRequestsTable)
    .where(and(eq(changeRequestsTable.id, id), eq(changeRequestsTable.targetType, AGENT_TARGET), eq(changeRequestsTable.requestedBy, username)));
  return row && isReceiptRequest(row.payload) ? row : null;
}

/** 表單選項：客戶（打字搜尋）、收到哪個帳戶。只給編號與名稱 */
router.get("/my-receipt-requests/options", async (req, res): Promise<void> => {
  const search = typeof req.query.search === "string" ? req.query.search.trim() : "";
  const match = search ? looseSqlMatch(search, [sql`${customersTable.name}`, sql`COALESCE(${customersTable.shortName}, '')`, sql`COALESCE(${customersTable.customerCode}, '')`]) : undefined;
  const customers = await db.select({ id: customersTable.id, name: customersTable.name, shortName: customersTable.shortName })
    .from(customersTable).where(match ? and(eq(customersTable.isActive, true), match) : eq(customersTable.isActive, true))
    .orderBy(asc(customersTable.name)).limit(30);
  const accounts = (await listCashAccounts(db)).map(a => ({ id: a.id, name: `${a.accountNumber} ${a.accountName}` }));
  res.json({ customers, accounts });
});

/** 這個客戶還沒收齊的銷貨單（可以勾，讓財務知道這筆錢是收哪幾張單） */
router.get("/my-receipt-requests/open-orders", async (req, res): Promise<void> => {
  const customerId = Number(req.query.customerId);
  if (!Number.isInteger(customerId) || customerId <= 0) { res.json([]); return; }
  const orders = await unbilledOrderReceivables(db, customerId);
  res.json(orders.slice(0, 100).map(o => ({ id: o.id, orderNumber: o.orderNumber, orderDate: o.orderDate, label: o.label, outstanding: o.outstanding, projectId: o.projectId })));
});

/** 自己送過的收款申請與審批進度 */
router.get("/my-receipt-requests", async (req, res): Promise<void> => {
  const { username } = me(req);
  const rows = (await db.select().from(changeRequestsTable)
    .where(and(eq(changeRequestsTable.targetType, AGENT_TARGET), eq(changeRequestsTable.requestedBy, username)))
    .orderBy(desc(changeRequestsTable.id)).limit(200)).filter(r => isReceiptRequest(r.payload));
  const approvals = rows.length > 0 ? await db.select().from(approvalRequestsTable)
    .where(and(eq(approvalRequestsTable.documentType, CHANGE_DOC_TYPE), inArray(approvalRequestsTable.documentId, rows.map(r => r.id)))) : [];
  res.json(rows.map(r => {
    const body = ((r.payload as any)?.body ?? {}) as Record<string, any>;
    const original = (r.original ?? {}) as Record<string, any>;
    const approval = approvals.filter(a => a.documentId === r.id).sort((a, b) => b.id - a.id)[0];
    const history = Array.isArray(approval?.approvers) ? (approval!.approvers as any[]) : [];
    const last = history[history.length - 1];
    return {
      id: r.id, requestNumber: r.requestNumber, status: r.status, createdAt: r.createdAt,
      customerName: original.customerName ?? null, amount: Number(original.amount) || 0,
      voucherDate: body.voucherDate ?? null, description: body.description ?? "",
      orders: (Array.isArray(body.items) ? body.items : []).filter((i: any) => i?.orderNumber).map((i: any) => i.orderNumber),
      result: r.result ?? null,
      decidedBy: last?.name ?? null, decisionNote: last?.comments ?? null,
    };
  }));
});

/** 送出收款申請 */
router.post("/my-receipt-requests", async (req, res): Promise<void> => {
  const user = me(req);
  if (!user.username) { res.status(401).json({ error: "請先登入" }); return; }
  const customerId = Number(req.body?.customerId);
  const voucherDate = typeof req.body?.voucherDate === "string" ? req.body.voucherDate : todayTaipei();
  const cashAccountId = req.body?.cashAccountId === undefined || req.body?.cashAccountId === null || req.body?.cashAccountId === "" ? null : Number(req.body.cashAccountId);
  const memo = typeof req.body?.description === "string" ? req.body.description.trim().slice(0, 300) : "";
  const rawLines: any[] = Array.isArray(req.body?.lines) ? req.body.lines : [];
  try {
    if (!Number.isInteger(customerId) || customerId <= 0) throw new Error("請選擇是哪個客戶付的款");
    if (!isRealDate(voucherDate)) throw new Error("請填正確的收款日期");
    if (voucherDate > todayTaipei()) throw new Error("收款日期不能是未來的日子");
    const [customer] = await db.select({ id: customersTable.id, name: customersTable.name }).from(customersTable).where(eq(customersTable.id, customerId));
    if (!customer) throw new Error("找不到這個客戶");
    if (cashAccountId !== null) {
      if (!(await listCashAccounts(db)).some(a => a.id === cashAccountId)) throw new Error("收款帳戶不正確，請重新選擇");
    }
    // 有勾銷貨單：每張單一行；沒勾：整筆一行
    const open = await unbilledOrderReceivables(db, customerId);
    const items: Array<{ description: string; amount: number; salesOrderId?: number; orderNumber?: string }> = [];
    for (const line of rawLines) {
      const amount = round2(Number(line?.amount));
      if (!(amount > 0)) throw new Error("每一筆的金額都要大於 0");
      const orderId = line?.salesOrderId == null || line.salesOrderId === "" ? null : Number(line.salesOrderId);
      if (orderId !== null) {
        const order = open.find(o => o.id === orderId);
        if (!order) throw new Error("勾選的銷貨單不是這個客戶還沒收齊的單，請重新選擇");
        if (amount > round2(order.outstanding) + 0.001) throw new Error(`${order.orderNumber} 只剩 ${order.outstanding} 元沒收，金額不能超過`);
        items.push({ description: `收款 ${order.orderNumber}${order.label ? ` ${order.label}` : ""}`.slice(0, 200), amount, salesOrderId: order.id, orderNumber: order.orderNumber });
      } else {
        items.push({ description: (typeof line?.description === "string" && line.description.trim() ? line.description.trim() : `${customer.name} 收款`).slice(0, 200), amount });
      }
    }
    if (items.length === 0) throw new Error("請填收到的金額");
    if (new Set(items.filter(i => i.salesOrderId).map(i => i.salesOrderId)).size !== items.filter(i => i.salesOrderId).length) throw new Error("同一張銷貨單不要選兩次");
    // 每一筆收入都要歸屬專案：有填就用填的；沒填就用勾選銷貨單的專案（要是同一個）
    const askedProject = Number(req.body?.projectId);
    const orderProjects = [...new Set(items.filter(i => i.salesOrderId).map(i => open.find(o => o.id === i.salesOrderId)?.projectId).filter((id): id is number => typeof id === "number" && id > 0))];
    const projectId = Number.isInteger(askedProject) && askedProject > 0 ? askedProject : orderProjects.length === 1 ? orderProjects[0] : null;
    if (!projectId) throw new Error(orderProjects.length > 1 ? "勾的銷貨單屬於不同專案，請選這筆收款算哪個專案" : "請選這筆收款算哪個專案");
    const amount = round2(items.reduce((s, i) => s + i.amount, 0));
    const body: Record<string, unknown> = {
      voucherType: "收款單", voucherDate, customerId, projectId,
      ...(cashAccountId !== null ? { cashAccountId } : {}),
      description: (memo || `${customer.name} 收款${items.some(i => i.orderNumber) ? `（${items.filter(i => i.orderNumber).map(i => i.orderNumber).join("、")}）` : ""}`).slice(0, 300),
      // orderNumber 只是給審核的人看，開單時系統只認 salesOrderId
      items: items.map(i => ({ description: i.description, amount: i.amount, ...(i.salesOrderId ? { salesOrderId: i.salesOrderId, orderNumber: i.orderNumber } : {}) })),
    };
    const cr: any = await submitStaffReceiptReview({ username: user.username, displayName: user.displayName, role: user.role }, body, { customerName: customer.name, amount }, "我的申請");
    res.status(201).json({ id: cr.id, requestNumber: cr.requestNumber, status: cr.status });
  } catch (err: any) {
    res.status(err?.status || 400).json({ error: err?.message || "送出失敗" });
  }
});

/** 撤回：還沒審的才能撤 */
router.post("/my-receipt-requests/:id/cancel", async (req, res): Promise<void> => {
  const request = await ownRequest(Number(req.params.id), me(req).username);
  if (!request) { res.status(404).json({ error: "找不到這張申請，或這不是你送出的" }); return; }
  if (request.status !== "Pending") { res.status(400).json({ error: "這張申請已經審過了，不能撤回；有問題請找財務" }); return; }
  await db.transaction(async tx => {
    await tx.update(changeRequestsTable).set({ status: "Cancelled", result: "申請人撤回" }).where(and(eq(changeRequestsTable.id, request.id), eq(changeRequestsTable.status, "Pending")));
    await tx.update(approvalRequestsTable).set({ status: "Cancelled" })
      .where(and(eq(approvalRequestsTable.documentType, CHANGE_DOC_TYPE), eq(approvalRequestsTable.documentId, request.id), eq(approvalRequestsTable.status, "Pending")));
  });
  res.json({ ok: true });
});

/** 匯款截圖、收據：財務在審批內容裡看得到 */
router.get("/my-receipt-requests/:id/attachments", async (req, res): Promise<void> => {
  const request = await ownRequest(Number(req.params.id), me(req).username);
  if (!request) { res.status(404).json({ error: "找不到這張申請，或這不是你送出的" }); return; }
  res.json(await documentAttachments(CHANGE_DOC_TYPE, request.id));
});

router.post("/my-receipt-requests/:id/attachments", receiptUpload.array("files", MAX_ATTACHMENTS_PER_DOCUMENT), async (req, res): Promise<void> => {
  const { username } = me(req);
  const request = await ownRequest(Number(req.params.id), username);
  if (!request) { res.status(404).json({ error: "找不到這張申請，或這不是你送出的" }); return; }
  if (request.status !== "Pending") { res.status(400).json({ error: "這張申請已經審過了，不能再補附件" }); return; }
  const files = (req.files as Express.Multer.File[] | undefined) ?? [];
  if (files.length === 0) { res.status(400).json({ error: "請選擇要上傳的照片或 PDF" }); return; }
  const existing = await documentAttachments(CHANGE_DOC_TYPE, request.id);
  if (existing.length + files.length > MAX_ATTACHMENTS_PER_DOCUMENT) { res.status(400).json({ error: `一張申請最多 ${MAX_ATTACHMENTS_PER_DOCUMENT} 個附件，已經有 ${existing.length} 個` }); return; }
  for (const file of files) {
    try {
      await saveDocumentAttachment(file, { module: "Accounting", documentType: CHANGE_DOC_TYPE, documentId: request.id, uploadedBy: username, description: `${request.requestNumber} 收款證明` });
    } catch {
      res.status(502).json({ error: `「${file.originalname}」上傳失敗，請再試一次` }); return;
    }
  }
  res.status(201).json(await documentAttachments(CHANGE_DOC_TYPE, request.id));
});

router.get("/my-receipt-requests/:id/attachments/:attachmentId", async (req, res): Promise<void> => {
  const request = await ownRequest(Number(req.params.id), me(req).username);
  const attachmentId = Number(req.params.attachmentId);
  const list = request ? await documentAttachments(CHANGE_DOC_TYPE, request.id) : [];
  if (!list.some(a => a.id === attachmentId)) { res.status(404).json({ error: "找不到這個附件" }); return; }
  await sendAttachment(res, attachmentId);
});

export default router;
