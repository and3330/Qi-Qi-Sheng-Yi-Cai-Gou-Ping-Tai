import { Router, type IRouter } from "express";
import { nextDocNumber } from "../lib/doc-number";
import { eq, desc, sql, and, gte, lte } from "drizzle-orm";
import { db, journalEntriesTable, accountsTable, activitiesTable, projectsTable, departmentsTable } from "@workspace/erp-db";
import { journalKindSql, splitDescription, JOURNAL_KINDS, JOURNAL_KIND_LABELS, type JournalKind } from "../lib/journal-kind";
import { autoEntryText, autoOrPlain } from "../lib/auto-entry-text";
import { CreateJournalEntryBody } from "@workspace/erp-api-zod";
import { friendlyValidationError } from "../lib/friendly-errors";
import { requireAuth, requireRole } from "../middleware/require-auth";
import { assertPeriodOpen } from "../lib/auto-journal";
import { isMissingProject, PROJECT_REQUIRED_MESSAGE } from "../middleware/project-required";
import { todayTaipei } from "../lib/inventory-journal";
import { vouchersTable } from "@workspace/erp-db";
import { isRealDate, openingEntryLines } from "../lib/cash-accounts";
import { accountingSettingsTable } from "@workspace/erp-db";
import { ne } from "drizzle-orm";
import { auditLogsTable } from "@workspace/erp-db";
import { journalHistoryRows, pickAutoActor, reversalOriginalId } from "../lib/journal-history";
import { registerChangeHandler, registerPayloadCheck, submitChangeRequest } from "../lib/change-requests";

const OPENING_PREFIX = "JE-OPEN-";

const round2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;

const router: IRouter = Router();
// Matches UI FINANCE_ROLES; requireRole preserves super_admin/admin-key semantics.
router.use("/journal-entries", requireAuth, requireRole("owner", "admin", "finance_admin", "accountant"));

function generateEntryNumber(): string {
  return "JE-" + String(Date.now()).slice(-8);
}

async function getTenantAccounts() {
  // db is the request's tenant-scoped proxy. Never retain account data across requests.
  const accounts = await db.select({
    id: accountsTable.id, accountName: accountsTable.accountName, isGroup: accountsTable.isGroup,
    accountType: accountsTable.accountType,
  }).from(accountsTable);
  return new Map(accounts.map(account => [account.id, account]));
}

router.get("/journal-entries", async (req, res): Promise<void> => {
  const page = Math.max(1, parseInt(req.query.page as string) || 1);
  const limit = Math.min(200, Math.max(1, parseInt(req.query.limit as string) || 50));
  const offset = (page - 1) * limit;
  const startDate = req.query.startDate as string | undefined;
  const endDate = req.query.endDate as string | undefined;
  const search = req.query.search as string | undefined;

  const conditions = [];
  if (startDate) conditions.push(gte(journalEntriesTable.entryDate, startDate));
  if (endDate) conditions.push(lte(journalEntriesTable.entryDate, endDate));
  // 搜尋分錄編號、說明、科目名稱（原本只在目前這一頁的資料裡找，翻頁就找不到）
  if (search && search.trim()) {
    const term = "%" + search.trim().replace(/[\\%_]/g, m => "\\" + m) + "%";
    conditions.push(sql`(${journalEntriesTable.entryNumber} ILIKE ${term} OR ${journalEntriesTable.description} ILIKE ${term} OR ${journalEntriesTable.lines}::text ILIKE ${term})`);
  }
  const status = req.query.status as string | undefined;
  if (status && ["Posted", "Reversed", "Draft"].includes(status)) conditions.push(eq(journalEntriesTable.status, status));

  // 部門、專案篩選（部門也算專案所屬部門的分錄，跟部門損益同一套）
  const departmentId = Number(req.query.departmentId);
  if (Number.isInteger(departmentId) && departmentId > 0) {
    conditions.push(sql`(${journalEntriesTable.departmentId} = ${departmentId} OR ${journalEntriesTable.projectId} IN (SELECT id FROM projects WHERE department_id = ${departmentId}))`);
  }
  const projectId = Number(req.query.projectId);
  if (Number.isInteger(projectId) && projectId > 0) conditions.push(eq(journalEntriesTable.projectId, projectId));

  // 各交易類型的筆數（分頁籤上的數字），不受類型篩選影響
  const baseWhere = conditions.length > 0 ? and(...conditions) : undefined;
  const kindCounts = await db
    .select({ kind: journalKindSql, count: sql<number>`count(*)` })
    .from(journalEntriesTable)
    .where(baseWhere)
    .groupBy(sql`1`);
  const counts: Record<string, number> = Object.fromEntries(JOURNAL_KINDS.map(k => [k, 0]));
  for (const row of kindCounts) counts[row.kind] = Number(row.count);

  const kind = req.query.kind as string | undefined;
  if (kind && (JOURNAL_KINDS as readonly string[]).includes(kind)) conditions.push(sql`${journalKindSql} = ${kind}`);
  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const [countResult] = await db
    .select({ count: sql<number>`count(*)` })
    .from(journalEntriesTable)
    .where(whereClause);

  const rows = await db
    .select({
      entry: journalEntriesTable, kind: journalKindSql,
      projectName: projectsTable.name, departmentName: sql<string | null>`COALESCE(${departmentsTable.name}, pd.name)`,
    })
    .from(journalEntriesTable)
    .leftJoin(projectsTable, eq(projectsTable.id, journalEntriesTable.projectId))
    .leftJoin(departmentsTable, eq(departmentsTable.id, journalEntriesTable.departmentId))
    .leftJoin(sql`departments pd`, sql`pd.id = ${projectsTable.departmentId}`)
    .where(whereClause)
    .orderBy(desc(journalEntriesTable.entryDate), desc(journalEntriesTable.createdAt))
    .limit(limit)
    .offset(offset);
  const entries = rows.map(r => ({ ...r.entry, kind: r.kind as JournalKind, kindLabel: JOURNAL_KIND_LABELS[r.kind as JournalKind] ?? "一般", projectName: r.projectName, departmentName: r.departmentName, ...splitDescription(r.entry.description) }));

  const accounts = await getTenantAccounts();

  const result = entries.map(entry => {
    const lines = (entry.lines as any[]).map(line => ({
      ...line,
      accountName: accounts.get(line.accountId)?.accountName || line.accountName || "Unknown",
    }));
    // 不是 Ecount 搬來的分錄：客戶／廠商取分錄行裡第一個有填的對象
    const lineParty = lines.map(l => typeof l.description === "string" && l.description.includes("｜") ? l.description.split("｜")[0].trim() : "").find(Boolean) || null;
    return {
      ...entry,
      party: entry.party ?? lineParty,
      totalDebit: Number(entry.totalDebit),
      totalCredit: Number(entry.totalCredit),
      lines,
    };
  });

  res.json({
    data: result,
    total: Number(countResult.count),
    kindCounts: counts,
    page,
    limit,
    totalPages: Math.ceil(Number(countResult.count) / limit),
  });
});

