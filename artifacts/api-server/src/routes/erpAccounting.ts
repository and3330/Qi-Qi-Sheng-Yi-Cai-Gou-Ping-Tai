import { Router, type IRouter } from "express";
import { and, count, desc, eq, sql, type SQL } from "drizzle-orm";
import {
  db,
  erpAccountsTable,
  erpAccountingSettingsTable,
  erpJournalEntriesTable,
  erpVouchersTable,
  erpInvoicesTable,
  erpInvoiceSettlementsTable,
  erpPaymentRequestsTable,
  erpBankStatementsTable,
  erpBankReconciliationEntriesTable,
  erpCustomersTable,
  suppliersTable,
  erpAuditLogsTable,
  type ErpJournalLine,
} from "@workspace/db";
import { requireErp, requireErpMenu } from "../middlewares/requireErp";
import {
  assertPeriodOpen,
  createAutoJournalEntry,
  getLockDate,
  resolveJournalLines,
  todayISO,
} from "../lib/erpAutoJournal";
import { recomputeInvoices } from "../lib/erpInvoiceSync";

const router: IRouter = Router();

/** 會計寫入角色 */
const FINANCE_WRITE = ["admin", "finance_admin", "accountant"];

class DocError extends Error {}

async function audit(
  req: { member?: { id: number; name: string; username: string } },
  entry: {
    action: string;
    documentType?: string;
    documentId?: string;
    description?: string;
  },
) {
  try {
    const m = req.member!;
    await db.insert(erpAuditLogsTable).values({
      action: entry.action,
      module: "accounting",
      documentType: entry.documentType ?? null,
      documentId: entry.documentId ?? null,
      userId: m.id,
      userName: m.name || m.username,
      description: entry.description ?? null,
    });
  } catch {
    /* audit 失敗不阻斷主流程 */
  }
}

const isDate = (s: unknown): s is string =>
  typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);

const intAmount = (v: unknown): number | null => {
  const n = Number(v);
  if (!Number.isFinite(n) || !Number.isInteger(n)) return null;
  return n;
};

/* ============================ 科目表 ============================ */

router.get(
  "/erp/accounting/accounts",
  requireErpMenu("/accounting/accounts"),
  async (_req, res): Promise<void> => {
    const rows = await db
      .select()
      .from(erpAccountsTable)
      .orderBy(erpAccountsTable.accountNumber);
    // hasChildren：彙總科目或實際有子科目者（前端據此排除不可過帳科目）
    const parentIds = new Set(
      rows.map((r) => r.parentAccountId).filter((v) => v != null),
    );
    res.json(
      rows.map((r) => ({
        ...r,
        hasChildren: r.isGroup || parentIds.has(r.id),
      })),
    );
  },
);

const CASH_FLOW_CATEGORIES = ["operating", "investing", "financing", "cash"];
const ACCOUNT_TYPES = ["Asset", "Liability", "Equity", "Income", "Expense"];

router.post(
  "/erp/accounting/accounts",
  requireErpMenu("/accounting/accounts"),
  requireErp(...FINANCE_WRITE),
  async (req, res): Promise<void> => {
    const {
      accountNumber,
      accountName,
      accountType,
      parentAccountId,
      isGroup,
      cashFlowCategory,
      balance,
      description,
    } = req.body ?? {};
    if (!accountNumber || !accountName || !ACCOUNT_TYPES.includes(accountType)) {
      res.status(400).json({ error: "缺少必填欄位或科目類型不正確" });
      return;
    }
    if (cashFlowCategory && !CASH_FLOW_CATEGORIES.includes(cashFlowCategory)) {
      res.status(400).json({ error: "現金流量分類不正確" });
      return;
    }
    if (parentAccountId != null) {
      const [parent] = await db
        .select()
        .from(erpAccountsTable)
        .where(eq(erpAccountsTable.id, Number(parentAccountId)));
      if (!parent) {
        res.status(400).json({ error: "上層科目不存在" });
        return;
      }
    }
    try {
      const [row] = await db
        .insert(erpAccountsTable)
        .values({
          accountNumber: String(accountNumber),
          accountName: String(accountName),
          accountType,
          parentAccountId: parentAccountId != null ? Number(parentAccountId) : null,
          isGroup: Boolean(isGroup),
          cashFlowCategory: cashFlowCategory || null,
          balance: intAmount(balance) ?? 0,
          description: description || null,
        })
        .returning();
      await audit(req, {
        action: "create",
        documentType: "account",
        documentId: String(row.id),
        description: `新增科目 ${row.accountNumber} ${row.accountName}`,
      });
      res.status(201).json(row);
    } catch (err: any) {
      if (err?.cause?.code === "23505") {
        res.status(409).json({ error: "科目編號已存在" });
        return;
      }
      throw err;
    }
  },
);

router.patch(
  "/erp/accounting/accounts/:id",
  requireErpMenu("/accounting/accounts"),
  requireErp(...FINANCE_WRITE),
  async (req, res): Promise<void> => {
    const id = Number(req.params.id);
    const [existing] = await db
      .select()
      .from(erpAccountsTable)
      .where(eq(erpAccountsTable.id, id));
    if (!existing) {
      res.status(404).json({ error: "科目不存在" });
      return;
    }
    const { accountName, cashFlowCategory, balance, description, isActive } =
      req.body ?? {};
    if (cashFlowCategory && !CASH_FLOW_CATEGORIES.includes(cashFlowCategory)) {
      res.status(400).json({ error: "現金流量分類不正確" });
      return;
    }
    const patch: Record<string, unknown> = {};
    if (accountName !== undefined) patch.accountName = String(accountName);
    if (cashFlowCategory !== undefined)
      patch.cashFlowCategory = cashFlowCategory || null;
    if (balance !== undefined) {
      const b = intAmount(balance);
      if (b == null) {
        res.status(400).json({ error: "期初餘額必須為整數" });
        return;
      }
      patch.balance = b;
    }
    if (description !== undefined) patch.description = description || null;
    if (isActive !== undefined) patch.isActive = Boolean(isActive);
    const [row] = await db
      .update(erpAccountsTable)
      .set(patch)
      .where(eq(erpAccountsTable.id, id))
      .returning();
    await audit(req, {
      action: "update",
      documentType: "account",
      documentId: String(id),
      description: `更新科目 ${row.accountNumber}`,
    });
    res.json(row);
  },
);

/* ============================ 會計設定（關帳日） ============================ */

router.get(
  "/erp/accounting/settings",
  requireErpMenu("/accounting/journal"),
  async (_req, res): Promise<void> => {
    const lockDate = await getLockDate(db);
    res.json({ lockDate });
  },
);

router.put(
  "/erp/accounting/settings",
  requireErpMenu("/accounting/journal"),
  requireErp(...FINANCE_WRITE),
  async (req, res): Promise<void> => {
    const { lockDate } = req.body ?? {};
    if (lockDate != null && lockDate !== "" && !isDate(lockDate)) {
      res.status(400).json({ error: "關帳日格式須為 YYYY-MM-DD" });
      return;
    }
    const value = lockDate ? String(lockDate) : null;
    const [existing] = await db.select().from(erpAccountingSettingsTable).limit(1);
    if (existing) {
      await db
        .update(erpAccountingSettingsTable)
        .set({ lockDate: value, updatedAt: new Date() })
        .where(eq(erpAccountingSettingsTable.id, existing.id));
    } else {
      await db.insert(erpAccountingSettingsTable).values({ lockDate: value });
    }
    await audit(req, {
      action: "update",
      documentType: "settings",
      description: `設定關帳日為 ${value ?? "（無）"}`,
    });
    res.json({ lockDate: value });
  },
);

/* ============================ 日記帳/傳票 ============================ */

