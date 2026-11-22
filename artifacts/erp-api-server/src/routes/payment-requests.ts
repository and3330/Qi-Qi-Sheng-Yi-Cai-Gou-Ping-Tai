import { Router, type IRouter } from "express";
import { nextDocNumber } from "../lib/doc-number";
import { desc, eq, and, sql } from "drizzle-orm";
import { db, paymentRequestsTable, invoicesTable, invoiceSettlementsTable, customersTable, suppliersTable, activitiesTable, notificationsTable, journalEntriesTable, approvalRequestsTable } from "@workspace/erp-db";
import { createApprovalRequest, approvalBlockReason } from "../utils/approval-helper";
import { recomputeInvoices } from "../lib/invoice-sync";
import { requireAuth } from "../middleware/require-auth";
import { postAutoJournal, todayTaipei } from "../lib/inventory-journal";
import { cashLineAccount, isRealDate, leafAccount, parseActualCash } from "../lib/cash-accounts";
import { partyLineText, requestLines } from "../lib/voucher-entry-text";
import { approvalProgress, requestContent } from "./my-requests";
import { documentAttachments, sendAttachment } from "../lib/document-attachments";
import { registerChangeHandler, submitChangeRequest } from "../lib/change-requests";
import { assertPeriodOpen } from "../lib/auto-journal";
import { machineOnly } from "../lib/api-key-user";

/** 誰可以做哪個動作：核准、駁回要主管以上；付款（會動到帳）只有財務 */
const APPROVE_ROLES = ["owner", "admin", "finance_admin", "manager"];
const PAY_ROLES = ["owner", "admin", "finance_admin", "accountant"];
function hasRole(req: any, roles: string[]): boolean {
  if (machineOnly(req)) return true;
  const role = req.session?.user?.role;
  return role === "super_admin" || roles.includes(role);
}

const router: IRouter = Router();
router.use("/payment-requests", requireAuth);

function generatePRQNumber(): string {
  return "PRQ-" + String(Date.now()).slice(-8);
}

const VALID_TRANSITIONS: Record<string, string[]> = {
  Draft: ["Pending", "Cancelled"],
  Pending: ["Approved", "Rejected", "Cancelled"],
  Approved: ["Paid", "Cancelled"],
  Paid: [],
  Rejected: ["Draft"],
  Cancelled: [],
  Voided: [],
};

router.get("/payment-requests", async (req, res): Promise<void> => {
  const { status, partyType } = req.query as { status?: string; partyType?: string };
  const conditions = [];
  if (status) conditions.push(eq(paymentRequestsTable.status, status));
  if (partyType) conditions.push(eq(paymentRequestsTable.partyType, partyType));

  const requests = await db
    .select({
      id: paymentRequestsTable.id, requestNumber: paymentRequestsTable.requestNumber,
      invoiceId: paymentRequestsTable.invoiceId, partyType: paymentRequestsTable.partyType,
      customerId: paymentRequestsTable.customerId, customerName: customersTable.name,
      supplierId: paymentRequestsTable.supplierId, supplierName: suppliersTable.name,
      requestDate: paymentRequestsTable.requestDate, dueDate: paymentRequestsTable.dueDate,
      amount: paymentRequestsTable.amount, status: paymentRequestsTable.status,
      paymentMethod: paymentRequestsTable.paymentMethod, bankAccount: paymentRequestsTable.bankAccount,
      remarks: paymentRequestsTable.remarks, createdAt: paymentRequestsTable.createdAt, requestedBy: paymentRequestsTable.requestedBy,
      projectId: paymentRequestsTable.projectId, departmentId: paymentRequestsTable.departmentId,
      projectName: sql<string | null>`(SELECT name FROM projects WHERE id = "payment_requests"."project_id")`,
      departmentName: sql<string | null>`(SELECT name FROM departments WHERE id = "payment_requests"."department_id")`,
    })
    .from(paymentRequestsTable)
    .leftJoin(customersTable, eq(paymentRequestsTable.customerId, customersTable.id))
    .leftJoin(suppliersTable, eq(paymentRequestsTable.supplierId, suppliersTable.id))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(paymentRequestsTable.requestDate), desc(paymentRequestsTable.id));

  res.json(requests.map(r => ({ ...r, amount: Number(r.amount) })));
});