router.post("/journal-entries", async (req, res): Promise<void> => {
  const parsed = CreateJournalEntryBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: friendlyValidationError(parsed.error) }); return; }

  const isInternalTransfer = req.body.isInternalTransfer === true;
  const transferFromDepartmentId = req.body.transferFromDepartmentId == null ? null : Number(req.body.transferFromDepartmentId);
  const transferToDepartmentId = req.body.transferToDepartmentId == null ? null : Number(req.body.transferToDepartmentId);
  if (isInternalTransfer && (
    !Number.isInteger(transferFromDepartmentId) || !Number.isInteger(transferToDepartmentId)
    || transferFromDepartmentId! <= 0 || transferToDepartmentId! <= 0
  )) {
    res.status(400).json({ error: "內部轉撥必須選擇轉出部門與轉入部門" }); return;
  }
  if (isInternalTransfer && transferFromDepartmentId === transferToDepartmentId) {
    res.status(400).json({ error: "轉出部門與轉入部門不可相同" }); return;
  }

  if (!isRealDate(parsed.data.entryDate)) { res.status(400).json({ error: "請填寫正確的分錄日期" }); return; }
  if (!parsed.data.lines || parsed.data.lines.length < 2) {
    res.status(400).json({ error: "日記帳分錄至少需要兩行（借方與貸方）" }); return;
  }

  let totalDebit = 0;
  let totalCredit = 0;
  const lines: Array<{ accountId: number; accountName: string; debit: number; credit: number; description?: string }> = [];
  const accounts = await getTenantAccounts();
  let touchesIncomeOrExpense = false;

  for (const line of parsed.data.lines) {
    const account = accounts.get(line.accountId);
    // The account schema has no active flag; selectable posting accounts are non-group leaves.
    if (!Number.isInteger(line.accountId) || line.accountId <= 0 || !account || account.isGroup) {
      res.status(400).json({ error: "會計科目不存在或不可過帳，請選擇本公司的明細科目" }); return;
    }
    if (line.debit < 0 || line.credit < 0) {
      res.status(400).json({ error: "借方與貸方金額不可為負數" }); return;
    }
    if (line.debit === 0 && line.credit === 0) {
      res.status(400).json({ error: "每行至少需要有借方或貸方金額" }); return;
    }
    if (line.debit > 0 && line.credit > 0) {
      res.status(400).json({ error: "同一行不能同時有借方與貸方金額，請拆成兩行" }); return;
    }
    if (account.accountType === "Income" || account.accountType === "Expense") touchesIncomeOrExpense = true;
    // 金額一律到小數兩位，避免浮點數讓合計差一分錢
    const debit = round2(line.debit), credit = round2(line.credit);
    totalDebit = round2(totalDebit + debit);
    totalCredit = round2(totalCredit + credit);
    const raw = Array.isArray(req.body?.lines) ? req.body.lines[lines.length] : undefined;
    // 每行可以填客戶／廠商和摘要，存成「對象｜摘要」，跟 Ecount 搬來的分錄同一個格式，總分類帳才拆得出客戶名
    const party = typeof raw?.party === "string" ? raw.party.trim().slice(0, 80) : "";
    const summary = typeof raw?.description === "string" ? raw.description.trim() : "";
    const text = party ? `${party}｜${summary}` : summary;
    lines.push({
      accountId: line.accountId, accountName: account.accountName, debit, credit,
      ...(text ? { description: text.slice(0, 200) } : {}),
    });
  }

  // 純資產負債之間的調整（例如銀行互轉）不需要專案；有收入或費用就一定要
  if (touchesIncomeOrExpense && isMissingProject(parsed.data.projectId)) {
    res.status(400).json({ error: PROJECT_REQUIRED_MESSAGE }); return;
  }

  if (Math.abs(totalDebit - totalCredit) > 0.01) {
    res.status(400).json({ error: `借貸不平衡：借方合計 $${totalDebit.toFixed(2)} ≠ 貸方合計 $${totalCredit.toFixed(2)}` }); return;
  }

  try {
    await assertPeriodOpen(db, parsed.data.entryDate, "新增日記帳分錄");
  } catch (err: any) {
    res.status(400).json({ error: err.message }); return;
  }

  const [entry] = await db.insert(journalEntriesTable).values({
    entryNumber: await nextDocNumber(db, "journal_entries", "entry_number", "JE", generateEntryNumber, parsed.data.entryDate),
    entryDate: parsed.data.entryDate,
    description: parsed.data.description,
    totalDebit: String(totalDebit),
    totalCredit: String(totalCredit),
    status: "Posted",
    lines,
    projectId: parsed.data.projectId,
    departmentId: parsed.data.departmentId,
    isInternalTransfer,
    transferFromDepartmentId: isInternalTransfer ? transferFromDepartmentId : null,
    transferToDepartmentId: isInternalTransfer ? transferToDepartmentId : null,
  }).returning();

  await db.insert(activitiesTable).values({
    type: "create", title: "日記帳分錄",
    description: `${entry.entryNumber} - 借方: $${totalDebit.toFixed(2)}`,
    module: "Accounting",
  });

  res.status(201).json({ ...entry, totalDebit, totalCredit, lines });
});

/**
 * 一張單打多筆（照 Ecount 收款單／付款單）：表頭選日期和收付的銀行／現金科目，
 * 每一行各自有科目、客戶或廠商、金額、手續費、摘要、部門、專案。
 * 每一行存成一張自己的分錄，這樣部門、專案損益照舊算得對；整張單要嘛全部成功、要嘛全部不存。
 */
export interface BatchLineInput { accountId: number; party?: string; amount: number; fee?: number; summary?: string; departmentId?: number | null; projectId?: number | null }

