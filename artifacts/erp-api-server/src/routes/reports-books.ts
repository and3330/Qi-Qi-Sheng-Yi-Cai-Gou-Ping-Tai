import { Router, type IRouter, type Response } from "express";
import { db, journalEntriesTable, accountsTable, projectsTable, departmentsTable, legacyDocumentsTable, invoicesTable } from "@workspace/erp-db";
import { and, eq, gte, isNotNull, lte, ne, type SQL } from "drizzle-orm";
import { requireAuth, requireRole } from "../middleware/require-auth";
import { finiteReportNumber, safeJournalLines, validateReportQuery } from "./report-guards";
import {
  cashBook, expandAccountIds, flattenLines, journalBook, periodTotals, subledger, trialBalance,
  type BookAccount, type BookEntry, type SubledgerGroup,
} from "../lib/account-books";
import {
  accountDailyChanges, accountingSummary, accountPartyBalances, partyTransactions, accountMovements, balanceAging, cashFlowSummary, fundMovements, fundStatus,
  isFundAccount, isPayable, isReceivable, isSalesTax, monthlyPartyTotals, monthlyProfitLoss, vatBook, voucherTotals, type SumKey,
} from "../lib/business-reports";
import { isDebitNature } from "../lib/account-books";

/** 會計帳簿（照 Ecount 會計 > 報表 > 帳簿）。計算在 lib/account-books.ts。 */
const router: IRouter = Router();
const access = [requireAuth, requireRole("owner", "admin", "finance_admin", "accountant")] as const;

router.use("/reports/books", (req, res, next) => {
  const error = validateReportQuery(req.query as Record<string, unknown>);
  if (error) { res.status(400).json({ error }); return; }
  next();
});

type Q = Record<string, string | undefined>;
const idList = (v: string | undefined) => String(v || "").split(",").map(Number).filter(n => Number.isInteger(n) && n > 0);
const num = (v: string | undefined) => (v === undefined || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));

async function loadAccounts() {
  const rows = await db.select().from(accountsTable);
  const list: BookAccount[] = rows.map(a => ({
    id: a.id, accountNumber: a.accountNumber, accountName: a.accountName, accountType: a.accountType,
    parentAccountId: a.parentAccountId, balance: finiteReportNumber(a.balance), isGroup: a.isGroup,
  }));
  return { list, map: new Map(list.map(a => [a.id, a])) };
}

/** 讀已過帳分錄（到結束日為止），再依部門／專案篩；部門也算「專案所屬部門」，跟損益表一致 */
async function loadEntries(q: Q, opts: { fromStart: boolean }) {
  const conditions: SQL[] = [ne(journalEntriesTable.status, "Draft")];
  if (q.endDate) conditions.push(lte(journalEntriesTable.entryDate, q.endDate));
  const rows = await db.select().from(journalEntriesTable).where(and(...conditions));
  const departmentId = Number(q.departmentId) || null;
  const projectId = Number(q.projectId) || null;
  let projectDept = new Map<number, number | null>();
  if (departmentId) {
    projectDept = new Map((await db.select({ id: projectsTable.id, departmentId: projectsTable.departmentId }).from(projectsTable)).map(p => [p.id, p.departmentId]));
  }
  const entries: BookEntry[] = [];
  for (const e of rows) {
    if (opts.fromStart && q.startDate && e.entryDate < q.startDate) continue;
    if (projectId && e.projectId !== projectId) continue;
    if (departmentId && e.departmentId !== departmentId && !(e.projectId && projectDept.get(e.projectId) === departmentId)) continue;
    entries.push({
      id: e.id, entryNumber: e.entryNumber, entryDate: e.entryDate, description: e.description,
      projectId: e.projectId, departmentId: e.departmentId, lines: safeJournalLines(e.lines),
    });
  }
  return { entries, filteredByDimension: Boolean(departmentId || projectId) };
}

async function dimensionNames() {
  const projects = new Map((await db.select({ id: projectsTable.id, name: projectsTable.name, departmentId: projectsTable.departmentId }).from(projectsTable)).map(p => [p.id, p]));
  const departments = new Map((await db.select({ id: departmentsTable.id, name: departmentsTable.name }).from(departmentsTable)).map(d => [d.id, d.name]));
  return (projectId: number | null, departmentId: number | null) => {
    const p = projectId ? projects.get(projectId) : undefined;
    const d = departmentId ?? p?.departmentId ?? null;
    return { project: p?.name ?? null, department: d ? departments.get(d) ?? null : null };
  };
}

