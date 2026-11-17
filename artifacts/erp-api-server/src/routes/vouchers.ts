import { Router, type IRouter } from "express";
import { eq, and, sql, inArray } from "drizzle-orm";
import { db, salesOrdersTable, purchaseOrdersTable, vouchersTable, projectsTable, departmentsTable, customersTable, suppliersTable, employeesTable, activitiesTable, auditLogsTable, journalEntriesTable, invoicesTable, invoiceSettlementsTable } from "@workspace/erp-db";
import {
  ListVouchersQueryParams, CreateVoucherBody,
  GetVoucherParams, UpdateVoucherParams, UpdateVoucherBody,
  DeleteVoucherParams,
} from "@workspace/erp-api-zod";

import { recomputeInvoices } from "../lib/invoice-sync";
import { resolveJournalLinesStrict, assertPeriodOpen } from "../lib/auto-journal";
import { friendlyCaughtError, friendlyValidationError } from "../lib/friendly-errors";
import { requireAuth, requireRole } from "../middleware/require-auth";
import { orderInvoices, orderOutstanding, orderPaymentSummaries, round2 as roundMoney } from "../lib/order-payments";
import { todayTaipei } from "../lib/inventory-journal";
import { cashLineAccount, isRealDate, leafAccount, listCashAccounts, parseActualCash, settlementJournalLines, type SettlementPart } from "../lib/cash-accounts";
import { REVENUE_ORDER_STATUSES } from "../lib/auto-journal";
import { syncSalesOrderDepositTransfer } from "../lib/order-deposits";
import { nextDocNumber } from "../lib/doc-number";
import { registerChangeHandler, submitChangeRequest } from "../lib/change-requests";
import { entrySummary, partyLineText, voidLineText, voucherHistoryRows } from "../lib/voucher-entry-text";

export const VOUCHER_VOIDED = "已作廢";
export const VOUCHER_POSTED = "已過帳";

const router: IRouter = Router();
// Matches UI FINANCE_ROLES; requireRole preserves super_admin/admin-key semantics.
router.use("/vouchers", requireAuth, requireRole("owner", "admin", "finance_admin", "accountant"));

import { isLegacyVoucher, legacyVoucherJournalId, LEGACY_VOUCHER_READONLY_MESSAGE, LEGACY_SOURCE } from "../lib/legacy";

const typeToDb: Record<string, string> = { "收款單": "Receipt", "付款單": "Payment", "請款單": "Journal" };
const dbToType: Record<string, string> = { "Receipt": "收款單", "Payment": "付款單", "Journal": "請款單" };

router.get("/vouchers", async (req, res): Promise<void> => {
  const query = ListVouchersQueryParams.safeParse(req.query);
  const conditions: any[] = [];

  if (query.success) {
    if (query.data.voucherType) {
      const mapped = typeToDb[query.data.voucherType] || query.data.voucherType;
      conditions.push(eq(vouchersTable.voucherType, mapped));
    }
    if (query.data.projectId) conditions.push(eq(vouchersTable.projectId, query.data.projectId));
    if (query.data.departmentId) conditions.push(eq(vouchersTable.departmentId, query.data.departmentId));
    if (query.data.status) conditions.push(eq(vouchersTable.status, query.data.status));
  }

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const vouchers = await db
    .select({
      id: vouchersTable.id,
      voucherNumber: vouchersTable.voucherNumber,
      voucherType: vouchersTable.voucherType,
      voucherDate: vouchersTable.voucherDate,
      description: vouchersTable.description,
      totalAmount: vouchersTable.totalAmount,
      status: vouchersTable.status,
      projectId: vouchersTable.projectId,
      departmentId: vouchersTable.departmentId,
      customerId: vouchersTable.customerId,
      supplierId: vouchersTable.supplierId,
      employeeId: vouchersTable.employeeId,
      items: vouchersTable.items,
      journalEntryId: vouchersTable.journalEntryId,
      createdAt: vouchersTable.createdAt,
      projectName: sql<string | null>`(SELECT name FROM projects WHERE id = "vouchers"."project_id")`,
      departmentName: sql<string | null>`(SELECT name FROM departments WHERE id = "vouchers"."department_id")`,
      customerName: sql<string | null>`(SELECT name FROM customers WHERE id = "vouchers"."customer_id")`,
      supplierName: sql<string | null>`(SELECT name FROM suppliers WHERE id = "vouchers"."supplier_id")`,
      employeeName: sql<string | null>`(SELECT first_name || last_name FROM employees WHERE id = "vouchers"."employee_id")`,
    })
    .from(vouchersTable)
    .where(where)
    .orderBy(sql`"vouchers"."voucher_date" DESC, "vouchers"."id" DESC`);

  // 收付款帳戶：從自動分錄裡找出現金／銀行那一行
  const cashIds = new Set((await listCashAccounts(db)).map(a => a.id));
  // 歷史收款單自己沒有分錄，收款帳戶要從它對應的那張舊分錄找
  const entryIdOf = (v: { journalEntryId: number | null; items: unknown }): number | null => v.journalEntryId ?? legacyVoucherJournalId(v.items);
  const jeIds = vouchers.map(entryIdOf).filter((id): id is number => typeof id === "number");
  const entries = jeIds.length > 0
    ? await db.select({ id: journalEntriesTable.id, lines: journalEntriesTable.lines }).from(journalEntriesTable).where(inArray(journalEntriesTable.id, jeIds))
    : [];
  const cashNameByEntry = new Map<number, string>();
  for (const entry of entries) {
    const line = (Array.isArray(entry.lines) ? (entry.lines as any[]) : []).find(l => cashIds.has(Number(l?.accountId)));
    if (line) cashNameByEntry.set(entry.id, String(line.accountName || ""));
  }
  const mapped = vouchers.map(v => ({
    ...v, voucherType: dbToType[v.voucherType] || v.voucherType,
    cashAccountName: entryIdOf(v) ? cashNameByEntry.get(entryIdOf(v)!) ?? null : null,
    legacy: isLegacyVoucher(v.items),
    // 歷史收款單的客戶在主檔找不到時，顯示單據上原本的名稱
    customerName: v.customerName ?? (isLegacyVoucher(v.items) ? String((v.items as any[])[0]?.legacyPartyName || "") || null : null),
  }));
  res.json(mapped);
});