router.post("/payment-requests", async (req, res): Promise<void> => {
  const { invoiceId, partyType, customerId, supplierId, requestDate, dueDate, amount, paymentMethod, bankAccount, remarks, departmentId, projectId } = req.body;
  if (!partyType || !requestDate || !amount) {
    res.status(400).json({ error: "缺少必填欄位 (partyType, requestDate, amount)" }); return;
  }
  if (!Number.isFinite(Number(amount)) || Number(amount) <= 0) {
    res.status(400).json({ error: "金額必須為正數" }); return;
  }
  if (!["Customer", "Supplier"].includes(partyType)) { res.status(400).json({ error: "對象類型無效" }); return; }
  if (!isRealDate(requestDate)) { res.status(400).json({ error: "請填寫正確的申請日期" }); return; }
  if (dueDate && !isRealDate(dueDate)) { res.status(400).json({ error: "到期日格式不正確" }); return; }

  if (partyType === "Customer" && !customerId) {
    res.status(400).json({ error: "客戶類型必須指定客戶" }); return;
  }
  if (partyType === "Supplier" && !supplierId) {
    res.status(400).json({ error: "供應商類型必須指定供應商" }); return;
  }

  if (invoiceId) {
    const [inv] = await db.select().from(invoicesTable).where(eq(invoicesTable.id, invoiceId));
    if (!inv) { res.status(400).json({ error: "發票不存在" }); return; }
    if (partyType === "Customer" && inv.invoiceType !== "Sales" && inv.invoiceType !== "Credit Note") {
      res.status(400).json({ error: "客戶付款申請僅能關聯銷售發票" }); return;
    }
    if (partyType === "Supplier" && inv.invoiceType !== "Purchase" && inv.invoiceType !== "Debit Note") {
      res.status(400).json({ error: "供應商付款申請僅能關聯採購發票" }); return;
    }
    // 金額不可超過發票未結金額（含其他未付款完成的申請單）
    const outstanding = Number(inv.outstandingAmount);
    const [{ pending }] = await db
      .select({ pending: sql<string>`COALESCE(SUM(amount), 0)` })
      .from(paymentRequestsTable)
      .where(and(
        eq(paymentRequestsTable.invoiceId, invoiceId),
        sql`status NOT IN ('Paid', 'Cancelled', 'Rejected')`,
      ));
    const available = Math.round((outstanding - Number(pending)) * 100) / 100;
    if (Number(amount) > available + 0.001) {
      res.status(400).json({ error: `金額 $${Number(amount).toFixed(2)} 超過發票可申請餘額 $${available.toFixed(2)}（未結 $${outstanding.toFixed(2)}，已有申請中 $${Number(pending).toFixed(2)}）` });
      return;
    }
  }

  if (partyType === "Customer" && customerId) {
    const [c] = await db.select({ id: customersTable.id }).from(customersTable).where(eq(customersTable.id, customerId));
    if (!c) { res.status(400).json({ error: "客戶不存在" }); return; }
  }
  if (partyType === "Supplier" && supplierId) {
    const [s] = await db.select({ id: suppliersTable.id }).from(suppliersTable).where(eq(suppliersTable.id, supplierId));
    if (!s) { res.status(400).json({ error: "供應商不存在" }); return; }
  }

  // 老闆或管理員可以「代別人」建立：申請人記成真正的提案人（否則自己建的自己不能審）。
  // deferApproval：先存成草稿、還不進審批清單，等按「送審」時才產生審批請求。
  const privileged = hasRole(req, ["owner", "admin"]);
  const onBehalfOf = privileged && typeof req.body.onBehalfOf === "string" && req.body.onBehalfOf.trim() ? req.body.onBehalfOf.trim().slice(0, 60) : null;
  const deferApproval = privileged && req.body.deferApproval === true;
  const requestedBy = onBehalfOf || (req as any).session?.user?.username || "API";

  const [request] = await db.insert(paymentRequestsTable).values({
    requestNumber: await nextDocNumber(db, "payment_requests", "request_number", "PRQ", generatePRQNumber),
    invoiceId: invoiceId || null,
    partyType,
    customerId: partyType === "Customer" ? customerId : null,
    supplierId: partyType === "Supplier" ? supplierId : null,
    requestDate,
    dueDate: dueDate || null,
    amount: String(amount),
    departmentId: departmentId ? Number(departmentId) : null,
    projectId: projectId ? Number(projectId) : null,
    paymentMethod: paymentMethod || null,
    bankAccount: bankAccount || null,
    remarks: remarks || null,
    requestedBy,
  }).returning();

  const partyName = partyType === "Customer"
    ? (customerId ? (await db.select({ name: customersTable.name }).from(customersTable).where(eq(customersTable.id, customerId)))[0]?.name : null)
    : (supplierId ? (await db.select({ name: suppliersTable.name }).from(suppliersTable).where(eq(suppliersTable.id, supplierId)))[0]?.name : null);

  await db.insert(activitiesTable).values({
    type: "create", title: "付款申請已建立",
    description: `${request.requestNumber} - ${partyName || "對象"} - $${Number(amount).toFixed(2)}`,
    module: "Accounting",
  });

  if (!deferApproval) {
    await createApprovalRequest({
      module: "Accounting",
      documentType: "PaymentRequest",
      documentId: request.id,
      documentNumber: request.requestNumber,
      requestedBy,
    });
    await db.insert(notificationsTable).values({
      title: "新付款申請",
      message: `${request.requestNumber} - ${partyName || "對象"} - $${Number(amount).toFixed(2)}`,
      type: "approval",
      module: "Accounting",
      documentType: "PaymentRequest",
      documentId: request.id,
    });
  }

  res.status(201).json({ ...request, amount: Number(request.amount), customerName: null, supplierName: null });
});

