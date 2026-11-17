/**
 * 會計帳簿（照 Ecount「會計 > 報表 > 帳簿」）：日記簿、日/月合計表、
 * 科目/客戶/供應商明細帳、客戶/供應商/科目明細帳、科目摘要明細帳、現金出納帳。
 *
 * 這裡只做計算（純函式，方便測試）；讀資料庫在 routes/reports-books.ts。
 * 分錄行說明是「對象｜摘要」（Ecount 搬來的格式），對象就當客戶/供應商。
 */

export interface BookLineInput { accountId: number; debit: number; credit: number; description?: string }
export interface BookEntry {
  id: number;
  entryNumber: string;
  entryDate: string;
  description: string | null;
  projectId: number | null;
  departmentId: number | null;
  lines: BookLineInput[];
}
export interface BookAccount {
  id: number;
  accountNumber: string;
  accountName: string;
  accountType: string;
  parentAccountId: number | null;
  balance: number;
  isGroup: boolean;
}
export interface BookLine {
  date: string;
  entryId: number;
  reference: string;
  seq: number;
  accountId: number;
  accountNumber: string;
  accountName: string;
  party: string;
  summary: string;
  debit: number;
  credit: number;
  projectId: number | null;
  departmentId: number | null;
}

export const money = (n: number) => Math.round(n * 100) / 100;
const byNumber = (a: { accountNumber: string }, b: { accountNumber: string }) =>
  String(a.accountNumber).localeCompare(String(b.accountNumber), "zh-Hant", { numeric: true });

/** 借方科目（資產、費用）餘額＝借−貸；其他＝貸−借 */
export const isDebitNature = (accountType: string) => accountType === "Asset" || accountType === "Expense";

/** 「Ecount 2026/10/01-3｜對象｜摘要」→ 2026/10/01-3；不是 Ecount 搬來的就回 null */
export function ecountReference(entryDescription: string | null | undefined): string | null {
  const m = /^Ecount\s+([^\s｜]+)｜/.exec(entryDescription || "");
  return m ? m[1] : null;
}

/** 分錄行說明「對象｜摘要」拆成對象、摘要；沒有分隔符號就整句當摘要，摘要空白就用整張分錄的說明 */
export function splitLineText(lineDescription: string | undefined, entryDescription: string | null): { party: string; summary: string } {
  const text = String(lineDescription || "");
  const [party, ...rest] = text.includes("｜") ? text.split("｜") : ["", text];
  let summary = rest.join("｜").trim();
  if (!summary) {
    const ec = /^Ecount\s+[^\s｜]+｜[^｜]*｜(.*)$/.exec(entryDescription || "");
    summary = (ec ? ec[1] : entryDescription || "").trim();
  }
  return { party: party.trim(), summary: summary.replace(/^自動分錄 - /, "") };
}

/** 選到上層科目：一路展開到最底層科目 */
export function expandAccountIds(ids: number[], accounts: BookAccount[]): Set<number> {
  const childrenOf = new Map<number, number[]>();
  for (const a of accounts) if (a.parentAccountId) childrenOf.set(a.parentAccountId, [...(childrenOf.get(a.parentAccountId) ?? []), a.id]);
  const leaf = new Set<number>();
  const expand = (id: number, depth = 0) => {
    const kids = childrenOf.get(id);
    if (kids && kids.length > 0 && depth < 10) kids.forEach(k => expand(k, depth + 1));
    else leaf.add(id);
  };
  ids.forEach(id => expand(id));
  return leaf;
}

/** 分錄攤平成一行一筆（依日期、分錄順序） */
export function flattenLines(entries: BookEntry[], accounts: Map<number, BookAccount>): BookLine[] {
  const out: BookLine[] = [];
  const sorted = [...entries].sort((a, b) => a.entryDate.localeCompare(b.entryDate) || a.id - b.id);
  for (const e of sorted) {
    const ref = ecountReference(e.description) ?? e.entryNumber;
    e.lines.forEach((l, i) => {
      const acc = accounts.get(l.accountId);
      const { party, summary } = splitLineText(l.description, e.description);
      out.push({
        date: e.entryDate, entryId: e.id, reference: ref, seq: i + 1,
        accountId: l.accountId, accountNumber: acc?.accountNumber ?? "", accountName: acc?.accountName ?? `科目 #${l.accountId}`,
        party, summary, debit: l.debit, credit: l.credit, projectId: e.projectId, departmentId: e.departmentId,
      });
    });
  }
  return out;
}