router.post("/vouchers", async (req, res): Promise<void> => {
  const parsed = CreateVoucherBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: friendlyValidationError(parsed.error) }); return; }

  try {
    const uiType = parsed.data.voucherType;
    const dbType = typeToDb[uiType] || uiType;
    if (!typeToDb[uiType]) throw new Error("傳票類型無效");
    if (!isRealDate(parsed.data.voucherDate)) throw new Error("請填寫正確的傳票日期");
    const voucherItems = parsed.data.items as Array<{ amount: number; invoiceId?: number; salesOrderId?: number; purchaseOrderId?: number }>;
    // 明細可直接指定銷貨單（收款）或採購單（付款）：還沒開發票就先收、先付訂金
    const rawItems: any[] = Array.isArray(req.body?.items) ? req.body.items : [];
    voucherItems.forEach((item, index) => {
      for (const key of ["salesOrderId", "purchaseOrderId"] as const) {
        const raw = rawItems[index]?.[key];
        if (raw === undefined || raw === null || raw === "") continue;
        const orderId = Number(raw);
        if (!Number.isInteger(orderId) || orderId <= 0) throw new Error("傳票明細的訂單編號格式不正確");
        item[key] = orderId;
      }
      if (item.invoiceId !== undefined && (item.salesOrderId !== undefined || item.purchaseOrderId !== undefined)) {
        throw new Error("同一筆明細只能指定發票或訂單其中一種");
      }
      if (item.salesOrderId !== undefined && uiType !== "收款單") throw new Error("只有收款單可以核對銷貨單");
      if (item.purchaseOrderId !== undefined && uiType !== "付款單") throw new Error("只有付款單可以核對採購單");
    });
    for (const item of voucherItems) {
      if (!Number.isFinite(item.amount) || item.amount <= 0) {
        throw new Error("傳票明細金額必須為正數；折扣、手續費或沖回請使用獨立更正流程");
      }
      if (item.invoiceId !== undefined && (!Number.isInteger(item.invoiceId) || item.invoiceId <= 0)) {
        throw new Error("傳票明細的發票編號格式不正確");
      }
    }

    const result = await db.transaction(async (tx) => {
      await assertPeriodOpen(tx, parsed.data.voucherDate, "建立傳票");
      // 錢進出哪個帳戶（收款單、付款單），請款單記到哪個費用科目
      const cashAccount = await cashLineAccount(tx, req.body?.cashAccountId);
      const expenseAccount = uiType === "請款單" && req.body?.expenseAccountId
        ? await leafAccount(tx, req.body.expenseAccountId, "費用科目", ["Expense", "Asset"])
        : null;
      const typePrefix: Record<string, string> = { "請款單": "RQ", "收款單": "RC", "付款單": "PY" };
      const prefix = typePrefix[uiType] || "VO";
      // 連號：前綴-年月-流水號。原本用「目前筆數 + 1」，刪過一張或兩人同時開單就會撞號
      const voucherNumber = await nextDocNumber(tx, "vouchers", "voucher_number", prefix,
        () => `${prefix}-${String(Date.now()).slice(-8)}`, parsed.data.voucherDate);

      // 銷貨單還沒成立（草稿）就先收的錢是預收訂金：帳上還沒有應收可沖，先記預收款項
      const draftOrderIds = new Set<number>();
      if (uiType === "收款單") {
        const ids = Array.from(new Set(voucherItems.map(it => it.salesOrderId).filter((id): id is number => id !== undefined)));
        if (ids.length > 0) {
          const rows = await tx.select({ id: salesOrdersTable.id, status: salesOrdersTable.status }).from(salesOrdersTable).where(inArray(salesOrdersTable.id, ids));
          for (const row of rows) if (!REVENUE_ORDER_STATUSES.includes(row.status) && row.status !== "Cancelled") draftOrderIds.add(row.id);
        }
        for (const item of voucherItems) {
          if (item.salesOrderId !== undefined && draftOrderIds.has(item.salesOrderId)) (item as any).asDeposit = true;
        }
      }
      // 外幣發票：記下發票入帳時的匯率，等一下算兌換損益
      const invoiceRates = new Map<number, number>();

      const itemsSum = voucherItems.reduce((sum, item) => sum + item.amount, 0);
      const declaredTotal = parsed.data.totalAmount != null && parsed.data.totalAmount !== "" ? Number(parsed.data.totalAmount) : null;
      if (declaredTotal != null && (!Number.isFinite(declaredTotal) || declaredTotal < 0)) {
        throw new Error("傳票總金額格式不正確");
      }
      // 有明細時，總金額必須等於明細合計，避免沖銷金額與傳票金額不一致
      if (declaredTotal != null && itemsSum > 0 && Math.abs(declaredTotal - itemsSum) > 0.01) {
        throw new Error(`傳票總金額 ${declaredTotal} 與明細合計 ${itemsSum} 不一致`);
      }
      const totalAmount = String(itemsSum > 0 ? itemsSum : (declaredTotal ?? 0));

      const [voucher] = await tx.insert(vouchersTable).values({
        ...parsed.data,
        voucherType: dbType,
        voucherNumber,
        totalAmount,
      }).returning();

      // 收款單沖銷銷貨發票 / 付款單沖銷採購發票：items 帶 invoiceId 的明細寫入 invoice_settlements，並重算對應發票
      if (uiType === "收款單" || uiType === "付款單") {
        const isReceipt = uiType === "收款單";
        const settledItems = voucherItems.filter(it => it.invoiceId !== undefined);
        if (settledItems.length > 0) {
          if (isReceipt && !parsed.data.customerId) throw new Error("收款單沖銷發票時必須指定客戶");
          if (!isReceipt && !parsed.data.supplierId) throw new Error("付款單沖銷發票時必須指定供應商");
          const targetIds = Array.from(new Set(settledItems.map((it: any) => Number(it.invoiceId))));
          // 鎖定發票列以避免併發超額沖銷
          const targetInvoices = await tx.select().from(invoicesTable)
            .where(inArray(invoicesTable.id, targetIds))
            .for("update");
          const invMap = new Map<number, any>(targetInvoices.map((i: any) => [i.id, i]));
          for (const inv of targetInvoices as any[]) {
            if (inv.currency && inv.currency !== "TWD") invoiceRates.set(inv.id, Number(inv.exchangeRate) || 1);
          }
          // 已存在的沖銷總額（不含本次新增）
          const existingSums = await tx
            .select({ invoiceId: invoiceSettlementsTable.invoiceId, total: sql<string>`COALESCE(SUM(${invoiceSettlementsTable.amount}), 0)` })
            .from(invoiceSettlementsTable)
            .where(inArray(invoiceSettlementsTable.invoiceId, targetIds))
            .groupBy(invoiceSettlementsTable.invoiceId);
          const existingMap = new Map<number, number>(existingSums.map((s: any) => [s.invoiceId, Number(s.total)]));
          // 加總本次每張發票要新增的金額
          const newPerInvoice = new Map<number, number>();
          for (const it of settledItems) {
            const id = Number(it.invoiceId);
            newPerInvoice.set(id, (newPerInvoice.get(id) || 0) + Number(it.amount));
          }
          for (const [id, addAmount] of newPerInvoice) {
            const inv = invMap.get(id);
            if (!inv) throw new Error(`發票 ${id} 不存在`);
            if (isReceipt) {
              if (inv.invoiceType !== "Sales" && inv.invoiceType !== "Sales Invoice") throw new Error(`發票 ${inv.invoiceNumber} 不是銷貨發票，無法以收款單沖銷`);
              if (inv.ecpayVoidedAt) throw new Error(`發票 ${inv.invoiceNumber} 的電子發票已作廢，無法沖銷`);
              if (Number(inv.customerId) !== Number(parsed.data.customerId)) {
                throw new Error(`發票 ${inv.invoiceNumber} 的客戶與收款單客戶不一致`);
              }
            } else {
              if (inv.invoiceType !== "Purchase" && inv.invoiceType !== "Purchase Invoice") throw new Error(`發票 ${inv.invoiceNumber} 不是採購發票，無法以付款單沖銷`);
              if (Number(inv.supplierId) !== Number(parsed.data.supplierId)) {
                throw new Error(`發票 ${inv.invoiceNumber} 的供應商與付款單供應商不一致`);
              }
            }
            if (inv.status === "Cancelled") throw new Error(`發票 ${inv.invoiceNumber} 已取消，無法沖銷`);
            if (inv.status === "WrittenOff") throw new Error(`發票 ${inv.invoiceNumber} 已轉呆帳，如需收款請先取消呆帳`);
            const total = Number(inv.totalAmount);
            const already = existingMap.get(id) || 0;
            // 未結餘額同時要扣掉先前直接對訂單收付、已自動算進這張發票的金額
            const remaining = Math.min(Math.round((total - already) * 100) / 100, Number(inv.outstandingAmount));
            if (addAmount > remaining + 0.001) {
              throw new Error(`發票 ${inv.invoiceNumber} 沖銷金額 ${addAmount} 超過${isReceipt ? "未收" : "未付"}餘額 ${remaining}`);
            }
          }
          await tx.insert(invoiceSettlementsTable).values(settledItems.map((it: any) => ({
            voucherId: voucher.id,
            invoiceId: Number(it.invoiceId),
            amount: String(Number(it.amount)),
          })));
          await recomputeInvoices(tx, targetIds);
        }

        // 直接核對訂單的明細：檢查對象、訂單狀態與可收付餘額，再重算該訂單底下的發票
        const kind = isReceipt ? "sales" as const : "purchase" as const;
        const orderIds = Array.from(new Set(voucherItems
          .map(it => (isReceipt ? it.salesOrderId : it.purchaseOrderId))
          .filter((id): id is number => id !== undefined)));
        if (orderIds.length > 0) {
          const label = isReceipt ? "銷貨單" : "採購單";
          if (isReceipt && !parsed.data.customerId) throw new Error("收款單核對銷貨單時必須指定客戶");
          if (!isReceipt && !parsed.data.supplierId) throw new Error("付款單核對採購單時必須指定供應商");
          const orders: any[] = isReceipt
            ? await tx.select().from(salesOrdersTable).where(inArray(salesOrdersTable.id, orderIds)).for("update")
            : await tx.select().from(purchaseOrdersTable).where(inArray(purchaseOrdersTable.id, orderIds)).for("update");
          const orderMap = new Map<number, any>(orders.map(o => [o.id, o]));
          // 這張傳票已寫入，所以合計已包含本次金額
          const summaries = await orderPaymentSummaries(tx, kind, orderIds);
          for (const orderId of orderIds) {
            const order = orderMap.get(orderId);
            if (!order) throw new Error(`${label} ${orderId} 不存在`);
            if (order.status === "Cancelled") throw new Error(`${label} ${order.orderNumber} 已取消，無法${isReceipt ? "收款" : "付款"}`);
            if (isReceipt && Number(order.customerId) !== Number(parsed.data.customerId)) throw new Error(`銷貨單 ${order.orderNumber} 的客戶與收款單客戶不一致`);
            if (!isReceipt && Number(order.supplierId) !== Number(parsed.data.supplierId)) throw new Error(`採購單 ${order.orderNumber} 的供應商與付款單供應商不一致`);
            const rate = !isReceipt && order.currency && order.currency !== "TWD" ? (Number(order.exchangeRate) || 1) : 1;
            const total = roundMoney(Number(order.totalAmount) * rate);
            const summary = summaries.get(orderId);
            const thisTime = roundMoney(voucherItems
              .filter(it => (isReceipt ? it.salesOrderId : it.purchaseOrderId) === orderId)
              .reduce((sum, it) => sum + it.amount, 0));
            if ((summary?.paid || 0) > total + 0.001) {
              const before = orderOutstanding(total, summary ? { ...summary, paid: roundMoney(summary.paid - thisTime) } : undefined);
              throw new Error(`${label} ${order.orderNumber} 本次金額 ${thisTime} 超過${isReceipt ? "未收" : "未付"}餘額 ${before}`);
            }
          }
          const related = await orderInvoices(tx, kind, orderIds);
          if (related.length > 0) await recomputeInvoices(tx, related.map(i => i.id));
        }
      }

      await tx.insert(activitiesTable).values({
        type: "create",
        title: `新${parsed.data.voucherType}`,
        description: `${voucherNumber} - ${parsed.data.description || parsed.data.voucherType}`,
        module: "Accounting",
      });

      const jeNum = await nextDocNumber(tx, "journal_entries", "entry_number", "JE",
        () => `JE-${Date.now().toString().slice(-8)}`, parsed.data.voucherDate);
      const amt = Number(totalAmount) || 0;
      let lines: any[] = [];
      let entryText = `自動分錄 - ${parsed.data.voucherType} ${voucherNumber}`;

      if (uiType === "收款單" || uiType === "付款單") {
        const parts: SettlementPart[] = voucherItems.map((item, index) => {
          const paymentRate = Number(rawItems[index]?.exchangeRate);
          const invoiceRate = item.invoiceId !== undefined ? invoiceRates.get(item.invoiceId) : undefined;
          if (rawItems[index]?.exchangeRate !== undefined && rawItems[index]?.exchangeRate !== "" && !(paymentRate > 0)) {
            throw new Error("收付當天的匯率必須大於 0");
          }
          return {
            amount: item.amount,
            invoiceRate,
            // 只有外幣發票才有匯率差；本幣明細填了匯率也不採用
            paymentRate: invoiceRate !== undefined && paymentRate > 0 ? paymentRate : undefined,
            deposit: (item as any).asDeposit === true,
          };
        });
        // 實際進出的台幣（外幣貨款換匯去付，和入帳時的台幣金額不同）：差額記兌換損益
        const settledBooked = parts.filter(p => !p.deposit).reduce((sum, p) => sum + p.amount * (p.invoiceRate && p.invoiceRate > 0 ? p.invoiceRate : 1), 0);
        const hasLinked = voucherItems.some(it => it.invoiceId !== undefined || it.salesOrderId !== undefined || it.purchaseOrderId !== undefined);
        const actualCash = parseActualCash(req.body?.actualCashAmount, hasLinked && !parts.some(p => p.deposit) ? settledBooked : 0);
        const kind = uiType === "收款單" ? "receipt" as const : "payment" as const;
        // 每一行的「摘要」直接成為日記帳那一行的摘要，前面放客戶/供應商
        const partyId = kind === "receipt" ? parsed.data.customerId : parsed.data.supplierId;
        const [partyRow] = partyId
          ? kind === "receipt"
            ? await tx.select({ name: customersTable.name }).from(customersTable).where(eq(customersTable.id, Number(partyId)))
            : await tx.select({ name: suppliersTable.name }).from(suppliersTable).where(eq(suppliersTable.id, Number(partyId)))
          : [];
        const party = partyRow?.name ?? "";
        const verb = kind === "receipt" ? "收款" : "付款";
        const summaries = voucherItems.map((_, index) => rawItems[index]?.description);
        entryText = entrySummary(summaries, parsed.data.description, `${uiType} ${voucherNumber}`);
        if (itemsSum > 0 && !hasLinked && actualCash === undefined) {
          // 一般收付（沒沖發票、沒核對訂單）：一行摘要拆成一組借貸，各自帶自己的摘要
          lines = voucherItems.flatMap((item, index) =>
            settlementJournalLines({ kind, voucherNumber, cash: cashAccount, parts: [{ amount: item.amount }] })
              .map(l => ({ ...l, description: partyLineText(party, summaries[index], verb) })));
        } else {
          const text = partyLineText(party, entryText, verb);
          lines = (itemsSum > 0
            ? settlementJournalLines({ kind, voucherNumber, cash: cashAccount, parts, actualCash })
            : settlementJournalLines({ kind, voucherNumber, cash: cashAccount, parts: [{ amount: amt }] }))
            .map(l => ({ ...l, description: text }));
        }
      } else if (uiType === "請款單") {
        lines = [
          { ...(expenseAccount ? { accountId: expenseAccount.accountId, accountNumber: expenseAccount.accountNumber, accountName: expenseAccount.accountName } : { accountName: "費用" }), debit: amt, credit: 0, description: `${voucherNumber} 請款` },
          { accountName: "應付帳款", debit: 0, credit: amt, description: `${voucherNumber} 請款應付` },
        ];
      }

      if (lines.length > 0 && amt > 0) {
        const resolvedLines = await resolveJournalLinesStrict(tx, lines);
        // 外幣收付時，分錄金額是換算後的新台幣，可能和傳票金額不同
        const entryTotal = Math.round(lines.reduce((sum, l) => sum + (Number(l.debit) || 0), 0) * 100) / 100;
        const [je] = await tx.insert(journalEntriesTable).values({
          entryNumber: jeNum,
          entryDate: parsed.data.voucherDate,
          description: entryText,
          totalDebit: String(entryTotal),
          totalCredit: String(entryTotal),
          status: "Posted",
          lines: resolvedLines,
          projectId: parsed.data.projectId || null,
          departmentId: parsed.data.departmentId || null,
        }).returning();
        // 記錄關聯，刪除傳票時同步刪除自動分錄。
        // 傳票一建立就入帳了，狀態要跟著改成「已過帳」（原本永遠停在「草稿」，看起來像還沒入帳）
        const [posted] = await tx.update(vouchersTable).set({ journalEntryId: je.id, status: VOUCHER_POSTED }).where(eq(vouchersTable.id, voucher.id)).returning();
        return posted;
      }

      return voucher;
    });

    res.status(201).json(result);
  } catch (err: any) {
    console.error("Voucher creation failed:", err);
    res.status(400).json({ error: friendlyCaughtError(err, "傳票建立失敗，請確認資料後再試") });
  }
});