router.get(
  "/erp/accounting/journal-entries",
  requireErpMenu("/accounting/journal"),
  async (req, res): Promise<void> => {
    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize) || 20));
    const { startDate, endDate, q } = req.query as Record<string, string>;
    const conditions: SQL[] = [];
    if (isDate(startDate))
      conditions.push(sql`${erpJournalEntriesTable.entryDate} >= ${startDate}`);
    if (isDate(endDate))
      conditions.push(sql`${erpJournalEntriesTable.entryDate} <= ${endDate}`);
    if (q)
      conditions.push(
        sql`(${erpJournalEntriesTable.entryNumber} ILIKE ${"%" + q + "%"} OR ${erpJournalEntriesTable.description} ILIKE ${"%" + q + "%"})`,
      );
    const where = conditions.length > 0 ? and(...conditions) : undefined;
    const [rows, [{ total }]] = await Promise.all([
      db
        .select()
        .from(erpJournalEntriesTable)
        .where(where)
        .orderBy(desc(erpJournalEntriesTable.entryDate), desc(erpJournalEntriesTable.id))
        .limit(pageSize)
        .offset((page - 1) * pageSize),
      db.select({ total: count() }).from(erpJournalEntriesTable).where(where),
    ]);
    res.json({ items: rows, total: Number(total), page, pageSize });
  },
);

router.post(
  "/erp/accounting/journal-entries",
  requireErpMenu("/accounting/journal"),
  requireErp(...FINANCE_WRITE),
  async (req, res): Promise<void> => {
    const { entryDate, reference, description, lines, status } = req.body ?? {};
    if (!isDate(entryDate)) {
      res.status(400).json({ error: "傳票日期格式須為 YYYY-MM-DD" });
      return;
    }
    if (!Array.isArray(lines) || lines.length < 2) {
      res.status(400).json({ error: "至少需要兩筆分錄行" });
      return;
    }
    const parsed: ErpJournalLine[] = [];
    for (const line of lines) {
      const debit = intAmount(line?.debit ?? 0);
      const credit = intAmount(line?.credit ?? 0);
      if (debit == null || credit == null || debit < 0 || credit < 0) {
        res.status(400).json({ error: "分錄金額必須為非負整數" });
        return;
      }
      if ((debit > 0 && credit > 0) || (debit === 0 && credit === 0)) {
        res.status(400).json({ error: "每行僅能填借方或貸方其中一邊" });
        return;
      }
      if (line?.accountId == null) {
        res.status(400).json({ error: "分錄行必須指定科目" });
        return;
      }
      parsed.push({
        accountId: Number(line.accountId),
        accountName: line.accountName ?? null,
        debit,
        credit,
        description: line.description ?? null,
      });
    }
    const totalDebit = parsed.reduce((s, l) => s + l.debit, 0);
    const totalCredit = parsed.reduce((s, l) => s + l.credit, 0);
    if (totalDebit !== totalCredit) {
      res.status(400).json({
        error: `借貸不平衡（借 ${totalDebit} / 貸 ${totalCredit}）`,
      });
      return;
    }
    // 科目必須為可過帳的葉節點
    const ids = Array.from(new Set(parsed.map((l) => l.accountId!)));
    const accounts = await db
      .select()
      .from(erpAccountsTable)
      .where(sql`${erpAccountsTable.id} IN (${sql.join(ids.map((i) => sql`${i}`), sql`, `)})`);
    const accMap = new Map(accounts.map((a) => [a.id, a]));
    for (const l of parsed) {
      const acc = accMap.get(l.accountId!);
      if (!acc) {
        res.status(400).json({ error: `科目 ${l.accountId} 不存在` });
        return;
      }
      if (acc.isGroup) {
        res.status(400).json({ error: `科目 ${acc.accountName} 為彙總科目，不可過帳` });
        return;
      }
      l.accountName = acc.accountName;
    }
    try {
      const row = await db.transaction(async (tx) => {
        await assertPeriodOpen(tx, entryDate, "新增傳票");
        const id = await createAutoJournalEntry(tx, {
          entryDate,
          description: description || "",
          reference: reference || null,
          lines: parsed,
          createdBy: req.member?.id ?? null,
        });
        const [created] = await tx
          .select()
          .from(erpJournalEntriesTable)
          .where(eq(erpJournalEntriesTable.id, id));
        // 手動傳票非自動立帳
        await tx
          .update(erpJournalEntriesTable)
          .set({ isAuto: false, status: status === "Draft" ? "Draft" : "Posted" })
          .where(eq(erpJournalEntriesTable.id, id));
        return { ...created, isAuto: false, status: status === "Draft" ? "Draft" : "Posted" };
      });
      await audit(req, {
        action: "create",
        documentType: "journal_entry",
        documentId: String(row.id),
        description: `新增傳票 ${row.entryNumber}`,
      });
      res.status(201).json(row);
    } catch (err: any) {
      res.status(400).json({ error: err?.message || "新增傳票失敗" });
    }
  },
);

router.delete(
  "/erp/accounting/journal-entries/:id",
  requireErpMenu("/accounting/journal"),
  requireErp(...FINANCE_WRITE),
  async (req, res): Promise<void> => {
    const id = Number(req.params.id);
    try {
      const deleted = await db.transaction(async (tx) => {
        const [entry] = await tx
          .select()
          .from(erpJournalEntriesTable)
          .where(eq(erpJournalEntriesTable.id, id))
          .for("update");
        if (!entry) throw new DocError("傳票不存在");
        if (entry.isAuto)
          throw new DocError("自動傳票不可直接刪除，請刪除其來源單據");
        await assertPeriodOpen(tx, entry.entryDate, "刪除傳票");
        await tx
          .delete(erpJournalEntriesTable)
          .where(eq(erpJournalEntriesTable.id, id));
        return entry;
      });
      await audit(req, {
        action: "delete",
        documentType: "journal_entry",
        documentId: String(id),
        description: `刪除傳票 ${deleted.entryNumber}`,
      });
      res.json({ success: true });
    } catch (err: any) {
      res.status(400).json({ error: err?.message || "刪除傳票失敗" });
    }
  },
);

/* ============================ 收付款/請款單 ============================ */

const VOUCHER_TYPES = ["Receipt", "Payment", "Journal"];
const VOUCHER_PREFIX: Record<string, string> = {
  Receipt: "RC",
  Payment: "PY",
  Journal: "RQ",
};
const VOUCHER_LABEL: Record<string, string> = {
  Receipt: "收款單",
  Payment: "付款單",
  Journal: "請款單",
};

router.get(
  "/erp/accounting/vouchers",
  requireErpMenu("/accounting/vouchers"),
  async (req, res): Promise<void> => {
    const { voucherType } = req.query as Record<string, string>;
    const where = voucherType
      ? eq(erpVouchersTable.voucherType, voucherType)
      : undefined;
    const rows = await db
      .select({
        id: erpVouchersTable.id,
        voucherNumber: erpVouchersTable.voucherNumber,
        voucherType: erpVouchersTable.voucherType,
        voucherDate: erpVouchersTable.voucherDate,
        partyType: erpVouchersTable.partyType,
        customerId: erpVouchersTable.customerId,
        customerName: erpCustomersTable.name,
        supplierId: erpVouchersTable.supplierId,
        supplierName: suppliersTable.name,
        totalAmount: erpVouchersTable.totalAmount,
        paymentMethod: erpVouchersTable.paymentMethod,
        bankAccount: erpVouchersTable.bankAccount,
        items: erpVouchersTable.items,
        remarks: erpVouchersTable.remarks,
        journalEntryId: erpVouchersTable.journalEntryId,
        createdAt: erpVouchersTable.createdAt,
      })
      .from(erpVouchersTable)
      .leftJoin(erpCustomersTable, eq(erpVouchersTable.customerId, erpCustomersTable.id))
      .leftJoin(suppliersTable, eq(erpVouchersTable.supplierId, suppliersTable.id))
      .where(where)
      .orderBy(desc(erpVouchersTable.createdAt));
    res.json(rows);
  },
);