export interface JournalFilter {
  accountIds?: Set<number> | null;
  party?: string;
  summary?: string;
  reference?: string;
  minAmount?: number | null;
  maxAmount?: number | null;
  unbalancedOnly?: boolean;
}

/** 日記簿：照 Ecount 的查詢條件篩選；有篩科目／對象／摘要／金額時，只留符合的行 */
export function journalBook(entries: BookEntry[], accounts: Map<number, BookAccount>, f: JournalFilter) {
  let pool = entries;
  if (f.unbalancedOnly) {
    pool = pool.filter(e => Math.abs(e.lines.reduce((s, l) => s + l.debit - l.credit, 0)) >= 0.005);
  }
  if (f.reference) {
    const r = f.reference.trim();
    pool = pool.filter(e => e.entryNumber.includes(r) || (ecountReference(e.description) ?? "").includes(r));
  }
  const party = f.party?.trim(), summary = f.summary?.trim();
  const rows = flattenLines(pool, accounts).filter(l =>
    (!f.accountIds || f.accountIds.has(l.accountId))
    && (!party || l.party.includes(party))
    && (!summary || l.summary.includes(summary))
    && (f.minAmount == null || Math.max(l.debit, l.credit) >= f.minAmount)
    && (f.maxAmount == null || Math.max(l.debit, l.credit) <= f.maxAmount));
  return {
    rows,
    entryCount: new Set(rows.map(r => r.entryId)).size,
    totalDebit: money(rows.reduce((s, r) => s + r.debit, 0)),
    totalCredit: money(rows.reduce((s, r) => s + r.credit, 0)),
  };
}

/** 日/月合計表：每天（或每月）一段，列出各科目借貸方合計，段尾是日（月）總計 */
export function periodTotals(lines: BookLine[], accounts: Map<number, BookAccount>, mode: "day" | "month") {
  const periods = new Map<string, Map<number, { debit: number; credit: number }>>();
  for (const l of lines) {
    const key = mode === "day" ? l.date : l.date.slice(0, 7);
    const m = periods.get(key) ?? new Map();
    const t = m.get(l.accountId) ?? { debit: 0, credit: 0 };
    t.debit = money(t.debit + l.debit); t.credit = money(t.credit + l.credit);
    m.set(l.accountId, t); periods.set(key, m);
  }
  return [...periods.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([period, m]) => {
    const rows = [...m.entries()].map(([accountId, t]) => {
      const a = accounts.get(accountId);
      return { accountId, accountNumber: a?.accountNumber ?? "", accountName: a?.accountName ?? `科目 #${accountId}`, debit: t.debit, credit: t.credit };
    }).sort(byNumber);
    return { period, rows, totalDebit: money(rows.reduce((s, r) => s + r.debit, 0)), totalCredit: money(rows.reduce((s, r) => s + r.credit, 0)) };
  });
}

export type SubledgerGroup = "account-party" | "party-account" | "account-summary";
export interface SubledgerRow { date: string; entryId: number; reference: string; party: string; summary: string; accountName: string; debit: number; credit: number; balance: number }
export interface SubledgerSection {
  key: string;
  account: { id: number; accountNumber: string; accountName: string; accountType: string };
  party: string;
  summary: string;
  openingBalance: number;
  totalDebit: number;
  totalCredit: number;
  closingBalance: number;
  rows: SubledgerRow[];
}

/**
 * 明細帳：
 * - account-party：科目/客戶/供應商明細帳（先科目、再對象，一組一段）
 * - party-account：客戶/供應商/科目明細帳（先對象、再科目）
 * - account-summary：科目摘要明細帳（先科目、再摘要）
 * 期初＝起始日前的分錄；科目開帳餘額沒有對象，算在「（無客戶/供應商）」那段。
 * 收入、費用科目的結轉只從起始日那年 1/1 算起（跟 Ecount 一樣每年歸零）。
 */