/**
 * 把舊系統（Ecount）的收款單併進收款單。歷史單狀態是已過帳、只能查看：
 * 不產生分錄（帳已經由舊系統的傳票搬進來）、不沖任何發票或訂單（已收金額記在歷史銷貨單上）。
 * 單號重複的會跳過，所以可以重跑。
 */
router.post("/vouchers/legacy-import", requireRole("owner", "admin"), async (req, res): Promise<void> => {
  const documents: any[] = Array.isArray(req.body?.documents) ? req.body.documents : [];
  if (documents.length === 0 || documents.length > 500) { res.status(400).json({ error: "一次請送 1 到 500 張" }); return; }
  const positive = (value: unknown): number | null => (Number.isInteger(Number(value)) && Number(value) > 0 ? Number(value) : null);
  const values = [];
  for (const [index, d] of documents.entries()) {
    const number = typeof d?.number === "string" ? d.number.trim().slice(0, 60) : "";
    const date = String(d?.date ?? "");
    const total = Math.round(Number(d?.totalAmount) * 100) / 100;
    if (!number || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(total)) { res.status(400).json({ error: `第 ${index + 1} 張的單號、日期或金額不正確` }); return; }
    const description = String(d.description ?? "").trim().slice(0, 500) || null;
    values.push({
      voucherNumber: number, voucherType: "Receipt", voucherDate: date, description, totalAmount: String(total), status: VOUCHER_POSTED,
      projectId: positive(d.projectId), departmentId: positive(d.departmentId), customerId: positive(d.customerId),
      createdAt: new Date(`${date}T00:00:00+08:00`),
      items: [{
        description: description ?? "", amount: total, legacy: true, legacySource: LEGACY_SOURCE,
        legacyDocNumber: String(d.legacyDocNumber ?? "").slice(0, 80), legacyPartyName: String(d.legacyPartyName ?? "").slice(0, 200),
        ...(positive(d.legacyJournalEntryId) ? { legacyJournalEntryId: positive(d.legacyJournalEntryId) } : {}),
      }],
    });
  }
  try {
    const inserted = await db.insert(vouchersTable).values(values as any).onConflictDoNothing().returning({ id: vouchersTable.id });
    res.status(201).json({ inserted: inserted.length, skipped: values.length - inserted.length });
  } catch (err: any) {
    res.status(400).json({ error: /[\u3400-\u9fff]/.test(err?.message || "") ? err.message : "寫入失敗，請確認客戶與專案都存在" });
  }
});

