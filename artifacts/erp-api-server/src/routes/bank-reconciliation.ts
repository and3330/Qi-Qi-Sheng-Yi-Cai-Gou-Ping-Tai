import { Router, type IRouter } from "express";
import { eq, and, sql, desc } from "drizzle-orm";
import { db, bankStatementsTable, bankReconciliationEntriesTable, vouchersTable, accountsTable, journalEntriesTable } from "@workspace/erp-db";
import { postAutoJournal, round2 } from "../lib/inventory-journal";
import { assertPeriodOpen } from "../lib/auto-journal";
import multer from "multer";
import { UploadRejectedError } from "../middleware/multer-error";
import { requireAuth, requireRole } from "../middleware/require-auth";

/** 銀行明細直接入帳的分錄鍵（寫在分錄編號尾碼，用來回查這筆明細的分錄） */
const journalKey = (entryId: number) => `BR${entryId}E`;
const financeOnly = requireRole("owner", "admin", "finance_admin", "accountant");

/**
 * 銀行明細直接入帳的分錄明細。對帳單的「借方」是支出、「貸方」是存入：
 * 存入 → 借 銀行／貸 對方科目；支出 → 借 對方科目／貸 銀行。
 */
export function bankEntryJournalLines(
  entry: { debit: string | number | null; credit: string | number | null; description?: string | null },
  counter: { id: number; accountNumber: string; accountName: string },
  bank: { id: number; accountNumber: string; accountName: string } | null,
) {
  const withdrawal = round2(Number(entry.debit));
  const deposit = round2(Number(entry.credit));
  if ((withdrawal > 0) === (deposit > 0)) throw new Error("這筆明細的借方、貸方必須恰好一邊有金額");
  const amount = deposit > 0 ? deposit : withdrawal;
  const memo = entry.description || "銀行交易";
  const bankLine = bank
    ? { accountId: bank.id, accountNumber: bank.accountNumber, accountName: bank.accountName }
    : { accountName: "現金/銀行" };
  const counterLine = { accountId: counter.id, accountNumber: counter.accountNumber, accountName: counter.accountName };
  return deposit > 0
    ? [
      { ...bankLine, debit: amount, credit: 0, description: memo },
      { ...counterLine, debit: 0, credit: amount, description: memo },
    ]
    : [
      { ...counterLine, debit: amount, credit: 0, description: memo },
      { ...bankLine, debit: 0, credit: amount, description: memo },
    ];
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ext = (file.originalname.match(/\.[^.]+$/)?.[0] || "").toLowerCase();
    if ([".csv", ".txt"].includes(ext)) cb(null, true);
    else cb(new UploadRejectedError("僅支援 CSV 檔案"));
  },
});
const router: IRouter = Router();
router.use("/bank-reconciliation", requireAuth);
router.use("/bank-statements", requireAuth);

router.get("/bank-statements", async (_req, res): Promise<void> => {
  const rows = await db.select().from(bankStatementsTable).orderBy(desc(bankStatementsTable.statementDate));
  res.json(rows);
});

router.post("/bank-statements", async (req, res): Promise<void> => {
  const { bankName, accountNumber, statementDate, openingBalance, closingBalance } = req.body;
  if (!bankName || !statementDate) { res.status(400).json({ error: "銀行名稱和日期必填" }); return; }
  const [row] = await db.insert(bankStatementsTable).values({
    bankName, accountNumber, statementDate,
    openingBalance: openingBalance || "0",
    closingBalance: closingBalance || "0",
  }).returning();
  res.status(201).json(row);
});

router.get("/bank-statements/:id", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  const [statement] = await db.select().from(bankStatementsTable).where(eq(bankStatementsTable.id, id));
  if (!statement) { res.status(404).json({ error: "Not found" }); return; }
  const entries = await db.select({
    id: bankReconciliationEntriesTable.id,
    statementId: bankReconciliationEntriesTable.statementId,
    transactionDate: bankReconciliationEntriesTable.transactionDate,
    description: bankReconciliationEntriesTable.description,
    debit: bankReconciliationEntriesTable.debit,
    credit: bankReconciliationEntriesTable.credit,
    balance: bankReconciliationEntriesTable.balance,
    reference: bankReconciliationEntriesTable.reference,
    matchedVoucherId: bankReconciliationEntriesTable.matchedVoucherId,
    matchStatus: bankReconciliationEntriesTable.matchStatus,
    createdAt: bankReconciliationEntriesTable.createdAt,
    voucherNumber: sql<string | null>`(SELECT voucher_number FROM vouchers WHERE id = "bank_reconciliation_entries"."matched_voucher_id")`,
    journalEntryNumber: sql<string | null>`(SELECT entry_number FROM journal_entries WHERE entry_number LIKE '%-BR' || "bank_reconciliation_entries"."id" || 'E' LIMIT 1)`,
  }).from(bankReconciliationEntriesTable)
    .where(eq(bankReconciliationEntriesTable.statementId, id))
    .orderBy(bankReconciliationEntriesTable.transactionDate);
  res.json({ ...statement, entries });
});