router.get("/payment-requests/:id", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "付款申請編號格式不正確" }); return; }
  const [request] = await db
    .select({
      id: paymentRequestsTable.id, requestNumber: paymentRequestsTable.requestNumber,
      invoiceId: paymentRequestsTable.invoiceId, partyType: paymentRequestsTable.partyType,
      customerId: paymentRequestsTable.customerId, customerName: customersTable.name,
      supplierId: paymentRequestsTable.supplierId, supplierName: suppliersTable.name,
      requestDate: paymentRequestsTable.requestDate, dueDate: paymentRequestsTable.dueDate,
      amount: paymentRequestsTable.amount, status: paymentRequestsTable.status,
      paymentMethod: paymentRequestsTable.paymentMethod, bankAccount: paymentRequestsTable.bankAccount,
      remarks: paymentRequestsTable.remarks, createdAt: paymentRequestsTable.createdAt, requestedBy: paymentRequestsTable.requestedBy,
      projectId: paymentRequestsTable.projectId, departmentId: paymentRequestsTable.departmentId,
      projectName: sql<string | null>`(SELECT name FROM projects WHERE id = "payment_requests"."project_id")`,
      departmentName: sql<string | null>`(SELECT name FROM departments WHERE id = "payment_requests"."department_id")`,
      metadata: paymentRequestsTable.metadata,
    })
    .from(paymentRequestsTable)
    .leftJoin(customersTable, eq(paymentRequestsTable.customerId, customersTable.id))
    .leftJoin(suppliersTable, eq(paymentRequestsTable.supplierId, suppliersTable.id))
    .where(eq(paymentRequestsTable.id, id));
  if (!request) { res.status(404).json({ error: "找不到付款申請" }); return; }
  // 跟「我的申請」開的是同一個畫面：每一行付給誰、類型、備註、審批進度一起給
  const { metadata, ...rest } = request;
  const progress = await approvalProgress([id]);
  res.json({ ...rest, amount: Number(request.amount), ...requestContent(metadata), approval: progress.get(id) ?? null });
});