router.get("/vouchers/:id", async (req, res): Promise<void> => {
  const params = GetVoucherParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: friendlyValidationError(params.error) }); return; }

  const [voucher] = await db
    .select({
      id: vouchersTable.id,
      voucherNumber: vouchersTable.voucherNumber,
      voucherType: vouchersTable.voucherType,
      voucherDate: vouchersTable.voucherDate,
      description: vouchersTable.description,
      totalAmount: vouchersTable.totalAmount,
      status: vouchersTable.status,
      projectId: vouchersTable.projectId,
      departmentId: vouchersTable.departmentId,
      customerId: vouchersTable.customerId,
      supplierId: vouchersTable.supplierId,
      employeeId: vouchersTable.employeeId,
      items: vouchersTable.items,
      createdAt: vouchersTable.createdAt,
      projectName: sql<string | null>`(SELECT name FROM projects WHERE id = "vouchers"."project_id")`,
      departmentName: sql<string | null>`(SELECT name FROM departments WHERE id = "vouchers"."department_id")`,
      customerName: sql<string | null>`(SELECT name FROM customers WHERE id = "vouchers"."customer_id")`,
      supplierName: sql<string | null>`(SELECT name FROM suppliers WHERE id = "vouchers"."supplier_id")`,
      employeeName: sql<string | null>`(SELECT first_name || last_name FROM employees WHERE id = "vouchers"."employee_id")`,
    })
    .from(vouchersTable)
    .where(eq(vouchersTable.id, params.data.id));

  if (!voucher) { res.status(404).json({ error: "找不到傳票" }); return; }
  res.json({ ...voucher, voucherType: dbToType[voucher.voucherType] || voucher.voucherType });
});