router.post(
  "/erp/accounting/vouchers",
  requireErpMenu("/accounting/vouchers"),
  requireErp(...FINANCE_WRITE),
  async (req, res): Promise<void> => {
    const {
      voucherType,
      voucherDate,
      partyType,
      partyId,
      customerId: rawCustomerId,
      supplierId: rawSupplierId,
      totalAmount,
      paymentMethod,
      paymentAccountId,
      bankAccount,
      items,
      settlements,
      description,
      remarks,
    } = req.body ?? {};
    // 前端合約：partyId + partyType（customer/supplier）；相容 customerId/supplierId
    const partyKind = typeof partyType === "string" ? partyType.toLowerCase() : "";
    const customerId =
      rawCustomerId ?? (partyKind === "customer" && partyId != null ? partyId : null);
    const supplierId =
      rawSupplierId ?? (partyKind === "supplier" && partyId != null ? partyId : null);
    if (!VOUCHER_TYPES.includes(voucherType) || !isDate(voucherDate)) {
      res.status(400).json({ error: "單據類型或日期不正確" });
      return;
    }
    const total = intAmount(totalAmount);
    if (total == null || total <= 0) {
      res.status(400).json({ error: "金額必須為正整數" });
      return;
    }
    const rawItems = items ?? settlements;
    const itemList: Array<{ invoiceId?: number; description?: string; amount: number }> = [];
    if (rawItems != null) {
      if (!Array.isArray(rawItems)) {
        res.status(400).json({ error: "items 格式不正確" });
        return;
      }
      for (const it of rawItems) {
        const amt = intAmount(it?.amount);
        if (amt == null || amt <= 0) {
          res.status(400).json({ error: "明細金額必須為正整數" });
          return;
        }
        itemList.push({
          invoiceId: it?.invoiceId != null ? Number(it.invoiceId) : undefined,
          description: it?.description || undefined,
          amount: amt,
        });
      }
      if (itemList.length > 0) {
        const sum = itemList.reduce((s, i) => s + i.amount, 0);
        if (sum !== total) {
          res.status(400).json({ error: `明細合計 ${sum} 與單據金額 ${total} 不符` });
          return;
        }
      }
    }
    try {
      const created = await db.transaction(async (tx) => {
        await assertPeriodOpen(tx, voucherDate, `新增${VOUCHER_LABEL[voucherType]}`);
        // 編號：依類型計數
        const prefix = VOUCHER_PREFIX[voucherType];
        const result = await tx.execute(
          sql`SELECT COUNT(*)::int AS n FROM erp_vouchers WHERE voucher_type = ${voucherType}`,
        );
        const n = Number((result.rows ?? result)[0]?.n || 0);
        const voucherNumber = `${prefix}-${String(n + 1).padStart(5, "0")}`;

        // 核銷：收款單沖銷售發票、付款單沖採購發票
        const settleIds: number[] = [];
        for (const it of itemList) {
          if (!it.invoiceId) continue;
          if (voucherType === "Journal")
            throw new DocError("請款單不可直接核銷發票，請走付款流程");
          const [inv] = await tx
            .select()
            .from(erpInvoicesTable)
            .where(eq(erpInvoicesTable.id, it.invoiceId))
            .for("update");
          if (!inv) throw new DocError(`發票 ${it.invoiceId} 不存在`);
          if (inv.status === "Cancelled") throw new DocError(`發票 ${inv.invoiceNumber} 已作廢`);
          if (voucherType === "Receipt") {
            if (inv.invoiceType !== "Sales")
              throw new DocError("收款單僅能核銷銷售發票");
            if (customerId && inv.customerId && Number(customerId) !== inv.customerId)
              throw new DocError(`發票 ${inv.invoiceNumber} 的客戶與單據不符`);
          }
          if (voucherType === "Payment") {
            if (inv.invoiceType !== "Purchase")
              throw new DocError("付款單僅能核銷採購發票");
            if (supplierId && inv.supplierId && Number(supplierId) !== inv.supplierId)
              throw new DocError(`發票 ${inv.invoiceNumber} 的供應商與單據不符`);
          }
          if (it.amount > inv.outstandingAmount)
            throw new DocError(
              `核銷金額 ${it.amount} 超過發票 ${inv.invoiceNumber} 未結金額 ${inv.outstandingAmount}`,
            );
          settleIds.push(it.invoiceId);
        }

        const [voucher] = await tx
          .insert(erpVouchersTable)
          .values({
            voucherNumber,
            voucherType,
            voucherDate,
            partyType: partyType || null,
            customerId: customerId != null ? Number(customerId) : null,
            supplierId: supplierId != null ? Number(supplierId) : null,
            totalAmount: total,
            paymentMethod: paymentMethod || null,
            bankAccount: bankAccount || null,
            items: itemList,
            remarks: remarks || description || null,
            createdBy: req.member?.id ?? null,
          })
          .returning();

        for (const it of itemList) {
          if (!it.invoiceId) continue;
          await tx.insert(erpInvoiceSettlementsTable).values({
            invoiceId: it.invoiceId,
            voucherId: voucher.id,
            amount: it.amount,
            remarks: `${VOUCHER_LABEL[voucherType]} ${voucherNumber} 核銷`,
          });
        }
        if (settleIds.length > 0) await recomputeInvoices(tx, settleIds);

        // 自動傳票：優先使用前端指定的收付款科目
        let cashName = paymentMethod === "cash" ? "庫存現金" : "銀行存款";
        if (paymentAccountId != null) {
          const [payAcc] = await tx
            .select()
            .from(erpAccountsTable)
            .where(eq(erpAccountsTable.id, Number(paymentAccountId)));
          if (!payAcc || !payAcc.isActive)
            throw new DocError("收付款科目不存在或已停用");
          if (payAcc.isGroup) throw new DocError("收付款科目須為葉節點科目");
          cashName = payAcc.accountName;
        }
        let lines: ErpJournalLine[] = [];
        if (voucherType === "Receipt") {
          lines = [
            { accountName: cashName, debit: total, credit: 0 },
            { accountName: "應收帳款", debit: 0, credit: total },
          ];
        } else if (voucherType === "Payment") {
          lines = [
            { accountName: "應付帳款", debit: total, credit: 0 },
            { accountName: cashName, debit: 0, credit: total },
          ];
        } else {
          lines = [
            { accountName: "費用", debit: total, credit: 0 },
            { accountName: "應付帳款", debit: 0, credit: total },
          ];
        }
        const jeId = await createAutoJournalEntry(tx, {
          entryDate: voucherDate,
          description: `${VOUCHER_LABEL[voucherType]} ${voucherNumber} 自動立帳`,
          reference: voucherNumber,
          lines,
          sourceType: "voucher",
          sourceId: String(voucher.id),
          createdBy: req.member?.id ?? null,
        });
        const [row] = await tx
          .update(erpVouchersTable)
          .set({ journalEntryId: jeId })
          .where(eq(erpVouchersTable.id, voucher.id))
          .returning();
        return row;
      });
      await audit(req, {
        action: "create",
        documentType: "voucher",
        documentId: String(created.id),
        description: `新增${VOUCHER_LABEL[voucherType]} ${created.voucherNumber}`,
      });
      res.status(201).json(created);
    } catch (err: any) {
      if (err instanceof DocError) {
        res.status(400).json({ error: err.message });
        return;
      }
      res.status(400).json({ error: err?.message || "新增單據失敗" });
    }
  },
);