/** 這張申請的收據、發票照片（財務和審批的人看；申請人自己從「我的申請」看） */
router.get("/payment-requests/:id/attachments", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) { res.status(400).json({ error: "付款申請編號格式不正確" }); return; }
  const [row] = await db.select({ metadata: paymentRequestsTable.metadata }).from(paymentRequestsTable).where(eq(paymentRequestsTable.id, id));
  if (!row) { res.status(404).json({ error: "找不到付款申請" }); return; }
  res.json(await documentAttachments("PaymentRequest", id, Number((row.metadata as any)?.voucherId) || null));
});
router.get("/payment-requests/:id/attachments/:attachmentId", async (req, res): Promise<void> => {
  const id = Number(req.params.id), attachmentId = Number(req.params.attachmentId);
  if (!Number.isInteger(id) || id <= 0 || !Number.isInteger(attachmentId) || attachmentId <= 0) { res.status(400).json({ error: "編號格式不正確" }); return; }
  const [row] = await db.select({ metadata: paymentRequestsTable.metadata }).from(paymentRequestsTable).where(eq(paymentRequestsTable.id, id));
  const list = row ? await documentAttachments("PaymentRequest", id, Number((row.metadata as any)?.voucherId) || null) : [];
  if (!list.some(a => a.id === attachmentId)) { res.status(404).json({ error: "找不到這個附件" }); return; }
  await sendAttachment(res, attachmentId);
});