export function buildBatchEntryLines(
  mode: "receipt" | "payment",
  cash: { id: number; name: string },
  feeAccount: { id: number; name: string } | null,
  account: { id: number; name: string },
  line: { party: string; amount: number; fee: number; summary: string },
) {
  const text = line.party ? `${line.party}｜${line.summary}` : line.summary;
  const L = (a: { id: number; name: string }, debit: number, credit: number) =>
    ({ accountId: a.id, accountName: a.name, debit: round2(debit), credit: round2(credit), ...(text ? { description: text.slice(0, 200) } : {}) });
  const out = [];
  if (mode === "receipt") {
    // 收款：借 銀行（實收＝金額－手續費）＋ 借 手續費／貸 對方科目（金額）
    out.push(L(cash, line.amount - line.fee, 0));
    if (line.fee > 0 && feeAccount) out.push(L(feeAccount, line.fee, 0));
    out.push(L(account, 0, line.amount));
  } else {
    // 付款：借 對方科目（金額）＋ 借 手續費／貸 銀行（金額＋手續費）
    out.push(L(account, line.amount, 0));
    if (line.fee > 0 && feeAccount) out.push(L(feeAccount, line.fee, 0));
    out.push(L(cash, 0, line.amount + line.fee));
  }
  return out;
}

router.post("/journal-entries/batch", async (req, res): Promise<void> => {
  const b = req.body ?? {};
  const mode = b.mode === "payment" ? "payment" : b.mode === "receipt" ? "receipt" : null;
  if (!mode) { res.status(400).json({ error: "請選擇收款或付款" }); return; }
  if (typeof b.entryDate !== "string" || !isRealDate(b.entryDate)) { res.status(400).json({ error: "請填寫正確的日期" }); return; }
  const rawLines: any[] = Array.isArray(b.lines) ? b.lines : [];
  if (rawLines.length === 0) { res.status(400).json({ error: "至少要有一行" }); return; }
  if (rawLines.length > 200) { res.status(400).json({ error: "一張單最多 200 行" }); return; }

  const accounts = await getTenantAccounts();
  const leaf = (id: unknown, what: string) => {
    const a = accounts.get(Number(id));
    if (!a || a.isGroup) throw new Error(`${what}不存在或不可過帳，請選擇明細科目`);
    return { id: Number(id), name: a.accountName, type: a.accountType };
  };
  const memo = typeof b.memo === "string" ? b.memo.trim().slice(0, 200) : "";
  const prepared: Array<{ lines: any[]; total: number; description: string; projectId: number | null; departmentId: number | null }> = [];
  try {
    const cash = leaf(b.cashAccountId, mode === "receipt" ? "收款帳戶" : "付款帳戶");
    const needsFee = rawLines.some(l => Number(l?.fee) > 0);
    const feeAccount = needsFee ? leaf(b.feeAccountId, "手續費科目") : null;
    rawLines.forEach((l, i) => {
      const n = i + 1;
      const account = leaf(l?.accountId, `第 ${n} 行的科目`);
      const amount = round2(Number(l?.amount));
      const fee = round2(Number(l?.fee) || 0);
      if (!(amount > 0)) throw new Error(`第 ${n} 行金額要大於 0`);
      if (fee < 0) throw new Error(`第 ${n} 行手續費不可為負數`);
      if (mode === "receipt" && fee >= amount) throw new Error(`第 ${n} 行手續費不能大於等於金額`);
      if (account.id === cash.id) throw new Error(`第 ${n} 行的科目不能跟${mode === "receipt" ? "收款" : "付款"}帳戶相同`);
      const projectId = Number(l?.projectId) > 0 ? Number(l.projectId) : null;
      const departmentId = Number(l?.departmentId) > 0 ? Number(l.departmentId) : null;
      const touchesPnl = ["Income", "Expense"].includes(account.type) || (fee > 0 && feeAccount!.type === "Expense");
      if (touchesPnl && isMissingProject(projectId ?? undefined)) throw new Error(`第 ${n} 行：${PROJECT_REQUIRED_MESSAGE}`);
      const party = typeof l?.party === "string" ? l.party.trim().slice(0, 80) : "";
      const summary = (typeof l?.summary === "string" ? l.summary.trim() : "") || memo;
      const lines = buildBatchEntryLines(mode, cash, feeAccount, account, { party, amount, fee, summary });
      const total = round2(lines.reduce((s, x) => s + x.debit, 0));
      prepared.push({ lines, total, projectId, departmentId, description: summary || (mode === "receipt" ? `收款${party ? ` ${party}` : ""}` : `付款${party ? ` ${party}` : ""}`) });
    });
    await assertPeriodOpen(db, b.entryDate, mode === "receipt" ? "新增收款單" : "新增付款單");
  } catch (err: any) {
    res.status(400).json({ error: err.message }); return;
  }

  const created = await db.transaction(async tx => {
    const out = [];
    for (const p of prepared) {
      const [entry] = await tx.insert(journalEntriesTable).values({
        entryNumber: await nextDocNumber(tx, "journal_entries", "entry_number", "JE", generateEntryNumber, b.entryDate),
        entryDate: b.entryDate, description: p.description,
        totalDebit: String(p.total), totalCredit: String(p.total), status: "Posted",
        lines: p.lines, projectId: p.projectId, departmentId: p.departmentId,
      }).returning();
      out.push(entry);
    }
    await tx.insert(activitiesTable).values({
      type: "create", title: mode === "receipt" ? "收款單" : "付款單",
      description: `${out.length} 筆分錄（${out[0].entryNumber}${out.length > 1 ? ` ~ ${out[out.length - 1].entryNumber}` : ""}）`,
      module: "Accounting",
    });
    return out;
  });
  res.status(201).json({ count: created.length, entries: created.map(e => ({ id: e.id, entryNumber: e.entryNumber })) });
});

/** 目前有效的開帳分錄（已沖銷的不算） */
async function activeOpeningEntry(executor: any) {
  const [entry] = await executor.select().from(journalEntriesTable)
    .where(and(sql`${journalEntriesTable.entryNumber} LIKE ${OPENING_PREFIX + "%"}`, eq(journalEntriesTable.status, "Posted")));
  return entry || null;
}

// 開帳狀態：有沒有開過帳、開帳分錄的內容
router.get("/journal-entries/opening", async (_req, res): Promise<void> => {
  const entry = await activeOpeningEntry(db);
  res.json({ entry: entry ? { ...entry, totalDebit: Number(entry.totalDebit), totalCredit: Number(entry.totalCredit) } : null });
});

/**
 * 開帳：把舊系統（或開始使用前）各科目的餘額一次輸入，產生一張開帳分錄。
 * 資產填正數代表借方餘額，負債與權益填正數代表貸方餘額；借貸的差額記到「累積盈虧」。
 * 只能有一張有效的開帳分錄，要重做請先沖銷原本那張。
 */