/**
 * 單據的「H」：跟 Ecount「查詢憑證紀錄」一樣，列出這張單每一次新增、修改、作廢、刪除的
 * 操作人員與日期時間。資料來自系統自動寫的稽核紀錄（每次異動都會記）。
 */
router.get("/vouchers/:id/history", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) { res.status(400).json({ error: "單據編號格式不正確" }); return; }
  const [voucher] = await db.select({ voucherNumber: vouchersTable.voucherNumber, createdAt: vouchersTable.createdAt, items: vouchersTable.items })
    .from(vouchersTable).where(eq(vouchersTable.id, id));
  if (!voucher) { res.status(404).json({ error: "找不到單據" }); return; }
  const logs = await db.select().from(auditLogsTable)
    .where(and(eq(auditLogsTable.documentType, "vouchers"), eq(auditLogsTable.documentId, id)))
    .orderBy(auditLogsTable.createdAt, auditLogsTable.id);
  res.json({ voucherNumber: voucher.voucherNumber, rows: voucherHistoryRows({ createdAt: voucher.createdAt, legacy: isLegacyVoucher(voucher.items) }, logs) });
});


router.patch("/vouchers/:id", async (req, res): Promise<void> => {
  const params = UpdateVoucherParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: friendlyValidationError(params.error) }); return; }
  const parsed = UpdateVoucherBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: friendlyValidationError(parsed.error) }); return; }
  try {
    // A voucher is posted atomically with settlements and an auto-JE at creation.
    // Mutating amount/status in place cannot preserve those ledgers. Until a
    // dedicated reversal workflow exists, support metadata correction only.
    if (parsed.data.totalAmount !== undefined || parsed.data.status !== undefined) {
      res.status(400).json({ error: "已建立傳票不可直接修改總金額或狀態；請刪除後重建，讓沖帳與分錄同步回沖" });
      return;
    }
    const voucher = await db.transaction(async (tx) => {
      const [existing] = await tx.select().from(vouchersTable)
        .where(eq(vouchersTable.id, params.data.id)).for("update");
      if (!existing) return null;
      // 已入帳、已作廢或 Ecount 搬來的單，改備註也要送審（老闆 2026-11-16）
      if (existing.journalEntryId || existing.status === VOUCHER_VOIDED || isLegacyVoucher(existing.items)) {
        throw Object.assign(new Error("這張單已經入帳，修改要送修改申請，審核通過才會改"), { status: 400 });
      }
      // 這裡只會改「說明」，不動金額與分錄，歷史收款單也可以改（而且不受關帳日限制）
      if (!isLegacyVoucher(existing.items)) await assertPeriodOpen(tx, existing.voucherDate, "修改傳票");
      const [updated] = await tx.update(vouchersTable)
        .set({ description: parsed.data.description })
        .where(eq(vouchersTable.id, params.data.id))
        .returning();
      return updated || null;
    });
    if (!voucher) { res.status(404).json({ error: "找不到傳票" }); return; }
    res.json(voucher);
  } catch (err: any) {
    res.status(400).json({ error: err.message || "傳票更新失敗" });
  }
});