router.delete("/bank-statements/:id", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  const [posted] = await db.select({ id: bankReconciliationEntriesTable.id }).from(bankReconciliationEntriesTable)
    .where(and(eq(bankReconciliationEntriesTable.statementId, id), eq(bankReconciliationEntriesTable.matchStatus, "Posted"))).limit(1);
  if (posted) { res.status(400).json({ error: "這張對帳單有明細已直接入帳，請先取消入帳再刪除" }); return; }
  await db.delete(bankReconciliationEntriesTable).where(eq(bankReconciliationEntriesTable.statementId, id));
  const [row] = await db.delete(bankStatementsTable).where(eq(bankStatementsTable.id, id)).returning();
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  res.sendStatus(204);
});

router.post("/bank-statements/:id/entries", async (req, res): Promise<void> => {
  const statementId = Number(req.params.id);
  const entries: any[] = req.body.entries;
  if (!Array.isArray(entries) || entries.length === 0) { res.status(400).json({ error: "entries 必須為非空陣列" }); return; }

  const rows = await db.insert(bankReconciliationEntriesTable)
    .values(entries.map(e => ({
      statementId,
      transactionDate: e.transactionDate,
      description: e.description,
      debit: e.debit || "0",
      credit: e.credit || "0",
      balance: e.balance || "0",
      reference: e.reference,
    })))
    .returning();

  res.status(201).json(rows);
});

router.post("/bank-statements/:id/upload-csv", upload.single("file"), async (req: any, res): Promise<void> => {
  const statementId = Number(req.params.id);
  const [stmt] = await db.select().from(bankStatementsTable).where(eq(bankStatementsTable.id, statementId));
  if (!stmt) { res.status(404).json({ error: "對帳單不存在" }); return; }

  if (!req.file) { res.status(400).json({ error: "請上傳 CSV 檔案" }); return; }

  // 支援引號欄位與千分位逗號的 CSV 解析
  const parseCsvLine = (line: string): string[] | null => {
    const cols: string[] = [];
    let cur = "", inQ = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (inQ) {
        if (ch === '"') {
          if (line[i + 1] === '"') { cur += '"'; i++; } else inQ = false;
        } else cur += ch;
      } else if (ch === '"') inQ = true;
      else if (ch === ",") { cols.push(cur.trim()); cur = ""; }
      else cur += ch;
    }
    if (inQ) return null; // 引號未閉合（含跨行引號欄位）→ 回報錯誤而非吞掉
    cols.push(cur.trim());
    return cols;
  };
  const parseAmount = (raw: string | undefined): number | null => {
    if (!raw) return 0;
    const cleaned = raw.replace(/[,，$ ]/g, "");
    if (cleaned === "" || cleaned === "-") return 0;
    const n = Number(cleaned);
    return Number.isFinite(n) ? n : null; // null = 格式錯誤，回報而非默默視為 0
  };

  const csvText = req.file.buffer.toString("utf-8").replace(/^\uFEFF/, "");
  const lines = csvText.split(/\r?\n/).filter((l: string) => l.trim());

  if (lines.length < 2) { res.status(400).json({ error: "CSV 檔案需至少包含標題列和一筆資料" }); return; }

  const headerCols = parseCsvLine(lines[0]);
  if (!headerCols) { res.status(400).json({ error: "CSV 標題列格式錯誤（引號未閉合）" }); return; }
  const header = headerCols.map((h: string) => h.toLowerCase());
  const dateIdx = header.findIndex((h: string) => h.includes("date") || h.includes("日期"));
  const descIdx = header.findIndex((h: string) => h.includes("desc") || h.includes("說明") || h.includes("摘要"));
  const debitIdx = header.findIndex((h: string) => h.includes("debit") || h.includes("借") || h.includes("支出"));
  const creditIdx = header.findIndex((h: string) => h.includes("credit") || h.includes("貸") || h.includes("收入"));
  const refIdx = header.findIndex((h: string) => h.includes("ref") || h.includes("參考") || h.includes("備註"));

  if (dateIdx === -1) { res.status(400).json({ error: "CSV 必須包含日期欄位 (date/日期)" }); return; }

  const entries: any[] = [];
  const errors: string[] = [];

  for (let i = 1; i < lines.length; i++) {
    const cols = parseCsvLine(lines[i]);
    if (!cols) { errors.push(`第 ${i + 1} 行: 格式錯誤（引號未閉合），已略過`); continue; }
    const dateVal = cols[dateIdx];
    if (!dateVal) { errors.push(`第 ${i + 1} 行: 日期為空`); continue; }

    const parsed = new Date(dateVal);
    if (isNaN(parsed.getTime())) { errors.push(`第 ${i + 1} 行: 日期格式無效 "${dateVal}"`); continue; }

    const debitVal = debitIdx >= 0 ? parseAmount(cols[debitIdx]) : 0;
    const creditVal = creditIdx >= 0 ? parseAmount(cols[creditIdx]) : 0;
    if (debitVal === null || creditVal === null) {
      errors.push(`第 ${i + 1} 行: 金額格式無效 (借:"${cols[debitIdx] || ""}" 貸:"${cols[creditIdx] || ""}")`); continue;
    }
    if (debitVal === 0 && creditVal === 0) { errors.push(`第 ${i + 1} 行: 借貸金額皆為 0，已略過`); continue; }

    entries.push({
      statementId,
      transactionDate: parsed.toISOString().split("T")[0],
      description: descIdx >= 0 ? cols[descIdx] || null : null,
      debit: String(debitVal),
      credit: String(creditVal),
      balance: "0",
      reference: refIdx >= 0 ? cols[refIdx] || null : null,
    });
  }

  if (entries.length === 0) { res.status(400).json({ error: "無有效資料可匯入", errors }); return; }

  const rows = await db.insert(bankReconciliationEntriesTable).values(entries).returning();
  res.status(201).json({ imported: rows.length, errors });
});