router.post("/journal-entries/opening", async (req, res): Promise<void> => {
  const date = req.body?.date;
  if (!isRealDate(date)) { res.status(400).json({ error: "請填寫開帳日期" }); return; }
  const input: any[] = Array.isArray(req.body?.balances) ? req.body.balances : [];
  if (input.length === 0) { res.status(400).json({ error: "請至少輸入一個科目的餘額" }); return; }
  const accounts = await getTenantAccounts();
  const rows: Array<{ accountId: number; accountName: string; accountType: string; amount: number }> = [];
  const seen = new Set<number>();
  for (const item of input) {
    const accountId = Number(item?.accountId);
    const amount = Number(item?.amount);
    const account = accounts.get(accountId);
    if (!account || account.isGroup) { res.status(400).json({ error: "開帳的科目不存在或是彙總科目" }); return; }
    if (!["Asset", "Liability", "Equity"].includes(account.accountType)) {
      res.status(400).json({ error: `「${account.accountName}」是收入或費用科目，不能有期初餘額` }); return;
    }
    if (!Number.isFinite(amount)) { res.status(400).json({ error: `「${account.accountName}」的金額格式不正確` }); return; }
    if (seen.has(accountId)) { res.status(400).json({ error: `「${account.accountName}」重複輸入` }); return; }
    seen.add(accountId);
    rows.push({ accountId, accountName: account.accountName, accountType: account.accountType, amount });
  }
  const built = openingEntryLines(rows);
  if (built.lines.length === 0) { res.status(400).json({ error: "請至少輸入一個不是 0 的餘額" }); return; }
  const lines = [...built.lines];
  if (built.difference !== 0) {
    // 借貸差額就是累積到開帳日的盈虧
    const retained = [...accounts.values()].find(a => !a.isGroup && a.accountType === "Equity" && ["累積盈虧", "累積盈餘", "保留盈餘", "未分配盈餘"].includes(a.accountName));
    if (!retained) { res.status(400).json({ error: `借貸差 ${built.difference}，科目表找不到「累積盈虧」可以放差額，請補上權益科目的餘額讓借貸相等` }); return; }
    if (req.body?.balanceToRetainedEarnings !== true) {
      res.status(400).json({ error: `借方合計 ${built.totalDebit} 與貸方合計 ${built.totalCredit} 不相等，差額 ${built.difference}`, difference: built.difference, needsConfirm: true }); return;
    }
    const existing = lines.find(l => l.accountId === retained.id);
    const diff = built.difference;
    const extra = { accountId: retained.id, accountName: retained.accountName, debit: diff < 0 ? -diff : 0, credit: diff > 0 ? diff : 0 };
    if (existing) {
      const net = round2(existing.debit - existing.credit + extra.debit - extra.credit);
      existing.debit = net > 0 ? net : 0; existing.credit = net < 0 ? -net : 0;
    } else lines.push(extra);
  }
  const total = round2(lines.reduce((s, l) => s + l.debit, 0));
  try {
    const entry = await db.transaction(async (tx) => {
      if (await activeOpeningEntry(tx)) throw new Error("已經開過帳了。要重新輸入，請先到日記帳把原本的開帳分錄沖銷");
      await assertPeriodOpen(tx, date, "輸入期初餘額");
      const [created] = await tx.insert(journalEntriesTable).values({
        entryNumber: OPENING_PREFIX + date.replace(/-/g, "") + "-" + String(Date.now()).slice(-4),
        entryDate: date, description: "開帳分錄（期初餘額）",
        totalDebit: String(total), totalCredit: String(total), status: "Posted", lines: lines.filter(l => l.debit !== 0 || l.credit !== 0),
      }).returning();
      await tx.insert(activitiesTable).values({ type: "create", title: "開帳", description: `${created.entryNumber} 期初餘額合計 ${total}`, module: "Accounting" });
      return created;
    });
    res.status(201).json({ ...entry, totalDebit: total, totalCredit: total });
  } catch (err: any) {
    res.status(400).json({ error: err?.message || "開帳失敗" });
  }
});

/**
 * 年度結帳。
 * 這套系統的報表是直接從分錄算出來的：資產負債表會自動把歷年損益併入權益，
 * 所以不需要（也不應該）另外做「結轉分錄」把收入費用歸零，否則該年度的損益表會變成 0。
 * 年度結帳做兩件事：告訴你這一年的收入、費用、損益，然後把關帳日設到年底，鎖住這一年的帳。
 */
router.get("/journal-entries/year-close", async (req, res): Promise<void> => {
  const year = Number(req.query.year);
  if (!Number.isInteger(year) || year < 2000 || year > 2100) { res.status(400).json({ error: "年度格式不正確" }); return; }
  res.json(await yearSummary(year));
});

async function yearSummary(year: number) {
  const from = `${year}-01-01`, to = `${year}-12-31`;
  const [accounts, entries, settings] = await Promise.all([
    getTenantAccounts(),
    db.select({ lines: journalEntriesTable.lines, totalDebit: journalEntriesTable.totalDebit, totalCredit: journalEntriesTable.totalCredit })
      .from(journalEntriesTable).where(and(ne(journalEntriesTable.status, "Draft"), gte(journalEntriesTable.entryDate, from), lte(journalEntriesTable.entryDate, to))),
    db.select().from(accountingSettingsTable).limit(1),
  ]);
  let income = 0, expense = 0, unbalanced = 0;
  for (const entry of entries) {
    if (Math.abs(Number(entry.totalDebit) - Number(entry.totalCredit)) > 0.01) unbalanced++;
    for (const line of (Array.isArray(entry.lines) ? (entry.lines as any[]) : [])) {
      const type = accounts.get(Number(line?.accountId))?.accountType;
      if (type === "Income") income += (Number(line.credit) || 0) - (Number(line.debit) || 0);
      if (type === "Expense") expense += (Number(line.debit) || 0) - (Number(line.credit) || 0);
    }
  }
  const lockDate = settings[0]?.lockDate || null;
  return {
    year, entryCount: entries.length, unbalancedCount: unbalanced,
    totalIncome: round2(income), totalExpense: round2(expense), netProfit: round2(income - expense),
    lockDate, closed: Boolean(lockDate && lockDate >= to),
  };
}

