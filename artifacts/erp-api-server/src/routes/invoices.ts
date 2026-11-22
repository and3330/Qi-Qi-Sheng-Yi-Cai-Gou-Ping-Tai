import crypto from "node:crypto";
import { looseSqlMatch } from "../lib/loose-match";
import { autoEntryText, applyAutoText } from "../lib/auto-entry-text";
import { todayTaipei } from "../lib/inventory-journal";
import { nextDocNumber } from "../lib/doc-number";
import { isMissingProject, PROJECT_REQUIRED_MESSAGE } from "../middleware/project-required";
import { Router, type IRouter } from "express";
import { applyPaymentTerm } from "../lib/invoice-terms";
import { scheduleStatus } from "../lib/payment-terms";
import { desc, eq, and, inArray, isNull, ne, sql } from "drizzle-orm";
import { recomputeInvoices, syncSalesOrderCompletion } from "../lib/invoice-sync";
import { db, invoicesTable, ecpayInvoiceAllowancesTable, ecpayInvoiceIssueRequestsTable, invoiceSettlementsTable, customersTable, suppliersTable, itemsTable, activitiesTable, salesOrdersTable, deliveryNotesTable, journalEntriesTable, salesReturnsTable, purchaseReturnsTable } from "@workspace/erp-db";
import {
  ListInvoicesQueryParams, CreateInvoiceBody, GetInvoiceParams,
  UpdateInvoiceParams, UpdateInvoiceBody,
} from "@workspace/erp-api-zod";
import { issueInvoice, voidInvoice, queryInvoice, queryInvoiceByRelateNumber, issueAllowance, voidAllowance, queryAllowance, queryVoidedAllowance } from "../lib/ecpay-invoice";
import { autoSendInvoiceEmail } from "../lib/email";
import { friendlyCaughtError, friendlyValidationError } from "../lib/friendly-errors";
import { requireAuth, requireRole } from "../middleware/require-auth";
import { reqTenantId } from "../middleware/tenant-context";
import { assertPeriodOpen, assertVatAccountsReady, createInvoiceJournalEntry, deleteInvoiceJournalEntry, getLockDate, resolveJournalLines, syncSalesOrderJournalEntry } from "../lib/auto-journal";
import { missingIssues, normalizeSavedEcpayCustomer } from "../lib/ecpay-buyer";
import { assertDeletableDraft } from "../lib/document-rules";
import { assertIntegerInvoiceItems } from "../lib/ecpay-integer-items";
import { printInvoice } from "../lib/ecpay-invoice";
import { renderEcpayPdf } from "../lib/ecpay-pdf";
import { requireInvoicePermission } from "../middleware/invoice-permission";

const router: IRouter = Router();
const FINANCE_ROLES = ["owner", "admin", "finance_admin", "accountant"] as const;
router.use("/invoices", requireAuth);
router.use("/delivery-notes", requireAuth);
router.use("/sales-orders", requireAuth);

function generateInvoiceNumber(type: string): string {
  const prefix = type === "Sales" ? "SINV" : "PINV";
  return `${prefix}-${String(Date.now()).slice(-8)}`;
}

function numericInvoice(inv: any) {
  const { ecpayIssueKey: _internalIssueKey, ...safeInvoice } = inv;
  return {
    ...safeInvoice,
    totalAmount: Number(inv.totalAmount),
    paidAmount: Number(inv.paidAmount),
    outstandingAmount: Number(inv.outstandingAmount),
    // 有分期排程時，帶出下一期到期日與已逾期金額
    ...(Array.isArray(inv.paymentSchedule) && inv.paymentSchedule.length > 0 ? (() => {
      const st = scheduleStatus(inv.paymentSchedule, Number(inv.paidAmount), new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10));
      return { nextDueDate: st.nextDueDate, nextDueAmount: st.nextDueAmount, overdueAmount: st.overdueAmount };
    })() : {}),
    ...(inv.taxRate !== undefined ? { taxRate: Number(inv.taxRate) } : {}),
    ...(inv.netAmount !== undefined ? { netAmount: Number(inv.netAmount) } : {}),
    ...(inv.taxAmount !== undefined ? { taxAmount: Number(inv.taxAmount) } : {}),
  };
}

async function finalizeEcpayInvoiceVoid(
  invoiceId: number,
  reason: string,
  remoteResponse?: Record<string, unknown> | null,
) {
  return db.transaction(async (tx) => {
    const [current] = await tx.select().from(invoicesTable)
      .where(eq(invoicesTable.id, invoiceId)).for("update");
    if (!current) throw Object.assign(new Error("找不到發票"), { statusCode: 404 });
    if (current.ecpayVoidedAt && !current.writeOffJournalEntryId) return current;
    const wasVoided = !!current.ecpayVoidedAt;
    await assertPeriodOpen(tx, current.invoiceDate, "作廢發票");
    if (current.writeOffJournalEntryId) {
      const [writeOffEntry] = await tx.select({
        transactionDate: journalEntriesTable.entryDate,
      }).from(journalEntriesTable).where(eq(journalEntriesTable.id, current.writeOffJournalEntryId));
      if (writeOffEntry) await assertPeriodOpen(tx, writeOffEntry.transactionDate, "作廢已轉呆帳發票");
      await tx.delete(journalEntriesTable).where(eq(journalEntriesTable.id, current.writeOffJournalEntryId));
    }
    await deleteInvoiceJournalEntry(tx, current, { skipUnlink: true });
    const [row] = await tx.update(invoicesTable).set({
      status: "Cancelled",
      ecpayVoidedAt: new Date(),
      ecpayVoidReason: reason,
      ecpayStatus: "Voided",
      ecpayLastSyncedAt: new Date(),
      ecpayLastSyncResponse: remoteResponse || null,
      ecpayVoidRequestedAt: null,
      journalEntryId: null,
      writeOffJournalEntryId: null,
    }).where(eq(invoicesTable.id, invoiceId)).returning();
    if (row.salesOrderId) await syncSalesOrderJournalEntry(tx, row.salesOrderId);
    if (!wasVoided) {
      await tx.insert(activitiesTable).values({
        type: "delete",
        title: "作廢綠界發票",
        description: `${row.ecpayInvoiceNumber} - ${reason}`,
        module: "Accounting",
      });
    }
    return row;
  });
}

const TAX_TYPES = ["taxable", "zero_rated", "exempt", "unclassified"] as const;

function taxFields(total: number, exchangeRate: number, taxType: string, taxRate: number, taxIncluded: boolean) {
  const totalTwdInput = total * exchangeRate;
  if (taxType !== "taxable") {
    return { totalAmount: total, netAmount: Math.round(totalTwdInput * 100) / 100, taxAmount: 0 };
  }
  if (taxIncluded) {
    const totalTwd = Math.round(totalTwdInput * 100) / 100;
    const netAmount = Math.round((totalTwd / (1 + taxRate / 100)) * 100) / 100;
    return { totalAmount: total, netAmount, taxAmount: Math.round((totalTwd - netAmount) * 100) / 100 };
  }
  const netAmount = Math.round(totalTwdInput * 100) / 100;
  const taxAmount = Math.round(netAmount * taxRate) / 100;
  return { totalAmount: (netAmount + taxAmount) / exchangeRate, netAmount, taxAmount };
}

type TaxInputBody = {
  taxType?: typeof TAX_TYPES[number];
  taxRate?: number;
  taxIncluded?: boolean;
  govInvoiceNumber?: string | null;
};

function parseTaxInput(body: TaxInputBody, defaults?: { taxType: string; taxRate: number; govInvoiceNumber?: string | null }) {
  const taxType = body.taxType == null ? (defaults?.taxType ?? "unclassified") : String(body.taxType);
  const taxRate = body.taxRate == null ? (defaults?.taxRate ?? 5) : body.taxRate;
  if (!TAX_TYPES.includes(taxType as typeof TAX_TYPES[number])) throw new Error("稅別無效");
  if (!Number.isFinite(taxRate) || taxRate < 0 || taxRate > 100) throw new Error("稅率必須介於 0 至 100");
  return {
    taxType,
    taxRate,
    taxIncluded: body.taxIncluded == null ? true : body.taxIncluded === true,
    govInvoiceNumber: body.govInvoiceNumber === undefined
      ? (defaults?.govInvoiceNumber ?? null)
      : body.govInvoiceNumber === "" || body.govInvoiceNumber === null ? null : String(body.govInvoiceNumber).trim(),
  };
}

/**
 * 舊系統（Ecount）開過的銷項發票，只供查看。
 * 這些發票不在發票表裡（放進去會讓應收、營業稅、催收、儀表板重複計算），存在歷史單據，
 * 由銷售發票頁面一起列出來。有對應的歷史銷貨單時一併帶回，畫面可以直接點過去。
 */
const legacyInvoiceRow = (row: any) => {
  const head = (row.head ?? {}) as Record<string, string>;
  return {
    legacy: true, legacyDocumentId: Number(row.id), invoiceNumber: String(row.docNumber), invoiceDate: row.docDate as string | null,
    customerName: (row.partyName as string | null) ?? null, customerCode: head["客戶/供應商編碼"] || null,
    einvoiceType: head["發票類型"] || null, status: head["狀態"] || "已開立", taxLabel: head["稅別"] || null,
    netAmount: Number(head["稅前價格"]) || 0, taxAmount: Number(head["營業稅"]) || 0, totalAmount: Number(row.total) || 0,
    detail: head["明細"] || null, legacySalesNumber: head["Ecount 銷貨單"] || null, linkMethod: head["連結方式"] || null,
    salesOrderId: row.salesOrderId === null || row.salesOrderId === undefined ? null : Number(row.salesOrderId), salesOrderNumber: (row.salesOrderNumber as string | null) ?? null,
  };
};

router.get("/invoices/legacy", async (_req, res): Promise<void> => {
  const result = await db.execute(sql`
    SELECT d.id, d.doc_number AS "docNumber", d.doc_date AS "docDate", d.party_name AS "partyName", d.total::float AS total, d.lines->0 AS head,
      so.id AS "salesOrderId", so.order_number AS "salesOrderNumber"
    FROM legacy_documents d
    LEFT JOIN sales_orders so ON so.order_source = 'ecount' AND so.order_number = NULLIF(d.lines->0->>'銷貨單號', '')
    WHERE d.doc_type = '銷項發票明細'
    ORDER BY d.doc_date DESC NULLS LAST, d.doc_number DESC`);
  res.json((((result as any).rows ?? result) as any[]).map(legacyInvoiceRow));
});

/** 某一張歷史銷貨單在舊系統開過的發票 */
router.get("/sales-orders/:id/legacy-invoices", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) { res.status(400).json({ error: "訂單編號格式不正確" }); return; }
  const result = await db.execute(sql`
    SELECT d.id, d.doc_number AS "docNumber", d.doc_date AS "docDate", d.party_name AS "partyName", d.total::float AS total, d.lines->0 AS head,
      so.id AS "salesOrderId", so.order_number AS "salesOrderNumber"
    FROM sales_orders so
    JOIN legacy_documents d ON d.doc_type = '銷項發票明細' AND d.lines->0->>'銷貨單號' = so.order_number
    WHERE so.id = ${id} AND so.order_source = 'ecount'
    ORDER BY d.doc_date, d.doc_number`);
  res.json((((result as any).rows ?? result) as any[]).map(legacyInvoiceRow));
});

router.get("/invoices", async (req, res): Promise<void> => {
  const query = ListInvoicesQueryParams.safeParse(req.query);
  const conditions = [];
  if (query.success && query.data.type) conditions.push(eq(invoicesTable.invoiceType, query.data.type));
  if (query.success && query.data.status) conditions.push(eq(invoicesTable.status, query.data.status));
  // 關鍵字：發票號碼、客戶或供應商名稱／簡稱；打簡稱也找得到
  const search = typeof req.query.search === "string" ? req.query.search.trim() : "";
  const searchMatch = search ? looseSqlMatch(search, [sql`${invoicesTable.invoiceNumber}`, sql`COALESCE(${customersTable.name}, '')`, sql`COALESCE(${customersTable.shortName}, '')`, sql`COALESCE(${suppliersTable.name}, '')`, sql`COALESCE(${suppliersTable.shortName}, '')`]) : undefined;
  if (searchMatch) conditions.push(searchMatch);
  const customerId = Number(req.query.customerId);
  if (Number.isInteger(customerId) && customerId > 0) conditions.push(eq(invoicesTable.customerId, customerId));
  const supplierId = Number(req.query.supplierId);
  if (Number.isInteger(supplierId) && supplierId > 0) conditions.push(eq(invoicesTable.supplierId, supplierId));

  const invoices = await db
    .select({
      id: invoicesTable.id, invoiceNumber: invoicesTable.invoiceNumber,
      invoiceType: invoicesTable.invoiceType,
      customerId: invoicesTable.customerId, customerName: customersTable.name,
      supplierId: invoicesTable.supplierId, supplierName: suppliersTable.name,
      salesOrderId: invoicesTable.salesOrderId,
      invoiceDate: invoicesTable.invoiceDate, dueDate: invoicesTable.dueDate,
      paymentTermId: invoicesTable.paymentTermId, paymentSchedule: invoicesTable.paymentSchedule,
      status: invoicesTable.status, totalAmount: invoicesTable.totalAmount,
      paidAmount: invoicesTable.paidAmount, outstandingAmount: invoicesTable.outstandingAmount,
      currency: invoicesTable.currency, exchangeRate: invoicesTable.exchangeRate,
      taxType: invoicesTable.taxType, taxRate: invoicesTable.taxRate,
      netAmount: invoicesTable.netAmount, taxAmount: invoicesTable.taxAmount,
      govInvoiceNumber: invoicesTable.govInvoiceNumber,
      items: invoicesTable.items, createdAt: invoicesTable.createdAt,
      ecpayInvoiceNumber: invoicesTable.ecpayInvoiceNumber,
      ecpayRandomNumber: invoicesTable.ecpayRandomNumber,
      ecpayInvoiceDate: invoicesTable.ecpayInvoiceDate,
      ecpayVoidedAt: invoicesTable.ecpayVoidedAt,
      ecpayVoidReason: invoicesTable.ecpayVoidReason,
      ecpayStatus: invoicesTable.ecpayStatus,
      ecpayLastSyncedAt: invoicesTable.ecpayLastSyncedAt,
      ecpayBuyerEmail: invoicesTable.ecpayBuyerEmail,
      ecpayBuyerPhone: invoicesTable.ecpayBuyerPhone,
    })
    .from(invoicesTable)
    .leftJoin(customersTable, eq(invoicesTable.customerId, customersTable.id))
    .leftJoin(suppliersTable, eq(invoicesTable.supplierId, suppliersTable.id))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(invoicesTable.invoiceDate), desc(invoicesTable.id));

  res.json(invoices.map(inv => {
    const exRate = Number(inv.exchangeRate) || 1;
    const ni = numericInvoice(inv);
    return { ...ni, exchangeRate: exRate, totalAmountTWD: Math.round(ni.totalAmount * exRate * 100) / 100 };
  }));
});