/** 日記簿 */
router.get("/reports/books/journal", ...access, async (req, res): Promise<void> => {
  const q = req.query as Q;
  const { list, map } = await loadAccounts();
  const { entries } = await loadEntries(q, { fromStart: true });
  const ids = idList(q.accountIds);
  const result = journalBook(entries, map, {
    accountIds: ids.length ? expandAccountIds(ids, list) : null,
    party: q.party, summary: q.summary, reference: q.reference,
    minAmount: num(q.minAmount), maxAmount: num(q.maxAmount), unbalancedOnly: q.unbalancedOnly === "1",
  });
  const names = await dimensionNames();
  res.json({ ...result, rows: result.rows.map(r => ({ ...r, ...names(r.projectId, r.departmentId) })) });
});

/** 日/月合計表 */
router.get("/reports/books/period-totals", ...access, async (req, res): Promise<void> => {
  const q = req.query as Q;
  const { map } = await loadAccounts();
  const { entries } = await loadEntries(q, { fromStart: true });
  const periods = periodTotals(flattenLines(entries, map), map, q.mode === "day" ? "day" : "month");
  const totalDebit = periods.reduce((s, p) => s + p.totalDebit, 0);
  const totalCredit = periods.reduce((s, p) => s + p.totalCredit, 0);
  res.json({ periods, totalDebit: Math.round(totalDebit * 100) / 100, totalCredit: Math.round(totalCredit * 100) / 100 });
});

/** 科目/客戶/供應商明細帳、客戶/供應商/科目明細帳、科目摘要明細帳 */
router.get("/reports/books/subledger", ...access, async (req, res): Promise<void> => {
  const q = req.query as Q;
  const group: SubledgerGroup = q.group === "party-account" || q.group === "account-summary" ? q.group : "account-party";
  const ids = idList(q.accountIds);
  // 跟總分類帳一樣：沒選科目、也沒指定對象時要明確說「查全部」才查，避免一次撈太多
  if (ids.length === 0 && !q.party && q.all !== "1") { res.json({ sections: [] }); return; }
  const { list, map } = await loadAccounts();
  const { entries, filteredByDimension } = await loadEntries(q, { fromStart: false });
  const sections = subledger(entries, map, {
    group, accountIds: ids.length ? expandAccountIds(ids, list) : null, startDate: q.startDate,
    party: q.party, summary: q.summary, includeStaticBalance: !filteredByDimension, hideEmpty: q.hideEmpty === "1",
  });
  res.json({ filteredByDimension, sections });
});

/** 現金出納帳：預設只看現金（1111），勾「包括存款」再加上 111x 銀行存款 */
router.get("/reports/books/cash", ...access, async (req, res): Promise<void> => {
  const q = req.query as Q;
  const { list, map } = await loadAccounts();
  const cashIds = new Set(list.filter(a => !a.isGroup && (q.includeBank === "1" ? /^111/.test(a.accountNumber) : /^1111/.test(a.accountNumber))).map(a => a.id));
  const { entries, filteredByDimension } = await loadEntries(q, { fromStart: false });
  res.json({
    filteredByDimension,
    cashAccounts: [...cashIds].map(id => map.get(id)!).map(a => ({ id: a.id, accountNumber: a.accountNumber, accountName: a.accountName })),
    ...cashBook(entries, map, cashIds, q.startDate, !filteredByDimension),
  });
});

/** 餘額試算表（Ecount 累計格式）：期末金額＝結轉＋本期發生額，上層科目有小計 */
router.get("/reports/books/trial-balance", ...access, async (req, res): Promise<void> => {
  const q = req.query as Q;
  if (!q.startDate) { res.status(400).json({ error: "請選起始日期" }); return; }
  const { list } = await loadAccounts();
  const { entries, filteredByDimension } = await loadEntries(q, { fromStart: false });
  res.json({ filteredByDimension, ...trialBalance(entries, list, { startDate: q.startDate, endDate: q.endDate, includeStaticBalance: !filteredByDimension, hideZero: q.includeZero !== "1" }) });
});

// ─────────── 經營資料、其他帳簿 ───────────

const needRange = (q: Q, res: Response) => {
  if (!q.startDate || !q.endDate) { res.status(400).json({ error: "請選起訖日期" }); return false; }
  return true;
};
const shiftRange = (start: string, end: string, mode: string) => {
  const shift = (d: string) => {
    const x = new Date(`${d}T00:00:00Z`);
    if (mode === "lastYear") x.setUTCFullYear(x.getUTCFullYear() - 1);
    else if (mode === "prevMonth") x.setUTCMonth(x.getUTCMonth() - 1);
    else x.setUTCDate(x.getUTCDate() - 1);
    return x.toISOString().slice(0, 10);
  };
  return [shift(start), shift(end)] as const;
};