router.post("/journal-entries/year-close", async (req, res): Promise<void> => {
  const year = Number(req.body?.year);
  if (!Number.isInteger(year) || year < 2000 || year > 2100) { res.status(400).json({ error: "年度格式不正確" }); return; }
  const to = `${year}-12-31`;
  if (to >= todayTaipei()) { res.status(400).json({ error: `${year} 年還沒過完，不能結帳` }); return; }
  const summary = await yearSummary(year);
  if (summary.unbalancedCount > 0) { res.status(400).json({ error: `${year} 年有 ${summary.unbalancedCount} 筆借貸不平衡的分錄，請先處理` }); return; }
  if (summary.closed) { res.status(400).json({ error: `${year} 年已經結帳（關帳日 ${summary.lockDate}）` }); return; }
  const [existing] = await db.select().from(accountingSettingsTable).limit(1);
  if (existing) await db.update(accountingSettingsTable).set({ lockDate: to });
  else await db.insert(accountingSettingsTable).values({ lockDate: to });
  await db.insert(activitiesTable).values({
    type: "update", title: "年度結帳", module: "Accounting",
    description: `${req.session?.user?.username || "API"} 結 ${year} 年：收入 ${summary.totalIncome}、費用 ${summary.totalExpense}、損益 ${summary.netProfit}，關帳日設為 ${to}`,
  });
  res.json({ ...summary, lockDate: to, closed: true });
});

/**
 * 沖銷分錄：不刪、不改原分錄，另開一張借貸相反的分錄把它抵掉。
 * 由傳票產生的分錄要從傳票作廢，才能連同沖帳一起還原。
 */
router.post("/journal-entries/:id/reverse", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) { res.status(400).json({ error: "分錄編號格式不正確" }); return; }
  const reason = typeof req.body?.reason === "string" ? req.body.reason.trim().slice(0, 200) : "";
  const requestedDate = typeof req.body?.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(req.body.date) ? req.body.date : todayTaipei();
  try {
    const reversal = await db.transaction(async (tx) => {
      const [original] = await tx.select().from(journalEntriesTable).where(eq(journalEntriesTable.id, id)).for("update");
      if (!original) throw Object.assign(new Error("找不到這筆分錄"), { status: 404 });
      if (original.status === "Reversed") throw new Error("這筆分錄已經沖銷過了");
      if (original.status === "Draft") throw new Error("草稿分錄尚未入帳，不需要沖銷");
      // 作廢、沖銷產生的分錄（說明開頭是「沖銷 」或「作廢」）本身就是沖銷，不能再沖
      if (String(original.description || "").startsWith("沖銷 ") || String(original.description || "").startsWith("作廢")) {
        throw new Error("這筆本身就是沖銷分錄，不能再沖銷");
      }
      const [voucher] = await tx.select({ voucherNumber: vouchersTable.voucherNumber }).from(vouchersTable).where(eq(vouchersTable.journalEntryId, id));
      if (voucher) throw new Error(`這筆分錄是傳票 ${voucher.voucherNumber} 產生的，請到該傳票按「作廢」`);
      // 其他單據（付款申請、發票、銷貨單、出貨單…）自動開的分錄也一樣：在這裡沖銷，原單的狀態不會跟著變，帳和單就對不起來
      const source = await sourceOfEntry(original.entryNumber);
      if (source) throw new Error(`這筆分錄是 ${source} 自動產生的，請到那張單作廢或取消，分錄會一起沖掉`);
      await assertPeriodOpen(tx, requestedDate, "沖銷分錄");

      const lines = (Array.isArray(original.lines) ? (original.lines as any[]) : []).map(line => ({ ...line, debit: Number(line.credit) || 0, credit: Number(line.debit) || 0 }));
      const [created] = await tx.insert(journalEntriesTable).values({
        entryNumber: `JE-R${original.id}-${String(Date.now()).slice(-6)}`,
        entryDate: requestedDate,
        description: `沖銷 ${original.entryNumber}${reason ? "：" + reason : ""}`,
        totalDebit: original.totalCredit,
        totalCredit: original.totalDebit,
        status: "Posted",
        lines,
        projectId: original.projectId,
        departmentId: original.departmentId,
        isInternalTransfer: original.isInternalTransfer,
        transferFromDepartmentId: original.transferToDepartmentId,
        transferToDepartmentId: original.transferFromDepartmentId,
      }).returning();
      await tx.update(journalEntriesTable).set({ status: "Reversed" }).where(eq(journalEntriesTable.id, original.id));
      await tx.insert(activitiesTable).values({
        type: "update", title: "分錄沖銷",
        description: `${original.entryNumber} → ${created.entryNumber}${reason ? " - " + reason : ""}`, module: "Accounting",
      });
      return created;
    });
    res.status(201).json(reversal);
  } catch (err: any) {
    res.status(Number(err?.status) || 400).json({ error: err?.message || "沖銷失敗" });
  }
});

/**
 * 舊的系統分錄說明只有單號（「自動分錄 - 付款申請 PRQ-… 付款」）。這裡回頭查來源單據，
 * 把說明改成「對象｜摘要」。只改文字，金額、科目、日期都不動。先 dryRun 看會改幾筆。
 */
router.post("/journal-entries/refresh-auto-text", requireRole("owner", "admin"), async (req, res): Promise<void> => {
  const dryRun = req.body?.dryRun !== false;
  const rows = await db.select({ id: journalEntriesTable.id, entryNumber: journalEntriesTable.entryNumber, description: journalEntriesTable.description, lines: journalEntriesTable.lines })
    .from(journalEntriesTable)
    .where(sql`(${journalEntriesTable.description} LIKE '自動分錄 - %' OR ${journalEntriesTable.description} LIKE '作廢沖銷 - %')`);
  const changes: Array<{ id: number; entryNumber: string; before: string; after: string }> = [];
  for (const row of rows) {
    // 查得到來源單據就寫「對象｜摘要」；查不到（工單、外包、金流撥款…）就把單號拿掉，只留內容
    const found = await autoEntryText(db, row.entryNumber);
    const text = autoOrPlain(found, row.description || "", (row.lines as any[]) || []);
    if (text.description === row.description) continue;
    changes.push({ id: row.id, entryNumber: row.entryNumber, before: row.description || "", after: text.lines[0]?.description ?? text.description });
    if (!dryRun) await db.update(journalEntriesTable).set({ description: text.description, lines: text.lines }).where(eq(journalEntriesTable.id, row.id));
  }
  if (!dryRun && changes.length) {
    await db.insert(activitiesTable).values({ type: "update", title: "系統分錄摘要", description: `改寫 ${changes.length} 筆系統分錄的摘要（只改文字）`, module: "Accounting" });
  }
  res.json({ dryRun, scanned: rows.length, changed: changes.length, sample: changes.slice(0, 20) });
});

/** 單張分錄：總分類帳點「日期-號碼」時開的明細，附來源單據 */
/** 這筆分錄是不是收款單、付款單（含 Ecount 搬來的）開出來的：是的話要到那張單操作 */
async function voucherOfEntry(executor: any, entryId: number): Promise<string | null> {
  const [v] = await executor.select({ voucherNumber: vouchersTable.voucherNumber }).from(vouchersTable)
    .where(sql`${vouchersTable.journalEntryId} = ${entryId} OR ${vouchersTable.items} @> ${JSON.stringify([{ legacyJournalEntryId: entryId }])}::jsonb`).limit(1);
  return v?.voucherNumber ?? null;
}