export function subledger(
  entries: BookEntry[],
  accounts: Map<number, BookAccount>,
  opts: { group: SubledgerGroup; accountIds: Set<number> | null; startDate?: string; party?: string; summary?: string; includeStaticBalance: boolean; hideEmpty: boolean },
): SubledgerSection[] {
  const sections = new Map<string, SubledgerSection>();
  const keyOf = (accountId: number, party: string, summary: string) =>
    opts.group === "account-summary" ? `${accountId}\u0000${summary}` : `${accountId}\u0000${party}`;
  const get = (accountId: number, party: string, summary: string) => {
    const k = keyOf(accountId, party, summary);
    let s = sections.get(k);
    if (!s) {
      const a = accounts.get(accountId);
      s = {
        key: k,
        account: { id: accountId, accountNumber: a?.accountNumber ?? "", accountName: a?.accountName ?? `科目 #${accountId}`, accountType: a?.accountType ?? "Asset" },
        party: opts.group === "account-summary" ? "" : party, summary: opts.group === "account-summary" ? summary : "",
        openingBalance: 0, totalDebit: 0, totalCredit: 0, closingBalance: 0, rows: [],
      };
      sections.set(k, s);
    }
    return s;
  };
  const partyQ = opts.party?.trim(), summaryQ = opts.summary?.trim();
  const wanted = (accountId: number, party: string, summary: string) =>
    (!opts.accountIds || opts.accountIds.has(accountId)) && (!partyQ || party.includes(partyQ)) && (!summaryQ || summary.includes(summaryQ));

  if (opts.includeStaticBalance) {
    for (const a of accounts.values()) {
      if (a.isGroup || a.accountType === "Income" || a.accountType === "Expense" || Math.abs(a.balance) < 0.005 || !wanted(a.id, "", "")) continue;
      const s = get(a.id, "", "");
      s.openingBalance = money(s.openingBalance + a.balance);
    }
  }
  for (const l of flattenLines(entries, accounts)) {
    if (!wanted(l.accountId, l.party, l.summary)) continue;
    const s = get(l.accountId, l.party, l.summary);
    const delta = isDebitNature(s.account.accountType) ? l.debit - l.credit : l.credit - l.debit;
    if (opts.startDate && l.date < opts.startDate) {
      if ((s.account.accountType === "Income" || s.account.accountType === "Expense") && l.date < `${opts.startDate.slice(0, 4)}-01-01`) {
        if (s.rows.length === 0 && Math.abs(s.openingBalance) < 0.005) sections.delete(s.key);
        continue;
      }
      s.openingBalance = money(s.openingBalance + delta); continue; }
    s.totalDebit = money(s.totalDebit + l.debit);
    s.totalCredit = money(s.totalCredit + l.credit);
    s.rows.push({ date: l.date, entryId: l.entryId, reference: l.reference, party: l.party, summary: l.summary, accountName: l.accountName, debit: l.debit, credit: l.credit, balance: 0 });
  }
  const out: SubledgerSection[] = [];
  for (const s of sections.values()) {
    let bal = s.openingBalance;
    const natural = isDebitNature(s.account.accountType);
    for (const r of s.rows) { bal = money(bal + (natural ? r.debit - r.credit : r.credit - r.debit)); r.balance = bal; }
    s.closingBalance = bal;
    if (opts.hideEmpty && s.rows.length === 0) continue;
    if (s.rows.length === 0 && Math.abs(s.openingBalance) < 0.005) continue;
    out.push(s);
  }
  const cmpText = (a: string, b: string) => (a === "" ? 1 : 0) - (b === "" ? 1 : 0) || a.localeCompare(b, "zh-Hant");
  out.sort((a, b) => opts.group === "party-account"
    ? cmpText(a.party, b.party) || byNumber(a.account, b.account)
    : byNumber(a.account, b.account) || (opts.group === "account-summary" ? cmpText(a.summary, b.summary) : cmpText(a.party, b.party)));
  return out;
}

/**
 * 現金出納帳：現金（含存款時加上銀行存款）科目的進出，對應科目是同一張分錄另一邊的科目。
 * 同一張分錄裡現金科目之間互轉（例如提款）不列。
 */