router.get("/sales-orders/:id/invoices", async (req, res): Promise<void> => {
  const orderId = Number(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id);
  if (isNaN(orderId)) { res.status(400).json({ error: "銷貨單編號格式不正確" }); return; }

  const invoices = await db
    .select({
      id: invoicesTable.id, invoiceNumber: invoicesTable.invoiceNumber,
      invoiceType: invoicesTable.invoiceType,
      customerId: invoicesTable.customerId, customerName: customersTable.name,
      salesOrderId: invoicesTable.salesOrderId,
      invoiceDate: invoicesTable.invoiceDate, dueDate: invoicesTable.dueDate,
      status: invoicesTable.status, totalAmount: invoicesTable.totalAmount,
      paidAmount: invoicesTable.paidAmount, outstandingAmount: invoicesTable.outstandingAmount,
      currency: invoicesTable.currency,
      items: invoicesTable.items,
      ecpayInvoiceNumber: invoicesTable.ecpayInvoiceNumber,
      ecpayRandomNumber: invoicesTable.ecpayRandomNumber,
      ecpayInvoiceDate: invoicesTable.ecpayInvoiceDate,
      ecpayVoidedAt: invoicesTable.ecpayVoidedAt,
      ecpayVoidReason: invoicesTable.ecpayVoidReason,
      ecpayStatus: invoicesTable.ecpayStatus,
      ecpayLastSyncedAt: invoicesTable.ecpayLastSyncedAt,
    })
    .from(invoicesTable)
    .leftJoin(customersTable, eq(invoicesTable.customerId, customersTable.id))
    .where(eq(invoicesTable.salesOrderId, orderId))
    .orderBy(invoicesTable.invoiceDate);

  res.json(invoices.map(numericInvoice));
});

/**
 * 歷史單（Ecount 搬來的）能不能補開發票：舊系統已經開過發票的不能再開；沒開過的可以補開
 * （補開的發票不再入帳，見 createInvoiceJournalEntry）。回傳擋下的原因，可以開就回 null
 */
async function legacyOrderInvoiceBlock(order: { orderSource: string | null; orderNumber: string }): Promise<string | null> {
  if (order.orderSource !== "ecount") return null;
  const result = await db.execute(sql`
    SELECT d.doc_number AS "docNumber" FROM legacy_documents d
    WHERE d.doc_type = '銷項發票明細' AND d.lines->0->>'銷貨單號' = ${order.orderNumber}
    ORDER BY d.doc_number LIMIT 5`);
  const numbers = (((result as any).rows ?? result) as Array<{ docNumber: string }>).map(r => r.docNumber).filter(Boolean);
  return numbers.length > 0 ? `這張歷史單在舊系統（Ecount）已經開過發票（${numbers.join("、")}），不能再開一次` : null;
}

router.post("/sales-orders/:id/invoices", async (req, res): Promise<void> => {
  const orderId = parseInt(req.params.id);
  if (isNaN(orderId)) { res.status(400).json({ error: "銷貨單編號格式不正確" }); return; }

  const [order] = await db.select().from(salesOrdersTable).where(eq(salesOrdersTable.id, orderId));
  if (!order) { res.status(404).json({ error: "找不到銷貨單" }); return; }
  // 舊系統搬來的歷史單：舊系統開過發票的不能再開；沒開過的可以補開（不再入帳）
  const legacyBlock = await legacyOrderInvoiceBlock(order);
  if (legacyBlock) { res.status(400).json({ error: legacyBlock }); return; }

  const { invoiceId } = req.body;

  if (invoiceId) {
    // 綁定既有發票也需鎖定訂單列並檢查剩餘可開額度，避免超額綁定或與同時開票競爭
    try {
      await db.transaction(async (tx) => {
        const [lockedOrder] = await tx.select().from(salesOrdersTable).where(eq(salesOrdersTable.id, orderId)).for("update");
        if (!lockedOrder) throw new Error("找不到銷貨單");
        const [inv] = await tx.select().from(invoicesTable).where(eq(invoicesTable.id, invoiceId));
        if (!inv) throw new Error("找不到發票");
        if (inv.invoiceType !== "Sales") throw new Error("只能綁定銷項發票");
        if (inv.customerId !== lockedOrder.customerId) throw new Error("發票客戶與訂單客戶不符");
        if (inv.salesOrderId) throw new Error("此發票已綁定其他銷貨單");
        const linkedInvoices = await tx
          .select({ totalAmount: invoicesTable.totalAmount, status: invoicesTable.status })
          .from(invoicesTable)
          .where(and(eq(invoicesTable.salesOrderId, orderId), eq(invoicesTable.invoiceType, "Sales")));
        const alreadyInvoiced = linkedInvoices
          .filter(i => i.status !== "Cancelled")
          .reduce((sum, i) => sum + Number(i.totalAmount), 0);
        const remaining = Math.round((Number(lockedOrder.totalAmount) - alreadyInvoiced) * 100) / 100;
        if (inv.status !== "Cancelled" && Number(inv.totalAmount) > remaining) {
          throw new Error(`此發票金額 $${Number(inv.totalAmount).toFixed(2)} 超過剩餘可開金額 $${remaining.toFixed(2)}（已開 $${alreadyInvoiced.toFixed(2)} / 訂單 $${Number(lockedOrder.totalAmount).toFixed(2)}）`);
        }
        const [updated] = await tx.update(invoicesTable).set({ salesOrderId: orderId }).where(and(eq(invoicesTable.id, invoiceId), isNull(invoicesTable.salesOrderId))).returning();
        if (!updated) throw new Error("此發票已綁定其他銷貨單");
        // 補開/綁定發票後改以發票分錄為準，移除訂單的未開發票營收分錄
        await syncSalesOrderJournalEntry(tx, orderId);
      });
    } catch (err: any) {
      res.status(400).json({ error: friendlyCaughtError(err, "綁定發票失敗") }); return;
    }
    res.json({ success: true, invoiceId });
    return;
  }

  // items 欄位若有提供，必須是非空陣列（避免格式錯誤時誤開全額發票）
  if ("items" in (req.body ?? {}) && (!Array.isArray(req.body.items) || req.body.items.length === 0)) {
    res.status(400).json({ error: "items 必須是非空的品項陣列" }); return;
  }

  // 重複開票防呆：鎖定訂單列後，在同一交易內計算已開票額並開立，防止並發超額開票
  let inv;
  try {
    inv = await db.transaction(async (tx) => {
      const [lockedOrder] = await tx.select().from(salesOrdersTable).where(eq(salesOrdersTable.id, orderId)).for("update");
      if (!lockedOrder) throw new Error("Sales order not found");

      const linkedInvoices = await tx
        .select({ totalAmount: invoicesTable.totalAmount, status: invoicesTable.status })
        .from(invoicesTable)
        .where(and(eq(invoicesTable.salesOrderId, orderId), eq(invoicesTable.invoiceType, "Sales")));
      const alreadyInvoiced = linkedInvoices
        .filter(i => i.status !== "Cancelled")
        .reduce((sum, i) => sum + Number(i.totalAmount), 0);
      const orderTotal = Number(lockedOrder.totalAmount);
      const remainingInvoiceable = Math.round((orderTotal - alreadyInvoiced) * 100) / 100;
      if (remainingInvoiceable <= 0) {
        throw new Error(`此銷貨單已全額開立發票（已開 $${alreadyInvoiced.toFixed(2)} / 訂單 $${orderTotal.toFixed(2)}）`);
      }

      // 自訂本次開票內容（分批開票）：前端傳 items 時依其品項與金額開立
      const customItems = Array.isArray(req.body?.items) ? req.body.items : null;
      let itemEntries: { itemName: string; quantity: number; rate: number; amount: number }[];
      let totalAmount: number;

      if (customItems && customItems.length > 0) {
        itemEntries = customItems.map((item: any) => {
          const quantity = Number(item.quantity ?? 1);
          const rate = Number(item.rate ?? 0);
          const amount = Math.round((Number(item.amount ?? quantity * rate)) * 100) / 100;
          const itemName = String(item.itemName || "").trim();
          if (!itemName) throw new Error("品項名稱不可為空");
          if (!Number.isFinite(rate) || rate < 0) throw new Error(`品項「${itemName}」的單價格式不正確`);
          if (!Number.isFinite(quantity) || quantity <= 0) throw new Error(`品項「${itemName}」的數量必須大於 0`);
          if (!Number.isFinite(amount) || amount <= 0) throw new Error(`品項「${itemName}」的金額必須大於 0`);
          return { itemName, quantity, rate, amount };
        });
        totalAmount = Math.round(itemEntries.reduce((s, i) => s + i.amount, 0) * 100) / 100;
        if (totalAmount > remainingInvoiceable) {
          throw new Error(`本次開票金額 $${totalAmount.toFixed(2)} 超過剩餘可開金額 $${remainingInvoiceable.toFixed(2)}（已開 $${alreadyInvoiced.toFixed(2)} / 訂單 $${orderTotal.toFixed(2)}）`);
        }
      } else {
        const orderItems = Array.isArray(lockedOrder.items) ? lockedOrder.items : [];
        itemEntries = alreadyInvoiced > 0
          ? [{ itemName: "部分開票（剩餘金額）", quantity: 1, rate: remainingInvoiceable, amount: remainingInvoiceable }]
          : orderItems.map((item: any) => ({
              itemName: item.itemName || item.name || "品項",
              quantity: Number(item.quantity || 1),
              rate: Number(item.rate || item.unitPrice || 0),
              amount: Number(item.amount || (item.quantity * (item.rate || item.unitPrice || 0)) || 0),
            }));
        totalAmount = remainingInvoiceable;
      }
      const now = new Date();
      const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
      const invoiceNumber = `SINV-${lockedOrder.orderNumber}-${String(Date.now()).slice(-6)}`;

      // 內銷預設 5% 營業稅（含稅），拆出未稅與稅額供自動分錄入銷項稅額
      const tax = taxFields(totalAmount, 1, "taxable", 5, true);
      const [createdRow] = await tx.insert(invoicesTable).values({
        invoiceNumber,
        invoiceType: "Sales",
        customerId: lockedOrder.customerId,
        salesOrderId: orderId,
        invoiceDate: dateStr,
        status: "Unpaid",
        totalAmount: String(totalAmount),
        outstandingAmount: String(totalAmount),
        taxType: "taxable",
        taxRate: "5",
        netAmount: String(tax.netAmount),
        taxAmount: String(tax.taxAmount),
        items: itemEntries,
      }).returning();
      // 套用付款條件（指定的，或客戶／供應商的預設）：排出各期到期日
      const created = await applyPaymentTerm(tx, createdRow, undefined);
      // 自動過帳：借應收帳款、貸銷貨收入
      await createInvoiceJournalEntry(tx, created);
      // 先前直接對訂單收的訂金，自動算進這張發票的已收金額
      await recomputeInvoices(tx, [created.id]);
      // 補開發票後改以發票分錄為準，移除訂單的未開發票營收分錄
      await syncSalesOrderJournalEntry(tx, orderId);
      return created;
    });
  } catch (err: any) {
    res.status(400).json({ error: friendlyCaughtError(err, "開立發票失敗，請確認資料後再試") }); return;
  }

  await db.insert(activitiesTable).values({
    type: "create", title: "從銷貨單開立發票",
    description: `${inv.invoiceNumber} - $${Number(inv.totalAmount).toFixed(2)} (來自 ${order.orderNumber})`,
    module: "Accounting",
  });

  res.status(201).json(numericInvoice(inv));
});

// 依出貨單開立發票：按實際出貨品項/數量開票
router.post("/delivery-notes/:id/invoices", async (req, res): Promise<void> => {
  const dnId = parseInt(req.params.id);
  if (isNaN(dnId)) { res.status(400).json({ error: "出貨單編號格式不正確" }); return; }

  const [dn] = await db.select().from(deliveryNotesTable).where(eq(deliveryNotesTable.id, dnId));
  if (!dn) { res.status(404).json({ error: "出貨單不存在" }); return; }
  if (dn.status !== "Submitted" && dn.status !== "Completed") {
    res.status(400).json({ error: `出貨單狀態為「${dn.status}」，須先提交出貨後才能開立發票` }); return;
  }

  // 防止同一張出貨單重複開票
  const [existingInv] = await db
    .select({ id: invoicesTable.id, invoiceNumber: invoicesTable.invoiceNumber, status: invoicesTable.status })
    .from(invoicesTable)
    .where(and(eq(invoicesTable.deliveryNoteId, dnId), sql`${invoicesTable.status} != 'Cancelled'`));
  if (existingInv) {
    res.status(409).json({ error: `此出貨單已開立發票 ${existingInv.invoiceNumber}` }); return;
  }

  const dnItems = Array.isArray(dn.items) ? (dn.items as any[]) : [];
  const itemEntries = dnItems.map((item: any) => ({
    itemId: item.itemId ?? null,
    itemName: item.itemName || "品項",
    quantity: Number(item.quantity || 1),
    rate: Number(item.rate || 0),
    amount: Number(item.amount || (Number(item.quantity || 0) * Number(item.rate || 0))),
    // 沿用出貨單建單當下的成本快照，毛利計算不受日後成本變動影響
    ...(item.unitCost !== undefined && item.unitCost !== null ? { unitCost: Number(item.unitCost) } : {}),
  }));
  const totalAmount = itemEntries.reduce((s, i) => s + i.amount, 0);
  if (totalAmount <= 0) { res.status(400).json({ error: "出貨單沒有可開票金額" }); return; }

  const dateStr = todayTaipei();
  let inv;
  try {
    inv = await db.transaction(async (tx) => {
      // 內銷預設 5% 營業稅（含稅），拆出未稅與稅額供自動分錄入銷項稅額
      const tax = taxFields(totalAmount, 1, "taxable", 5, true);
      const [createdRow] = await tx.insert(invoicesTable).values({
        invoiceNumber: `SINV-${dn.noteNumber}-${String(Date.now()).slice(-6)}`,
        invoiceType: "Sales",
        customerId: dn.customerId,
        salesOrderId: dn.salesOrderId,
        deliveryNoteId: dnId,
        invoiceDate: dateStr,
        status: "Unpaid",
        totalAmount: String(Math.round(totalAmount * 100) / 100),
        outstandingAmount: String(Math.round(totalAmount * 100) / 100),
        taxType: "taxable",
        taxRate: "5",
        netAmount: String(tax.netAmount),
        taxAmount: String(tax.taxAmount),
        items: itemEntries,
      }).returning();
      // 套用付款條件（指定的，或客戶／供應商的預設）：排出各期到期日
      const created = await applyPaymentTerm(tx, createdRow, undefined);
      // 自動過帳：借應收帳款、貸銷貨收入
      await createInvoiceJournalEntry(tx, created);
      // 先前直接對訂單收的訂金，自動算進這張發票的已收金額
      await recomputeInvoices(tx, [created.id]);
      // 出貨單若綁定銷貨單，補開發票後移除訂單的未開發票營收分錄
      if (dn.salesOrderId) await syncSalesOrderJournalEntry(tx, dn.salesOrderId);
      return created;
    });
  } catch (err: any) {
    // 唯一索引攔截並發重複開票
    if (String(err.message || "").includes("invoices_dn_active_uniq")) {
      res.status(409).json({ error: "此出貨單已開立發票" }); return;
    }
    throw err;
  }

  await db.insert(activitiesTable).values({
    type: "create", title: "從出貨單開立發票",
    description: `${inv.invoiceNumber} - $${totalAmount.toFixed(2)} (來自 ${dn.noteNumber})`,
    module: "Accounting",
  });

  res.status(201).json(numericInvoice(inv));
});