router.delete(
  "/erp/accounting/vouchers/:id",
  requireErpMenu("/accounting/vouchers"),
  requireErp(...FINANCE_WRITE),
  async (req, res): Promise<void> => {
    const id = Number(req.params.id);
    try {
      const deleted = await db.transaction(async (tx) => {
        const [voucher] = await tx
          .select()
          .from(erpVouchersTable)
          .where(eq(erpVouchersTable.id, id))
          .for("update");
        if (!voucher) throw new DocError("單據不存在");
        await assertPeriodOpen(tx, voucher.voucherDate, "刪除單據");
        // 找出關聯發票以便重算
        const settlements = await tx
          .select()
          .from(erpInvoiceSettlementsTable)
          .where(eq(erpInvoiceSettlementsTable.voucherId, id));
        const invoiceIds = settlements.map((s) => s.invoiceId);
        // 鎖定發票
        for (const invId of invoiceIds) {
          await tx
            .select()
            .from(erpInvoicesTable)
            .where(eq(erpInvoicesTable.id, invId))
            .for("update");
        }
        await tx.delete(erpVouchersTable).where(eq(erpVouchersTable.id, id));
        if (voucher.journalEntryId) {
          await tx
            .delete(erpJournalEntriesTable)
            .where(eq(erpJournalEntriesTable.id, voucher.journalEntryId));
        }
        if (invoiceIds.length > 0) await recomputeInvoices(tx, invoiceIds);
        return voucher;
      });
      await audit(req, {
        action: "delete",
        documentType: "voucher",
        documentId: String(id),
        description: `刪除單據 ${deleted.voucherNumber}`,
      });
      res.json({ success: true });
    } catch (err: any) {
      res.status(400).json({ error: err?.message || "刪除單據失敗" });
    }
  },
);

/* ============================ 發票（AR/AP） ============================ */

/** 計算稅額欄位（含稅金額 → 未稅+稅額，四捨五入取整） */
function taxFields(totalAmount: number, taxType: string, taxRate: number) {
  if (taxType === "taxable" && taxRate > 0) {
    const net = Math.round(totalAmount / (1 + taxRate / 100));
    return { netAmount: net, taxAmount: totalAmount - net };
  }
  return { netAmount: totalAmount, taxAmount: 0 };
}

const TAX_TYPES = ["taxable", "zero_rated", "exempt", "unclassified"];
/** 發票自動傳票分錄模板（開立/稅別調整共用，維持與 JE 一致） */
function invoiceJournalLines(
  invoiceType: string,
  total: number,
  netAmount: number,
  taxAmount: number,
): ErpJournalLine[] {
  return invoiceType === "Sales"
    ? [
        { accountName: "應收帳款", debit: total, credit: 0 },
        { accountName: "銷貨收入", debit: 0, credit: netAmount },
        ...(taxAmount > 0
          ? [{ accountName: "銷項稅額", debit: 0, credit: taxAmount }]
          : []),
      ]
    : [
        { accountName: "費用", debit: netAmount, credit: 0 },
        ...(taxAmount > 0
          ? [{ accountName: "進項稅額", debit: taxAmount, credit: 0 }]
          : []),
        { accountName: "應付帳款", debit: 0, credit: total },
      ];
}

const INVOICE_STATUS_TRANSITIONS: Record<string, string[]> = {
  Draft: ["Unpaid", "Cancelled"],
  Unpaid: ["Overdue", "Cancelled"],
  Overdue: ["Unpaid", "Cancelled"],
  Paid: [],
  Cancelled: [],
};

router.get(
  "/erp/accounting/invoices",
  requireErpMenu("/accounting/invoices"),
  async (req, res): Promise<void> => {
    const { invoiceType, status, q } = req.query as Record<string, string>;
    const conditions: SQL[] = [];
    if (invoiceType) conditions.push(eq(erpInvoicesTable.invoiceType, invoiceType));
    if (status) conditions.push(eq(erpInvoicesTable.status, status));
    if (q)
      conditions.push(
        sql`(${erpInvoicesTable.invoiceNumber} ILIKE ${"%" + q + "%"} OR ${erpInvoicesTable.govInvoiceNumber} ILIKE ${"%" + q + "%"})`,
      );
    const rows = await db
      .select({
        id: erpInvoicesTable.id,
        invoiceNumber: erpInvoicesTable.invoiceNumber,
        invoiceType: erpInvoicesTable.invoiceType,
        customerId: erpInvoicesTable.customerId,
        customerName: erpCustomersTable.name,
        supplierId: erpInvoicesTable.supplierId,
        supplierName: suppliersTable.name,
        salesOrderId: erpInvoicesTable.salesOrderId,
        purchaseOrderId: erpInvoicesTable.purchaseOrderId,
        invoiceDate: erpInvoicesTable.invoiceDate,
        dueDate: erpInvoicesTable.dueDate,
        totalAmount: erpInvoicesTable.totalAmount,
        paidAmount: erpInvoicesTable.paidAmount,
        outstandingAmount: erpInvoicesTable.outstandingAmount,
        taxType: erpInvoicesTable.taxType,
        taxRate: erpInvoicesTable.taxRate,
        netAmount: erpInvoicesTable.netAmount,
        taxAmount: erpInvoicesTable.taxAmount,
        govInvoiceNumber: erpInvoicesTable.govInvoiceNumber,
        status: erpInvoicesTable.status,
        remarks: erpInvoicesTable.remarks,
        journalEntryId: erpInvoicesTable.journalEntryId,
        createdAt: erpInvoicesTable.createdAt,
      })
      .from(erpInvoicesTable)
      .leftJoin(erpCustomersTable, eq(erpInvoicesTable.customerId, erpCustomersTable.id))
      .leftJoin(suppliersTable, eq(erpInvoicesTable.supplierId, suppliersTable.id))
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(erpInvoicesTable.createdAt));
    res.json(rows);
  },
);

router.post(
  "/erp/accounting/invoices",
  requireErpMenu("/accounting/invoices"),
  requireErp(...FINANCE_WRITE),
  async (req, res): Promise<void> => {
    const {
      invoiceType,
      customerId,
      supplierId,
      invoiceDate,
      dueDate,
      totalAmount,
      taxType,
      taxRate,
      govInvoiceNumber,
      items,
      remarks,
    } = req.body ?? {};
    if (!["Sales", "Purchase"].includes(invoiceType) || !isDate(invoiceDate)) {
      res.status(400).json({ error: "發票類型或日期不正確" });
      return;
    }
    if (invoiceType === "Sales" && customerId == null) {
      res.status(400).json({ error: "銷售發票必須指定客戶" });
      return;
    }
    if (invoiceType === "Purchase" && supplierId == null) {
      res.status(400).json({ error: "採購發票必須指定供應商" });
      return;
    }
    const total = intAmount(totalAmount);
    if (total == null || total <= 0) {
      res.status(400).json({ error: "金額必須為正整數" });
      return;
    }
    const tt = taxType && TAX_TYPES.includes(taxType) ? taxType : "taxable";
    const tr = intAmount(taxRate) ?? 5;
    const { netAmount, taxAmount } = taxFields(total, tt, tr);
    try {
      const created = await db.transaction(async (tx) => {
        await assertPeriodOpen(tx, invoiceDate, "開立發票");
        const prefix = invoiceType === "Sales" ? "SINV" : "PINV";
        const result = await tx.execute(
          sql`SELECT COUNT(*)::int AS n FROM erp_invoices WHERE invoice_type = ${invoiceType}`,
        );
        const n = Number((result.rows ?? result)[0]?.n || 0);
        const invoiceNumber = `${prefix}-${String(n + 1).padStart(6, "0")}`;
        const [inv] = await tx
          .insert(erpInvoicesTable)
          .values({
            invoiceNumber,
            invoiceType,
            customerId: customerId != null ? Number(customerId) : null,
            supplierId: supplierId != null ? Number(supplierId) : null,
            invoiceDate,
            dueDate: isDate(dueDate) ? dueDate : null,
            totalAmount: total,
            paidAmount: 0,
            outstandingAmount: total,
            taxType: tt,
            taxRate: tr,
            netAmount,
            taxAmount,
            govInvoiceNumber: govInvoiceNumber || null,
            status: "Unpaid",
            items: Array.isArray(items) ? items : [],
            remarks: remarks || null,
            createdBy: req.member?.id ?? null,
          })
          .returning();
        // 自動傳票：銷售 借應收/貸銷貨收入(+銷項稅額)；採購 借費用(+進項稅額)/貸應付
        const lines = invoiceJournalLines(invoiceType, total, netAmount, taxAmount);
        const jeId = await createAutoJournalEntry(tx, {
          entryDate: invoiceDate,
          description: `發票 ${invoiceNumber} 自動立帳`,
          reference: invoiceNumber,
          lines,
          sourceType: "invoice",
          sourceId: String(inv.id),
          createdBy: req.member?.id ?? null,
        });
        const [row] = await tx
          .update(erpInvoicesTable)
          .set({ journalEntryId: jeId })
          .where(eq(erpInvoicesTable.id, inv.id))
          .returning();
        return row;
      });
      await audit(req, {
        action: "create",
        documentType: "invoice",
        documentId: String(created.id),
        description: `開立發票 ${created.invoiceNumber}`,
      });
      res.status(201).json(created);
    } catch (err: any) {
      res.status(400).json({ error: err?.message || "開立發票失敗" });
    }
  },
);