router.patch("/payment-requests/:id", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "付款申請編號格式不正確" }); return; }

  const [existing] = await db.select().from(paymentRequestsTable).where(eq(paymentRequestsTable.id, id));
  if (!existing) { res.status(404).json({ error: "找不到付款申請" }); return; }

  const { status, remarks, paymentMethod, bankAccount, dueDate, amount } = req.body;
  const updateData: Record<string, unknown> = {};

  if (status) {
    const allowed = VALID_TRANSITIONS[existing.status] || [];
    if (!allowed.includes(status)) {
      res.status(400).json({ error: `無法從「${existing.status}」轉換為「${status}」` }); return;
    }
    if ((status === "Approved" || status === "Rejected") && !hasRole(req, APPROVE_ROLES)) {
      res.status(403).json({ error: "只有主管或財務可以核准、駁回付款申請" }); return;
    }
    if (status === "Paid" && !hasRole(req, PAY_ROLES)) {
      res.status(403).json({ error: "只有財務人員可以執行付款" }); return;
    }
    // 有設定審批流程時，核准要在「審批請求」裡做，不能在這裡直接改
    if (status === "Approved") {
      const blocked = await approvalBlockReason(db, "PaymentRequest", id);
      if (blocked) { res.status(400).json({ error: blocked + "（請到「審批請求」處理）" }); return; }
    }
    updateData.status = status;
  }

  if (existing.status === "Draft" || existing.status === "Rejected") {
    if (paymentMethod !== undefined) updateData.paymentMethod = paymentMethod;
    if (bankAccount !== undefined) updateData.bankAccount = bankAccount;
    if (dueDate !== undefined) updateData.dueDate = dueDate;
    if (amount !== undefined) {
      if (!Number.isFinite(Number(amount)) || Number(amount) <= 0) {
        res.status(400).json({ error: "金額必須為正數" }); return;
      }
      updateData.amount = String(amount);
    }
  }

  // 已作廢、已取消的單是結束的紀錄，內容不能再改（已核准、已付款的改備註要送審，由前面的送審關卡處理）
  if (remarks !== undefined && (existing.status === "Voided" || existing.status === "Cancelled") && String(remarks ?? "") !== String(existing.remarks ?? "")) {
    res.status(400).json({ error: `這張申請已經${existing.status === "Voided" ? "作廢" : "取消"}，內容不能再改` }); return;
  }
  if (remarks !== undefined) updateData.remarks = remarks;

  let updated;
  try {
    updated = await db.transaction(async (tx) => {
      // 鎖定申請單列並重新驗證狀態，防止並發重複付款
      const [locked] = await tx.select().from(paymentRequestsTable).where(eq(paymentRequestsTable.id, id)).for("update");
      if (!locked) throw new Error("Not found");
      if (status) {
        const allowedNow = VALID_TRANSITIONS[locked.status] || [];
        if (!allowedNow.includes(status)) throw new Error(`無法從「${locked.status}」轉換為「${status}」`);
      }
      const [row] = await tx.update(paymentRequestsTable).set(updateData).where(eq(paymentRequestsTable.id, id)).returning();
      if (status === "Pending") {
        const [hasApproval] = await tx.select({ id: approvalRequestsTable.id }).from(approvalRequestsTable)
          .where(and(eq(approvalRequestsTable.documentType, "PaymentRequest"), eq(approvalRequestsTable.documentId, id))).limit(1);
        if (!hasApproval) {
          await createApprovalRequest({
            module: "Accounting", documentType: "PaymentRequest", documentId: id, documentNumber: row.requestNumber,
            requestedBy: (typeof req.body?.onBehalfOf === "string" && hasRole(req, ["owner", "admin"]) && req.body.onBehalfOf.trim()) || (req as any).session?.user?.username || "API",
          }, tx);
        }
      }
      if (status === "Paid" && existing.invoiceId) {
        // 透過沖帳紀錄結算，發票金額由 settlements 重算，避免直接改寫
        const [inv] = await tx.select().from(invoicesTable).where(eq(invoicesTable.id, existing.invoiceId)).for("update");
        if (!inv) throw new Error("關聯發票不存在");
        const paidAmt = Number(row.amount);
        if (paidAmt > Number(inv.outstandingAmount) + 0.001) {
          throw new Error(`付款金額 $${paidAmt.toFixed(2)} 超過發票未結金額 $${Number(inv.outstandingAmount).toFixed(2)}`);
        }
        await tx.insert(invoiceSettlementsTable).values({
          paymentRequestId: id,
          invoiceId: existing.invoiceId,
          amount: String(paidAmt),
          remarks: `付款申請 ${row.requestNumber} 付款`,
        });
        await recomputeInvoices(tx, [existing.invoiceId]);
      }
      if (status === "Paid") {
        // 付款完成同步入帳，否則發票標成已付、帳上的應付（應收）與銀行存款卻沒動。
        // 對供應商：借 應付帳款／貸 現金/銀行；對客戶（收款）：借 現金/銀行／貸 應收帳款
        const amount = Number(row.amount);
        const isCustomer = row.partyType === "customer" || row.partyType === "Customer";
        const cashAccount = await cashLineAccount(tx, req.body?.cashAccountId);
        // 有對應發票：沖應付（應收）。沒有發票：帳上本來就沒有應付可沖，
        // 付款要直接記到費用（或預付）科目，收款記到預收款，否則應付帳款會變成負數。
        const counter = existing.invoiceId
          ? { accountName: isCustomer ? "應收帳款" : "應付帳款" }
          : req.body?.counterAccountId
            ? await leafAccount(tx, req.body.counterAccountId, isCustomer ? "收入或預收科目" : "費用科目", isCustomer ? ["Income", "Liability"] : ["Expense", "Asset"])
            : { accountName: isCustomer ? "預收款項" : "費用" };
        const counterLine = "accountId" in counter
          ? { accountId: counter.accountId, accountNumber: counter.accountNumber, accountName: counter.accountName }
          : counter;
        // 實際進出的台幣和帳上的應付（應收）不同（外幣貨款換匯去付）：差額記兌換損益。只有沖發票的付款才有
        const actualCash = parseActualCash(req.body?.actualCashAmount, existing.invoiceId ? amount : 0) ?? amount;
        const fx = Math.round((actualCash - amount) * 100) / 100;
        // 付款多付、收款少收是損失；反過來是利益
        const loss = isCustomer ? -fx : fx;
        const fxLine = fx === 0 ? []
          : loss > 0 ? [{ accountName: "兌換損失", debit: loss, credit: 0, description: `${row.requestNumber} 兌換損失` }]
            : [{ accountName: "兌換利益", debit: 0, credit: -loss, description: `${row.requestNumber} 兌換利益` }];
        await postAutoJournal(tx, {
          key: `PQ${id}`,
          entryDate: todayTaipei(),
          description: `自動分錄 - 付款申請 ${row.requestNumber} ${isCustomer ? "收款" : "付款"}`,
          action: "付款申請付款",
          departmentId: row.departmentId ?? null,
          projectId: row.projectId ?? null,
          // 「我的申請」送來的單，每一行有自己的付款對象和摘要：每行各一組借貸，摘要就是那一行的摘要
          lines: !isCustomer && !existing.invoiceId && requestLines(existing.metadata, amount).length > 0
            ? requestLines(existing.metadata, amount).flatMap(line => {
              const text = partyLineText(line.payee, line.summary, "付款");
              return [
                { ...counterLine, debit: line.amount, credit: 0, description: text },
                { ...cashAccount, debit: 0, credit: line.amount, description: text },
              ];
            })
            : isCustomer
            ? [
              { ...cashAccount, debit: actualCash, credit: 0, description: `${row.requestNumber} 收款` },
              { ...counterLine, debit: 0, credit: amount, description: `${row.requestNumber} ${existing.invoiceId ? "沖銷應收" : "收款"}` },
              ...fxLine,
            ]
            : [
              { ...counterLine, debit: amount, credit: 0, description: `${row.requestNumber} ${existing.invoiceId ? "沖銷應付" : "付款"}` },
              { ...cashAccount, debit: 0, credit: actualCash, description: `${row.requestNumber} 付款` },
              ...fxLine,
            ],
        });
      }
      return row;
    });
  } catch (err: any) {
    res.status(400).json({ error: err.message || "更新失敗" }); return;
  }

  res.json({ ...updated, amount: Number(updated.amount) });
});