// 發票沖帳明細：顯示每筆收付款來源（傳票或付款申請）
router.get("/invoices/:id/settlements", async (req, res): Promise<void> => {
  const id = Number(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "發票編號格式不正確" }); return; }
  const rows = await db
    .select({
      id: invoiceSettlementsTable.id,
      voucherId: invoiceSettlementsTable.voucherId,
      paymentRequestId: invoiceSettlementsTable.paymentRequestId,
      amount: invoiceSettlementsTable.amount,
      remarks: invoiceSettlementsTable.remarks,
      createdAt: invoiceSettlementsTable.createdAt,
      voucherNumber: sql<string | null>`(SELECT voucher_number FROM vouchers WHERE id = invoice_settlements.voucher_id)`,
      requestNumber: sql<string | null>`(SELECT request_number FROM payment_requests WHERE id = invoice_settlements.payment_request_id)`,
    })
    .from(invoiceSettlementsTable)
    .where(eq(invoiceSettlementsTable.invoiceId, id))
    .orderBy(invoiceSettlementsTable.createdAt);
  res.json(rows.map(r => ({ ...r, amount: Number(r.amount) })));
});

router.delete("/invoices/:invoiceId/unlink-order", async (req, res): Promise<void> => {
  const invoiceId = parseInt(req.params.invoiceId);
  if (isNaN(invoiceId)) { res.status(400).json({ error: "發票編號格式不正確" }); return; }
  const [inv] = await db.select({ id: invoicesTable.id, salesOrderId: invoicesTable.salesOrderId }).from(invoicesTable).where(eq(invoicesTable.id, invoiceId));
  if (!inv) { res.status(404).json({ error: "找不到發票" }); return; }
  if (!inv.salesOrderId) { res.status(400).json({ error: "此發票未綁定任何銷貨單" }); return; }
  try {
    await db.transaction(async (tx) => {
      await tx.update(invoicesTable).set({ salesOrderId: null }).where(eq(invoicesTable.id, invoiceId));
      // 解除綁定後，若訂單已成立且再無其他發票，恢復訂單的營收分錄
      await syncSalesOrderJournalEntry(tx, inv.salesOrderId!);
    });
  } catch (err: any) {
    res.status(400).json({ error: friendlyCaughtError(err, "解除綁定失敗") }); return;
  }
  res.json({ success: true });
});

router.get("/invoices/unlinked", async (req, res): Promise<void> => {
  const customerId = req.query.customerId ? parseInt(req.query.customerId as string) : undefined;
  const conditions = [
    eq(invoicesTable.invoiceType, "Sales"),
    isNull(invoicesTable.salesOrderId),
  ];
  if (customerId && !isNaN(customerId)) {
    conditions.push(eq(invoicesTable.customerId, customerId));
  }

  const invoices = await db
    .select({
      id: invoicesTable.id, invoiceNumber: invoicesTable.invoiceNumber,
      invoiceDate: invoicesTable.invoiceDate, totalAmount: invoicesTable.totalAmount,
      status: invoicesTable.status, customerName: customersTable.name,
    })
    .from(invoicesTable)
    .leftJoin(customersTable, eq(invoicesTable.customerId, customersTable.id))
    .where(and(...conditions))
    .orderBy(invoicesTable.invoiceDate);

  res.json(invoices.map(inv => ({ ...inv, totalAmount: Number(inv.totalAmount) })));
});

router.post("/invoices", async (req, res): Promise<void> => {
  const parsed = CreateInvoiceBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: friendlyValidationError(parsed.error) }); return; }

  // 幣別/匯率驗證：幣別限 3 碼英文，匯率須為正的有限數
  const currencyRaw = req.body.currency;
  if (currencyRaw != null && !/^[A-Za-z]{3}$/.test(String(currencyRaw))) {
    res.status(400).json({ error: "幣別格式無效（須為 3 碼英文，如 TWD/USD）" }); return;
  }
  const currency = currencyRaw ? String(currencyRaw).toUpperCase() : "TWD";
  const rateRaw = req.body.exchangeRate;
  const exchangeRate = rateRaw == null || rateRaw === "" ? 1 : Number(rateRaw);
  if (!Number.isFinite(exchangeRate) || exchangeRate <= 0) {
    res.status(400).json({ error: "匯率必須為正數" }); return;
  }
  let taxInput;
  try {
    taxInput = parseTaxInput(parsed.data);
  } catch (err: any) {
    res.status(400).json({ error: err.message }); return;
  }

  // 手開的發票沒有來源訂單可以沿用，專案要自己選
  if (isMissingProject(req.body.projectId)) { res.status(400).json({ error: PROJECT_REQUIRED_MESSAGE }); return; }
  const invoiceProjectId = Number(req.body.projectId);

  const orderItems: { itemId: number; itemName: string; quantity: number; rate: number; amount: number }[] = [];
  let totalAmount = 0;
  for (const item of parsed.data.items) {
    const [dbItem] = await db.select({ itemName: itemsTable.itemName }).from(itemsTable).where(eq(itemsTable.id, item.itemId));
    const amount = item.quantity * item.rate;
    totalAmount += amount;
    orderItems.push({ itemId: item.itemId, itemName: dbItem?.itemName || "Unknown", quantity: item.quantity, rate: item.rate, amount });
  }

  const tax = taxFields(totalAmount, exchangeRate, taxInput.taxType, taxInput.taxRate, taxInput.taxIncluded);
  totalAmount = tax.totalAmount;
  // 已關帳、缺科目這類問題要回看得懂的訊息；原本直接變成「系統錯誤」
  let inv: Awaited<ReturnType<typeof applyPaymentTerm>>;
  try {
  inv = await db.transaction(async (tx) => {
    const [createdRow] = await tx.insert(invoicesTable).values({
      invoiceNumber: await nextDocNumber(tx, "invoices", "invoice_number", parsed.data.invoiceType === "Sales" ? "SINV" : "PINV", () => generateInvoiceNumber(parsed.data.invoiceType)),
      invoiceType: parsed.data.invoiceType,
      projectId: invoiceProjectId,
      customerId: parsed.data.customerId,
      supplierId: parsed.data.supplierId,
      invoiceDate: parsed.data.invoiceDate,
      dueDate: parsed.data.dueDate,
      totalAmount: String(totalAmount),
      outstandingAmount: String(totalAmount),
      currency,
      exchangeRate: String(exchangeRate),
      taxType: taxInput.taxType,
      taxRate: String(taxInput.taxRate),
      netAmount: String(tax.netAmount),
      taxAmount: String(tax.taxAmount),
      govInvoiceNumber: taxInput.govInvoiceNumber,
      items: orderItems,
    }).returning();
    // 套用付款條件（指定的，或客戶／供應商的預設）：排出各期到期日
    const created = await applyPaymentTerm(tx, createdRow, req.body.paymentTermId === null ? null : (req.body.paymentTermId ? Number(req.body.paymentTermId) : undefined));
    // 自動過帳：銷項借應收/貸收入，進項借進貨/貸應付
    await createInvoiceJournalEntry(tx, created);
    return created;
  });
  } catch (err) {
    res.status(400).json({ error: friendlyCaughtError(err, "發票建立失敗，請確認資料後再試") }); return;
  }

  await db.insert(activitiesTable).values({
    type: "create", title: "Invoice Created",
    description: `${inv.invoiceNumber} - $${totalAmount.toFixed(2)}`,
    module: "Accounting",
  });

  // 銷項發票開立後自動寄客戶通知信（依租戶設定；同步等待以確保租戶連線情境有效）
  if (inv.customerId && inv.invoiceType !== "Purchase") {
    await autoSendInvoiceEmail(inv.id);
  }

  res.status(201).json({ ...numericInvoice(inv), customerName: null, supplierName: null });
});

router.post(["/invoices/:id/ecpay-print", "/invoices/:id/ecpay-pdf"], requireInvoicePermission("print"), async (req, res): Promise<void> => {
  res.set("Cache-Control", "no-store");
  const printStyle = req.body?.printStyle ?? 1;
  if (printStyle !== 1 && printStyle !== 4) { res.status(400).json({ error: "列印格式僅支援一般格式或公司發票 A4" }); return; }
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id <= 0) { res.status(400).json({ error: "發票編號無效" }); return; }
  const [inv] = await db.select().from(invoicesTable).where(eq(invoicesTable.id, id));
  if (!inv) { res.status(404).json({ error: "找不到發票" }); return; }
  if (!inv.ecpayInvoiceNumber || !inv.ecpayInvoiceDate) { res.status(409).json({ error: "尚未取得綠界發票號碼，不能列印正式電子發票" }); return; }
  if (inv.ecpayVoidedAt || inv.status === "Cancelled") { res.status(409).json({ error: "已作廢或取消的發票不可列印為有效憑證" }); return; }
  if (printStyle === 4 && !/^\d{8}$/.test(inv.ecpayTaxId || "")) { res.status(409).json({ error: "公司發票 A4 僅限開票時已填買方統編的發票，不能用客戶目前統編取代原開票資料" }); return; }
  const result = await printInvoice(inv.ecpayInvoiceNumber, String(inv.ecpayInvoiceDate).slice(0, 10), undefined, printStyle);
  if (!result.success) { res.status(502).json({ error: result.message }); return; }
  if (req.path.endsWith("/ecpay-pdf")) {
    try {
      const pdf = await renderEcpayPdf(result.url!, inv.ecpayInvoiceNumber);
      res.set("Content-Disposition", `attachment; filename="${inv.ecpayInvoiceNumber}.pdf"`);
      res.type("application/pdf").send(pdf);
    } catch (error) {
      res.status((error as { status?: number }).status === 503 ? 503 : 502)
        .json({ error: "無法產生綠界發票 PDF，請稍後重試" });
    }
    return;
  }
  res.json({ url: result.url, expiresInSeconds: 3600 });
});

router.get("/invoices/:id", async (req, res): Promise<void> => {
  const params = GetInvoiceParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: friendlyValidationError(params.error) }); return; }
  const [inv] = await db
    .select({
      id: invoicesTable.id, invoiceNumber: invoicesTable.invoiceNumber,
      invoiceType: invoicesTable.invoiceType,
      customerId: invoicesTable.customerId, customerName: customersTable.name,
      supplierId: invoicesTable.supplierId, supplierName: suppliersTable.name,
      salesOrderId: invoicesTable.salesOrderId,
      orderNumber: salesOrdersTable.orderNumber,
      invoiceDate: invoicesTable.invoiceDate, dueDate: invoicesTable.dueDate,
      paymentTermId: invoicesTable.paymentTermId, paymentSchedule: invoicesTable.paymentSchedule,
      status: invoicesTable.status, totalAmount: invoicesTable.totalAmount,
      paidAmount: invoicesTable.paidAmount, outstandingAmount: invoicesTable.outstandingAmount,
      currency: invoicesTable.currency, exchangeRate: invoicesTable.exchangeRate,
      taxType: invoicesTable.taxType, taxRate: invoicesTable.taxRate,
      netAmount: invoicesTable.netAmount, taxAmount: invoicesTable.taxAmount,
      govInvoiceNumber: invoicesTable.govInvoiceNumber,
      items: invoicesTable.items, createdAt: invoicesTable.createdAt,
    })
    .from(invoicesTable)
    .leftJoin(customersTable, eq(invoicesTable.customerId, customersTable.id))
    .leftJoin(suppliersTable, eq(invoicesTable.supplierId, suppliersTable.id))
    .leftJoin(salesOrdersTable, eq(invoicesTable.salesOrderId, salesOrdersTable.id))
    .where(eq(invoicesTable.id, params.data.id));
  if (!inv) { res.status(404).json({ error: "找不到發票" }); return; }
  const exRate = Number(inv.exchangeRate) || 1;
  const ni = numericInvoice(inv);
  res.json({ ...ni, exchangeRate: exRate, totalAmountTWD: Math.round(ni.totalAmount * exRate * 100) / 100 });
});