router.patch(
  "/erp/accounting/invoices/:id",
  requireErpMenu("/accounting/invoices"),
  requireErp(...FINANCE_WRITE),
  async (req, res): Promise<void> => {
    const id = Number(req.params.id);
    const { status, dueDate, govInvoiceNumber, remarks, taxType } = req.body ?? {};
    try {
      const updated = await db.transaction(async (tx) => {
        const [inv] = await tx
          .select()
          .from(erpInvoicesTable)
          .where(eq(erpInvoicesTable.id, id))
          .for("update");
        if (!inv) throw new DocError("發票不存在");
        await assertPeriodOpen(tx, inv.invoiceDate, "修改發票");
        const patch: Record<string, unknown> = {};
        // 金額不變式：paidAmount/outstandingAmount 僅由核銷重算，一律忽略外部傳入
        if (status !== undefined && status !== inv.status) {
          const allowed = INVOICE_STATUS_TRANSITIONS[inv.status] || [];
          if (!allowed.includes(status))
            throw new DocError(`發票狀態不可由「${inv.status}」轉為「${status}」`);
          if (status === "Cancelled") {
            const settlements = await tx
              .select()
              .from(erpInvoiceSettlementsTable)
              .where(eq(erpInvoiceSettlementsTable.invoiceId, id));
            if (settlements.length > 0)
              throw new DocError("發票已有核銷紀錄，不可作廢");
            // 作廢須沖回原自動傳票（借貸反向、冪等），報表才不會殘留 AR/AP 與收入費用
            if (inv.journalEntryId) {
              const [je] = await tx
                .select()
                .from(erpJournalEntriesTable)
                .where(eq(erpJournalEntriesTable.id, inv.journalEntryId));
              if (je) {
                const reversed = (je.lines as ErpJournalLine[]).map((l) => ({
                  accountId: l.accountId,
                  accountName: l.accountName,
                  debit: l.credit,
                  credit: l.debit,
                  description: l.description,
                }));
                await createAutoJournalEntry(tx, {
                  entryDate: todayISO(),
                  description: `發票 ${inv.invoiceNumber} 作廢沖回`,
                  reference: inv.invoiceNumber,
                  lines: reversed,
                  sourceType: "invoice_cancel",
                  sourceId: String(inv.id),
                  createdBy: req.member?.id ?? null,
                });
              }
            }
          }
          patch.status = status;
        }
        if (dueDate !== undefined) patch.dueDate = isDate(dueDate) ? dueDate : null;
        if (govInvoiceNumber !== undefined)
          patch.govInvoiceNumber = govInvoiceNumber || null;
        if (remarks !== undefined) patch.remarks = remarks || null;
        if (taxType !== undefined && TAX_TYPES.includes(taxType) && taxType !== inv.taxType) {
          if (inv.status === "Cancelled") throw new DocError("已作廢發票不可修改稅別");
          patch.taxType = taxType;
          const { netAmount, taxAmount } = taxFields(
            inv.totalAmount,
            taxType,
            inv.taxRate,
          );
          patch.netAmount = netAmount;
          patch.taxAmount = taxAmount;
          // 稅別調整須同步改寫已過帳的自動傳票，否則總帳與營業稅申報會不一致
          if (inv.journalEntryId) {
            const newLines = await resolveJournalLines(
              tx,
              invoiceJournalLines(inv.invoiceType, inv.totalAmount, netAmount, taxAmount),
            );
            const totalDebit = newLines.reduce((s, l) => s + l.debit, 0);
            const totalCredit = newLines.reduce((s, l) => s + l.credit, 0);
            if (totalDebit !== totalCredit) throw new DocError("稅別調整後借貸不平衡");
            await tx
              .update(erpJournalEntriesTable)
              .set({ lines: newLines, totalDebit, totalCredit })
              .where(eq(erpJournalEntriesTable.id, inv.journalEntryId));
          }
        }
        const [row] = await tx
          .update(erpInvoicesTable)
          .set(patch)
          .where(eq(erpInvoicesTable.id, id))
          .returning();
        return row;
      });
      await audit(req, {
        action: "update",
        documentType: "invoice",
        documentId: String(id),
        description: `更新發票 ${updated.invoiceNumber}`,
      });
      res.json(updated);
    } catch (err: any) {
      res.status(400).json({ error: err?.message || "更新發票失敗" });
    }
  },
);

router.delete(
  "/erp/accounting/invoices/:id",
  requireErpMenu("/accounting/invoices"),
  requireErp(...FINANCE_WRITE),
  async (req, res): Promise<void> => {
    const id = Number(req.params.id);
    try {
      const deleted = await db.transaction(async (tx) => {
        const [inv] = await tx
          .select()
          .from(erpInvoicesTable)
          .where(eq(erpInvoicesTable.id, id))
          .for("update");
        if (!inv) throw new DocError("發票不存在");
        await assertPeriodOpen(tx, inv.invoiceDate, "刪除發票");
        const settlements = await tx
          .select()
          .from(erpInvoiceSettlementsTable)
          .where(eq(erpInvoiceSettlementsTable.invoiceId, id));
        if (settlements.length > 0)
          throw new DocError("發票已有核銷紀錄，不可刪除。請先刪除相關收付款單。");
        await tx.delete(erpInvoicesTable).where(eq(erpInvoicesTable.id, id));
        if (inv.journalEntryId) {
          await tx
            .delete(erpJournalEntriesTable)
            .where(eq(erpJournalEntriesTable.id, inv.journalEntryId));
        }
        return inv;
      });
      await audit(req, {
        action: "delete",
        documentType: "invoice",
        documentId: String(id),
        description: `刪除發票 ${deleted.invoiceNumber}`,
      });
      res.json({ success: true });
    } catch (err: any) {
      res.status(400).json({ error: err?.message || "刪除發票失敗" });
    }
  },
);

router.get(
  "/erp/accounting/invoices/:id/settlements",
  requireErpMenu("/accounting/invoices"),
  async (req, res): Promise<void> => {
    const id = Number(req.params.id);
    const rows = await db
      .select({
        id: erpInvoiceSettlementsTable.id,
        invoiceId: erpInvoiceSettlementsTable.invoiceId,
        voucherId: erpInvoiceSettlementsTable.voucherId,
        voucherNumber: erpVouchersTable.voucherNumber,
        paymentRequestId: erpInvoiceSettlementsTable.paymentRequestId,
        amount: erpInvoiceSettlementsTable.amount,
        remarks: erpInvoiceSettlementsTable.remarks,
        createdAt: erpInvoiceSettlementsTable.createdAt,
      })
      .from(erpInvoiceSettlementsTable)
      .leftJoin(
        erpVouchersTable,
        eq(erpInvoiceSettlementsTable.voucherId, erpVouchersTable.id),
      )
      .where(eq(erpInvoiceSettlementsTable.invoiceId, id))
      .orderBy(desc(erpInvoiceSettlementsTable.createdAt));
    res.json(rows);
  },
);

/* ============================ 付款申請（請款） ============================ */

const PAYREQ_TRANSITIONS: Record<string, string[]> = {
  Draft: ["Pending", "Cancelled"],
  Pending: ["Approved", "Rejected", "Cancelled"],
  Approved: ["Paid", "Cancelled"],
  Paid: [],
  Rejected: ["Draft"],
  Cancelled: [],
};