/**
 * 「點合計看分錄」用：報表上某個合計是哪幾個科目算出來的、增加記在借方還是貸方。只是多回一個欄位，不影響報表數字。
 * 分錄明細會把上層科目換成它底下的科目，所以期間內如果有分錄直接記在上層科目，或這幾個科目的借貸方向不一致，
 * 明細就會和報表對不起來——這種情況回 null，前端那個數字就不給點。
 */
function drillAccounts(list: BookAccount[], entries: BookEntry[], startDate: string, pick: (a: BookAccount) => boolean): { accountIds: number[]; side: "debit" | "credit" } | null {
  const parents = new Set(list.map(a => a.parentAccountId).filter((id): id is number => !!id));
  const hit = list.filter(pick);
  const leaves = hit.filter(a => !parents.has(a.id));
  if (leaves.length === 0) return null;
  const upper = new Set(hit.filter(a => parents.has(a.id)).map(a => a.id));
  if (upper.size > 0 && entries.some(e => e.entryDate >= startDate && e.lines.some(l => upper.has(l.accountId)))) return null;
  const debit = leaves.filter(a => isDebitNature(a.accountType)).length;
  if (debit !== 0 && debit !== leaves.length) return null;
  return { accountIds: leaves.map(a => a.id), side: debit ? "debit" : "credit" };
}

/** 資金日報表／資金情況表：各科目結轉、增加、減少、餘額（拆到客戶/供應商）；detail=1 再附資金與應收應付的增減明細 */
router.get("/reports/books/fund-status", ...access, async (req, res): Promise<void> => {
  const q = req.query as Q;
  if (!needRange(q, res)) return;
  const { list, map } = await loadAccounts();
  const ids = idList(q.accountIds);
  const target = ids.length ? expandAccountIds(ids, list) : new Set(list.filter(a => isFundAccount(a) || isReceivable(a) || isPayable(a)).map(a => a.id));
  const { entries, filteredByDimension } = await loadEntries(q, { fromStart: false });
  const status = fundStatus(entries, map, target, q.startDate!, !filteredByDimension);
  if (q.detail !== "1") { res.json({ filteredByDimension, ...status }); return; }
  const fund = new Set(list.filter(isFundAccount).map(a => a.id));
  const lines = flattenLines(entries, map);
  res.json({
    filteredByDimension, ...status,
    fund: fundMovements(entries, map, fund, q.startDate!, q.endDate),
    receivable: accountMovements(lines, map, new Set(list.filter(isReceivable).map(a => a.id)), q.startDate!, q.endDate),
    payable: accountMovements(lines, map, new Set(list.filter(isPayable).map(a => a.id)), q.startDate!, q.endDate),
    receivableDrill: drillAccounts(list, entries, q.startDate!, isReceivable),
    payableDrill: drillAccounts(list, entries, q.startDate!, isPayable),
  });
});

/** 現金流動(收付款明細)：期初、依對應科目的增加／減少、期末；可加比較期間 */
router.get("/reports/books/cash-movement", ...access, async (req, res): Promise<void> => {
  const q = req.query as Q;
  if (!needRange(q, res)) return;
  const { list, map } = await loadAccounts();
  const fund = new Set(list.filter(isFundAccount).map(a => a.id));
  const { entries, filteredByDimension } = await loadEntries(q, { fromStart: false });
  const current = cashFlowSummary(entries, map, fund, q.startDate!, q.endDate!, !filteredByDimension);
  let compare = null;
  if (q.compare && q.compare !== "none") {
    const [s, e] = shiftRange(q.startDate!, q.endDate!, q.compare);
    compare = { startDate: s, endDate: e, ...cashFlowSummary(entries.filter(x => x.entryDate <= e), map, fund, s, e, !filteredByDimension) };
  }
  res.json({ filteredByDimension, current, compare });
});

/** 資金收支明細：資金的增加、資金的減少逐筆 */
router.get("/reports/books/fund-detail", ...access, async (req, res): Promise<void> => {
  const q = req.query as Q;
  if (!needRange(q, res)) return;
  const { list, map } = await loadAccounts();
  const { entries } = await loadEntries(q, { fromStart: true });
  res.json(fundMovements(entries, map, new Set(list.filter(isFundAccount).map(a => a.id)), q.startDate!, q.endDate));
});

/** 月損益報表 */
router.get("/reports/books/monthly-pl", ...access, async (req, res): Promise<void> => {
  const q = req.query as Q;
  if (!needRange(q, res)) return;
  const { list } = await loadAccounts();
  const { entries } = await loadEntries(q, { fromStart: true });
  res.json(monthlyProfitLoss(entries, list, q.startDate!, q.endDate!));
});