export function cashBook(entries: BookEntry[], accounts: Map<number, BookAccount>, cashIds: Set<number>, startDate?: string, includeStaticBalance = true) {
  let opening = 0;
  if (includeStaticBalance) for (const id of cashIds) opening = money(opening + (accounts.get(id)?.balance ?? 0));
  const rows: { date: string; entryId: number; reference: string; cashAccount: string; counterAccount: string; party: string; summary: string; debit: number; credit: number; balance: number }[] = [];
  const sorted = [...entries].sort((a, b) => a.entryDate.localeCompare(b.entryDate) || a.id - b.id);
  for (const e of sorted) {
    const cashLines = e.lines.filter(l => cashIds.has(l.accountId));
    if (cashLines.length === 0) continue;
    const others = e.lines.filter(l => !cashIds.has(l.accountId));
    if (others.length === 0) continue; // 現金科目互轉
    const before = Boolean(startDate) && e.entryDate < startDate!;
    for (const c of cashLines) {
      const net = c.debit - c.credit;
      if (before) { opening = money(opening + net); continue; }
      // 對應科目：跟這筆現金方向相反的那一邊；多個就用第一個並加「等」
      const opposite = others.filter(o => (net >= 0 ? o.credit > 0 : o.debit > 0));
      const pick = opposite.length > 0 ? opposite : others;
      const counter = accounts.get(pick[0].accountId)?.accountName ?? "";
      const { party, summary } = splitLineText(pick[0].description || c.description, e.description);
      rows.push({
        date: e.entryDate, entryId: e.id, reference: ecountReference(e.description) ?? e.entryNumber,
        cashAccount: accounts.get(c.accountId)?.accountName ?? "", counterAccount: pick.length > 1 ? `${counter} 等` : counter,
        party, summary, debit: c.debit, credit: c.credit, balance: 0,
      });
    }
  }
  let bal = opening;
  for (const r of rows) { bal = money(bal + r.debit - r.credit); r.balance = bal; }
  return {
    openingBalance: opening, rows,
    totalDebit: money(rows.reduce((s, r) => s + r.debit, 0)),
    totalCredit: money(rows.reduce((s, r) => s + r.credit, 0)),
    closingBalance: bal,
  };
}

export interface TrialRow {
  accountId: number;
  accountNumber: string;
  accountName: string;
  accountType: string;
  depth: number;
  isGroup: boolean;
  /** 期末金額：結轉金額＋本期發生額（照 Ecount 餘額試算表的「累計」格式） */
  debitAmount: number;
  creditAmount: number;
  /** 期末餘額 */
  debitBalance: number;
  creditBalance: number;
}

/**
 * 餘額試算表（Ecount「預設格式(累計)」）：
 * - 資產負債科目的結轉金額＝起始日前全部累計；損益科目只從起始日那年 1/1 起算（每年歸零）。
 * - 結轉金額放在它的餘額那一邊，再加上本期借貸發生額，就是「期末金額」；兩邊相減是「期末餘額」。
 * - 上層科目一列，金額是底下所有科目的合計。
 */