router.patch("/invoices/:id", async (req, res): Promise<void> => {
  const params = UpdateInvoiceParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: friendlyValidationError(params.error) }); return; }
  const parsed = UpdateInvoiceBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: friendlyValidationError(parsed.error) }); return; }
  const [current] = await db.select().from(invoicesTable).where(eq(invoicesTable.id, params.data.id));
  if (!current) { res.status(404).json({ error: "找不到發票" }); return; }
  let taxInput;
  try {
    taxInput = parseTaxInput(parsed.data, {
      taxType: current.taxType,
      taxRate: Number(current.taxRate),
      govInvoiceNumber: current.govInvoiceNumber,
    });
  } catch (err: any) {
    res.status(400).json({ error: err.message }); return;
  }

  // 狀態轉換驗證
  if (parsed.data.status != null && parsed.data.status !== current.status) {
    // Paid/Unpaid is accounting state derived exclusively from invoice_settlements.
    // Accepting a status-only PATCH would make paidAmount, outstandingAmount and
    // the settlement ledger disagree.
    if (parsed.data.status === "Paid" || current.status === "Paid") {
      res.status(400).json({ error: "已收付狀態由沖帳紀錄自動計算，不可直接修改" }); return;
    }
    const INVOICE_TRANSITIONS: Record<string, string[]> = {
      Draft: ["Submitted", "Unpaid", "Cancelled"],
      Submitted: ["Unpaid", "Overdue", "Cancelled"],
      Unpaid: ["Overdue", "Cancelled"],
      Overdue: ["Unpaid", "Cancelled"],
      Paid: [],
      Cancelled: [],
      WrittenOff: [], // 呆帳僅能透過「取消呆帳」端點復原
    };
    const allowed = INVOICE_TRANSITIONS[current.status] || [];
    if (!allowed.includes(parsed.data.status)) {
      res.status(400).json({ error: `發票無法從「${current.status}」轉換為「${parsed.data.status}」` }); return;
    }
    if (current.ecpayInvoiceNumber && parsed.data.status === "Cancelled") {
      res.status(400).json({ error: "綠界電子發票不可直接改為取消，請使用「管理綠界發票」完成正式作廢" }); return;
    }
  }

  if (current.ecpayInvoiceNumber) {
    const changesFiscalData =
      (parsed.data.taxType != null && parsed.data.taxType !== current.taxType) ||
      (parsed.data.taxRate != null && Number(parsed.data.taxRate) !== Number(current.taxRate)) ||
      parsed.data.taxIncluded === false ||
      (parsed.data.govInvoiceNumber !== undefined && parsed.data.govInvoiceNumber !== current.govInvoiceNumber);
    if (changesFiscalData) {
      res.status(400).json({ error: "已開立的綠界電子發票不可直接修改稅務內容；請先依法作廢或開立折讓" }); return;
    }
  }

  // paidAmount 防呆：不可為負、不可超過總額
  if (parsed.data.paidAmount != null) {
    const total = Number(current.totalAmount);
    if (parsed.data.paidAmount < 0) { res.status(400).json({ error: "已付金額不可為負數" }); return; }
    if (parsed.data.paidAmount > total + 0.001) {
      res.status(400).json({ error: `已付金額 ${parsed.data.paidAmount} 不可超過發票總額 ${total}` }); return;
    }
  }

  let inv;
  try {
    inv = await db.transaction(async (tx) => {
      let pendingOrderSyncId: number | null = null;
      const [locked] = await tx.select().from(invoicesTable).where(eq(invoicesTable.id, params.data.id)).for("update");
      if (!locked) throw new Error("Invoice not found");
      await assertPeriodOpen(tx, locked.invoiceDate, "修改發票");

      if (parsed.data.status === "Cancelled" && locked.status !== "Cancelled") {
        const [sourceReturn] = locked.invoiceType === "Credit Note"
          ? await tx.select({ id: salesReturnsTable.id }).from(salesReturnsTable)
              .where(eq(salesReturnsTable.creditNoteInvoiceId, locked.id)).limit(1)
          : locked.invoiceType === "Debit Note"
            ? await tx.select({ id: purchaseReturnsTable.id }).from(purchaseReturnsTable)
                .where(eq(purchaseReturnsTable.debitNoteInvoiceId, locked.id)).limit(1)
            : [];
        if (sourceReturn) {
          throw new Error("退貨自動建立的折讓／扣項單不可單獨作廢，請由原退貨單執行取消");
        }
        const [settlement] = await tx
          .select({ id: invoiceSettlementsTable.id })
          .from(invoiceSettlementsTable)
          .where(eq(invoiceSettlementsTable.invoiceId, locked.id))
          .limit(1);
        if (settlement) {
          throw new Error(`發票 ${locked.invoiceNumber} 已有沖帳紀錄，請先刪除或沖回沖帳後再取消`);
        }
      }

      const updateData: Record<string, unknown> = { ...parsed.data };
      delete updateData.paidAmount; // 已付金額一律經由沖帳紀錄調整，不直接改寫
      if (parsed.data.taxType != null || parsed.data.taxRate != null || parsed.data.taxIncluded != null || parsed.data.govInvoiceNumber !== undefined) {
        const tax = taxFields(
          Number(locked.totalAmount),
          Number(locked.exchangeRate) || 1,
          taxInput.taxType,
          taxInput.taxRate,
          taxInput.taxIncluded,
        );
        updateData.taxType = taxInput.taxType;
        updateData.taxRate = String(taxInput.taxRate);
        updateData.netAmount = String(tax.netAmount);
        updateData.taxAmount = String(tax.taxAmount);
        updateData.govInvoiceNumber = taxInput.govInvoiceNumber;
        if (!taxInput.taxIncluded) {
          updateData.totalAmount = String(tax.totalAmount);
          updateData.outstandingAmount = String(Math.max(0, tax.totalAmount - Number(locked.paidAmount)));
        }
      }
      // 發票取消時同步刪除自動分錄
      if (parsed.data.status === "Cancelled" && locked.journalEntryId) {
        await deleteInvoiceJournalEntry(tx, locked, { skipUnlink: true });
        updateData.journalEntryId = null;
      }
      // 發票取消後，若綁定的訂單仍成立且無其他有效發票，恢復訂單的營收分錄
      if (parsed.data.status === "Cancelled" && locked.status !== "Cancelled" && locked.salesOrderId) {
        pendingOrderSyncId = locked.salesOrderId;
      }
      let row = locked;
      if (Object.keys(updateData).length > 0) {
        [row] = await tx.update(invoicesTable).set(updateData).where(eq(invoicesTable.id, params.data.id)).returning();
      }

      // 稅別/稅率會改變營收與營業稅拆分；即使含稅總額不變也必須重建分錄。
      const journalInputsChanged =
        Number(row.totalAmount) !== Number(locked.totalAmount) ||
        parsed.data.taxType != null ||
        parsed.data.taxRate != null ||
        parsed.data.taxIncluded != null;
      if (row.status !== "Cancelled" && row.journalEntryId && journalInputsChanged) {
        await deleteInvoiceJournalEntry(tx, row, { skipUnlink: true });
        await createInvoiceJournalEntry(tx, row);
        [row] = await tx.select().from(invoicesTable).where(eq(invoicesTable.id, params.data.id));
      }

      if (parsed.data.paidAmount != null) {
        // 手動調整已付金額 → 寫入差額沖帳紀錄，由 settlements 統一重算
        const [{ settled }] = await tx
          .select({ settled: sql<string>`COALESCE(SUM(amount), 0)` })
          .from(invoiceSettlementsTable)
          .where(eq(invoiceSettlementsTable.invoiceId, params.data.id));
        const delta = Math.round((parsed.data.paidAmount - Number(settled)) * 100) / 100;
        if (Math.abs(delta) > 0.001) {
          await tx.insert(invoiceSettlementsTable).values({
            invoiceId: params.data.id,
            amount: String(delta),
            remarks: "手動調整已付金額",
          });
          await recomputeInvoices(tx, [params.data.id]);
          [row] = await tx.select().from(invoicesTable).where(eq(invoicesTable.id, params.data.id));
        }
      }
      if (pendingOrderSyncId) await syncSalesOrderJournalEntry(tx, pendingOrderSyncId);
      return row;
    });
  } catch (err: any) {
    if (err.message === "Invoice not found") { res.status(404).json({ error: "找不到發票" }); return; }
    res.status(400).json({ error: friendlyCaughtError(err, "發票更新失敗，請確認資料後再試") }); return;
  }

  // 發票收款後同步更新關聯銷貨單狀態
  if (parsed.data.status === "Paid" && inv.salesOrderId) {
    await db.transaction(async (tx) => {
      await syncSalesOrderCompletion(tx, [inv.salesOrderId!]);
    });
  }

  res.json({ ...numericInvoice(inv), customerName: null, supplierName: null });
});

// ============ 呆帳沖銷 ============

// 轉呆帳：將銷貨發票的未收餘額認列為呆帳損失，自動建立分錄（借 呆帳損失 / 貸 應收帳款）
router.post("/invoices/:id/write-off", requireRole("owner", "admin", "finance_admin", "accountant"), async (req, res): Promise<void> => {
  const id = parseInt(String(req.params.id));
  if (isNaN(id)) { res.status(400).json({ error: "發票編號格式不正確" }); return; }
  const reason = typeof req.body?.reason === "string" ? req.body.reason.trim().slice(0, 500) : "";
  const today = todayTaipei();
  try {
    const result = await db.transaction(async (tx) => {
      const [inv] = await tx.select().from(invoicesTable).where(eq(invoicesTable.id, id)).for("update");
      if (!inv) throw Object.assign(new Error("找不到發票"), { statusCode: 404 });
      if (inv.invoiceType !== "Sales" && inv.invoiceType !== "Sales Invoice") throw new Error("僅銷貨發票可以轉呆帳");
      if (inv.status === "Cancelled") throw new Error("已取消的發票不可轉呆帳");
      if (inv.status === "WrittenOff") throw new Error("此發票已轉呆帳");
      if (inv.status === "Paid") throw new Error("已收款完成的發票不需轉呆帳");
      const outstanding = Math.round(Number(inv.outstandingAmount) * 100) / 100;
      if (!(outstanding > 0)) throw new Error("此發票沒有未收餘額，不需轉呆帳");
      await assertPeriodOpen(tx, today, "認列呆帳損失");

      const lines = await resolveJournalLines(tx, [
        { accountName: "呆帳損失", debit: outstanding, credit: 0, description: `${inv.invoiceNumber} 呆帳損失` },
        { accountName: "應收帳款", debit: 0, credit: outstanding, description: `${inv.invoiceNumber} 沖銷應收帳款` },
      ]);
      const unresolved = lines.filter(l => !l.accountId);
      if (unresolved.length > 0) {
        throw new Error(`會計科目表缺少科目：${unresolved.map(l => l.accountName).join("、")}，請先於會計科目建立`);
      }
      const entryNumber = `JE-${Date.now().toString().slice(-8)}-W${inv.id}`;
      // 摘要寫「客戶｜呆帳沖銷：原因」；沖銷原因這時還沒寫回發票，直接用這次填的
      const found = await autoEntryText(tx, entryNumber);
      const text = applyAutoText(found && { ...found, summary: `呆帳沖銷${reason ? `：${reason}` : ""}` }, `自動分錄 - 呆帳沖銷 ${inv.invoiceNumber}${reason ? `（${reason}）` : ""}`, lines);
      const [je] = await tx.insert(journalEntriesTable).values({
        entryNumber,
        entryDate: today,
        description: text.description,
        // 呆帳損失算回這張發票的專案（部門跟著專案）
        projectId: inv.projectId ?? null,
        totalDebit: String(outstanding),
        totalCredit: String(outstanding),
        status: "Posted",
        lines: text.lines,
      }).returning();

      const [row] = await tx.update(invoicesTable).set({
        status: "WrittenOff",
        outstandingAmount: "0",
        writeOffJournalEntryId: je.id,
        writeOffAmount: String(outstanding),
        writeOffDate: today,
        writeOffReason: reason || null,
      }).where(eq(invoicesTable.id, id)).returning();

      await tx.insert(activitiesTable).values({
        type: "update",
        title: "發票轉呆帳",
        description: `${inv.invoiceNumber} 未收餘額 NT$ ${outstanding.toLocaleString()} 轉列呆帳損失（分錄 ${je.entryNumber}）${reason ? `，原因：${reason}` : ""}`,
        module: "Accounting",
      });
      return { invoice: row, journalEntry: je };
    });
    res.json({ ...numericInvoice(result.invoice), journalEntryNumber: result.journalEntry.entryNumber, writeOffAmount: Number(result.invoice.writeOffAmount) });
  } catch (err: any) {
    res.status(err.statusCode || 400).json({ error: friendlyCaughtError(err, "轉呆帳失敗，請稍後再試") });
  }
});

// 取消呆帳：刪除呆帳分錄並將發票恢復為未付款，可再進行收款
router.post("/invoices/:id/cancel-write-off", requireRole("owner", "admin", "finance_admin", "accountant"), async (req, res): Promise<void> => {
  const id = parseInt(String(req.params.id));
  if (isNaN(id)) { res.status(400).json({ error: "發票編號格式不正確" }); return; }
  try {
    const row = await db.transaction(async (tx) => {
      const [inv] = await tx.select().from(invoicesTable).where(eq(invoicesTable.id, id)).for("update");
      if (!inv) throw Object.assign(new Error("找不到發票"), { statusCode: 404 });
      if (inv.status !== "WrittenOff") throw new Error("此發票不是呆帳狀態");
      if (inv.writeOffDate) await assertPeriodOpen(tx, inv.writeOffDate, "取消呆帳");
      if (inv.writeOffJournalEntryId) {
        await tx.delete(journalEntriesTable).where(eq(journalEntriesTable.id, inv.writeOffJournalEntryId));
      }
      await tx.update(invoicesTable).set({
        status: "Unpaid",
        writeOffJournalEntryId: null,
        writeOffAmount: "0",
        writeOffDate: null,
        writeOffReason: null,
      }).where(eq(invoicesTable.id, id));
      // 依沖帳紀錄重算已付/未付與狀態
      await recomputeInvoices(tx, [id]);
      await tx.insert(activitiesTable).values({
        type: "update",
        title: "取消呆帳",
        description: `${inv.invoiceNumber} 呆帳已取消，發票恢復為未收款狀態`,
        module: "Accounting",
      });
      const [updated] = await tx.select().from(invoicesTable).where(eq(invoicesTable.id, id));
      return updated;
    });
    res.json(numericInvoice(row));
  } catch (err: any) {
    res.status(err.statusCode || 400).json({ error: friendlyCaughtError(err, "取消呆帳失敗，請稍後再試") });
  }
});