/**
 * 作廢已付款的申請（付錯對象、付錯金額）：
 * 原本的付款分錄留著，另開一張借貸相反的沖銷分錄；對發票的沖帳取消，發票回到未付。
 */
router.post("/payment-requests/:id/void", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) { res.status(400).json({ error: "付款申請編號格式不正確" }); return; }
  if (!hasRole(req, PAY_ROLES)) { res.status(403).json({ error: "只有財務人員可以作廢已付款的申請" }); return; }
  const reason = typeof req.body?.reason === "string" ? req.body.reason.trim().slice(0, 200) : "";
  if (!reason) { res.status(400).json({ error: "請填寫作廢原因" }); return; }
  try {
    const voided = await db.transaction(async (tx) => {
      const [existing] = await tx.select().from(paymentRequestsTable).where(eq(paymentRequestsTable.id, id)).for("update");
      if (!existing) throw Object.assign(new Error("找不到付款申請"), { status: 404 });
      if (existing.status !== "Paid") throw new Error("只有已付款的申請可以作廢；還沒付款的請直接取消");
      const voidDate = todayTaipei();
      const originals = await tx.select().from(journalEntriesTable)
        .where(and(sql`${journalEntriesTable.entryNumber} LIKE ${"%-PQ" + id}`, eq(journalEntriesTable.status, "Posted")));
      for (const original of originals) {
        const lines = (Array.isArray(original.lines) ? (original.lines as any[]) : []).map(line => ({ ...line, debit: Number(line.credit) || 0, credit: Number(line.debit) || 0 }));
        await postAutoJournal(tx, {
          key: `PQV${id}`,
          entryDate: voidDate,
          description: `作廢沖銷 - 付款申請 ${existing.requestNumber}：${reason}`,
          action: "作廢付款申請",
          projectId: original.projectId, departmentId: original.departmentId,
          lines,
        });
        await tx.update(journalEntriesTable).set({ status: "Reversed" }).where(eq(journalEntriesTable.id, original.id));
      }
      await tx.delete(invoiceSettlementsTable).where(eq(invoiceSettlementsTable.paymentRequestId, id));
      if (existing.invoiceId) await recomputeInvoices(tx, [existing.invoiceId]);
      const [row] = await tx.update(paymentRequestsTable).set({
        status: "Voided",
        remarks: [existing.remarks, `〔作廢 ${req.session?.user?.username || "API"}〕${reason}`].filter(Boolean).join("；"),
      }).where(eq(paymentRequestsTable.id, id)).returning();
      await tx.insert(activitiesTable).values({ type: "update", title: "付款申請作廢", description: `${existing.requestNumber} - ${reason}`, module: "Accounting" });
      return row;
    });
    res.json({ ...voided, amount: Number(voided.amount) });
  } catch (err: any) {
    res.status(Number(err?.status) || 400).json({ error: err?.message || "作廢失敗" });
  }
});

/** 這張付款申請開出來的所有分錄：付款分錄、作廢沖銷分錄，以及有人在日記帳對它們按沖銷開的分錄 */
async function requestEntries(executor: any, id: number) {
  const own = await executor.select().from(journalEntriesTable)
    .where(sql`${journalEntriesTable.entryNumber} LIKE ${"%-PQ" + id} OR ${journalEntriesTable.entryNumber} LIKE ${"%-PQV" + id}`);
  const out = [...own];
  for (const e of own) {
    const reversals = await executor.select().from(journalEntriesTable).where(sql`${journalEntriesTable.entryNumber} LIKE ${`JE-R${e.id}-%`}`);
    out.push(...reversals);
  }
  return out;
}