router.get(
  "/erp/accounting/payment-requests",
  requireErpMenu("/accounting/payment-requests"),
  async (req, res): Promise<void> => {
    const { status, partyType } = req.query as Record<string, string>;
    const conditions: SQL[] = [];
    if (status) conditions.push(eq(erpPaymentRequestsTable.status, status));
    if (partyType) conditions.push(eq(erpPaymentRequestsTable.partyType, partyType));
    const rows = await db
      .select({
        id: erpPaymentRequestsTable.id,
        requestNumber: erpPaymentRequestsTable.requestNumber,
        invoiceId: erpPaymentRequestsTable.invoiceId,
        partyType: erpPaymentRequestsTable.partyType,
        partyId: sql<number | null>`COALESCE(${erpPaymentRequestsTable.customerId}, ${erpPaymentRequestsTable.supplierId})`,
        partyName: sql<string | null>`COALESCE(${erpCustomersTable.name}, ${suppliersTable.name})`,
        customerId: erpPaymentRequestsTable.customerId,
        customerName: erpCustomersTable.name,
        supplierId: erpPaymentRequestsTable.supplierId,
        supplierName: suppliersTable.name,
        requestDate: erpPaymentRequestsTable.requestDate,
        dueDate: erpPaymentRequestsTable.dueDate,
        amount: erpPaymentRequestsTable.amount,
        status: erpPaymentRequestsTable.status,
        paymentMethod: erpPaymentRequestsTable.paymentMethod,
        bankAccount: erpPaymentRequestsTable.bankAccount,
        remarks: erpPaymentRequestsTable.remarks,
        description: erpPaymentRequestsTable.remarks,
        createdAt: erpPaymentRequestsTable.createdAt,
      })
      .from(erpPaymentRequestsTable)
      .leftJoin(
        erpCustomersTable,
        eq(erpPaymentRequestsTable.customerId, erpCustomersTable.id),
      )
      .leftJoin(
        suppliersTable,
        eq(erpPaymentRequestsTable.supplierId, suppliersTable.id),
      )
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(erpPaymentRequestsTable.createdAt));
    res.json(rows);
  },
);

router.post(
  "/erp/accounting/payment-requests",
  requireErpMenu("/accounting/payment-requests"),
  requireErp(...FINANCE_WRITE),
  async (req, res): Promise<void> => {
    const {
      invoiceId,
      partyType: rawPartyType,
      partyId,
      customerId: rawCustomerId,
      supplierId: rawSupplierId,
      requestDate: rawRequestDate,
      dueDate,
      amount,
      paymentMethod,
      bankAccount,
      description,
      remarks,
    } = req.body ?? {};
    // 合約：partyType（大小寫皆可）+ partyId；相容 customerId/supplierId
    const partyType =
      typeof rawPartyType === "string" && rawPartyType.toLowerCase() === "customer"
        ? "Customer"
        : typeof rawPartyType === "string" && rawPartyType.toLowerCase() === "supplier"
          ? "Supplier"
          : null;
    const customerId =
      rawCustomerId ?? (partyType === "Customer" && partyId != null ? partyId : null);
    const supplierId =
      rawSupplierId ?? (partyType === "Supplier" && partyId != null ? partyId : null);
    const requestDate = isDate(rawRequestDate) ? rawRequestDate : todayISO();
    if (!partyType) {
      res.status(400).json({ error: "對象類型不正確" });
      return;
    }
    const amt = intAmount(amount);
    if (amt == null || amt <= 0) {
      res.status(400).json({ error: "金額必須為正整數" });
      return;
    }
    if (partyType === "Customer" && customerId == null) {
      res.status(400).json({ error: "客戶類型必須指定客戶" });
      return;
    }
    if (partyType === "Supplier" && supplierId == null) {
      res.status(400).json({ error: "供應商類型必須指定供應商" });
      return;
    }
    if (invoiceId != null) {
      const [inv] = await db
        .select()
        .from(erpInvoicesTable)
        .where(eq(erpInvoicesTable.id, Number(invoiceId)));
      if (!inv) {
        res.status(400).json({ error: "發票不存在" });
        return;
      }
      if (partyType === "Customer" && inv.invoiceType !== "Sales") {
        res.status(400).json({ error: "客戶付款申請僅能關聯銷售發票" });
        return;
      }
      if (partyType === "Supplier" && inv.invoiceType !== "Purchase") {
        res.status(400).json({ error: "供應商付款申請僅能關聯採購發票" });
        return;
      }
      const [{ pending }] = await db
        .select({ pending: sql<string>`COALESCE(SUM(amount), 0)` })
        .from(erpPaymentRequestsTable)
        .where(
          and(
            eq(erpPaymentRequestsTable.invoiceId, Number(invoiceId)),
            sql`status NOT IN ('Paid', 'Rejected', 'Cancelled')`,
          ),
        );
      if (amt + Number(pending) > inv.outstandingAmount) {
        res.status(400).json({
          error: `金額超過發票未結金額（未結 ${inv.outstandingAmount}，其他申請中 ${pending}）`,
        });
        return;
      }
    }
    const requestNumber = "PRQ-" + String(Date.now()).slice(-8);
    const [row] = await db
      .insert(erpPaymentRequestsTable)
      .values({
        requestNumber,
        invoiceId: invoiceId != null ? Number(invoiceId) : null,
        partyType,
        customerId: customerId != null ? Number(customerId) : null,
        supplierId: supplierId != null ? Number(supplierId) : null,
        requestDate,
        dueDate: isDate(dueDate) ? dueDate : null,
        amount: amt,
        paymentMethod: paymentMethod || null,
        bankAccount: bankAccount || null,
        remarks: remarks || description || null,
        createdBy: req.member?.id ?? null,
      })
      .returning();
    await audit(req, {
      action: "create",
      documentType: "payment_request",
      documentId: String(row.id),
      description: `新增付款申請 ${row.requestNumber}`,
    });
    res.status(201).json(row);
  },
);