// ============ 綠界 ECPay 電子發票 ============

// 預覽：自動讀取客戶資訊以填充開立發票表單
router.get("/sales-orders/:id/ecpay-invoice-preview", async (req, res): Promise<void> => {
  const orderId = parseInt(req.params.id);
  if (isNaN(orderId)) { res.status(400).json({ error: "銷貨單編號格式不正確" }); return; }

  const [order] = await db.select().from(salesOrdersTable).where(eq(salesOrdersTable.id, orderId));
  if (!order) { res.status(404).json({ error: "找不到銷貨單" }); return; }

  let customer: any = null;
  if (order.customerId) {
    const [cust] = await db.select().from(customersTable).where(eq(customersTable.id, order.customerId));
    customer = cust || null;
  }

  // 已存在的發票
  const existing = await db
    .select({
      id: invoicesTable.id,
      invoiceNumber: invoicesTable.invoiceNumber,
      ecpayInvoiceNumber: invoicesTable.ecpayInvoiceNumber,
      ecpayInvoiceDate: invoicesTable.ecpayInvoiceDate,
      ecpayRandomNumber: invoicesTable.ecpayRandomNumber,
      ecpayInvoiceType: invoicesTable.ecpayInvoiceType,
      ecpayVoidedAt: invoicesTable.ecpayVoidedAt,
      totalAmount: invoicesTable.totalAmount,
      status: invoicesTable.status,
    })
    .from(invoicesTable)
    .where(eq(invoicesTable.salesOrderId, orderId));

  const normalizedCustomer = customer ? normalizeSavedEcpayCustomer(customer) : null;
  // 推測發票類型：如果客戶有統編就預設為公司發票，否則為個人發票
  const invoiceType = normalizedCustomer?.taxId ? "company" : "personal";

  // 已開金額（排除作廢與取消），供分次開票計算剩餘可開
  const alreadyInvoiced = existing
    .filter(e => !e.ecpayVoidedAt && e.status !== "Cancelled")
    .reduce((s, e) => s + Number(e.totalAmount), 0);

  res.json({
    alreadyInvoiced,
    remainingAmount: Math.max(0, Number(order.totalAmount) - alreadyInvoiced),
    order: {
      id: order.id,
      orderNumber: order.orderNumber,
      orderDate: order.orderDate,
      totalAmount: Number(order.totalAmount),
      items: Array.isArray(order.items) ? order.items : [],
    },
    customer: normalizedCustomer,
    suggestedInvoiceType: invoiceType,
    existingInvoices: existing.map(e => ({ ...e, totalAmount: Number(e.totalAmount) })),
  });
});

// 開立綠界電子發票
router.post("/sales-orders/:id/issue-ecpay-invoice", requireInvoicePermission("issue"), async (req, res): Promise<void> => {
  const orderId = Number(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id);
  if (isNaN(orderId)) { res.status(400).json({ error: "銷貨單編號格式不正確" }); return; }
  const issueKey = String(req.get("Idempotency-Key") || req.body?.idempotencyKey || "").trim();
  if (!/^[A-Za-z0-9-]{8,100}$/.test(issueKey)) {
    res.status(400).json({ error: "開票請求識別碼格式不正確，請關閉視窗後重新開啟再試" }); return;
  }

  const [order] = await db.select().from(salesOrdersTable).where(eq(salesOrdersTable.id, orderId));
  if (!order) { res.status(404).json({ error: "找不到銷貨單" }); return; }
  // 舊系統搬來的歷史單：舊系統開過發票的不能再開；沒開過的可以補開（不再入帳）
  const legacyBlock = await legacyOrderInvoiceBlock(order);
  if (legacyBlock) { res.status(400).json({ error: legacyBlock }); return; }

  const {
    invoiceType,
    customerEmail,
    customerName,
    customerPhone,
    customerAddr,
    taxId,
    companyTitle,
    carrierType,
    carrierNum,
    loveCode,
    items: customItems,
  } = req.body as Record<string, any>;

  if (!invoiceType || !["personal", "company", "donation"].includes(invoiceType)) {
    res.status(400).json({ error: "發票類型必須為個人、公司或捐贈發票" });
    return;
  }
  // 品項：前端可傳自訂品項（分次開票），未傳則以訂單全部品項開立
  const sourceItems = Array.isArray(customItems) && customItems.length > 0
    ? customItems
    : (Array.isArray(order.items) ? order.items : []);
  const items = sourceItems.map((it: any) => {
    const qty = Number(it.count ?? it.quantity ?? 1);
    const rate = Number(it.unitPrice ?? it.rate ?? 0);
    const amount = Number(it.amount ?? qty * rate);
    return {
      name: String(it.name || it.itemName || "商品"),
      count: qty,
      unitPrice: rate,
      amount,
    };
  }).filter(it => it.amount > 0);

  if (items.length === 0) {
    res.status(400).json({ error: "訂單沒有任何品項，無法開立發票" });
    return;
  }
  if (items.some(it => !Number.isFinite(it.amount) || !Number.isFinite(it.count) || it.count <= 0 || it.unitPrice < 0)) {
    res.status(400).json({ error: "發票品項的數量或金額格式不正確" });
    return;
  }

  const salesAmount = Math.round(items.reduce((s, it) => s + it.amount, 0));
  if (salesAmount <= 0) {
    res.status(400).json({ error: "發票金額必須大於 0" });
    return;
  }

  const tenantId = reqTenantId(req);
  const requestInput = {
    invoiceType: invoiceType as "personal" | "company" | "donation",
    customerEmail: String(customerEmail || ""),
    customerName: String(customerName || ""),
    customerPhone: String(customerPhone || ""),
    customerAddr: String(customerAddr || ""),
    carrierType: String(carrierType || ""),
    carrierNum: String(carrierNum || ""),
    loveCode: String(loveCode || ""),
    taxId: String(taxId || ""),
    companyTitle: String(companyTitle || ""),
    salesAmount,
    items,
  };
  const payloadHash = crypto.createHash("sha256").update(JSON.stringify(requestInput)).digest("hex");
  const relateNumber = `T${tenantId}K${crypto.createHash("sha256").update(`${tenantId}:${issueKey}`).digest("hex").slice(0, 20)}`;
  const requestedInvoiceDate = todayTaipei();

  try {
    const prepared = await db.transaction(async (tx) => {
      const [lockedOrder] = await tx.select().from(salesOrdersTable)
        .where(eq(salesOrdersTable.id, orderId)).for("update");
      if (!lockedOrder) throw Object.assign(new Error("找不到銷貨單"), { statusCode: 404 });

      const [existingOperation] = await tx.select().from(ecpayInvoiceIssueRequestsTable)
        .where(eq(ecpayInvoiceIssueRequestsTable.idempotencyKey, issueKey)).limit(1);
      if (existingOperation) {
        if (existingOperation.salesOrderId !== orderId || existingOperation.payloadHash !== payloadHash) {
          throw Object.assign(new Error("此開票識別碼已用於不同內容；為避免帳務錯置，請關閉視窗後重新開啟"), { statusCode: 409 });
        }
        if (existingOperation.invoiceId) {
          const [existingInvoice] = await tx.select().from(invoicesTable)
            .where(eq(invoicesTable.id, existingOperation.invoiceId));
        if (existingInvoice) {
          if (existingOperation.status !== "Issued") {
            const [repairedOperation] = await tx.update(ecpayInvoiceIssueRequestsTable).set({ status: "Issued" })
              .where(eq(ecpayInvoiceIssueRequestsTable.id, existingOperation.id)).returning();
            return { operation: repairedOperation, invoice: existingInvoice, existed: true };
          }
          return { operation: existingOperation, invoice: existingInvoice, existed: true };
        }
        }
        if (existingOperation.status === "Failed") {
          throw Object.assign(new Error("前次開票已確認失敗，請關閉視窗後重新開啟再試"), { statusCode: 409, retryable: true });
        }
        return { operation: existingOperation, invoice: null, existed: true };
      }

      assertIntegerInvoiceItems(items);
      const buyerIssues = missingIssues(requestInput);
      if (buyerIssues.length > 0) {
        throw Object.assign(new Error(`買方資料不完整：${buyerIssues.join("、")}`), { statusCode: 400 });
      }

      const existingRows = await tx.select({ totalAmount: invoicesTable.totalAmount })
        .from(invoicesTable).where(and(
          eq(invoicesTable.salesOrderId, orderId),
          ne(invoicesTable.status, "Cancelled"),
          isNull(invoicesTable.ecpayVoidedAt),
        ));
      const openOperations = await tx.select({ requestPayload: ecpayInvoiceIssueRequestsTable.requestPayload })
        .from(ecpayInvoiceIssueRequestsTable).where(and(
          eq(ecpayInvoiceIssueRequestsTable.salesOrderId, orderId),
          inArray(ecpayInvoiceIssueRequestsTable.status, ["Prepared", "Sending", "ReconcileRequired"]),
          isNull(ecpayInvoiceIssueRequestsTable.invoiceId),
        ));
      const alreadyInvoiced = existingRows.reduce((sum, row) => sum + Number(row.totalAmount), 0);
      const reserved = openOperations.reduce((sum, row) =>
        sum + Number((row.requestPayload as { salesAmount?: number } | null)?.salesAmount || 0), 0);
      const remaining = Number(lockedOrder.totalAmount) - alreadyInvoiced - reserved;
      if (salesAmount > remaining + 0.001) {
        throw Object.assign(new Error(
          `開立金額 $${salesAmount.toLocaleString()} 超過此訂單剩餘可開金額 $${Math.max(0, Math.round(remaining)).toLocaleString()}（已開或處理中 $${Math.round(alreadyInvoiced + reserved).toLocaleString()}）`,
        ), { statusCode: 400 });
      }
      await assertVatAccountsReady(tx);
      await assertPeriodOpen(tx, requestedInvoiceDate, "開立綠界發票");
      const [operation] = await tx.insert(ecpayInvoiceIssueRequestsTable).values({
        salesOrderId: orderId,
        idempotencyKey: issueKey,
        relateNumber,
        payloadHash,
        requestPayload: {
          ...requestInput,
          invoiceDate: requestedInvoiceDate,
          customerId: lockedOrder.customerId,
          orderNumber: lockedOrder.orderNumber,
        },
        status: "Prepared",
      }).returning();
      return { operation, invoice: null, existed: false };
    });

    if (prepared.invoice) {
      res.json({ success: true, idempotent: true, invoice: numericInvoice(prepared.invoice) });
      return;
    }

    let operation = prepared.operation;
    let result: Awaited<ReturnType<typeof issueInvoice>> | null = null;
    const [claimed] = await db.update(ecpayInvoiceIssueRequestsTable).set({ status: "Sending" })
      .where(and(
        eq(ecpayInvoiceIssueRequestsTable.id, operation.id),
        eq(ecpayInvoiceIssueRequestsTable.status, "Prepared"),
        isNull(ecpayInvoiceIssueRequestsTable.invoiceId),
      )).returning();

    if (claimed) {
      operation = claimed;
      const payload = operation.requestPayload as typeof requestInput & { invoiceDate: string };
      result = await issueInvoice({
        relateNumber: operation.relateNumber,
        customerEmail: payload.customerEmail,
        customerName: payload.customerName,
        customerPhone: payload.customerPhone,
        customerAddr: payload.customerAddr,
        invoiceType: payload.invoiceType,
        carrierType: payload.carrierType,
        carrierNum: payload.carrierNum,
        loveCode: payload.loveCode,
        taxId: payload.taxId,
        companyTitle: payload.companyTitle,
        salesAmount: payload.salesAmount,
        items: payload.items,
      });
    } else {
      [operation] = await db.select().from(ecpayInvoiceIssueRequestsTable)
        .where(eq(ecpayInvoiceIssueRequestsTable.id, operation.id));
    }

    const duplicateRelateNumber = !!result && !result.success &&
      String(result.rawResponse?.RtnCode || "") === "10000009";
    if (!result || duplicateRelateNumber) {
      const recovered = await queryInvoiceByRelateNumber(operation.relateNumber);
      const payload = operation.requestPayload as typeof requestInput & { invoiceDate: string };
      if (recovered.success && recovered.invoiceNumber && recovered.invoiceStatus !== "Voided" &&
          recovered.relateNumber === operation.relateNumber &&
          recovered.salesAmount === payload.salesAmount) {
        result = {
          success: true,
          message: "已找回先前成功開立的綠界發票",
          invoiceNumber: recovered.invoiceNumber,
          invoiceDate: recovered.invoiceDate || payload.invoiceDate,
          randomNumber: recovered.randomNumber,
          rawResponse: recovered.rawResponse,
          isTest: recovered.isTest,
        };
      } else if (!recovered.outcomeUnknown &&
          Date.now() - operation.createdAt.getTime() > 60_000 &&
          ["Sending", "ReconcileRequired"].includes(operation.status)) {
        const [reset] = await db.update(ecpayInvoiceIssueRequestsTable).set({ status: "Prepared" })
          .where(and(
            eq(ecpayInvoiceIssueRequestsTable.id, operation.id),
            inArray(ecpayInvoiceIssueRequestsTable.status, ["Sending", "ReconcileRequired"]),
            isNull(ecpayInvoiceIssueRequestsTable.invoiceId),
          )).returning();
        if (reset) {
          res.status(409).json({ error: "已確認綠界尚未開立，請按原按鈕再試一次；系統會沿用同一請求，不會重複開票", retryableSameKey: true });
          return;
        }
      } else if (duplicateRelateNumber) {
        result = {
          success: false,
          outcomeUnknown: true,
          message: "綠界回報關聯編號已存在，但查回內容無法與原始開票請求安全核對",
          rawResponse: recovered.rawResponse,
          isTest: recovered.isTest,
        };
      }
    }

    if (!result?.success || !result.invoiceNumber) {
      const outcomeUnknown = !result || !!result.outcomeUnknown;
      await db.update(ecpayInvoiceIssueRequestsTable).set({
        status: outcomeUnknown ? "ReconcileRequired" : "Failed",
        ecpayResponse: result?.rawResponse || null,
        errorMessage: result?.message || "綠界開票結果不明",
      }).where(and(
        eq(ecpayInvoiceIssueRequestsTable.id, operation.id),
        inArray(ecpayInvoiceIssueRequestsTable.status, ["Sending", "ReconcileRequired"]),
        isNull(ecpayInvoiceIssueRequestsTable.invoiceId),
      ));
      res.status(outcomeUnknown ? 502 : 400).json({
        error: outcomeUnknown
          ? "綠界開票結果仍待確認，請保留此視窗並稍後按原按鈕重試，系統不會建立第二張"
          : result?.message || "綠界發票開立失敗",
        retryable: !outcomeUnknown,
        isTest: result?.isTest,
      });
      return;
    }

    const completion = await db.transaction(async (tx) => {
      const [lockedOperation] = await tx.select().from(ecpayInvoiceIssueRequestsTable)
        .where(eq(ecpayInvoiceIssueRequestsTable.id, operation.id)).for("update");
      if (lockedOperation.invoiceId) {
        const [existingInvoice] = await tx.select().from(invoicesTable)
          .where(eq(invoicesTable.id, lockedOperation.invoiceId));
        if (existingInvoice) {
          if (lockedOperation.status !== "Issued") {
            await tx.update(ecpayInvoiceIssueRequestsTable).set({ status: "Issued" })
              .where(eq(ecpayInvoiceIssueRequestsTable.id, lockedOperation.id));
          }
          return { invoice: existingInvoice, created: false };
        }
      }
      const payload = lockedOperation.requestPayload as typeof requestInput & {
        invoiceDate: string;
        customerId: number | null;
        orderNumber: string;
      };
      await assertPeriodOpen(tx, payload.invoiceDate, "開立綠界發票");
      const tax = taxFields(payload.salesAmount, 1, "taxable", 5, true);
      const [createdRow] = await tx.insert(invoicesTable).values({
        invoiceNumber: result.invoiceNumber!,
        invoiceType: "Sales",
        customerId: payload.customerId,
        salesOrderId: lockedOperation.salesOrderId,
        invoiceDate: payload.invoiceDate,
        status: "Unpaid",
        totalAmount: String(payload.salesAmount),
        outstandingAmount: String(payload.salesAmount),
        taxType: "taxable",
        taxRate: "5",
        netAmount: String(tax.netAmount),
        taxAmount: String(tax.taxAmount),
        items: payload.items,
        ecpayIssueKey: lockedOperation.idempotencyKey,
        ecpayInvoiceNumber: result.invoiceNumber,
        ecpayRandomNumber: result.randomNumber,
        ecpayInvoiceDate: result.invoiceDate || payload.invoiceDate,
        ecpayInvoiceType: payload.invoiceType,
        ecpayStatus: "Issued",
        ecpayLastSyncedAt: new Date(),
        ecpayCarrierType: payload.carrierType || null,
        ecpayCarrierNum: payload.carrierNum || null,
        ecpayLoveCode: payload.loveCode || null,
        ecpayTaxId: payload.taxId || null,
        ecpayCompanyTitle: payload.companyTitle || null,
        ecpayBuyerName: payload.customerName || null,
        ecpayBuyerEmail: payload.customerEmail || null,
        ecpayBuyerPhone: payload.customerPhone || null,
        ecpayBuyerAddr: payload.customerAddr || null,
        ecpayResponse: result.rawResponse || null,
        ecpayLastSyncResponse: result.rawResponse || null,
      }).returning();
      // 套用付款條件（指定的，或客戶／供應商的預設）：排出各期到期日
      const created = await applyPaymentTerm(tx, createdRow, undefined);
      await createInvoiceJournalEntry(tx, created);
      await recomputeInvoices(tx, [created.id]);
      await syncSalesOrderJournalEntry(tx, lockedOperation.salesOrderId);
      await tx.update(ecpayInvoiceIssueRequestsTable).set({
        status: "Issued",
        invoiceId: created.id,
        ecpayInvoiceNumber: result.invoiceNumber,
        ecpayInvoiceDate: result.invoiceDate || payload.invoiceDate,
        ecpayRandomNumber: result.randomNumber || null,
        ecpayResponse: result.rawResponse || null,
        errorMessage: null,
      }).where(eq(ecpayInvoiceIssueRequestsTable.id, lockedOperation.id));
      await tx.insert(activitiesTable).values({
        type: "create",
        title: "開立綠界電子發票",
        description: `${result.invoiceNumber} - $${payload.salesAmount.toLocaleString()} (來自 ${payload.orderNumber})${result.isTest ? " [測試環境]" : ""}`,
        module: "Accounting",
      });
      return { invoice: created, created: true };
    });
    if (completion.created) await autoSendInvoiceEmail(completion.invoice.id);

    res.status(completion.created ? 201 : 200).json({
    success: true,
      idempotent: prepared.existed || !completion.created,
      isTest: result.isTest,
      invoice: numericInvoice(completion.invoice),
    });
  } catch (err: any) {
    res.status(err.statusCode || 400).json({
      error: friendlyCaughtError(err, "開立綠界發票失敗，請確認資料後再試"),
      ...(err.retryable ? { retryable: true } : {}),
    });
  }
});