export function trialBalance(entries: BookEntry[], accounts: BookAccount[], opts: { startDate: string; endDate?: string; includeStaticBalance: boolean; hideZero: boolean }) {
  const yearStart = `${opts.startDate.slice(0, 4)}-01-01`;
  const t = new Map<number, { open: number; dr: number; cr: number }>();
  const get = (id: number) => { let x = t.get(id); if (!x) { x = { open: 0, dr: 0, cr: 0 }; t.set(id, x); } return x; };
  const byId = new Map(accounts.map(a => [a.id, a]));
  const isPL = (a: BookAccount | undefined) => a?.accountType === "Income" || a?.accountType === "Expense";
  if (opts.includeStaticBalance) for (const a of accounts) if (!a.isGroup && a.balance) get(a.id).open += a.balance;
  // ERP 沒有年底結帳分錄：以前年度的損益要滾進權益，試算表才會平（Ecount 是滾進未分配盈餘）
  let priorProfit = 0;
  for (const e of entries) {
    if (opts.endDate && e.entryDate > opts.endDate) continue;
    for (const l of e.lines) {
      const a = byId.get(l.accountId);
      const x = get(l.accountId);
      if (e.entryDate >= opts.startDate) { x.dr += l.debit; x.cr += l.credit; continue; }
      if (isPL(a) && e.entryDate < yearStart) { priorProfit += l.credit - l.debit; continue; }
      x.open += isDebitNature(a?.accountType ?? "Asset") ? l.debit - l.credit : l.credit - l.debit;
    }
  }
  const leafRow = (a: BookAccount, depth: number): TrialRow => {
    const x = t.get(a.id) ?? { open: 0, dr: 0, cr: 0 };
    const debitNature = isDebitNature(a.accountType);
    const debitAmount = money(x.dr + (debitNature ? x.open : 0));
    const creditAmount = money(x.cr + (debitNature ? 0 : x.open));
    const net = money(debitAmount - creditAmount);
    return {
      accountId: a.id, accountNumber: a.accountNumber, accountName: a.accountName, accountType: a.accountType, depth, isGroup: false,
      debitAmount, creditAmount, debitBalance: debitNature ? net : 0, creditBalance: debitNature ? 0 : -net,
    };
  };
  const childrenOf = new Map<number | null, BookAccount[]>();
  for (const a of accounts) {
    const p = a.parentAccountId && byId.has(a.parentAccountId) ? a.parentAccountId : null;
    childrenOf.set(p, [...(childrenOf.get(p) ?? []), a]);
  }
  childrenOf.forEach(list => list.sort(byNumber));
  const rows: TrialRow[] = [];
  const walk = (a: BookAccount, depth: number, guard = 0): TrialRow | null => {
    const kids = childrenOf.get(a.id) ?? [];
    if (!a.isGroup && kids.length === 0) {
      const r = leafRow(a, depth);
      if (opts.hideZero && !r.debitAmount && !r.creditAmount) return null;
      rows.push(r);
      return r;
    }
    const at = rows.length;
    const sum: TrialRow = { accountId: a.id, accountNumber: a.accountNumber, accountName: a.accountName, accountType: a.accountType, depth, isGroup: true, debitAmount: 0, creditAmount: 0, debitBalance: 0, creditBalance: 0 };
    rows.push(sum);
    if (!a.isGroup) { // 有下層又自己有分錄的科目：自己算一列
      const own = leafRow(a, depth + 1);
      if (!opts.hideZero || own.debitAmount || own.creditAmount) { rows.push({ ...own, accountName: `${own.accountName}（本科目）` }); addTo(sum, own); }
    }
    for (const k of kids) { if (guard > 10) break; const r = walk(k, depth + 1, guard + 1); if (r) addTo(sum, r); }
    if (opts.hideZero && !sum.debitAmount && !sum.creditAmount) { rows.splice(at, 1); return null; }
    return sum;
  };
  const addTo = (s: TrialRow, r: TrialRow) => {
    s.debitAmount = money(s.debitAmount + r.debitAmount); s.creditAmount = money(s.creditAmount + r.creditAmount);
    s.debitBalance = money(s.debitBalance + r.debitBalance); s.creditBalance = money(s.creditBalance + r.creditBalance);
  };
  const total = { debitAmount: 0, creditAmount: 0, debitBalance: 0, creditBalance: 0 };
  const prior: TrialRow | null = Math.abs(priorProfit) >= 0.005 ? {
    accountId: 0, accountNumber: "", accountName: `以前年度損益（${yearStart.slice(0, 4)} 年以前，尚未結帳）`, accountType: "Equity", depth: 1, isGroup: false,
    debitAmount: priorProfit < 0 ? money(-priorProfit) : 0, creditAmount: priorProfit > 0 ? money(priorProfit) : 0, debitBalance: 0, creditBalance: money(priorProfit),
  } : null;
  let priorPlaced = false;
  for (const a of childrenOf.get(null) ?? []) {
    const r = walk(a, 0);
    if (prior && !priorPlaced && a.accountType === "Equity" && r) {
      rows.push(prior); addTo(r, prior); priorPlaced = true;
    }
    if (r) { total.debitAmount = money(total.debitAmount + r.debitAmount); total.creditAmount = money(total.creditAmount + r.creditAmount); total.debitBalance = money(total.debitBalance + r.debitBalance); total.creditBalance = money(total.creditBalance + r.creditBalance); }
  }
  if (prior && !priorPlaced) { rows.push({ ...prior, depth: 0 }); }
  if (prior) {
    if (!priorPlaced) { total.debitAmount = money(total.debitAmount + prior.debitAmount); total.creditAmount = money(total.creditAmount + prior.creditAmount); }
    total.creditBalance = money(total.creditBalance + (priorPlaced ? 0 : prior.creditBalance));
  }
  return { rows, total };
}