/** 會計合計表 */
router.get("/reports/books/summary", ...access, async (req, res): Promise<void> => {
  const q = req.query as Q;
  if (!needRange(q, res)) return;
  const keys: SumKey[] = ["account", "party", "department", "project", "month"];
  const key1 = (keys.includes(q.key1 as SumKey) ? q.key1 : "account") as SumKey;
  const key2 = keys.includes(q.key2 as SumKey) && q.key2 !== key1 ? q.key2 as SumKey : null;
  const { list, map } = await loadAccounts();
  const { entries } = await loadEntries(q, { fromStart: false });
  const ids = idList(q.accountIds);
  const target = ids.length ? expandAccountIds(ids, list) : null;
  const lines = flattenLines(entries, map).filter(l => (!target || target.has(l.accountId)) && (!q.party || l.party.includes(q.party)));
  // 「點借方、貸方看分錄」用（只多回一個欄位）：分錄明細只列最底層科目，期間內如果有分錄直接記在上層科目，明細會少算，這時不給點
  const parents = new Set(list.map(a => a.parentAccountId).filter((id): id is number => !!id));
  const drillable = !lines.some(l => l.date >= q.startDate! && parents.has(l.accountId));
  res.json({ ...accountingSummary(lines, map, { startDate: q.startDate!, key1, key2, dimName: await dimensionNames() }), drillable });
});

/** 月銷項／月進項合計表 */
router.get("/reports/books/monthly-party", ...access, async (req, res): Promise<void> => {
  const q = req.query as Q;
  if (!needRange(q, res)) return;
  const { list, map } = await loadAccounts();
  const { entries } = await loadEntries(q, { fromStart: true });
  const sales = q.kind !== "purchase";
  const result = monthlyPartyTotals(entries, map, sales ? "sales" : "purchase", q.startDate!, q.endDate!);
  // 算進去的科目跟 monthlyPartyTotals 一樣：銷項＝4 開頭的收入科目＋銷項稅額（看貸方減借方）；進項＝應付帳款（只看貸方）
  const picked = drillAccounts(list, entries, q.startDate!, sales ? a => (a.accountType === "Income" && /^4/.test(a.accountNumber)) || isSalesTax(a) : isPayable);
  const drill = picked && (!sales || picked.side === "credit") ? picked : null;
  const p = q.party?.trim();
  res.json(p ? { ...result, rows: result.rows.filter(r => r.party.includes(p)), drill } : { ...result, drill });
});

/** 收款單／付款單／暫付款單合計 */
router.get("/reports/books/vouchers", ...access, async (req, res): Promise<void> => {
  const q = req.query as Q;
  if (!needRange(q, res)) return;
  const { list, map } = await loadAccounts();
  const { entries } = await loadEntries(q, { fromStart: true });
  const kind = q.kind === "payment" || q.kind === "advance" ? q.kind : "receipt";
  let rows = voucherTotals(entries, map, kind, new Set(list.filter(isFundAccount).map(a => a.id)), q.startDate!, q.endDate!, await dimensionNames());
  if (q.party) rows = rows.filter(r => r.party.includes(q.party!));
  if (q.reference) rows = rows.filter(r => r.reference.includes(q.reference!));
  res.json({ rows, total: Math.round(rows.reduce((s, r) => s + r.amount, 0) * 100) / 100, totalFee: Math.round(rows.reduce((s, r) => s + r.fee, 0) * 100) / 100 });
});

/** 進項/銷項帳簿 */
router.get("/reports/books/vat", ...access, async (req, res): Promise<void> => {
  const q = req.query as Q;
  if (!needRange(q, res)) return;
  const { map } = await loadAccounts();
  const { entries } = await loadEntries(q, { fromStart: true });
  // Ecount 搬來的發票號碼在歷史「進項銷項明細」；新系統開的發票在發票資料
  const legacy = await db.select({ docNumber: legacyDocumentsTable.docNumber, lines: legacyDocumentsTable.lines }).from(legacyDocumentsTable)
    .where(and(eq(legacyDocumentsTable.docType, "進項銷項明細"), gte(legacyDocumentsTable.docDate, q.startDate!), lte(legacyDocumentsTable.docDate, q.endDate!)));
  const legacyNo = new Map(legacy.map(d => [d.docNumber, (d.lines ?? []).map(l => l["發票號碼"]).filter(Boolean).join("、")]));
  const inv = await db.select({ je: invoicesTable.journalEntryId, gov: invoicesTable.govInvoiceNumber, ecpay: invoicesTable.ecpayInvoiceNumber }).from(invoicesTable).where(isNotNull(invoicesTable.journalEntryId));
  const invNo = new Map(inv.map(i => [i.je as number, i.ecpay || i.gov || ""]));
  const kind = q.kind === "sales" || q.kind === "purchase" ? q.kind : "all";
  let rows = vatBook(entries, map, kind, q.startDate!, q.endDate!, (e, ref) => legacyNo.get(ref) || invNo.get(e.id) || "");
  if (q.party) rows = rows.filter(r => r.party.includes(q.party!));
  if (q.invoiceNumber) rows = rows.filter(r => r.invoiceNumber.includes(q.invoiceNumber!));
  const sum = (k: "sales" | "purchase", f: "net" | "tax") => Math.round(rows.filter(r => r.kind === k).reduce((s, r) => s + r[f], 0) * 100) / 100;
  res.json({ rows, sales: { net: sum("sales", "net"), tax: sum("sales", "tax") }, purchase: { net: sum("purchase", "net"), tax: sum("purchase", "tax") } });
});