// 同步綠界發票狀態
router.post("/invoices/:id/ecpay-sync", requireRole(...FINANCE_ROLES), async (req, res): Promise<void> => {
  const id = Number(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: "發票編號格式不正確" }); return;
  }
  const [inv] = await db.select().from(invoicesTable).where(eq(invoicesTable.id, id));
  if (!inv) { res.status(404).json({ error: "找不到發票" }); return; }
  if (!inv.ecpayInvoiceNumber || !inv.ecpayInvoiceDate) {
    res.status(400).json({ error: "此發票非綠界發票或缺少必要資訊" }); return;
  }
  const result = await queryInvoice(inv.ecpayInvoiceNumber, inv.ecpayInvoiceDate.slice(0, 10));
  if (!result.success) {
    res.status(502).json({ error: result.message || "查詢綠界發票失敗" }); return;
  }
  let updated: typeof invoicesTable.$inferSelect;
  if (result.invoiceStatus === "Voided") {
    updated = await finalizeEcpayInvoiceVoid(id, inv.ecpayVoidReason || "由綠界狀態同步確認已作廢", result.rawResponse);
  } else {
    try {
      updated = await db.transaction(async (tx) => {
        const [current] = await tx.select().from(invoicesTable)
          .where(eq(invoicesTable.id, id)).for("update");
        if (!current) throw Object.assign(new Error("找不到發票"), { statusCode: 404 });
        if (current.ecpayVoidedAt) return current;
        if (["VoidPending", "ReconcileRequired"].includes(current.ecpayStatus || "") &&
            current.ecpayVoidRequestedAt &&
            Date.now() - current.ecpayVoidRequestedAt.getTime() < 120_000) {
          throw Object.assign(new Error("作廢請求仍可能在綠界處理中，請兩分鐘後再同步，系統不會覆蓋處理中的狀態"), { statusCode: 409 });
        }
        const [row] = await tx.update(invoicesTable).set({
          ecpayStatus: "Issued",
          ecpayLastSyncedAt: new Date(),
          ecpayLastSyncResponse: result.rawResponse || null,
          ecpayVoidRequestedAt: null,
        }).where(and(eq(invoicesTable.id, id), isNull(invoicesTable.ecpayVoidedAt))).returning();
        return row || current;
      });
    } catch (error: any) {
      res.status(error.statusCode || 400).json({ error: friendlyCaughtError(error, "同步綠界狀態失敗") }); return;
    }
  }
  res.json({ success: true, invoice: numericInvoice(updated), remote: result.rawResponse });
});

router.get("/invoices/:id/ecpay-allowances", async (req, res): Promise<void> => {
  const id = Number(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: "發票編號格式不正確" }); return;
  }
  const [inv] = await db.select({ id: invoicesTable.id }).from(invoicesTable).where(eq(invoicesTable.id, id));
  if (!inv) { res.status(404).json({ error: "找不到發票" }); return; }
  const rows = await db.select().from(ecpayInvoiceAllowancesTable)
    .where(eq(ecpayInvoiceAllowancesTable.invoiceId, id))
    .orderBy(ecpayInvoiceAllowancesTable.createdAt);
  res.json(rows.map((row) => ({ ...row, amount: Number(row.amount), accountingEffect: "none" })));
});