router.patch(
  "/erp/accounting/payment-requests/:id",
  requireErpMenu("/accounting/payment-requests"),
  requireErp(...FINANCE_WRITE),
  async (req, res): Promise<void> => {
    const id = Number(req.params.id);
    const {
      status,
      remarks,
      description,
      paymentMethod,
      paymentAccountId,
      bankAccount,
      dueDate,
      amount,
    } = req.body ?? {};
    try {
      const updated = await db.transaction(async (tx) => {
        const [locked] = await tx
          .select()
          .from(erpPaymentRequestsTable)
          .where(eq(erpPaymentRequestsTable.id, id))
          .for("update");
        if (!locked) throw new DocError("付款申請不存在");
        const patch: Record<string, unknown> = {};
        if (status) {
          const allowed = PAYREQ_TRANSITIONS[locked.status] || [];
          if (!allowed.includes(status))
            throw new DocError(`無法從「${locked.status}」轉換為「${status}」`);
          patch.status = status;
        }
        if (locked.status === "Draft" || locked.status === "Rejected") {
          if (paymentMethod !== undefined) patch.paymentMethod = paymentMethod || null;
          if (bankAccount !== undefined) patch.bankAccount = bankAccount || null;
          if (dueDate !== undefined) patch.dueDate = isDate(dueDate) ? dueDate : null;
          if (amount !== undefined) {
            const amt = intAmount(amount);
            if (amt == null || amt <= 0) throw new DocError("金額必須為正整數");
            patch.amount = amt;
          }
        }
        if (remarks !== undefined || description !== undefined)
          patch.remarks = remarks || description || null;
        const [row] = await tx
          .update(erpPaymentRequestsTable)
          .set(patch)
          .where(eq(erpPaymentRequestsTable.id, id))
          .returning();
        if (status === "Paid") {
          const payDate = todayISO();
          await assertPeriodOpen(tx, payDate, "付款");
          if (locked.invoiceId) {
            // 透過核銷路徑結算，發票金額由 settlements 重算
            const [inv] = await tx
              .select()
              .from(erpInvoicesTable)
              .where(eq(erpInvoicesTable.id, locked.invoiceId))
              .for("update");
            if (!inv) throw new DocError("關聯發票不存在");
            if (row.amount > inv.outstandingAmount)
              throw new DocError(
                `付款金額 ${row.amount} 超過發票未結金額 ${inv.outstandingAmount}`,
              );
            await tx.insert(erpInvoiceSettlementsTable).values({
              paymentRequestId: id,
              invoiceId: locked.invoiceId,
              amount: row.amount,
              remarks: `付款申請 ${row.requestNumber} 付款`,
            });
            await recomputeInvoices(tx, [locked.invoiceId]);
          }
          // 自動傳票：付款 借應付/費用 貸現金銀行（優先用指定的付款科目）
          let cashName = row.paymentMethod === "cash" ? "庫存現金" : "銀行存款";
          if (paymentAccountId != null) {
            const [payAcc] = await tx
              .select()
              .from(erpAccountsTable)
              .where(eq(erpAccountsTable.id, Number(paymentAccountId)));
            if (!payAcc || !payAcc.isActive) throw new DocError("付款科目不存在或已停用");
            if (payAcc.isGroup) throw new DocError("付款科目須為葉節點科目");
            cashName = payAcc.accountName;
          }
          await createAutoJournalEntry(tx, {
            entryDate: payDate,
            description: `付款申請 ${row.requestNumber} 付款自動立帳`,
            reference: row.requestNumber,
            lines: [
              {
                accountName: locked.invoiceId ? "應付帳款" : "費用",
                debit: row.amount,
                credit: 0,
              },
              { accountName: cashName, debit: 0, credit: row.amount },
            ],
            sourceType: "payment_request",
            sourceId: String(id),
            createdBy: req.member?.id ?? null,
          });
        }
        return row;
      });
      await audit(req, {
        action: "update",
        documentType: "payment_request",
        documentId: String(id),
        description: `更新付款申請 ${updated.requestNumber}`,
      });
      res.json(updated);
    } catch (err: any) {
      res.status(400).json({ error: err?.message || "更新付款申請失敗" });
    }
  },
);

router.delete(
  "/erp/accounting/payment-requests/:id",
  requireErpMenu("/accounting/payment-requests"),
  requireErp(...FINANCE_WRITE),
  async (req, res): Promise<void> => {
    const id = Number(req.params.id);
    const [existing] = await db
      .select()
      .from(erpPaymentRequestsTable)
      .where(eq(erpPaymentRequestsTable.id, id));
    if (!existing) {
      res.status(404).json({ error: "付款申請不存在" });
      return;
    }
    if (existing.status !== "Draft") {
      res.status(400).json({ error: "只能刪除草稿狀態的付款申請" });
      return;
    }
    await db.delete(erpPaymentRequestsTable).where(eq(erpPaymentRequestsTable.id, id));
    await audit(req, {
      action: "delete",
      documentType: "payment_request",
      documentId: String(id),
      description: `刪除付款申請 ${existing.requestNumber}`,
    });
    res.json({ success: true });
  },
);

/* ============================ 銀行對帳 ============================ */

/** 對帳單序列化為前端合約格式 */
function serializeBankStatement(row: typeof erpBankStatementsTable.$inferSelect) {
  return {
    id: row.id,
    bankAccountId: row.bankAccountId,
    bankAccountName: row.bankName,
    statementDate: row.statementDate,
    openingBalance: row.openingBalance,
    closingBalance: row.closingBalance,
    status: row.status,
    createdAt: row.createdAt,
  };
}

/** 對帳明細序列化為前端合約格式（amount 有號：收入為正、支出為負） */
function serializeBankEntry(row: typeof erpBankReconciliationEntriesTable.$inferSelect) {
  return {
    id: row.id,
    statementId: row.statementId,
    transactionDate: row.transactionDate,
    description: row.description,
    amount: row.credit - row.debit,
    status: row.matchStatus,
    journalEntryId: row.matchedJournalEntryId,
    createdAt: row.createdAt,
  };
}

router.get(
  "/erp/accounting/bank-statements",
  requireErpMenu("/accounting/bank-reconciliation"),
  async (_req, res): Promise<void> => {
    const rows = await db
      .select()
      .from(erpBankStatementsTable)
      .orderBy(desc(erpBankStatementsTable.createdAt));
    res.json(rows.map(serializeBankStatement));
  },
);

router.post(
  "/erp/accounting/bank-statements",
  requireErpMenu("/accounting/bank-reconciliation"),
  requireErp(...FINANCE_WRITE),
  async (req, res): Promise<void> => {
    const {
      bankAccountId,
      bankAccountName,
      bankName,
      statementDate,
      openingBalance,
      closingBalance,
      remarks,
    } = req.body ?? {};
    if (!isDate(statementDate)) {
      res.status(400).json({ error: "缺少對帳日期" });
      return;
    }
    const opening = intAmount(openingBalance) ?? 0;
    const closing = intAmount(closingBalance) ?? 0;
    const [row] = await db
      .insert(erpBankStatementsTable)
      .values({
        bankName: bankAccountName || bankName || null,
        bankAccountId: bankAccountId != null ? Number(bankAccountId) : null,
        statementDate,
        openingBalance: opening,
        closingBalance: closing,
        status: "draft",
        remarks: remarks || null,
      })
      .returning();
    res.status(201).json(serializeBankStatement(row));
  },
);

router.get(
  "/erp/accounting/bank-statements/:id/entries",
  requireErpMenu("/accounting/bank-reconciliation"),
  async (req, res): Promise<void> => {
    const id = Number(req.params.id);
    const rows = await db
      .select()
      .from(erpBankReconciliationEntriesTable)
      .where(eq(erpBankReconciliationEntriesTable.statementId, id))
      .orderBy(erpBankReconciliationEntriesTable.transactionDate);
    res.json(rows.map(serializeBankEntry));
  },
);

/** 簡易 CSV 行解析（支援雙引號含逗號；引號未閉合回傳 null） */
function parseCsvLine(line: string): string[] | null {
  const cols: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else inQuotes = false;
      } else cur += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ",") {
      cols.push(cur.trim());
      cur = "";
    } else cur += ch;
  }
  if (inQuotes) return null;
  cols.push(cur.trim());
  return cols;
}

function parseAmount(v: string | undefined): number | null {
  if (!v) return 0;
  const n = Number(String(v).replace(/[,$\s]/g, ""));
  if (!Number.isFinite(n)) return null;
  return Math.round(n);
}