/** 原分錄和它的沖銷分錄是一組，要刪一起刪：只刪一邊帳會不平 */
async function entryGroup(executor: any, entry: { id: number; entryNumber: string }) {
  const originalId = reversalOriginalId(entry.entryNumber) ?? entry.id;
  return executor.select().from(journalEntriesTable)
    .where(sql`${journalEntriesTable.id} = ${originalId} OR ${journalEntriesTable.entryNumber} LIKE ${`JE-R${originalId}-%`}`);
}

/** 系統從其他單據（付款申請、發票、出貨…）自動開的分錄：要到原單處理 */
async function sourceOfEntry(entryNumber: string): Promise<string | null> {
  const found = await autoEntryText(db, entryNumber).catch(() => null);
  return found ? `${found.sourceLabel} ${found.sourceNumber}` : null;
}

// 草稿還沒入帳，可以直接刪；已入帳的要送「異動申請」
router.delete("/journal-entries/:id", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) { res.status(400).json({ error: "分錄編號不正確" }); return; }
  const [e] = await db.select().from(journalEntriesTable).where(eq(journalEntriesTable.id, id));
  if (!e) { res.status(404).json({ error: "找不到這筆分錄" }); return; }
  if (e.status !== "Draft") { res.status(400).json({ error: "已入帳的分錄要送刪除申請，審核通過才會刪除" }); return; }
  try {
    await assertPeriodOpen(db, e.entryDate, "刪除分錄");
    await db.delete(journalEntriesTable).where(eq(journalEntriesTable.id, id));
    res.sendStatus(204);
  } catch (err: any) { res.status(Number(err?.status) || 400).json({ error: err?.message || "刪除失敗" }); }
});

// 申請刪除已入帳的分錄（連同沖銷分錄一起）
router.post("/journal-entries/:id/delete-request", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) { res.status(400).json({ error: "分錄編號不正確" }); return; }
  try {
    const [e] = await db.select().from(journalEntriesTable).where(eq(journalEntriesTable.id, id));
    if (!e) throw Object.assign(new Error("找不到這筆分錄"), { status: 404 });
    const group = await entryGroup(db, e);
    for (const g of group) {
      const voucher = await voucherOfEntry(db, g.id);
      if (voucher) throw new Error(`這筆分錄是 ${voucher} 開出來的，請到那張單申請刪除，分錄會一起刪`);
      const source = await sourceOfEntry(g.entryNumber);
      if (source) throw new Error(`這筆分錄是 ${source} 自動產生的，請到原單處理`);
      await assertPeriodOpen(db, g.entryDate, "刪除分錄");
    }
    const numbers = group.map((g: any) => g.entryNumber);
    const user = req.session?.user;
    const { changeRequest, autoApplied } = await db.transaction(tx => submitChangeRequest(tx, {
      kind: "delete", targetType: "journal_entry", targetId: reversalOriginalId(e.entryNumber) ?? e.id, targetNumber: numbers.join("、"),
      title: `刪除分錄 ${numbers.join("、")}`, original: { entries: group.map((g: any) => ({ id: g.id, entryNumber: g.entryNumber, entryDate: g.entryDate, description: g.description, totalDebit: g.totalDebit })) },
      reason: String(req.body?.reason ?? ""),
    }, { username: user?.username || "API", role: user?.role ?? null }));
    res.status(autoApplied ? 200 : 202).json(autoApplied ? { applied: true, requestNumber: changeRequest.requestNumber, message: autoApplied } : { pending: true, requestNumber: changeRequest.requestNumber });
  } catch (err: any) { res.status(Number(err?.status) || 400).json({ error: err?.message || "送出刪除申請失敗" }); }
});

registerChangeHandler("journal_entry", "delete", async (tx, cr) => {
  const [e] = await tx.select().from(journalEntriesTable).where(eq(journalEntriesTable.id, cr.targetId ?? 0)).for("update");
  if (!e) return "分錄已經不在了";
  const group = await entryGroup(tx, e);
  for (const g of group) {
    const voucher = await voucherOfEntry(tx, g.id);
    if (voucher) throw Object.assign(new Error(`分錄 ${g.entryNumber} 是 ${voucher} 開出來的，請改到那張單申請刪除`), { status: 400 });
    await assertPeriodOpen(tx, g.entryDate, "刪除分錄");
  }
  for (const g of group) await tx.delete(journalEntriesTable).where(eq(journalEntriesTable.id, g.id));
  return `已刪除 ${group.map((g: any) => g.entryNumber).join("、")}`;
});

/**
 * 修改分錄要填的內容，檢查方式跟新增一樣：至少兩行、科目是明細科目、借貸平衡、有收入費用要選專案。
 * 送審時檢查一次，核准時（審核人可能改過內容）再檢查一次。
 */
export interface EntryEdit { entryDate: string; description: string; projectId: number | null; departmentId: number | null; lines: Array<{ accountId: number; debit: number; credit: number; party?: string; description?: string }> }
async function checkEntryEdit(raw: any): Promise<{ error: string } | { value: EntryEdit; built: { lines: any[]; totalDebit: number; totalCredit: number } }> {
  const entryDate = String(raw?.entryDate ?? "");
  if (!isRealDate(entryDate)) return { error: "請填寫正確的分錄日期" };
  const rawLines: any[] = Array.isArray(raw?.lines) ? raw.lines : [];
  if (rawLines.length < 2) return { error: "日記帳分錄至少需要兩行（借方與貸方）" };
  const accounts = await getTenantAccounts();
  let totalDebit = 0, totalCredit = 0, touchesIncomeOrExpense = false;
  const lines: any[] = [];
  const clean: EntryEdit["lines"] = [];
  for (const line of rawLines) {
    const accountId = Number(line?.accountId);
    const account = accounts.get(accountId);
    if (!Number.isInteger(accountId) || accountId <= 0 || !account || account.isGroup) return { error: "會計科目不存在或不可過帳，請選擇本公司的明細科目" };
    const debit = round2(Number(line?.debit) || 0), credit = round2(Number(line?.credit) || 0);
    if (debit < 0 || credit < 0) return { error: "借方與貸方金額不可為負數" };
    if (debit === 0 && credit === 0) return { error: "每行至少需要有借方或貸方金額" };
    if (debit > 0 && credit > 0) return { error: "同一行不能同時有借方與貸方金額，請拆成兩行" };
    if (account.accountType === "Income" || account.accountType === "Expense") touchesIncomeOrExpense = true;
    totalDebit = round2(totalDebit + debit); totalCredit = round2(totalCredit + credit);
    const party = typeof line?.party === "string" ? line.party.trim().slice(0, 80) : "";
    const summary = typeof line?.description === "string" ? line.description.trim() : "";
    const text = party ? `${party}｜${summary}` : summary;
    lines.push({ accountId, accountName: account.accountName, debit, credit, ...(text ? { description: text.slice(0, 200) } : {}) });
    clean.push({ accountId, debit, credit, party, description: summary });
  }
  const projectId = raw?.projectId == null || raw.projectId === "" ? null : Number(raw.projectId) || null;
  const departmentId = raw?.departmentId == null || raw.departmentId === "" ? null : Number(raw.departmentId) || null;
  if (touchesIncomeOrExpense && isMissingProject(projectId)) return { error: PROJECT_REQUIRED_MESSAGE };
  if (Math.abs(totalDebit - totalCredit) > 0.01) return { error: `借貸不平衡：借方合計 $${totalDebit.toFixed(2)} ≠ 貸方合計 $${totalCredit.toFixed(2)}` };
  const description = String(raw?.description ?? "").trim().slice(0, 300);
  return { value: { entryDate, description, projectId, departmentId, lines: clean }, built: { lines, totalDebit, totalCredit } };
}