router.post("/invoices/:id/ecpay-allowances", requireRole(...FINANCE_ROLES), async (req, res): Promise<void> => {
  const id = Number(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: "發票編號格式不正確" }); return;
  }
  const body = req.body as Record<string, unknown>;
  const idempotencyKey = String(req.get("Idempotency-Key") || body.idempotencyKey || "").trim();
  if (!idempotencyKey || idempotencyKey.length > 100) {
    res.status(400).json({ error: "必須提供 1 至 100 字元的 Idempotency-Key" }); return;
  }
  const amount = Number(body.amount);
  const reason = String(body.reason || "").trim();
  const notify = String(body.notify || "N");
  const sourceItems = Array.isArray(body.items) ? body.items as Record<string, unknown>[] : [];
  const items = sourceItems.map((item) => ({
    name: String(item.name || item.itemName || "").trim(),
    count: Number(item.count ?? item.quantity),
    unitPrice: Number(item.unitPrice ?? item.rate),
    amount: Number(item.amount),
    word: item.word == null ? undefined : String(item.word),
  }));
  if (!Number.isFinite(amount) || amount <= 0 || Math.round(amount) !== amount) {
    res.status(400).json({ error: "折讓金額必須為正整數（新台幣元）" }); return;
  }
  if (!reason || reason.length > 200) {
    res.status(400).json({ error: "折讓原因為必填，且不可超過 200 字" }); return;
  }
  if (!["E", "S", "A", "N"].includes(notify)) {
    res.status(400).json({ error: "notify 必須為 E、S、A 或 N" }); return;
  }
  if (items.length === 0 || items.some((item) =>
    !item.name || !Number.isFinite(item.count) || item.count <= 0 ||
    !Number.isFinite(item.unitPrice) || item.unitPrice < 0 ||
    !Number.isFinite(item.amount) || item.amount <= 0
  )) {
    res.status(400).json({ error: "折讓品項名稱、數量、單價或金額格式不正確" }); return;
  }
  const itemTotal = Math.round(items.reduce((sum, item) => sum + item.amount, 0));
  if (itemTotal !== amount) {
    res.status(400).json({ error: "折讓品項金額合計必須等於折讓總額" }); return;
  }
  const notifyEmail = body.notifyEmail == null ? "" : String(body.notifyEmail).trim();
  const notifyPhone = body.notifyPhone == null ? "" : String(body.notifyPhone).trim();
  if ((notify === "E" || notify === "A") && !notifyEmail) {
    res.status(400).json({ error: "Email 通知必須提供 notifyEmail" }); return;
  }
  if ((notify === "S" || notify === "A") && !notifyPhone) {
    res.status(400).json({ error: "簡訊通知必須提供 notifyPhone" }); return;
  }

  let inv: typeof invoicesTable.$inferSelect;
  let pending: typeof ecpayInvoiceAllowancesTable.$inferSelect;
  try {
    ({ inv, pending } = await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT id FROM invoices WHERE id = ${id} FOR UPDATE`);
      const [locked] = await tx.select().from(invoicesTable).where(eq(invoicesTable.id, id));
      if (!locked) throw new Error("NOT_FOUND");
      if (locked.invoiceType !== "Sales" || !locked.ecpayInvoiceNumber || !locked.ecpayInvoiceDate) throw new Error("NOT_ECPAY_SALES");
      if (locked.ecpayVoidedAt || locked.status === "Cancelled") throw new Error("INVOICE_VOIDED");
      await assertPeriodOpen(tx, locked.invoiceDate, "開立發票折讓");
      const [duplicate] = await tx.select().from(ecpayInvoiceAllowancesTable).where(and(
        eq(ecpayInvoiceAllowancesTable.invoiceId, id),
        eq(ecpayInvoiceAllowancesTable.idempotencyKey, idempotencyKey),
      ));
      if (duplicate) throw Object.assign(new Error("IDEMPOTENT"), { row: duplicate });
      const active = await tx.select({ amount: ecpayInvoiceAllowancesTable.amount })
        .from(ecpayInvoiceAllowancesTable).where(and(
          eq(ecpayInvoiceAllowancesTable.invoiceId, id),
          ne(ecpayInvoiceAllowancesTable.status, "Voided"),
          ne(ecpayInvoiceAllowancesTable.status, "Failed"),
        ));
      const alreadyAllowed = active.reduce((sum, row) => sum + Number(row.amount), 0);
      if (alreadyAllowed + amount > Number(locked.totalAmount) + 0.001) throw new Error("ALLOWANCE_EXCEEDS");
      const [created] = await tx.insert(ecpayInvoiceAllowancesTable).values({
        invoiceId: id,
        idempotencyKey,
        allowanceDate: todayTaipei(),
        amount: String(amount),
        items,
        reason,
        notifyType: notify,
        status: "Pending",
      }).returning();
      return { inv: locked, pending: created };
    }));
  } catch (error: any) {
    if (error?.message === "IDEMPOTENT" && error.row) {
      if (error.row.status === "Issued" || error.row.status === "Voided") {
        res.status(200).json({ success: true, idempotent: true, allowance: { ...error.row, amount: Number(error.row.amount), accountingEffect: "none" } }); return;
      }
      if (error.row.status === "Failed") {
        res.status(409).json({ error: "前次折讓已確認失敗，請重新送出新的折讓請求", retryable: true }); return;
      }
      res.status(409).json({
        error: "前次折讓結果仍待確認，為避免重複折讓不得重送；請至綠界後台確認後連結折讓單號",
        reconciliationRequired: true,
        allowance: { ...error.row, amount: Number(error.row.amount), accountingEffect: "none" },
      });
      return;
    }
    const messages: Record<string, [number, string]> = {
      NOT_FOUND: [404, "找不到發票"],
      NOT_ECPAY_SALES: [400, "只能對已開立的銷項綠界發票開立折讓"],
      INVOICE_VOIDED: [400, "已作廢發票不可開立折讓"],
      ALLOWANCE_EXCEEDS: [400, "折讓總額不可超過發票尚可折讓金額"],
    };
    const known = messages[error?.message];
    res.status(known?.[0] || 400).json({ error: known?.[1] || friendlyCaughtError(error, "折讓前檢查未通過") }); return;
  }

  const result = await issueAllowance({
    invoiceNumber: inv.ecpayInvoiceNumber!,
    invoiceDate: inv.ecpayInvoiceDate!.slice(0, 10),
    amount,
    customerName: inv.ecpayBuyerName || undefined,
    reason,
    notify: notify as "E" | "S" | "A" | "N",
    notifyEmail,
    notifyPhone,
    items,
  });
  if (!result.success || !result.allowanceNumber) {
    await db.update(ecpayInvoiceAllowancesTable).set({
      status: result.outcomeUnknown ? "IssueReconcileRequired" : "Failed",
      ecpayResponse: result.rawResponse || null,
    }).where(and(
      eq(ecpayInvoiceAllowancesTable.id, pending.id),
      eq(ecpayInvoiceAllowancesTable.status, "Pending"),
    ));
    res.status(502).json({
      error: result.outcomeUnknown
        ? "綠界回應不明，系統已保留折讓額度且不會自動重送；請至綠界後台確認後連結折讓單號"
        : result.message || "綠界折讓開立失敗",
      retryable: !result.outcomeUnknown,
      reconciliationRequired: !!result.outcomeUnknown,
    });
    return;
  }
  const [issued] = await db.update(ecpayInvoiceAllowancesTable).set({
    status: "Issued",
    allowanceNumber: result.allowanceNumber,
    ecpayResponse: result.rawResponse || null,
  }).where(eq(ecpayInvoiceAllowancesTable.id, pending.id)).returning();
  await db.insert(activitiesTable).values({
    type: "create",
    title: "開立綠界發票折讓",
    description: `${inv.ecpayInvoiceNumber} / ${result.allowanceNumber} - $${amount.toLocaleString()} - ${reason}`,
    module: "Accounting",
  });
  res.status(201).json({
    success: true,
    allowance: { ...issued, amount: Number(issued.amount), accountingEffect: "none" },
  });
});

router.post("/invoices/:invoiceId/ecpay-allowances/:allowanceId/reconcile", requireRole(...FINANCE_ROLES), async (req, res): Promise<void> => {
  const invoiceId = Number(Array.isArray(req.params.invoiceId) ? req.params.invoiceId[0] : req.params.invoiceId);
  const allowanceId = Number(Array.isArray(req.params.allowanceId) ? req.params.allowanceId[0] : req.params.allowanceId);
  const allowanceNumber = String(req.body?.allowanceNumber || "").trim();
  if (!Number.isInteger(invoiceId) || !Number.isInteger(allowanceId) || !/^\d{16}$/.test(allowanceNumber)) {
    res.status(400).json({ error: "請輸入綠界後台顯示的 16 碼折讓單號" }); return;
  }
  const [allowance] = await db.select().from(ecpayInvoiceAllowancesTable).where(and(
    eq(ecpayInvoiceAllowancesTable.id, allowanceId),
    eq(ecpayInvoiceAllowancesTable.invoiceId, invoiceId),
  ));
  const [inv] = await db.select().from(invoicesTable).where(eq(invoicesTable.id, invoiceId));
  if (!allowance || !inv?.ecpayInvoiceNumber) {
    res.status(404).json({ error: "找不到綠界發票折讓紀錄" }); return;
  }
  if (!["Pending", "IssueReconcileRequired"].includes(allowance.status)) {
    res.status(400).json({ error: "只有待確認的折讓可以連結綠界單號" }); return;
  }
  const result = await queryAllowance(inv.ecpayInvoiceNumber, allowanceNumber);
  if (!result.success) {
    res.status(502).json({ error: result.message || "綠界查無此折讓單，請確認單號後再試" }); return;
  }
  if (result.allowanceAmount !== Number(allowance.amount)) {
    res.status(409).json({ error: `綠界折讓金額 ${result.allowanceAmount} 與 ERP 保留金額 ${Number(allowance.amount)} 不一致，已拒絕連結` }); return;
  }
  const [updated] = await db.update(ecpayInvoiceAllowancesTable).set({
    status: "Issued",
    allowanceNumber,
    ecpayResponse: result.rawResponse || null,
  }).where(and(
    eq(ecpayInvoiceAllowancesTable.id, allowance.id),
    inArray(ecpayInvoiceAllowancesTable.status, ["Pending", "IssueReconcileRequired"]),
  )).returning();
  res.json({ success: true, allowance: { ...updated, amount: Number(updated.amount), accountingEffect: "none" } });
});

router.post("/invoices/:invoiceId/ecpay-allowances/:allowanceId/confirm-not-issued", requireRole(...FINANCE_ROLES), async (req, res): Promise<void> => {
  const invoiceId = Number(Array.isArray(req.params.invoiceId) ? req.params.invoiceId[0] : req.params.invoiceId);
  const allowanceId = Number(Array.isArray(req.params.allowanceId) ? req.params.allowanceId[0] : req.params.allowanceId);
  if (!Number.isInteger(invoiceId) || !Number.isInteger(allowanceId)) {
    res.status(400).json({ error: "發票或折讓編號格式不正確" }); return;
  }
  const [allowance] = await db.select().from(ecpayInvoiceAllowancesTable).where(and(
    eq(ecpayInvoiceAllowancesTable.id, allowanceId),
    eq(ecpayInvoiceAllowancesTable.invoiceId, invoiceId),
  ));
  const [inv] = await db.select().from(invoicesTable).where(eq(invoicesTable.id, invoiceId));
  if (!allowance || !inv?.ecpayInvoiceNumber || !inv.ecpayInvoiceDate) {
    res.status(404).json({ error: "找不到綠界發票折讓紀錄" }); return;
  }
  if (!["Pending", "IssueReconcileRequired"].includes(allowance.status)) {
    res.status(400).json({ error: "只有開立結果待確認的折讓可以解除保留" }); return;
  }
  if (Date.now() - allowance.createdAt.getTime() < 120_000) {
    res.status(409).json({ error: "原折讓請求仍可能在綠界處理中，請兩分鐘後再確認未開立" }); return;
  }
  const snapshot = await db.select({
    id: ecpayInvoiceAllowancesTable.id,
    status: ecpayInvoiceAllowancesTable.status,
    amount: ecpayInvoiceAllowancesTable.amount,
    updatedAt: ecpayInvoiceAllowancesTable.updatedAt,
  }).from(ecpayInvoiceAllowancesTable)
    .where(eq(ecpayInvoiceAllowancesTable.invoiceId, invoiceId))
    .orderBy(ecpayInvoiceAllowancesTable.id);
  if (snapshot.some((row) =>
    row.id !== allowanceId && !["Issued", "Voided", "Failed"].includes(row.status)
  )) {
    res.status(409).json({ error: "此發票還有其他結果待確認的折讓，暫時無法判定是哪一筆影響綠界餘額；請先完成其他折讓對帳" });
    return;
  }
  const remote = await queryInvoice(inv.ecpayInvoiceNumber, inv.ecpayInvoiceDate.slice(0, 10));
  if (!remote.success || remote.remainingAllowanceAmount == null) {
    res.status(502).json({ error: "目前無法從綠界確認剩餘折讓金額，為避免重複折讓，保留額度不會解除" }); return;
  }
  let updated: typeof ecpayInvoiceAllowancesTable.$inferSelect;
  try {
    updated = await db.transaction(async (tx) => {
      const [lockedInvoice] = await tx.select().from(invoicesTable)
        .where(eq(invoicesTable.id, invoiceId)).for("update");
      const lockedRows = await tx.select().from(ecpayInvoiceAllowancesTable)
        .where(eq(ecpayInvoiceAllowancesTable.invoiceId, invoiceId))
        .orderBy(ecpayInvoiceAllowancesTable.id)
        .for("update");
      const unchanged = lockedRows.length === snapshot.length && snapshot.every((before, index) => {
        const after = lockedRows[index];
        return after?.id === before.id &&
          after.status === before.status &&
          after.updatedAt.getTime() === before.updatedAt.getTime();
      });
      if (!lockedInvoice || !unchanged) {
        throw Object.assign(new Error("對帳期間折讓狀態已變更，請重新整理後再確認"), { statusCode: 409 });
      }
      const lockedAllowance = lockedRows.find((row) => row.id === allowanceId);
      if (!lockedAllowance || !["Pending", "IssueReconcileRequired"].includes(lockedAllowance.status)) {
        throw Object.assign(new Error("此折讓已由另一個操作更新"), { statusCode: 409 });
      }
      const expectedRemaining = Math.round(Number(lockedInvoice.totalAmount) -
        lockedRows
          .filter((row) => row.id !== allowanceId && row.status === "Issued")
          .reduce((sum, row) => sum + Number(row.amount), 0));
      if (Math.round(remote.remainingAllowanceAmount!) !== expectedRemaining) {
        throw Object.assign(new Error("綠界剩餘可折讓金額顯示可能已存在這筆折讓，不能解除保留；請從綠界後台取得折讓單號後連結"), { statusCode: 409 });
      }
      const [row] = await tx.update(ecpayInvoiceAllowancesTable).set({
        status: "Failed",
        ecpayResponse: remote.rawResponse || null,
      }).where(and(
        eq(ecpayInvoiceAllowancesTable.id, allowanceId),
        inArray(ecpayInvoiceAllowancesTable.status, ["Pending", "IssueReconcileRequired"]),
      )).returning();
      if (!row) throw Object.assign(new Error("此折讓已由另一個操作更新"), { statusCode: 409 });
      return row;
    });
  } catch (error: any) {
    res.status(error.statusCode || 400).json({ error: friendlyCaughtError(error, "無法安全解除折讓保留") }); return;
  }
  res.json({ success: true, allowance: { ...updated, amount: Number(updated.amount), accountingEffect: "none" } });
});

router.post("/invoices/:invoiceId/ecpay-allowances/:allowanceId/void", requireRole(...FINANCE_ROLES), async (req, res): Promise<void> => {
  const invoiceId = Number(Array.isArray(req.params.invoiceId) ? req.params.invoiceId[0] : req.params.invoiceId);
  const allowanceId = Number(Array.isArray(req.params.allowanceId) ? req.params.allowanceId[0] : req.params.allowanceId);
  const reason = String(req.body?.reason || "").trim();
  if (!Number.isInteger(invoiceId) || !Number.isInteger(allowanceId) || !reason || reason.length > 200) {
    res.status(400).json({ error: "發票、折讓編號或作廢原因格式不正確" }); return;
  }
  const [existingAllowance] = await db.select().from(ecpayInvoiceAllowancesTable).where(and(
    eq(ecpayInvoiceAllowancesTable.id, allowanceId),
    eq(ecpayInvoiceAllowancesTable.invoiceId, invoiceId),
  ));
  const [existingInvoice] = await db.select().from(invoicesTable).where(eq(invoicesTable.id, invoiceId));
  if (existingAllowance?.allowanceNumber && existingInvoice?.ecpayInvoiceNumber &&
      ["VoidPending", "VoidReconcileRequired"].includes(existingAllowance.status)) {
    if (existingAllowance.status === "VoidPending" && existingAllowance.voidRequestedAt &&
        Date.now() - existingAllowance.voidRequestedAt.getTime() < 120_000) {
      res.status(409).json({ error: "折讓作廢仍可能在綠界處理中，請兩分鐘後再查詢結果" });
      return;
    }
    const reconciled = await queryVoidedAllowance(existingInvoice.ecpayInvoiceNumber, existingAllowance.allowanceNumber);
    if (reconciled.success) {
      const [updated] = await db.update(ecpayInvoiceAllowancesTable).set({
        status: "Voided",
        voidReason: existingAllowance.voidReason || reason,
        voidedAt: existingAllowance.voidedAt || new Date(),
        voidRequestedAt: null,
        ecpayResponse: reconciled.rawResponse || null,
      }).where(eq(ecpayInvoiceAllowancesTable.id, allowanceId)).returning();
      res.json({ success: true, idempotent: true, allowance: { ...updated, amount: Number(updated.amount), accountingEffect: "none" } });
      return;
    }
    const stillIssued = await queryAllowance(existingInvoice.ecpayInvoiceNumber, existingAllowance.allowanceNumber);
    if (stillIssued.success && stillIssued.allowanceAmount === Number(existingAllowance.amount)) {
      const [updated] = await db.update(ecpayInvoiceAllowancesTable).set({
        status: "Issued",
        voidReason: null,
        voidRequestedAt: null,
        ecpayResponse: stillIssued.rawResponse || null,
      }).where(and(
        eq(ecpayInvoiceAllowancesTable.id, allowanceId),
        inArray(ecpayInvoiceAllowancesTable.status, ["VoidPending", "VoidReconcileRequired"]),
        isNull(ecpayInvoiceAllowancesTable.voidedAt),
        existingAllowance.voidRequestedAt
          ? eq(ecpayInvoiceAllowancesTable.voidRequestedAt, existingAllowance.voidRequestedAt)
          : isNull(ecpayInvoiceAllowancesTable.voidRequestedAt),
      )).returning();
      if (!updated) {
        const [current] = await db.select().from(ecpayInvoiceAllowancesTable)
          .where(eq(ecpayInvoiceAllowancesTable.id, allowanceId));
        if (current?.status === "Voided" || current?.voidedAt) {
          res.json({ success: true, idempotent: true, allowance: { ...current, amount: Number(current.amount), accountingEffect: "none" } });
          return;
        }
        res.status(409).json({ error: "折讓狀態已由另一個操作更新，請重新整理後再確認" });
        return;
      }
      res.json({
        success: false,
        verifiedActive: true,
        message: "已向綠界確認此折讓仍有效；如仍需作廢，請重新執行一次作廢",
        allowance: { ...updated, amount: Number(updated.amount), accountingEffect: "none" },
      });
      return;
    }
    res.status(409).json({ error: "折讓作廢結果仍待綠界確認，請稍後再試，系統不會重複送出作廢" });
    return;
  }
  let inv: typeof invoicesTable.$inferSelect;
  let allowance: typeof ecpayInvoiceAllowancesTable.$inferSelect;
  try {
    ({ inv, allowance } = await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT id FROM ecpay_invoice_allowances WHERE id = ${allowanceId} FOR UPDATE`);
      const [lockedAllowance] = await tx.select().from(ecpayInvoiceAllowancesTable).where(and(
        eq(ecpayInvoiceAllowancesTable.id, allowanceId),
        eq(ecpayInvoiceAllowancesTable.invoiceId, invoiceId),
      ));
      const [lockedInvoice] = await tx.select().from(invoicesTable).where(eq(invoicesTable.id, invoiceId));
      if (!lockedInvoice || !lockedAllowance) throw new Error("找不到發票折讓");
      if (!lockedInvoice.ecpayInvoiceNumber || !lockedAllowance.allowanceNumber) throw new Error("折讓尚未成功開立");
      if (lockedAllowance.status === "Voided") throw Object.assign(new Error("ALREADY_VOIDED"), { row: lockedAllowance });
      if (lockedAllowance.status !== "Issued") throw new Error("只有已開立折讓可以作廢");
      await assertPeriodOpen(tx, lockedAllowance.allowanceDate, "作廢發票折讓");
      const [voidPending] = await tx.update(ecpayInvoiceAllowancesTable)
        .set({ status: "VoidPending", voidReason: reason, voidRequestedAt: new Date() })
        .where(eq(ecpayInvoiceAllowancesTable.id, lockedAllowance.id))
        .returning();
      return { inv: lockedInvoice, allowance: voidPending };
    }));
  } catch (error: any) {
    if (error?.message === "ALREADY_VOIDED") {
      res.json({ success: true, idempotent: true, allowance: { ...error.row, amount: Number(error.row.amount), accountingEffect: "none" } }); return;
    }
    res.status(400).json({ error: friendlyCaughtError(error, "折讓作廢前檢查未通過") }); return;
  }
  const result = await voidAllowance(inv.ecpayInvoiceNumber!, allowance.allowanceNumber!, reason);
  if (!result.success) {
    let recovered = false;
    if (result.outcomeUnknown) {
      const queried = await queryVoidedAllowance(inv.ecpayInvoiceNumber!, allowance.allowanceNumber!);
      recovered = queried.success;
    }
    if (!recovered) await db.update(ecpayInvoiceAllowancesTable).set({
      status: result.outcomeUnknown ? "VoidReconcileRequired" : "Issued",
      voidReason: result.outcomeUnknown ? reason : null,
      voidRequestedAt: result.outcomeUnknown ? allowance.voidRequestedAt : null,
      ecpayResponse: result.rawResponse || null,
    })
      .where(and(
        eq(ecpayInvoiceAllowancesTable.id, allowance.id),
        eq(ecpayInvoiceAllowancesTable.status, "VoidPending"),
      ));
    if (!recovered) {
      res.status(502).json({
        error: result.outcomeUnknown
          ? "綠界作廢結果仍待確認，系統不會重複送出；請稍後再試以查詢結果"
          : result.message || "綠界折讓作廢失敗",
      });
      return;
    }
  }
  const [updated] = await db.update(ecpayInvoiceAllowancesTable).set({
    status: "Voided",
    voidReason: reason,
    voidedAt: new Date(),
    voidRequestedAt: null,
    ecpayResponse: result.rawResponse || null,
  }).where(eq(ecpayInvoiceAllowancesTable.id, allowance.id)).returning();
  await db.insert(activitiesTable).values({
    type: "delete",
    title: "作廢綠界發票折讓",
    description: `${inv.ecpayInvoiceNumber} / ${allowance.allowanceNumber} - ${reason}`,
    module: "Accounting",
  });
  res.json({ success: true, allowance: { ...updated, amount: Number(updated.amount), accountingEffect: "none" } });
});