// 申請刪除付款申請（老闆 2026-11-16：從原單申請刪除，核准後單和分錄一起刪）。草稿可以直接刪，不用走這裡
router.post("/payment-requests/:id/delete-request", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) { res.status(400).json({ error: "付款申請編號格式不正確" }); return; }
  if (!hasRole(req, PAY_ROLES)) { res.status(403).json({ error: "只有財務人員可以申請刪除付款申請" }); return; }
  try {
    const [existing] = await db.select().from(paymentRequestsTable).where(eq(paymentRequestsTable.id, id));
    if (!existing) throw Object.assign(new Error("找不到付款申請"), { status: 404 });
    if (existing.status === "Draft") throw new Error("草稿可以直接刪除，不用送申請");
    if (existing.status === "Pending") throw new Error("這張還在審批中，請先駁回或請申請人撤回");
    const voucherId = Number((existing.metadata as any)?.voucherId) || 0;
    if (voucherId) throw new Error("這張申請是請款單開出來的，請到那張請款單申請刪除，這張會一起處理");
    const entries = await requestEntries(db, id);
    for (const e of entries) await assertPeriodOpen(db, e.entryDate, "刪除付款申請");
    const user = req.session?.user;
    const { changeRequest, autoApplied } = await db.transaction(tx => submitChangeRequest(tx, {
      kind: "delete", targetType: "payment_request", targetId: id, targetNumber: existing.requestNumber,
      title: `刪除付款申請 ${existing.requestNumber}`,
      original: { requestNumber: existing.requestNumber, requestDate: existing.requestDate, amount: Number(existing.amount), status: existing.status, remarks: existing.remarks,
        entries: entries.map((e: any) => ({ id: e.id, entryNumber: e.entryNumber, entryDate: e.entryDate, description: e.description, totalDebit: e.totalDebit })) },
      reason: String(req.body?.reason ?? ""),
    }, { username: user?.username || "API", role: user?.role ?? null }));
    res.status(autoApplied ? 200 : 202).json(autoApplied ? { applied: true, requestNumber: changeRequest.requestNumber, message: autoApplied } : { pending: true, requestNumber: changeRequest.requestNumber });
  } catch (err: any) { res.status(Number(err?.status) || 400).json({ error: err?.message || "送出刪除申請失敗" }); }
});

registerChangeHandler("payment_request", "delete", async (tx, cr) => {
  const id = cr.targetId ?? 0;
  const [existing] = await tx.select().from(paymentRequestsTable).where(eq(paymentRequestsTable.id, id)).for("update");
  if (!existing) return "這張付款申請已經不在了";
  const entries = await requestEntries(tx, id);
  for (const e of entries) await assertPeriodOpen(tx, e.entryDate, "刪除付款申請");
  // 沖掉的發票恢復成未付，分錄和審批紀錄一起清掉，帳上不留痕跡（H 紀錄和異動申請留著）
  await tx.delete(invoiceSettlementsTable).where(eq(invoiceSettlementsTable.paymentRequestId, id));
  for (const e of entries) await tx.delete(journalEntriesTable).where(eq(journalEntriesTable.id, e.id));
  await tx.delete(approvalRequestsTable).where(and(eq(approvalRequestsTable.documentType, "PaymentRequest"), eq(approvalRequestsTable.documentId, id)));
  await tx.delete(paymentRequestsTable).where(eq(paymentRequestsTable.id, id));
  if (existing.invoiceId) await recomputeInvoices(tx, [existing.invoiceId]);
  return `已刪除付款申請 ${existing.requestNumber}${entries.length ? `，連同 ${entries.length} 筆分錄` : ""}`;
});

router.delete("/payment-requests/:id", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "付款申請編號格式不正確" }); return; }
  const [existing] = await db.select().from(paymentRequestsTable).where(eq(paymentRequestsTable.id, id));
  if (!existing) { res.status(404).json({ error: "找不到付款申請" }); return; }
  if (existing.status !== "Draft") {
    res.status(400).json({ error: "只能刪除草稿狀態的付款申請" }); return;
  }
  await db.delete(paymentRequestsTable).where(eq(paymentRequestsTable.id, id));
  res.json({ success: true });
});

export default router;