router.post("/bank-reconciliation/auto-match/:statementId", async (req, res): Promise<void> => {
  const statementId = Number(req.params.statementId);
  const entries = await db.select().from(bankReconciliationEntriesTable)
    .where(and(
      eq(bankReconciliationEntriesTable.statementId, statementId),
      eq(bankReconciliationEntriesTable.matchStatus, "Unmatched"),
    ));

  let matched = 0;
  for (const entry of entries) {
    const amount = Number(entry.debit) > 0 ? entry.debit : entry.credit;
    if (!(Number(amount) > 0)) continue;
    const vouchers = await db.select().from(vouchersTable)
      .where(and(
        sql`${vouchersTable.totalAmount} = ${String(amount)}::numeric`,
        sql`NOT EXISTS (SELECT 1 FROM bank_reconciliation_entries b WHERE b.matched_voucher_id = ${vouchersTable.id})`,
        // 舊系統搬來的歷史收款單是好幾年前的錢，不能拿來配現在的銀行明細
        sql`NOT (${vouchersTable.items} @> '[{"legacy": true}]'::jsonb)`,
      ));

    if (vouchers.length === 1) {
      await db.update(bankReconciliationEntriesTable)
        .set({ matchedVoucherId: vouchers[0].id, matchStatus: "Matched" })
        .where(eq(bankReconciliationEntriesTable.id, entry.id));
      matched++;
    }
  }

  res.json({ matched, total: entries.length });
});

router.patch("/bank-reconciliation/entries/:id/match", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  const { matchedVoucherId } = req.body;

  const [current] = await db.select().from(bankReconciliationEntriesTable).where(eq(bankReconciliationEntriesTable.id, id));
  if (!current) { res.status(404).json({ error: "Not found" }); return; }
  if (current.matchStatus === "Posted") { res.status(400).json({ error: "這筆明細已直接入帳，請先取消入帳再配對傳票" }); return; }
  if (matchedVoucherId) {
    const [voucher] = await db.select({ id: vouchersTable.id }).from(vouchersTable).where(eq(vouchersTable.id, Number(matchedVoucherId)));
    if (!voucher) { res.status(400).json({ error: "傳票不存在" }); return; }
  }

  const [row] = await db.update(bankReconciliationEntriesTable)
    .set({
      matchedVoucherId: matchedVoucherId || null,
      matchStatus: matchedVoucherId ? "Matched" : "Unmatched",
    })
    .where(eq(bankReconciliationEntriesTable.id, id))
    .returning();

  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  res.json(row);
});

/**
 * 沒有對應傳票的銀行明細（手續費、利息、零星收支）直接入帳：
 * 選一個對方科目就產生已過帳分錄，明細狀態改為 Posted。
 */