// 作廢綠界發票
router.post("/invoices/:id/void-ecpay", requireRole(...FINANCE_ROLES), async (req, res): Promise<void> => {
  const id = Number(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "發票編號格式不正確" }); return; }
  const reason = String(req.body?.reason || "").trim();
  if (!reason || reason.length > 200) {
    res.status(400).json({ error: "作廢原因為必填，且不可超過 200 字" }); return;
  }

  let inv: typeof invoicesTable.$inferSelect;
  try {
    inv = await db.transaction(async (tx) => {
      const [locked] = await tx.select().from(invoicesTable)
        .where(eq(invoicesTable.id, id)).for("update");
      if (!locked) throw Object.assign(new Error("找不到發票"), { statusCode: 404 });
      if (!locked.ecpayInvoiceNumber || !locked.ecpayInvoiceDate) throw new Error("此發票非綠界發票或缺少必要資訊");
      if (locked.ecpayVoidedAt) throw Object.assign(new Error("ALREADY_VOIDED"), { row: locked });
      if (locked.status === "WrittenOff") throw new Error("此發票已轉呆帳，請先取消呆帳再作廢");
      if (["VoidPending", "ReconcileRequired"].includes(locked.ecpayStatus || "")) {
        throw new Error("前次作廢結果仍待確認，請先按「同步綠界狀態」，系統不會重複送出作廢");
      }
      const [activeAllowance] = await tx.select({ id: ecpayInvoiceAllowancesTable.id })
        .from(ecpayInvoiceAllowancesTable)
        .where(and(
          eq(ecpayInvoiceAllowancesTable.invoiceId, id),
          ne(ecpayInvoiceAllowancesTable.status, "Voided"),
          ne(ecpayInvoiceAllowancesTable.status, "Failed"),
        )).limit(1);
      if (activeAllowance) throw new Error("此發票仍有有效或處理中的折讓單，請先作廢折讓單後再作廢整張發票");
      await assertPeriodOpen(tx, locked.invoiceDate, "作廢發票");
      const [pending] = await tx.update(invoicesTable).set({
        ecpayStatus: "VoidPending",
        ecpayVoidRequestedAt: new Date(),
      })
        .where(eq(invoicesTable.id, id)).returning();
      return pending;
    });
  } catch (error: any) {
    if (error?.message === "ALREADY_VOIDED") {
      res.json({ success: true, idempotent: true, invoice: numericInvoice(error.row) }); return;
    }
    res.status(error.statusCode || 400).json({ error: friendlyCaughtError(error, "作廢前檢查未通過") }); return;
  }

  const result = await voidInvoice(
    inv.ecpayInvoiceNumber!,
    inv.ecpayInvoiceDate!.slice(0, 10),
    reason,
  );

  if (!result.success) {
    let remoteVoided = false;
    if (result.outcomeUnknown) {
      const queried = await queryInvoice(inv.ecpayInvoiceNumber!, inv.ecpayInvoiceDate!.slice(0, 10));
      remoteVoided = queried.success && queried.invoiceStatus === "Voided";
    }
    if (!remoteVoided) {
      await db.update(invoicesTable).set({
        ecpayStatus: result.outcomeUnknown ? "ReconcileRequired" : "Issued",
        ecpayLastSyncedAt: new Date(),
        ecpayLastSyncResponse: result.rawResponse || null,
        ...(!result.outcomeUnknown ? { ecpayVoidRequestedAt: null } : {}),
      }).where(eq(invoicesTable.id, id));
      res.status(result.outcomeUnknown ? 502 : 400).json({
        error: result.outcomeUnknown
          ? "綠界作廢結果仍待確認，系統不會重複送出；請稍後使用「同步綠界狀態」確認"
          : result.message || "作廢失敗",
      });
      return;
    }
  }

  const updated = await finalizeEcpayInvoiceVoid(id, reason, result.rawResponse);

  res.json({
    success: true,
    invoice: {
      ...updated,
      totalAmount: Number(updated.totalAmount),
      paidAmount: Number(updated.paidAmount),
      outstandingAmount: Number(updated.outstandingAmount),
    },
  });
});

router.delete("/invoices/:id", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "發票編號格式不正確" }); return; }
  try {
    await db.transaction(async (tx) => {
      // 鎖定發票列，避免刪除與沖銷併發競爭
      const [existing] = await tx.select().from(invoicesTable).where(eq(invoicesTable.id, id)).for("update");
      if (!existing) throw Object.assign(new Error("找不到發票"), { statusCode: 404 });
      if (existing.status === "WrittenOff") throw new Error("此發票已轉呆帳，請先取消呆帳再刪除，避免呆帳分錄殘留");
      assertDeletableDraft("發票", existing.status, "作廢");
      if (existing.ecpayInvoiceNumber) throw new Error("綠界電子發票必須保留稅務稽核紀錄，不可刪除；如需取消請使用正式作廢功能");
      await assertPeriodOpen(tx, existing.invoiceDate, "刪除發票");
      const [sourceReturn] = existing.invoiceType === "Credit Note"
        ? await tx.select({ id: salesReturnsTable.id }).from(salesReturnsTable)
            .where(eq(salesReturnsTable.creditNoteInvoiceId, existing.id)).limit(1)
        : existing.invoiceType === "Debit Note"
          ? await tx.select({ id: purchaseReturnsTable.id }).from(purchaseReturnsTable)
              .where(eq(purchaseReturnsTable.debitNoteInvoiceId, existing.id)).limit(1)
          : [];
      if (sourceReturn) {
        throw new Error("退貨自動建立的折讓／扣項單不可單獨刪除，請由原退貨單執行取消");
      }
      const [settlement] = await tx.select({ id: invoiceSettlementsTable.id })
        .from(invoiceSettlementsTable)
        .where(eq(invoiceSettlementsTable.invoiceId, id))
        .limit(1);
      if (settlement) {
        throw new Error("此發票已有收付款沖銷紀錄，無法直接刪除。請先刪除相關收款單／付款單，或改為作廢發票。");
      }
      await tx.delete(invoicesTable).where(eq(invoicesTable.id, id));
      // 同步刪除自動分錄，避免總帳殘留
      await deleteInvoiceJournalEntry(tx, existing, { skipUnlink: true });
      // 刪除發票後，若綁定的訂單仍成立且無其他有效發票，恢復訂單的營收分錄
      if (existing.salesOrderId) await syncSalesOrderJournalEntry(tx, existing.salesOrderId);
    });
    res.status(204).send();
  } catch (err: any) {
    res.status(err.statusCode || 400).json({ error: err.message || "發票刪除失敗" });
  }
});

// 歷史發票補建分錄：把尚未有自動分錄的銷貨/採購發票一次補進帳務報表。
// dryRun=true 只回傳摘要；關帳日(含)以前的發票預設跳過，includeLocked=true 才納入。冪等：已有分錄者不會重複建立。
router.post("/invoices/backfill-journal-entries", requireRole("owner", "admin", "accountant"), async (req, res): Promise<void> => {
  try {
    const dryRun = req.body?.dryRun === true;
    const includeLocked = req.body?.includeLocked === true;
    const lockDate = await getLockDate(db);

    const candidates = await db
      .select({
        id: invoicesTable.id, invoiceNumber: invoicesTable.invoiceNumber,
        invoiceType: invoicesTable.invoiceType, invoiceDate: invoicesTable.invoiceDate,
        totalAmount: invoicesTable.totalAmount, exchangeRate: invoicesTable.exchangeRate,
        status: invoicesTable.status,
      })
      .from(invoicesTable)
      .where(and(
        isNull(invoicesTable.journalEntryId),
        ne(invoicesTable.status, "Cancelled"),
        sql`${invoicesTable.invoiceType} IN ('Sales', 'Purchase')`,
      ))
      .orderBy(invoicesTable.invoiceDate, invoicesTable.id);

    type Bucket = { count: number; amountTwd: number };
    const bucket = (): Bucket => ({ count: 0, amountTwd: 0 });
    const add = (b: Bucket, amt: number) => { b.count += 1; b.amountTwd = Math.round((b.amountTwd + amt) * 100) / 100; };
    const twd = (inv: { totalAmount: string | number; exchangeRate?: string | number | null }) =>
      Math.round(Number(inv.totalAmount) * (Number(inv.exchangeRate) || 1) * 100) / 100;

    const eligible = { sales: bucket(), purchase: bucket() };
    const locked = { sales: bucket(), purchase: bucket() };
    const zeroAmount = bucket();
    const eligibleRows: typeof candidates = [];

    for (const inv of candidates) {
      const amt = twd(inv);
      if (amt === 0) { add(zeroAmount, 0); continue; }
      const isLocked = !!lockDate && inv.invoiceDate <= lockDate;
      const key = inv.invoiceType === "Sales" ? "sales" as const : "purchase" as const;
      const target = isLocked && !includeLocked ? locked : eligible;
      add(target[key], amt);
      if (!(isLocked && !includeLocked)) eligibleRows.push(inv);
    }

    const summary = {
      lockDate,
      includeLocked,
      eligible: {
        count: eligible.sales.count + eligible.purchase.count,
        amountTwd: Math.round((eligible.sales.amountTwd + eligible.purchase.amountTwd) * 100) / 100,
        sales: eligible.sales,
        purchase: eligible.purchase,
      },
      skippedLocked: {
        count: locked.sales.count + locked.purchase.count,
        amountTwd: Math.round((locked.sales.amountTwd + locked.purchase.amountTwd) * 100) / 100,
      },
      skippedZeroAmount: zeroAmount.count,
    };

    if (dryRun) { res.json(summary); return; }

    const created = { sales: bucket(), purchase: bucket() };
    const failures: Array<{ invoiceNumber: string; error: string }> = [];
    for (const inv of eligibleRows) {
      try {
        await db.transaction(async (tx) => {
          // 逐筆鎖列並重新檢查，冪等：已補過的直接略過
          const [row] = await tx.select().from(invoicesTable).where(eq(invoicesTable.id, inv.id)).for("update");
          if (!row || row.journalEntryId || row.status === "Cancelled") return;
          // includeLocked 時管理者已明確同意把關帳期間的歷史發票一併入帳
          const isLocked = !!lockDate && row.invoiceDate <= lockDate;
          const jeId = await createInvoiceJournalEntry(tx, row, { bypassLockDate: includeLocked && isLocked });
          if (jeId) {
            const key = row.invoiceType === "Sales" ? "sales" as const : "purchase" as const;
            add(created[key], twd(row));
          }
        });
      } catch (err: any) {
        failures.push({ invoiceNumber: inv.invoiceNumber, error: err?.message || "Unknown error" });
      }
    }

    await db.insert(activitiesTable).values({
      type: "create", title: "補建歷史發票分錄",
      description: `補建 ${created.sales.count + created.purchase.count} 筆（銷 ${created.sales.count}/進 ${created.purchase.count}），失敗 ${failures.length} 筆`,
      module: "Accounting",
    });

    res.json({
      ...summary,
      created: {
        count: created.sales.count + created.purchase.count,
        amountTwd: Math.round((created.sales.amountTwd + created.purchase.amountTwd) * 100) / 100,
        sales: created.sales,
        purchase: created.purchase,
      },
      failures,
    });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || "Unknown error" });
  }
});

export default router;