/**
 * 作廢傳票：傳票與原分錄都留著，另外開一張借貸相反的沖銷分錄，
 * 並取消它對發票、訂單的沖帳。帳上看得到「曾經收／付過、後來作廢」的完整過程。
 */
router.post("/vouchers/:id/void", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) { res.status(400).json({ error: "傳票編號格式不正確" }); return; }
  const reason = typeof req.body?.reason === "string" ? req.body.reason.trim().slice(0, 200) : "";
  try {
    const voided = await db.transaction(async (tx) => {
      const [existing] = await tx.select().from(vouchersTable).where(eq(vouchersTable.id, id)).for("update");
      if (!existing) throw Object.assign(new Error("找不到傳票"), { status: 404 });
      if (isLegacyVoucher(existing.items)) throw Object.assign(new Error(LEGACY_VOUCHER_READONLY_MESSAGE), { status: 400 });
      if (existing.status === VOUCHER_VOIDED) throw new Error("這張傳票已經作廢");
      const voidDate = todayTaipei();
      await assertPeriodOpen(tx, voidDate, "作廢傳票");

      // 受影響的發票：直接沖這張傳票的，加上明細指到的訂單底下的
      const settlements = await tx.select({ invoiceId: invoiceSettlementsTable.invoiceId })
        .from(invoiceSettlementsTable).where(eq(invoiceSettlementsTable.voucherId, id));
      const affected = settlements.map((s: any) => Number(s.invoiceId));
      const items: any[] = Array.isArray(existing.items) ? (existing.items as any[]) : [];
      for (const kind of ["sales", "purchase"] as const) {
        const key = kind === "sales" ? "salesOrderId" : "purchaseOrderId";
        const orderIds = Array.from(new Set(items.map(it => Number(it?.[key])).filter(n => Number.isInteger(n) && n > 0)));
        if (orderIds.length > 0) affected.push(...(await orderInvoices(tx, kind, orderIds)).map(i => i.id));
      }

      // 沖銷分錄：原分錄每一行借貸對調
      if (existing.journalEntryId) {
        const [original] = await tx.select().from(journalEntriesTable).where(eq(journalEntriesTable.id, existing.journalEntryId));
        if (original) {
          // 摘要沿用原本的「對象｜摘要」，前面加「作廢」；單號在分錄編號（-V），不再寫進摘要
          const lines = (Array.isArray(original.lines) ? (original.lines as any[]) : []).map(line => ({ ...line, debit: Number(line.credit) || 0, credit: Number(line.debit) || 0, description: voidLineText(line.description) }));
          await tx.insert(journalEntriesTable).values({
            entryNumber: `JE-V${existing.id}-${String(Date.now()).slice(-6)}`,
            entryDate: voidDate,
            description: `作廢 ${original.description || ""}${reason ? `（${reason}）` : ""}`.trim().slice(0, 300),
            totalDebit: original.totalCredit,
            totalCredit: original.totalDebit,
            status: "Posted",
            lines,
            projectId: original.projectId,
            departmentId: original.departmentId,
          });
          await tx.update(journalEntriesTable).set({ status: "Reversed" }).where(eq(journalEntriesTable.id, original.id));
        }
      }

      await tx.delete(invoiceSettlementsTable).where(eq(invoiceSettlementsTable.voucherId, id));
      const [updated] = await tx.update(vouchersTable).set({ status: VOUCHER_VOIDED }).where(eq(vouchersTable.id, id)).returning();
      if (affected.length > 0) await recomputeInvoices(tx, affected);
      // 作廢的是預收訂金時，已經轉去沖應收的部分要跟著調回來
      const depositOrderIds = Array.from(new Set(items.filter(it => it?.asDeposit === true).map(it => Number(it?.salesOrderId)).filter(n => Number.isInteger(n) && n > 0)));
      for (const orderId of depositOrderIds) await syncSalesOrderDepositTransfer(tx, orderId);
      await tx.insert(activitiesTable).values({
        type: "update", title: "傳票作廢",
        description: `${existing.voucherNumber}${reason ? " - " + reason : ""}`, module: "Accounting",
      });
      return updated;
    });
    res.json(voided);
  } catch (err: any) {
    res.status(Number(err?.status) || 400).json({ error: err?.status ? err.message : friendlyCaughtError(err, "傳票作廢失敗，請稍後再試") });
  }
});