router.post(
  "/erp/accounting/bank-statements/:id/import",
  requireErpMenu("/accounting/bank-reconciliation"),
  requireErp(...FINANCE_WRITE),
  async (req, res): Promise<void> => {
    const statementId = Number(req.params.id);
    const [stmt] = await db
      .select()
      .from(erpBankStatementsTable)
      .where(eq(erpBankStatementsTable.id, statementId));
    if (!stmt) {
      res.status(404).json({ error: "對帳單不存在" });
      return;
    }
    const csv = String(req.body?.csv || "");
    const linesArr = csv.split(/\r?\n/).filter((l) => l.trim().length > 0);
    if (linesArr.length < 2) {
      res.status(400).json({ error: "CSV 內容不足（需含標題列與至少一筆資料）" });
      return;
    }
    const header = (parseCsvLine(linesArr[0]) || []).map((h) => h.toLowerCase());
    const dateIdx = header.findIndex((h) => h.includes("date") || h.includes("日期"));
    const descIdx = header.findIndex(
      (h) => h.includes("desc") || h.includes("說明") || h.includes("摘要"),
    );
    const debitIdx = header.findIndex(
      (h) => h.includes("debit") || h.includes("借") || h.includes("支出"),
    );
    const creditIdx = header.findIndex(
      (h) => h.includes("credit") || h.includes("貸") || h.includes("收入"),
    );
    // 單一有號金額欄（正=收入、負=支出），對應前端預設「日期,說明,金額」格式
    const amountIdx = header.findIndex(
      (h) => h === "amount" || h.includes("金額"),
    );
    const refIdx = header.findIndex(
      (h) => h.includes("ref") || h.includes("參考") || h.includes("備註"),
    );
    if (dateIdx === -1) {
      res.status(400).json({ error: "CSV 必須包含日期欄位 (date/日期)" });
      return;
    }
    const entries: any[] = [];
    const errors: string[] = [];
    for (let i = 1; i < linesArr.length; i++) {
      const cols = parseCsvLine(linesArr[i]);
      if (!cols) {
        errors.push(`第 ${i + 1} 行: 格式錯誤（引號未閉合），已略過`);
        continue;
      }
      const dateVal = cols[dateIdx];
      const parsedDate = dateVal ? new Date(dateVal) : null;
      if (!parsedDate || isNaN(parsedDate.getTime())) {
        errors.push(`第 ${i + 1} 行: 日期格式無效 "${dateVal || ""}"`);
        continue;
      }
      let debitVal = debitIdx >= 0 ? parseAmount(cols[debitIdx]) : 0;
      let creditVal = creditIdx >= 0 ? parseAmount(cols[creditIdx]) : 0;
      if (debitVal === null || creditVal === null) {
        errors.push(`第 ${i + 1} 行: 金額格式無效`);
        continue;
      }
      if (debitVal === 0 && creditVal === 0 && amountIdx >= 0) {
        const signed = parseAmount(cols[amountIdx]);
        if (signed === null) {
          errors.push(`第 ${i + 1} 行: 金額格式無效`);
          continue;
        }
        if (signed >= 0) creditVal = signed;
        else debitVal = -signed;
      }
      if (debitVal === 0 && creditVal === 0) {
        errors.push(`第 ${i + 1} 行: 借貸金額皆為 0，已略過`);
        continue;
      }
      entries.push({
        statementId,
        transactionDate: parsedDate.toISOString().split("T")[0],
        description: descIdx >= 0 ? cols[descIdx] || null : null,
        debit: debitVal,
        credit: creditVal,
        reference: refIdx >= 0 ? cols[refIdx] || null : null,
      });
    }
    if (entries.length === 0) {
      res.status(400).json({ error: "無有效資料可匯入", errors });
      return;
    }
    const rows = await db
      .insert(erpBankReconciliationEntriesTable)
      .values(entries)
      .returning();
    res.status(201).json({ imported: rows.length, skipped: errors.length, errors });
  },
);

router.post(
  "/erp/accounting/bank-statements/:id/auto-match",
  requireErpMenu("/accounting/bank-reconciliation"),
  requireErp(...FINANCE_WRITE),
  async (req, res): Promise<void> => {
    const statementId = Number(req.params.id);
    const entries = await db
      .select()
      .from(erpBankReconciliationEntriesTable)
      .where(
        and(
          eq(erpBankReconciliationEntriesTable.statementId, statementId),
          eq(erpBankReconciliationEntriesTable.matchStatus, "unmatched"),
        ),
      );
    let matched = 0;
    for (const entry of entries) {
      const amount = entry.debit > 0 ? entry.debit : entry.credit;
      if (amount <= 0) continue;
      // 以金額比對傳票（唯一命中才自動比對，避免誤配）
      const candidates = await db
        .select({ id: erpJournalEntriesTable.id })
        .from(erpJournalEntriesTable)
        .where(eq(erpJournalEntriesTable.totalDebit, amount));
      if (candidates.length === 1) {
        await db
          .update(erpBankReconciliationEntriesTable)
          .set({ matchedJournalEntryId: candidates[0].id, matchStatus: "matched" })
          .where(eq(erpBankReconciliationEntriesTable.id, entry.id));
        matched++;
      }
    }
    res.json({ matched, total: entries.length });
  },
);

router.patch(
  "/erp/accounting/bank-reconciliation-entries/:id",
  requireErpMenu("/accounting/bank-reconciliation"),
  requireErp(...FINANCE_WRITE),
  async (req, res): Promise<void> => {
    const id = Number(req.params.id);
    const { status, journalEntryId, matchedVoucherId } = req.body ?? {};
    const nextStatus = ["unmatched", "matched", "ignored"].includes(status)
      ? status
      : journalEntryId || matchedVoucherId
        ? "matched"
        : "unmatched";
    const jeId =
      nextStatus === "matched" && journalEntryId != null
        ? Number(journalEntryId)
        : null;
    if (nextStatus === "matched" && jeId != null) {
      const [je] = await db
        .select({ id: erpJournalEntriesTable.id })
        .from(erpJournalEntriesTable)
        .where(eq(erpJournalEntriesTable.id, jeId));
      if (!je) {
        res.status(400).json({ error: "傳票不存在" });
        return;
      }
    }
    const [row] = await db
      .update(erpBankReconciliationEntriesTable)
      .set({
        matchedJournalEntryId: jeId,
        matchedVoucherId:
          nextStatus === "matched" && matchedVoucherId
            ? Number(matchedVoucherId)
            : null,
        matchStatus: nextStatus,
      })
      .where(eq(erpBankReconciliationEntriesTable.id, id))
      .returning();
    if (!row) {
      res.status(404).json({ error: "對帳明細不存在" });
      return;
    }
    res.json(serializeBankEntry(row));
  },
);

router.patch(
  "/erp/accounting/bank-statements/:id",
  requireErpMenu("/accounting/bank-reconciliation"),
  requireErp(...FINANCE_WRITE),
  async (req, res): Promise<void> => {
    const id = Number(req.params.id);
    const { status } = req.body ?? {};
    if (!["draft", "reconciling", "completed"].includes(status)) {
      res.status(400).json({ error: "狀態不正確" });
      return;
    }
    const [row] = await db
      .update(erpBankStatementsTable)
      .set({ status })
      .where(eq(erpBankStatementsTable.id, id))
      .returning();
    if (!row) {
      res.status(404).json({ error: "對帳單不存在" });
      return;
    }
    res.json(serializeBankStatement(row));
  },
);

/* ============================ 營業稅申報 ============================ */

router.get(
  "/erp/accounting/vat-report",
  requireErpMenu("/accounting/vat-report"),
  async (req, res): Promise<void> => {
    const { startDate, endDate } = req.query as Record<string, string>;
    if (!isDate(startDate) || !isDate(endDate)) {
      res.status(400).json({ error: "請提供起始與結束日期" });
      return;
    }
    const invoices = await db
      .select()
      .from(erpInvoicesTable)
      .where(
        and(
          sql`${erpInvoicesTable.invoiceDate} >= ${startDate}`,
          sql`${erpInvoicesTable.invoiceDate} <= ${endDate}`,
          sql`${erpInvoicesTable.status} <> 'Cancelled'`,
        ),
      );
    let outputNet = 0,
      outputTax = 0,
      zeroRatedSales = 0,
      exemptSales = 0,
      inputNet = 0,
      inputTax = 0,
      unclassifiedCount = 0;
    for (const inv of invoices) {
      if (inv.taxType === "unclassified") {
        unclassifiedCount++;
        continue;
      }
      if (inv.invoiceType === "Sales") {
        if (inv.taxType === "taxable") {
          outputNet += inv.netAmount;
          outputTax += inv.taxAmount;
        } else if (inv.taxType === "zero_rated") zeroRatedSales += inv.totalAmount;
        else if (inv.taxType === "exempt") exemptSales += inv.totalAmount;
      } else if (inv.invoiceType === "Purchase") {
        if (inv.taxType === "taxable") {
          inputNet += inv.netAmount;
          inputTax += inv.taxAmount;
        }
      }
    }
    res.json({
      startDate,
      endDate,
      outputNet,
      outputTax,
      zeroRatedSales,
      exemptSales,
      inputNet,
      inputTax,
      payableTax: outputTax - inputTax,
      unclassifiedCount,
    });
  },
);

export default router;