router.post("/bank-reconciliation/entries/:id/journal", financeOnly, async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  const accountId = Number(req.body?.accountId);
  const bankAccountId = req.body?.bankAccountId ? Number(req.body.bankAccountId) : null;
  if (!Number.isInteger(id) || !Number.isInteger(accountId) || accountId <= 0) { res.status(400).json({ error: "請選擇對方科目" }); return; }

  try {
    const result = await db.transaction(async (tx) => {
      const [entry] = await tx.select().from(bankReconciliationEntriesTable).where(eq(bankReconciliationEntriesTable.id, id)).for("update");
      if (!entry) throw new Error("找不到這筆銀行明細");
      if (entry.matchStatus !== "Unmatched") throw new Error(entry.matchStatus === "Posted" ? "這筆明細已經入帳" : "這筆明細已配對傳票，請先取消配對");

      const loadLeaf = async (accId: number, label: string) => {
        const [acc] = await tx.select({ id: accountsTable.id, accountNumber: accountsTable.accountNumber, accountName: accountsTable.accountName, isGroup: accountsTable.isGroup })
          .from(accountsTable).where(eq(accountsTable.id, accId));
        if (!acc) throw new Error(`${label}不存在`);
        if (acc.isGroup) throw new Error(`${label}「${acc.accountName}」是彙總科目，請選明細科目`);
        return acc;
      };
      const counter = await loadLeaf(accountId, "對方科目");
      // 手續費、利息這類收入或費用要歸到專案（或至少部門），專案損益才看得到；純資產負債之間的轉帳不用
      const [counterType] = await tx.select({ accountType: accountsTable.accountType }).from(accountsTable).where(eq(accountsTable.id, counter.id));
      const projectId = Number(req.body?.projectId) > 0 ? Number(req.body.projectId) : null;
      const departmentId = Number(req.body?.departmentId) > 0 ? Number(req.body.departmentId) : null;
      if ((counterType?.accountType === "Income" || counterType?.accountType === "Expense") && !projectId && !departmentId) {
        throw new Error("請選擇專案：收入與費用都要歸屬到專案");
      }
      const bank = bankAccountId ? await loadLeaf(bankAccountId, "銀行科目") : null;
      if (bank && bank.id === counter.id) throw new Error("對方科目不能和銀行科目相同");

      const [stmt] = await tx.select({ bankName: bankStatementsTable.bankName }).from(bankStatementsTable).where(eq(bankStatementsTable.id, entry.statementId));
      const je = await postAutoJournal(tx, {
        key: journalKey(id),
        entryDate: entry.transactionDate,
        description: `自動分錄 - 銀行對帳 ${stmt?.bankName || ""} ${req.body?.description || entry.description || ""}`.trim(),
        action: "銀行明細入帳",
        projectId, departmentId,
        lines: bankEntryJournalLines(entry, counter, bank),
      });
      if (!je) throw new Error("金額為 0，無法入帳");
      const [row] = await tx.update(bankReconciliationEntriesTable).set({ matchStatus: "Posted", matchedVoucherId: null })
        .where(eq(bankReconciliationEntriesTable.id, id)).returning();
      return { ...row, journalEntryNumber: je.entryNumber };
    });
    res.status(201).json(result);
  } catch (err: any) {
    res.status(400).json({ error: err.message || "入帳失敗" });
  }
});

/** 取消直接入帳：刪除該明細的分錄，狀態回到未配對 */
router.delete("/bank-reconciliation/entries/:id/journal", financeOnly, async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) { res.status(400).json({ error: "Invalid ID" }); return; }
  try {
    const row = await db.transaction(async (tx) => {
      const [entry] = await tx.select().from(bankReconciliationEntriesTable).where(eq(bankReconciliationEntriesTable.id, id)).for("update");
      if (!entry) throw new Error("找不到這筆銀行明細");
      if (entry.matchStatus !== "Posted") throw new Error("這筆明細沒有直接入帳");
      await assertPeriodOpen(tx, entry.transactionDate, "取消銀行明細入帳");
      await tx.delete(journalEntriesTable).where(sql`${journalEntriesTable.entryNumber} LIKE ${"%-" + journalKey(id)}`);
      const [updated] = await tx.update(bankReconciliationEntriesTable).set({ matchStatus: "Unmatched" })
        .where(eq(bankReconciliationEntriesTable.id, id)).returning();
      return updated;
    });
    res.json(row);
  } catch (err: any) {
    res.status(400).json({ error: err.message || "取消入帳失敗" });
  }
});

router.patch("/bank-statements/:id/status", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  const { status } = req.body;
  const [row] = await db.update(bankStatementsTable).set({ status }).where(eq(bankStatementsTable.id, id)).returning();
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  res.json(row);
});

export default router;