/** 這張收款單、付款單的分錄：入帳那一筆、作廢沖回那一筆（JE-V{id}-） */
async function voucherEntries(executor: any, v: { id: number; journalEntryId: number | null; items: unknown }) {
  const mainId = v.journalEntryId ?? legacyVoucherJournalId(v.items);
  return executor.select().from(journalEntriesTable)
    .where(sql`${journalEntriesTable.id} = ${mainId ?? 0} OR ${journalEntriesTable.entryNumber} LIKE ${`JE-V${v.id}-%`}`);
}

// 申請刪除已入帳、已作廢或 Ecount 搬來的收款單／付款單：核准後單據、分錄、沖帳一起刪（老闆 2026-11-16）
router.post("/vouchers/:id/delete-request", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) { res.status(400).json({ error: "單據編號格式不正確" }); return; }
  try {
    const [v] = await db.select().from(vouchersTable).where(eq(vouchersTable.id, id));
    if (!v) throw Object.assign(new Error("找不到單據"), { status: 404 });
    await assertPeriodOpen(db, v.voucherDate, "刪除單據");
    const entries = await voucherEntries(db, v);
    for (const e of entries) await assertPeriodOpen(db, e.entryDate, "刪除單據的分錄");
    const user = req.session?.user;
    const { changeRequest, autoApplied } = await db.transaction(tx => submitChangeRequest(tx, {
      kind: "delete", targetType: "voucher", targetId: v.id, targetNumber: v.voucherNumber,
      title: `刪除 ${v.voucherNumber}（${Number(v.totalAmount).toLocaleString()} 元${entries.length > 0 ? `，連同分錄 ${entries.map((e: any) => e.entryNumber).join("、")}` : ""}）`,
      original: { voucherNumber: v.voucherNumber, voucherDate: v.voucherDate, totalAmount: v.totalAmount, description: v.description, status: v.status, entries: entries.map((e: any) => e.entryNumber) },
      reason: String(req.body?.reason ?? ""),
    }, { username: user?.username || "API", role: user?.role ?? null }));
    res.status(autoApplied ? 200 : 202).json(autoApplied ? { applied: true, requestNumber: changeRequest.requestNumber, message: autoApplied } : { pending: true, requestNumber: changeRequest.requestNumber });
  } catch (err: any) { res.status(Number(err?.status) || 400).json({ error: err?.message || "送出刪除申請失敗" }); }
});

/** 收款單、付款單可以送審修改的欄位：備註、專案、部門。金額、日期、科目要改請刪除後重開（也要審核） */
const voucherEditOf = (raw: any) => ({
  description: String(raw?.description ?? "").trim().slice(0, 500),
  projectId: raw?.projectId == null || raw.projectId === "" ? null : Number(raw.projectId) || null,
  departmentId: raw?.departmentId == null || raw.departmentId === "" ? null : Number(raw.departmentId) || null,
});

router.post("/vouchers/:id/edit-request", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) { res.status(400).json({ error: "單據編號格式不正確" }); return; }
  try {
    const [v] = await db.select().from(vouchersTable).where(eq(vouchersTable.id, id));
    if (!v) throw Object.assign(new Error("找不到單據"), { status: 404 });
    const next = voucherEditOf(req.body);
    const before = { description: v.description || "", projectId: v.projectId ?? null, departmentId: v.departmentId ?? null };
    if (JSON.stringify(next) === JSON.stringify(before)) throw new Error("內容沒有變更");
    const user = req.session?.user;
    const { changeRequest, autoApplied } = await db.transaction(tx => submitChangeRequest(tx, {
      kind: "edit", targetType: "voucher", targetId: v.id, targetNumber: v.voucherNumber,
      title: `修改 ${v.voucherNumber}`, payload: next, original: before, reason: String(req.body?.reason ?? ""),
    }, { username: user?.username || "API", role: user?.role ?? null }));
    res.status(autoApplied ? 200 : 202).json(autoApplied ? { applied: true, requestNumber: changeRequest.requestNumber, message: autoApplied } : { pending: true, requestNumber: changeRequest.requestNumber });
  } catch (err: any) { res.status(Number(err?.status) || 400).json({ error: err?.message || "送出修改申請失敗" }); }
});