/** 現在這張分錄的內容，整理成跟修改表單一樣的格式（送審時存起來，審核的人看得到改了什麼） */
function entryAsEdit(e: any): EntryEdit {
  return {
    entryDate: e.entryDate, description: e.description || "", projectId: e.projectId ?? null, departmentId: e.departmentId ?? null,
    lines: ((e.lines as any[]) || []).map(l => {
      const text = typeof l.description === "string" ? l.description : "";
      const [party, ...rest] = text.includes("｜") ? text.split("｜") : ["", text];
      return { accountId: Number(l.accountId), debit: Number(l.debit) || 0, credit: Number(l.credit) || 0, party: party.trim(), description: rest.join("｜").trim() };
    }),
  };
}

/** 能不能改：收付款單開的到原單改；系統自動產生的到原單；已沖銷的要整組刪掉重做 */
async function editBlock(e: any): Promise<string | null> {
  if (e.status === "Reversed") return "這筆已經沖銷過了，不能再改；要改請整組（原分錄＋沖銷分錄）申請刪除後重開";
  if (reversalOriginalId(e.entryNumber) || String(e.description || "").startsWith("作廢")) return "沖銷、作廢產生的分錄不能改";
  const voucher = await voucherOfEntry(db, e.id);
  if (voucher) return `這筆分錄是 ${voucher} 開出來的，請到那張單修改`;
  const source = await sourceOfEntry(e.entryNumber);
  if (source) return `這筆分錄是 ${source} 自動產生的，請到原單修改`;
  return null;
}

// 修改分錄：草稿直接改；已入帳的送「異動申請」，核准才改（老闆 2026-11-16）
router.put("/journal-entries/:id", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) { res.status(400).json({ error: "分錄編號不正確" }); return; }
  try {
    const [e] = await db.select().from(journalEntriesTable).where(eq(journalEntriesTable.id, id));
    if (!e) throw Object.assign(new Error("找不到這筆分錄"), { status: 404 });
    const blocked = await editBlock(e);
    if (blocked) throw new Error(blocked);
    const checked = await checkEntryEdit(req.body);
    if ("error" in checked) throw new Error(checked.error);
    await assertPeriodOpen(db, e.entryDate, "修改分錄");
    await assertPeriodOpen(db, checked.value.entryDate, "修改分錄");
    if (e.status === "Draft") {
      const [updated] = await db.update(journalEntriesTable).set({
        entryDate: checked.value.entryDate, description: checked.value.description, projectId: checked.value.projectId, departmentId: checked.value.departmentId,
        lines: checked.built.lines, totalDebit: String(checked.built.totalDebit), totalCredit: String(checked.built.totalCredit),
      }).where(eq(journalEntriesTable.id, id)).returning();
      res.json(updated); return;
    }
    const user = req.session?.user;
    const { changeRequest, autoApplied } = await db.transaction(tx => submitChangeRequest(tx, {
      kind: "edit", targetType: "journal_entry", targetId: e.id, targetNumber: e.entryNumber,
      title: `修改分錄 ${e.entryNumber}`, payload: checked.value as any, original: entryAsEdit(e) as any,
      reason: String(req.body?.reason ?? ""),
    }, { username: user?.username || "API", role: user?.role ?? null }));
    res.status(autoApplied ? 200 : 202).json(autoApplied ? { applied: true, requestNumber: changeRequest.requestNumber, message: autoApplied } : { pending: true, requestNumber: changeRequest.requestNumber });
  } catch (err: any) { res.status(Number(err?.status) || 400).json({ error: err?.message || "修改失敗" }); }
});

registerChangeHandler("journal_entry", "edit", async (tx, cr) => {
  const [e] = await tx.select().from(journalEntriesTable).where(eq(journalEntriesTable.id, cr.targetId ?? 0)).for("update");
  if (!e) throw Object.assign(new Error("分錄已經不在了"), { status: 400 });
  const blocked = await editBlock(e);
  if (blocked) throw Object.assign(new Error(blocked), { status: 400 });
  const checked = await checkEntryEdit(cr.payload);
  if ("error" in checked) throw Object.assign(new Error(checked.error), { status: 400 });
  await assertPeriodOpen(tx, e.entryDate, "修改分錄");
  await assertPeriodOpen(tx, checked.value.entryDate, "修改分錄");
  await tx.update(journalEntriesTable).set({
    entryDate: checked.value.entryDate, description: checked.value.description, projectId: checked.value.projectId, departmentId: checked.value.departmentId,
    lines: checked.built.lines, totalDebit: String(checked.built.totalDebit), totalCredit: String(checked.built.totalCredit),
  }).where(eq(journalEntriesTable.id, e.id));
  return `已修改 ${e.entryNumber}`;
});

// 審核人改了申請內容：先用同一套規則檢查（借貸平衡、科目、專案）
registerPayloadCheck("journal_entry", "edit", async payload => {
  const checked = await checkEntryEdit(payload);
  return "error" in checked ? checked.error : null;
});