/** 科目增減紀錄 */
router.get("/reports/books/account-changes", ...access, async (req, res): Promise<void> => {
  const q = req.query as Q;
  if (!needRange(q, res)) return;
  const ids = idList(q.accountIds);
  if (ids.length === 0) { res.status(400).json({ error: "請選會計科目" }); return; }
  const { list, map } = await loadAccounts();
  const { entries, filteredByDimension } = await loadEntries(q, { fromStart: false });
  const lines = flattenLines(entries, map).filter(l => !q.party || l.party.includes(q.party));
  res.json({ filteredByDimension, sections: accountDailyChanges(lines, map, expandAccountIds(ids, list), q.startDate!, !filteredByDimension && !q.party) });
});

/** 應收/應付餘額分析表 */
router.get("/reports/books/balance-aging", ...access, async (req, res): Promise<void> => {
  const q = req.query as Q;
  const asOf = q.endDate;
  if (!asOf) { res.status(400).json({ error: "請選查詢日期" }); return; }
  const { list, map } = await loadAccounts();
  const { entries, filteredByDimension } = await loadEntries(q, { fromStart: false });
  const ids = new Set(list.filter(q.type === "payable" ? isPayable : isReceivable).map(a => a.id));
  const result = balanceAging(flattenLines(entries, map), map, ids, asOf, !filteredByDimension);
  const p = q.party?.trim();
  res.json({ filteredByDimension, ...(p ? { ...result, rows: result.rows.filter(r => r.party.includes(p)) } : result) });
});

/** 科目明細表：截至查詢日每個科目的餘額，往來科目拆到客戶/供應商 */
router.get("/reports/books/account-detail", ...access, async (req, res): Promise<void> => {
  const q = req.query as Q;
  const asOf = q.endDate;
  if (!asOf) { res.status(400).json({ error: "請選查詢日期" }); return; }
  const { list, map } = await loadAccounts();
  const { entries, filteredByDimension } = await loadEntries(q, { fromStart: false });
  const ids = idList(q.accountIds);
  let sections = accountPartyBalances(flattenLines(entries, map), map, asOf, !filteredByDimension, ids.length ? expandAccountIds(ids, list) : null);
  if (q.includeZero !== "1") sections = sections.filter(s => Math.abs(s.total) >= 0.005);
  const p = q.party?.trim();
  if (p) sections = sections.map(s => ({ ...s, rows: s.rows.filter(r => r.party.includes(p)) })).filter(s => s.rows.length).map(s => ({ ...s, total: Math.round(s.rows.reduce((t, r) => t + r.amount, 0) * 100) / 100 }));
  res.json({ filteredByDimension, sections });
});

/** 查看客戶/供應商交易明細 */
router.get("/reports/books/party-transactions", ...access, async (req, res): Promise<void> => {
  const q = req.query as Q;
  if (!needRange(q, res)) return;
  const { map } = await loadAccounts();
  const { entries } = await loadEntries(q, { fromStart: true });
  let sections = partyTransactions(flattenLines(entries, map), q.startDate!, q.endDate!);
  const p = q.party?.trim();
  if (p) sections = sections.filter(s => s.party.includes(p));
  if (q.reference) sections = sections.map(s => ({ ...s, rows: s.rows.filter(r => r.reference.includes(q.reference!)) })).filter(s => s.rows.length)
    .map(s => ({ ...s, totalDebit: Math.round(s.rows.reduce((t, r) => t + r.debit, 0) * 100) / 100, totalCredit: Math.round(s.rows.reduce((t, r) => t + r.credit, 0) * 100) / 100 }));
  res.json({ sections });
});

export default router;