registerChangeHandler("voucher", "edit", async (tx, cr) => {
  const [v] = await tx.select().from(vouchersTable).where(eq(vouchersTable.id, cr.targetId ?? 0)).for("update");
  if (!v) throw Object.assign(new Error("單據已經不在了"), { status: 400 });
  const next = voucherEditOf(cr.payload);
  // 專案、部門會影響部門／專案損益，分錄要跟著改；Ecount 搬來的分錄也一起
  const entryId = v.journalEntryId ?? legacyVoucherJournalId(v.items);
  if (entryId && (next.projectId !== v.projectId || next.departmentId !== v.departmentId)) {
    const [e] = await tx.select({ entryDate: journalEntriesTable.entryDate }).from(journalEntriesTable).where(eq(journalEntriesTable.id, entryId));
    if (e) await assertPeriodOpen(tx, e.entryDate, "修改單據的專案、部門");
    await tx.update(journalEntriesTable).set({ projectId: next.projectId, departmentId: next.departmentId }).where(eq(journalEntriesTable.id, entryId));
  }
  await tx.update(vouchersTable).set(next).where(eq(vouchersTable.id, v.id));
  return `已修改 ${v.voucherNumber}`;
});

registerChangeHandler("voucher", "delete", async (tx, cr) => {
  const [existing] = await tx.select().from(vouchersTable).where(eq(vouchersTable.id, cr.targetId ?? 0)).for("update");
  if (!existing) return "單據已經不在了";
  await assertPeriodOpen(tx, existing.voucherDate, "刪除單據");
  const entries = await voucherEntries(tx, existing);
  for (const e of entries) await assertPeriodOpen(tx, e.entryDate, "刪除單據的分錄");
  const settlements = await tx.select({ invoiceId: invoiceSettlementsTable.invoiceId }).from(invoiceSettlementsTable).where(eq(invoiceSettlementsTable.voucherId, existing.id));
  const affected = settlements.map((s: any) => Number(s.invoiceId));
  const items: any[] = Array.isArray(existing.items) ? (existing.items as any[]) : [];
  for (const kind of ["sales", "purchase"] as const) {
    const key = kind === "sales" ? "salesOrderId" : "purchaseOrderId";
    const orderIds = Array.from(new Set(items.map(it => Number(it?.[key])).filter(n => Number.isInteger(n) && n > 0)));
    if (orderIds.length > 0) affected.push(...(await orderInvoices(tx, kind, orderIds)).map(i => i.id));
  }
  await tx.delete(vouchersTable).where(eq(vouchersTable.id, existing.id));
  for (const e of entries) await tx.delete(journalEntriesTable).where(eq(journalEntriesTable.id, e.id));
  if (affected.length > 0) await recomputeInvoices(tx, affected);
  const depositOrderIds = Array.from(new Set(items.filter(it => it?.asDeposit === true).map(it => Number(it?.salesOrderId)).filter(n => Number.isInteger(n) && n > 0)));
  for (const orderId of depositOrderIds) await syncSalesOrderDepositTransfer(tx, orderId);
  return `已刪除 ${existing.voucherNumber}${entries.length > 0 ? `，分錄 ${entries.map((e: any) => e.entryNumber).join("、")}` : ""}`;
});

router.delete("/vouchers/:id", async (req, res): Promise<void> => {
  const params = DeleteVoucherParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: friendlyValidationError(params.error) }); return; }
  try {
    await db.transaction(async (tx) => {
      const [existing] = await tx.select().from(vouchersTable).where(eq(vouchersTable.id, params.data.id));
      if (!existing) throw new Error("Voucher not found");
      if (isLegacyVoucher(existing.items)) throw Object.assign(new Error(LEGACY_VOUCHER_READONLY_MESSAGE), { status: 400 });
      // 已入帳（有分錄）或已作廢的傳票是交易紀錄，只能作廢、不能刪除
      if (existing.journalEntryId || existing.status === VOUCHER_VOIDED) {
        throw Object.assign(new Error("已入帳的傳票不能刪除，請改用「作廢」，系統會自動開沖銷分錄並保留紀錄"), { status: 400 });
      }
      await assertPeriodOpen(tx, existing.voucherDate, "刪除傳票");
      const settlements = await tx.select({ invoiceId: invoiceSettlementsTable.invoiceId })
        .from(invoiceSettlementsTable)
        .where(eq(invoiceSettlementsTable.voucherId, params.data.id));
      const affected = settlements.map((s: any) => Number(s.invoiceId));
      const existingItems: any[] = Array.isArray(existing.items) ? (existing.items as any[]) : [];
      for (const kind of ["sales", "purchase"] as const) {
        const key = kind === "sales" ? "salesOrderId" : "purchaseOrderId";
        const orderIds = Array.from(new Set(existingItems.map(it => Number(it?.[key])).filter(id => Number.isInteger(id) && id > 0)));
        if (orderIds.length > 0) affected.push(...(await orderInvoices(tx, kind, orderIds)).map(i => i.id));
      }
      const [voucher] = await tx.delete(vouchersTable).where(eq(vouchersTable.id, params.data.id)).returning();
      if (!voucher) throw new Error("Voucher not found");
      // 同步刪除建立傳票時自動產生的分錄，避免總帳殘留
      if (voucher.journalEntryId) {
        await tx.delete(journalEntriesTable).where(eq(journalEntriesTable.id, voucher.journalEntryId));
      }
      // settlements 因 onDelete cascade 已被刪除，重算受影響發票
      if (affected.length > 0) await recomputeInvoices(tx, affected);
    });
    res.sendStatus(204);
  } catch (err: any) {
    if (err.message === "Voucher not found") res.status(404).json({ error: "找不到傳票" });
    else if (err?.status === 400) res.status(400).json({ error: err.message });
    else res.status(500).json({ error: friendlyCaughtError(err, "傳票刪除失敗，請稍後再試") });
  }
});

export default router;