// H：這張分錄的操作紀錄（誰、什麼時候新增、修改、沖銷）
router.get("/journal-entries/:id/history", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) { res.status(400).json({ error: "分錄編號不正確" }); return; }
  const [e] = await db.select().from(journalEntriesTable).where(eq(journalEntriesTable.id, id));
  if (!e) { res.status(404).json({ error: "找不到這張分錄" }); return; }
  const logsOf = (docId: number) => db.select().from(auditLogsTable)
    .where(and(eq(auditLogsTable.documentType, "journal_entries"), eq(auditLogsTable.documentId, docId)))
    .orderBy(auditLogsTable.createdAt, auditLogsTable.id);
  const logs = await logsOf(id);
  const originalId = reversalOriginalId(e.entryNumber);
  let reversedBy: { log: any; originalNumber: string } | null = null;
  if (originalId) {
    const [original] = await db.select({ entryNumber: journalEntriesTable.entryNumber }).from(journalEntriesTable).where(eq(journalEntriesTable.id, originalId));
    const log = (await logsOf(originalId)).find(l => l.action === "create" && Number((l.newValues as any)?.id) === id);
    if (log) reversedBy = { log, originalNumber: original?.entryNumber ?? "" };
  }
  const split = splitDescription(e.description);
  // 單據入帳時自動開的分錄（收付款單、付款申請、發票…）：寫出是哪張單開的、當時是誰建立或核准的
  let auto: { source: string | null; actor: string | null } | null = null;
  const hasCreate = logs.some(l => l.action === "create" && !(Number((l.newValues as any)?.id) && Number((l.newValues as any)?.id) !== id));
  if (!hasCreate && !reversedBy && !split.sourceNumber && e.createdAt) {
    const voucherNumber = await voucherOfEntry(db, id).catch(() => null);
    const found = voucherNumber ? null : await autoEntryText(db, e.entryNumber).catch(() => null);
    const sourceNumber = voucherNumber ?? found?.sourceNumber ?? null;
    const source = voucherNumber ? `收付款單 ${voucherNumber}` : found ? `${found.sourceLabel} ${found.sourceNumber}` : null;
    const made = new Date(e.createdAt).getTime();
    const nearby = await db.select({ userName: auditLogsTable.userName, createdAt: auditLogsTable.createdAt, documentNumber: auditLogsTable.documentNumber, newValues: auditLogsTable.newValues })
      .from(auditLogsTable)
      .where(and(gte(auditLogsTable.createdAt, new Date(made - 2000)), lte(auditLogsTable.createdAt, new Date(made + 30000))))
      .orderBy(auditLogsTable.createdAt).limit(80);
    auto = { source, actor: pickAutoActor({ entryNumber: e.entryNumber, createdAt: e.createdAt }, sourceNumber, nearby) };
  }
  res.json({ entryNumber: e.entryNumber, rows: journalHistoryRows({ id: e.id, entryNumber: e.entryNumber, createdAt: e.createdAt, sourceNumber: split.sourceNumber }, logs, reversedBy, auto) });
});

router.get("/journal-entries/:id", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) { res.status(400).json({ error: "分錄編號不正確" }); return; }
  const [row] = await db.select({ entry: journalEntriesTable, projectName: projectsTable.name, departmentName: departmentsTable.name })
    .from(journalEntriesTable)
    .leftJoin(projectsTable, eq(projectsTable.id, journalEntriesTable.projectId))
    .leftJoin(departmentsTable, eq(departmentsTable.id, journalEntriesTable.departmentId))
    .where(eq(journalEntriesTable.id, id));
  if (!row) { res.status(404).json({ error: "找不到這張分錄" }); return; }
  const accounts = await getTenantAccounts();
  const e = row.entry;
  const lines = ((e.lines as any[]) || []).map(l => {
    const text = typeof l.description === "string" ? l.description : "";
    const [party, ...rest] = text.includes("｜") ? text.split("｜") : ["", text];
    return { ...l, accountName: accounts.get(l.accountId)?.accountName || l.accountName || "", party: party.trim() || null, summary: rest.join("｜").trim() };
  });
  const split = splitDescription(e.description);
  // 原分錄和沖銷分錄互相連得到：原分錄找 JE-R{id}-，沖銷分錄從編號找回原分錄
  const originalId = reversalOriginalId(e.entryNumber);
  const related = originalId
    ? await db.select({ id: journalEntriesTable.id, entryNumber: journalEntriesTable.entryNumber, entryDate: journalEntriesTable.entryDate }).from(journalEntriesTable).where(eq(journalEntriesTable.id, originalId))
    : await db.select({ id: journalEntriesTable.id, entryNumber: journalEntriesTable.entryNumber, entryDate: journalEntriesTable.entryDate }).from(journalEntriesTable).where(sql`${journalEntriesTable.entryNumber} LIKE ${`JE-R${e.id}-%`}`);
  // 來源單據：沖銷分錄跟原分錄是一組，原分錄是哪張單開的，沖銷分錄也算那張單的（兩邊的按鈕才會一致）
  const origin = originalId && related[0] ? related[0] : { id: e.id, entryNumber: e.entryNumber };
  const source = (await autoEntryText(db, e.entryNumber).catch(() => null)) ?? (origin.id !== e.id ? await autoEntryText(db, origin.entryNumber).catch(() => null) : null);
  // 收款單、付款單開出的分錄：來源單據就是那張單
  // Ecount 搬來的收付款單是記在明細裡（legacyJournalEntryId），一起找
  const [voucher] = source ? [] : await db.select({ voucherNumber: vouchersTable.voucherNumber, voucherType: vouchersTable.voucherType }).from(vouchersTable)
    .where(sql`${vouchersTable.journalEntryId} IN (${e.id}, ${origin.id}) OR ${vouchersTable.items} @> ${JSON.stringify([{ legacyJournalEntryId: e.id }])}::jsonb OR ${vouchersTable.items} @> ${JSON.stringify([{ legacyJournalEntryId: origin.id }])}::jsonb`).limit(1);
  res.json({
    ...e, ...split, summary: split.summary.replace(/^自動分錄 - /, ""),
    reversalOf: originalId ? related[0] ?? null : null,
    reversedBy: originalId ? [] : related,
    totalDebit: Number(e.totalDebit), totalCredit: Number(e.totalCredit), lines,
    projectName: row.projectName, departmentName: row.departmentName,
    source: source ? { label: source.sourceLabel, number: source.sourceNumber, url: source.sourceUrl }
      : voucher ? { label: voucher.voucherType === "Receipt" ? "收款單" : voucher.voucherType === "Payment" ? "付款單" : "請款單", number: voucher.voucherNumber, url: `${voucher.voucherType === "Receipt" ? "/accounting/receipts" : voucher.voucherType === "Payment" ? "/accounting/payments" : "/accounting/reimbursement"}?search=${encodeURIComponent(voucher.voucherNumber)}` }
      : null,
  });
});

export default router;
