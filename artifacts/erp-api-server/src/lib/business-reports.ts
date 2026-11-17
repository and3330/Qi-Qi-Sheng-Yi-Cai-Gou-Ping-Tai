/**
 * Ecount「會計 > 報表 > 經營資料」與部分帳簿（科目增減紀錄、進項/銷項帳簿、應收/應付餘額分析表）。
 * 純計算；讀資料庫在 routes/reports-books.ts。資料來源一律是已過帳分錄，分錄行說明是「對象｜摘要」。
 */
import { ecountReference, flattenLines, isDebitNature, money, splitLineText, type BookAccount, type BookEntry, type BookLine } from "./account-books";

type AccMap = Map<number, BookAccount>;
const acctLabel = (a: BookAccount | undefined, id: number) => a?.accountName ?? `科目 #${id}`;
const sortText = (a: string, b: string) => (a === "" ? 1 : 0) - (b === "" ? 1 : 0) || a.localeCompare(b, "zh-Hant");
const byNumber = (a: { accountNumber: string }, b: { accountNumber: string }) =>
  String(a.accountNumber).localeCompare(String(b.accountNumber), "zh-Hant", { numeric: true });
const sorted = (entries: BookEntry[]) => [...entries].sort((a, b) => a.entryDate.localeCompare(b.entryDate) || a.id - b.id);

/** 預設的「資金」科目：庫存現金、銀行存款、電子支付等 111x */
export const isFundAccount = (a: BookAccount) => !a.isGroup && /^111/.test(a.accountNumber);
/** 應收帳款 1141、應付帳款 2141（含底下子科目） */
export const isReceivable = (a: BookAccount) => !a.isGroup && /^114[1-2]/.test(a.accountNumber);
export const isPayable = (a: BookAccount) => !a.isGroup && /^214[1-2]/.test(a.accountNumber);
const isSalesTax = (a?: BookAccount) => !!a && (/銷項稅額/.test(a.accountName) || /^2281/.test(a.accountNumber));
const isInputTax = (a?: BookAccount) => !!a && (/進項稅額/.test(a.accountName) || /^1281/.test(a.accountNumber));
const isFee = (a?: BookAccount) => !!a && /手續費/.test(a.accountName);

// ─────────────────────────── 資金情況（資金日報表／資金情況表） ───────────────────────────

export interface FundPartyRow { party: string; opening: number; increase: number; decrease: number; closing: number }
export interface FundAccountRow { accountId: number; accountNumber: string; accountName: string; opening: number; increase: number; decrease: number; closing: number; parties: FundPartyRow[] }

/**
 * 每個科目：結轉、增加、減少、餘額（照科目餘額方向：資產借方增加，負債貸方增加），再拆到客戶/供應商。
 * 起始日前的分錄算結轉。
 */
export function fundStatus(entries: BookEntry[], accounts: AccMap, ids: Set<number>, startDate: string, includeStaticBalance: boolean): { rows: FundAccountRow[]; total: Omit<FundPartyRow, "party"> } {
  const acc = new Map<number, FundAccountRow & { partyMap: Map<string, FundPartyRow> }>();
  const get = (id: number) => {
    let r = acc.get(id);
    if (!r) {
      const a = accounts.get(id);
      r = { accountId: id, accountNumber: a?.accountNumber ?? "", accountName: acctLabel(a, id), opening: 0, increase: 0, decrease: 0, closing: 0, parties: [], partyMap: new Map() };
      acc.set(id, r);
    }
    return r;
  };
  const party = (r: FundAccountRow & { partyMap: Map<string, FundPartyRow> }, p: string) => {
    let x = r.partyMap.get(p);
    if (!x) { x = { party: p, opening: 0, increase: 0, decrease: 0, closing: 0 }; r.partyMap.set(p, x); }
    return x;
  };
  if (includeStaticBalance) {
    for (const id of ids) {
      const a = accounts.get(id);
      if (a && a.balance) { const r = get(id); r.opening = money(r.opening + a.balance); const x = party(r, ""); x.opening = money(x.opening + a.balance); }
    }
  }
  for (const l of flattenLines(entries, accounts)) {
    if (!ids.has(l.accountId)) continue;
    const a = accounts.get(l.accountId);
    const natural = isDebitNature(a?.accountType ?? "Asset");
    const inc = natural ? l.debit : l.credit;
    const dec = natural ? l.credit : l.debit;
    const r = get(l.accountId);
    const x = party(r, l.party);
    if (l.date < startDate) {
      r.opening = money(r.opening + inc - dec); x.opening = money(x.opening + inc - dec);
    } else {
      r.increase = money(r.increase + inc); r.decrease = money(r.decrease + dec);
      x.increase = money(x.increase + inc); x.decrease = money(x.decrease + dec);
    }
  }
  const rows: FundAccountRow[] = [];
  for (const r of acc.values()) {
    r.closing = money(r.opening + r.increase - r.decrease);
    const parties = [...r.partyMap.values()].map(x => ({ ...x, closing: money(x.opening + x.increase - x.decrease) }))
      .filter(x => Math.abs(x.opening) >= 0.005 || x.increase || x.decrease)
      .sort((a, b) => sortText(a.party, b.party));
    if (Math.abs(r.opening) < 0.005 && !r.increase && !r.decrease) continue;
    const { partyMap: _drop, ...rest } = r;
    rows.push({ ...rest, parties });
  }
  rows.sort(byNumber);
  const total = rows.reduce((t, r) => ({ opening: money(t.opening + r.opening), increase: money(t.increase + r.increase), decrease: money(t.decrease + r.decrease), closing: money(t.closing + r.closing) }), { opening: 0, increase: 0, decrease: 0, closing: 0 });
  return { rows, total };
}

export interface FundMoveRow { date: string; entryId: number; reference: string; counterAccount: string; party: string; summary: string; amount: number }

/**
 * 資金的增加／減少明細：資金科目借方＝增加、貸方＝減少；對應科目是同一張分錄另一邊的每一行。
 * 一張分錄裡資金科目互轉（例如提款）不列。
 */
export function fundMovements(entries: BookEntry[], accounts: AccMap, fundIds: Set<number>, startDate: string, endDate?: string) {
  const increase: FundMoveRow[] = [];
  const decrease: FundMoveRow[] = [];
  for (const e of sorted(entries)) {
    if (e.entryDate < startDate || (endDate && e.entryDate > endDate)) continue;
    const fund = e.lines.filter(l => fundIds.has(l.accountId));
    if (fund.length === 0) continue;
    const net = fund.reduce((s, l) => s + l.debit - l.credit, 0);
    if (Math.abs(net) < 0.005) continue;
    const ref = ecountReference(e.description) ?? e.entryNumber;
    // 資金增加：列出對方貸方行；資金減少：列出對方借方行。
    // 跟資金同一邊的其他行（例如收款時扣的匯費）不列成負數，改從最大的一筆扣掉，讓合計等於資金實際增減。
    const rows: FundMoveRow[] = [];
    let sameSide = 0;
    for (const l of e.lines) {
      if (fundIds.has(l.accountId)) continue;
      const amount = net > 0 ? l.credit - l.debit : l.debit - l.credit;
      if (Math.abs(amount) < 0.005) continue;
      if (amount < 0) { sameSide += -amount; continue; }
      const { party, summary } = splitLineText(l.description, e.description);
      rows.push({ date: e.entryDate, entryId: e.id, reference: ref, counterAccount: acctLabel(accounts.get(l.accountId), l.accountId), party, summary, amount: money(amount) });
    }
    for (const r of [...rows].sort((a, b) => b.amount - a.amount)) {
      if (sameSide < 0.005) break;
      const take = Math.min(r.amount, sameSide);
      r.amount = money(r.amount - take);
      sameSide -= take;
    }
    (net > 0 ? increase : decrease).push(...rows.filter(r => r.amount >= 0.005));
  }
  return {
    increase, decrease,
    totalIncrease: money(increase.reduce((s, r) => s + r.amount, 0)),
    totalDecrease: money(decrease.reduce((s, r) => s + r.amount, 0)),
  };
}

/** 某科目在期間的增加／減少明細（應收帳款的增加、應付帳款的減少……） */
export function accountMovements(lines: BookLine[], accounts: AccMap, ids: Set<number>, startDate: string, endDate?: string) {
  const increase: { date: string; reference: string; party: string; summary: string; amount: number }[] = [];
  const decrease: typeof increase = [];
  for (const l of lines) {
    if (!ids.has(l.accountId) || l.date < startDate || (endDate && l.date > endDate)) continue;
    const natural = isDebitNature(accounts.get(l.accountId)?.accountType ?? "Asset");
    const inc = natural ? l.debit : l.credit, dec = natural ? l.credit : l.debit;
    if (inc) increase.push({ date: l.date, reference: l.reference, party: l.party, summary: l.summary, amount: inc });
    if (dec) decrease.push({ date: l.date, reference: l.reference, party: l.party, summary: l.summary, amount: dec });
  }
  return { increase, decrease, totalIncrease: money(increase.reduce((s, r) => s + r.amount, 0)), totalDecrease: money(decrease.reduce((s, r) => s + r.amount, 0)) };
}

/** 現金流動(收付款明細)：期初資金、依對應科目合計的增加與減少、期末資金 */
export function cashFlowSummary(entries: BookEntry[], accounts: AccMap, fundIds: Set<number>, startDate: string, endDate: string, includeStaticBalance: boolean) {
  let opening = 0;
  if (includeStaticBalance) for (const id of fundIds) opening += accounts.get(id)?.balance ?? 0;
  for (const e of entries) {
    if (e.entryDate >= startDate) continue;
    for (const l of e.lines) if (fundIds.has(l.accountId)) opening += l.debit - l.credit;
  }
  const mv = fundMovements(entries, accounts, fundIds, startDate, endDate);
  const group = (rows: FundMoveRow[]) => {
    const m = new Map<string, number>();
    for (const r of rows) m.set(r.counterAccount, money((m.get(r.counterAccount) ?? 0) + r.amount));
    return [...m.entries()].map(([account, amount]) => ({ account, amount }));
  };
  const increase = group(mv.increase), decrease = group(mv.decrease);
  return { opening: money(opening), increase, decrease, totalIncrease: mv.totalIncrease, totalDecrease: mv.totalDecrease, closing: money(opening + mv.totalIncrease - mv.totalDecrease) };
}

// ─────────────────────────── 月損益報表 ───────────────────────────

export interface MonthlyPLRow { accountId: number; accountNumber: string; accountName: string; accountType: string; depth: number; isGroup: boolean; months: number[]; total: number }

/** 收入、費用科目按月一欄，最後一欄合計；上層科目一列小計。收入以貸方為正、費用以借方為正。 */
export function monthlyProfitLoss(entries: BookEntry[], accountList: BookAccount[], startDate: string, endDate: string) {
  const months: string[] = [];
  for (let d = new Date(`${startDate.slice(0, 7)}-01T00:00:00Z`); d.toISOString().slice(0, 7) <= endDate.slice(0, 7); d.setUTCMonth(d.getUTCMonth() + 1)) months.push(d.toISOString().slice(0, 7));
  const idx = new Map(months.map((m, i) => [m, i]));
  const byId = new Map(accountList.map(a => [a.id, a]));
  const amt = new Map<number, number[]>();
  for (const e of entries) {
    if (e.entryDate < startDate || e.entryDate > endDate) continue;
    const i = idx.get(e.entryDate.slice(0, 7));
    if (i === undefined) continue;
    for (const l of e.lines) {
      const a = byId.get(l.accountId);
      if (!a || (a.accountType !== "Income" && a.accountType !== "Expense")) continue;
      const v = amt.get(a.id) ?? months.map(() => 0);
      v[i] = money(v[i] + (a.accountType === "Income" ? l.credit - l.debit : l.debit - l.credit));
      amt.set(a.id, v);
    }
  }
  const childrenOf = new Map<number | null, BookAccount[]>();
  for (const a of accountList) {
    if (a.accountType !== "Income" && a.accountType !== "Expense") continue;
    const p = a.parentAccountId && byId.get(a.parentAccountId)?.accountType === a.accountType ? a.parentAccountId : null;
    childrenOf.set(p, [...(childrenOf.get(p) ?? []), a]);
  }
  childrenOf.forEach(l => l.sort(byNumber));
  const rows: MonthlyPLRow[] = [];
  const walk = (a: BookAccount, depth: number, guard = 0): number[] | null => {
    const kids = childrenOf.get(a.id) ?? [];
    const own = amt.get(a.id);
    if (kids.length === 0) {
      if (!own || own.every(v => !v)) return null;
      rows.push({ accountId: a.id, accountNumber: a.accountNumber, accountName: a.accountName, accountType: a.accountType, depth, isGroup: false, months: own, total: money(own.reduce((s, v) => s + v, 0)) });
      return own;
    }
    const at = rows.length;
    const head: MonthlyPLRow = { accountId: a.id, accountNumber: a.accountNumber, accountName: a.accountName, accountType: a.accountType, depth, isGroup: true, months: months.map(() => 0), total: 0 };
    rows.push(head);
    const add = (v: number[]) => { head.months = head.months.map((x, i) => money(x + v[i])); };
    if (own && own.some(v => v)) { rows.push({ ...head, depth: depth + 1, isGroup: false, accountName: `${a.accountName}（本科目）`, months: own, total: money(own.reduce((s, v) => s + v, 0)) }); add(own); }
    for (const k of kids) { if (guard > 10) break; const v = walk(k, depth + 1, guard + 1); if (v) add(v); }
    if (head.months.every(v => !v)) { rows.splice(at); return null; }
    head.total = money(head.months.reduce((s, v) => s + v, 0));
    return head.months;
  };
  const income = months.map(() => 0), expense = months.map(() => 0);
  for (const a of childrenOf.get(null) ?? []) {
    const v = walk(a, 0);
    if (v) v.forEach((x, i) => { if (a.accountType === "Income") income[i] = money(income[i] + x); else expense[i] = money(expense[i] + x); });
  }
  const net = months.map((_, i) => money(income[i] - expense[i]));
  const sum = (v: number[]) => money(v.reduce((s, x) => s + x, 0));
  return { months, rows, income: { months: income, total: sum(income) }, expense: { months: expense, total: sum(expense) }, net: { months: net, total: sum(net) } };
}

// ─────────────────────────── 會計合計表 ───────────────────────────

export type SumKey = "account" | "party" | "department" | "project" | "month";
export interface SumRow { key1: string; key2: string; opening: number; debit: number; credit: number; amount: number }

/**
 * 會計合計表：依合計條件（科目、客戶/供應商、部門、專案、月份）最多兩層合計借貸。
 * 依科目合計時有結轉餘額，金額＝科目方向的期末餘額；其他條件金額＝借方−貸方。
 */
export function accountingSummary(
  lines: BookLine[], accounts: AccMap, opts: { startDate: string; key1: SumKey; key2?: SumKey | null; dimName: (projectId: number | null, departmentId: number | null) => { project: string | null; department: string | null } },
): { rows: SumRow[]; total: Omit<SumRow, "key1" | "key2"> } {
  const label = (k: SumKey, l: BookLine) => {
    if (k === "account") return `[${l.accountNumber}] ${l.accountName}`;
    if (k === "party") return l.party;
    if (k === "month") return l.date.slice(0, 7).replace("-", "/");
    const d = opts.dimName(l.projectId, l.departmentId);
    return (k === "project" ? d.project : d.department) ?? "";
  };
  const withOpening = opts.key1 === "account" && !opts.key2;
  const m = new Map<string, SumRow & { natural: boolean }>();
  for (const l of lines) {
    const before = l.date < opts.startDate;
    if (before && !withOpening) continue;
    const type = accounts.get(l.accountId)?.accountType;
    // 收入、費用科目每年 1/1 歸零
    if (before && (type === "Income" || type === "Expense") && l.date < `${opts.startDate.slice(0, 4)}-01-01`) continue;
    const k1 = label(opts.key1, l), k2 = opts.key2 ? label(opts.key2, l) : "";
    const key = `${k1}\u0000${k2}`;
    let r = m.get(key);
    const natural = opts.key1 === "account" ? isDebitNature(accounts.get(l.accountId)?.accountType ?? "Asset") : true;
    if (!r) { r = { key1: k1, key2: k2, opening: 0, debit: 0, credit: 0, amount: 0, natural }; m.set(key, r); }
    if (before) r.opening = money(r.opening + (natural ? l.debit - l.credit : l.credit - l.debit));
    else { r.debit = money(r.debit + l.debit); r.credit = money(r.credit + l.credit); }
  }
  const rows = [...m.values()].map(({ natural, ...r }) => ({
    ...r, amount: money(withOpening ? r.opening + (natural ? r.debit - r.credit : r.credit - r.debit) : r.debit - r.credit),
  })).filter(r => r.debit || r.credit || Math.abs(r.opening) >= 0.005);
  const cmp = (k: SumKey | null | undefined, a: string, b: string) =>
    k === "account" ? String(a).localeCompare(String(b), "zh-Hant", { numeric: true }) : sortText(a, b);
  rows.sort((a, b) => cmp(opts.key1, a.key1, b.key1) || cmp(opts.key2, a.key2, b.key2));
  const total = rows.reduce((t, r) => ({ opening: money(t.opening + r.opening), debit: money(t.debit + r.debit), credit: money(t.credit + r.credit), amount: money(t.amount + r.amount) }), { opening: 0, debit: 0, credit: 0, amount: 0 });
  return { rows, total };
}

// ─────────────────────────── 月進項／月銷項合計表 ───────────────────────────

/**
 * 月銷項合計表：每張分錄的收入貸方＋銷項稅額（含稅銷售額），依客戶、按月。
 * 月進項合計表：應付帳款貸方（進貨、費用請款的含稅金額），依供應商、按月。
 */
export function monthlyPartyTotals(entries: BookEntry[], accounts: AccMap, kind: "sales" | "purchase", startDate: string, endDate: string) {
  const months = new Set<string>();
  const m = new Map<string, Map<string, number>>();
  for (const e of entries) {
    if (e.entryDate < startDate || e.entryDate > endDate) continue;
    const month = e.entryDate.slice(0, 7);
    for (const l of e.lines) {
      const a = accounts.get(l.accountId);
      let v = 0;
      if (kind === "sales" && a && (a.accountType === "Income" && /^4/.test(a.accountNumber) || isSalesTax(a))) v = l.credit - l.debit;
      if (kind === "purchase" && a && isPayable(a)) v = l.credit; // 只算新增的應付，付款不扣
      if (!v) continue;
      const { party } = splitLineText(l.description, e.description);
      months.add(month);
      const pm = m.get(party) ?? new Map<string, number>();
      pm.set(month, money((pm.get(month) ?? 0) + v));
      m.set(party, pm);
    }
  }
  const ms = [...months].sort();
  const rows = [...m.entries()].map(([party, pm]) => {
    const values = ms.map(x => pm.get(x) ?? 0);
    return { party, months: values, total: money(values.reduce((s, v) => s + v, 0)) };
  }).filter(r => r.total || r.months.some(v => v)).sort((a, b) => sortText(a.party, b.party));
  const totals = ms.map((_, i) => money(rows.reduce((s, r) => s + r.months[i], 0)));
  return { months: ms, rows, totals, total: money(totals.reduce((s, v) => s + v, 0)) };
}

// ─────────────────────────── 收款單／付款單／暫付款單合計 ───────────────────────────

export interface VoucherRow { date: string; entryId: number; reference: string; fundAccount: string; account: string; party: string; summary: string; amount: number; fee: number; tax: number; department: string | null; project: string | null }

/**
 * 收款單合計：資金科目借方的分錄，每一個對方貸方行一列。
 * 付款單合計：資金科目貸方的分錄，每一個對方借方行一列；手續費科目另放「手續費」欄。
 * 暫付款單合計：借記暫付款（科目名稱含「暫付」）的分錄。
 */
export function voucherTotals(
  entries: BookEntry[], accounts: AccMap, kind: "receipt" | "payment" | "advance", fundIds: Set<number>, startDate: string, endDate: string,
  dimName: (projectId: number | null, departmentId: number | null) => { project: string | null; department: string | null },
): VoucherRow[] {
  const rows: VoucherRow[] = [];
  const isAdvance = (a?: BookAccount) => !!a && /暫付/.test(a.accountName);
  for (const e of sorted(entries)) {
    if (e.entryDate < startDate || e.entryDate > endDate) continue;
    const ref = ecountReference(e.description) ?? e.entryNumber;
    const dims = dimName(e.projectId, e.departmentId);
    if (kind === "advance") {
      for (const l of e.lines) {
        if (!isAdvance(accounts.get(l.accountId)) || l.debit <= 0) continue;
        const { party, summary } = splitLineText(l.description, e.description);
        const fundLine = e.lines.find(x => fundIds.has(x.accountId) && x.credit > 0);
        rows.push({ date: e.entryDate, entryId: e.id, reference: ref, fundAccount: fundLine ? acctLabel(accounts.get(fundLine.accountId), fundLine.accountId) : "", account: acctLabel(accounts.get(l.accountId), l.accountId), party, summary, amount: l.debit, fee: 0, tax: 0, ...dims });
      }
      continue;
    }
    const fund = e.lines.filter(l => fundIds.has(l.accountId));
    if (fund.length === 0) continue;
    const net = fund.reduce((s, l) => s + l.debit - l.credit, 0);
    if (kind === "receipt" ? net <= 0.005 : net >= -0.005) continue;
    const fundLine = fund.find(l => (kind === "receipt" ? l.debit > 0 : l.credit > 0)) ?? fund[0];
    const fundParty = splitLineText(fundLine.description, e.description).party;
    const fundName = fundParty || acctLabel(accounts.get(fundLine.accountId), fundLine.accountId);
    const others = e.lines.filter(l => !fundIds.has(l.accountId));
    const fee = money(others.filter(l => isFee(accounts.get(l.accountId))).reduce((s, l) => s + (kind === "payment" ? l.debit - l.credit : l.debit - l.credit), 0));
    const tax = money(others.filter(l => isInputTax(accounts.get(l.accountId)) || isSalesTax(accounts.get(l.accountId))).reduce((s, l) => s + Math.abs(l.debit - l.credit), 0));
    let feeAssigned = false;
    for (const l of others) {
      const a = accounts.get(l.accountId);
      if (isFee(a) || isInputTax(a) || isSalesTax(a)) continue;
      const amount = kind === "receipt" ? l.credit - l.debit : l.debit - l.credit;
      if (Math.abs(amount) < 0.005) continue;
      const { party, summary } = splitLineText(l.description, e.description);
      rows.push({ date: e.entryDate, entryId: e.id, reference: ref, fundAccount: fundName, account: acctLabel(a, l.accountId), party, summary, amount: money(amount), fee: feeAssigned ? 0 : fee, tax: feeAssigned ? 0 : tax, ...dims });
      feeAssigned = true;
    }
  }
  return rows;
}

// ─────────────────────────── 進項/銷項帳簿 ───────────────────────────

export interface VatRow { date: string; entryId: number; reference: string; kind: "sales" | "purchase"; invoiceNumber: string; party: string; detail: string; net: number; tax: number }

/**
 * 進項/銷項帳簿：有銷項稅額（貸方）的分錄是銷項，有進項稅額（借方）的是進項。
 * 稅前金額：銷項＝收入貸方；進項＝同一張分錄裡除了稅額、資金、應付以外的借方。
 * 發票號碼：Ecount 搬來的用歷史「進項銷項明細」對單號；新系統開的發票用發票資料。
 */
export function vatBook(entries: BookEntry[], accounts: AccMap, kind: "sales" | "purchase" | "all", startDate: string, endDate: string, invoiceOf: (entry: BookEntry, ref: string) => string): VatRow[] {
  const rows: VatRow[] = [];
  for (const e of sorted(entries)) {
    if (e.entryDate < startDate || e.entryDate > endDate) continue;
    const ref = ecountReference(e.description) ?? e.entryNumber;
    const salesTax = e.lines.filter(l => isSalesTax(accounts.get(l.accountId)));
    const inputTax = e.lines.filter(l => isInputTax(accounts.get(l.accountId)));
    const head = (lines: typeof e.lines) => splitLineText(lines[0]?.description, e.description);
    if (kind !== "purchase" && salesTax.length) {
      const tax = money(salesTax.reduce((s, l) => s + l.credit - l.debit, 0));
      const income = e.lines.filter(l => accounts.get(l.accountId)?.accountType === "Income");
      const net = money(income.reduce((s, l) => s + l.credit - l.debit, 0));
      if (tax || net) {
        const { party, summary } = head(income.length ? income : salesTax);
        rows.push({ date: e.entryDate, entryId: e.id, reference: ref, kind: "sales", invoiceNumber: invoiceOf(e, ref), party, detail: summary, net, tax });
      }
    }
    if (kind !== "sales" && inputTax.length) {
      const tax = money(inputTax.reduce((s, l) => s + l.debit - l.credit, 0));
      const base = e.lines.filter(l => {
        const a = accounts.get(l.accountId);
        return !isInputTax(a) && !(a && (isFundAccount(a) || isPayable(a))) && l.debit > 0;
      });
      const net = money(base.reduce((s, l) => s + l.debit - l.credit, 0));
      if (tax || net) {
        const { party, summary } = head(base.length ? base : inputTax);
        rows.push({ date: e.entryDate, entryId: e.id, reference: ref, kind: "purchase", invoiceNumber: invoiceOf(e, ref), party, detail: summary, net, tax });
      }
    }
  }
  return rows;
}

// ─────────────────────────── 科目增減紀錄 ───────────────────────────

/** 科目增減紀錄：每個科目、每一天的結轉、增加、減少、餘額（照科目餘額方向） */
export function accountDailyChanges(lines: BookLine[], accounts: AccMap, ids: Set<number>, startDate: string, includeStaticBalance: boolean) {
  const sections = new Map<number, { accountId: number; accountNumber: string; accountName: string; opening: number; days: Map<string, { increase: number; decrease: number }> }>();
  const get = (id: number) => {
    let s = sections.get(id);
    if (!s) { const a = accounts.get(id); s = { accountId: id, accountNumber: a?.accountNumber ?? "", accountName: acctLabel(a, id), opening: includeStaticBalance ? a?.balance ?? 0 : 0, days: new Map() }; sections.set(id, s); }
    return s;
  };
  for (const id of ids) get(id);
  for (const l of lines) {
    if (!ids.has(l.accountId)) continue;
    const natural = isDebitNature(accounts.get(l.accountId)?.accountType ?? "Asset");
    const inc = natural ? l.debit : l.credit, dec = natural ? l.credit : l.debit;
    const s = get(l.accountId);
    if (l.date < startDate) { s.opening = money(s.opening + inc - dec); continue; }
    const d = s.days.get(l.date) ?? { increase: 0, decrease: 0 };
    d.increase = money(d.increase + inc); d.decrease = money(d.decrease + dec);
    s.days.set(l.date, d);
  }
  return [...sections.values()].map(s => {
    let bal = s.opening;
    const days = [...s.days.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, d]) => { bal = money(bal + d.increase - d.decrease); return { date, ...d, balance: bal }; });
    return {
      accountId: s.accountId, accountNumber: s.accountNumber, accountName: s.accountName, opening: money(s.opening), days,
      totalIncrease: money(days.reduce((t, d) => t + d.increase, 0)), totalDecrease: money(days.reduce((t, d) => t + d.decrease, 0)), closing: bal,
    };
  }).filter(s => s.days.length || Math.abs(s.opening) >= 0.005).sort(byNumber);
}

// ─────────────────────────── 應收/應付餘額分析表 ───────────────────────────

/**
 * 截至查詢日，每個客戶（供應商）的應收（應付）餘額，按發生月份拆：
 * 先進先出——收款先沖最早的帳，所以餘額落在最近幾個月的增加上。
 * 欄位：查詢月、前 3 個月各一欄，更早的放「其他」。
 */
export function balanceAging(lines: BookLine[], accounts: AccMap, ids: Set<number>, asOf: string, includeStaticBalance: boolean) {
  const months: string[] = [];
  const base = new Date(`${asOf.slice(0, 7)}-01T00:00:00Z`);
  for (let i = 0; i < 4; i++) { const d = new Date(base); d.setUTCMonth(d.getUTCMonth() - i); months.push(d.toISOString().slice(0, 7)); }
  const parties = new Map<string, { incs: { month: string; amount: number }[]; decs: number }>();
  const get = (p: string) => { let x = parties.get(p); if (!x) { x = { incs: [], decs: 0 }; parties.set(p, x); } return x; };
  if (includeStaticBalance) for (const id of ids) { const b = accounts.get(id)?.balance ?? 0; if (b > 0) get("").incs.push({ month: "0000-00", amount: b }); else if (b < 0) get("").decs -= b; }
  for (const l of lines) {
    if (!ids.has(l.accountId) || l.date > asOf) continue;
    const natural = isDebitNature(accounts.get(l.accountId)?.accountType ?? "Asset");
    const inc = natural ? l.debit - l.credit : l.credit - l.debit;
    const x = get(l.party);
    if (inc > 0) x.incs.push({ month: l.date.slice(0, 7), amount: inc }); else if (inc < 0) x.decs += -inc;
  }
  const rows = [...parties.entries()].map(([party, x]) => {
    const total = money(x.incs.reduce((s, i) => s + i.amount, 0) - x.decs);
    const buckets = [0, 0, 0, 0, 0]; // 查詢月、前 1、前 2、前 3 個月、其他
    let remaining = total;
    if (remaining > 0) {
      for (const inc of [...x.incs].sort((a, b) => b.month.localeCompare(a.month))) {
        if (remaining <= 0.005) break;
        const take = Math.min(inc.amount, remaining);
        const i = months.indexOf(inc.month);
        buckets[i >= 0 ? i : 4] = money(buckets[i >= 0 ? i : 4] + take);
        remaining = money(remaining - take);
      }
    } else buckets[4] = total; // 預收（餘額是負的）整筆放「其他」
    return { party, total, buckets };
  }).filter(r => Math.abs(r.total) >= 0.005).sort((a, b) => sortText(a.party, b.party));
  const totals = [0, 1, 2, 3, 4].map(i => money(rows.reduce((s, r) => s + r.buckets[i], 0)));
  return { months, rows, totals, total: money(rows.reduce((s, r) => s + r.total, 0)) };
}

// ─────────────────────────── 科目明細表 ───────────────────────────

/**
 * 科目明細表：截至查詢日每個科目的餘額，一個科目一段。
 * 往來科目（資產、負債，資金科目除外）再拆到客戶/供應商；收入、費用是當年 1/1 起的累計。
 * 金額照科目方向（資產、費用借方為正；負債、權益、收入貸方為正）。
 */
export function accountPartyBalances(lines: BookLine[], accounts: AccMap, asOf: string, includeStaticBalance: boolean, ids?: Set<number> | null) {
  const yearStart = `${asOf.slice(0, 4)}-01-01`;
  const splits = (a?: BookAccount) => !!a && (a.accountType === "Asset" || a.accountType === "Liability") && !isFundAccount(a);
  const m = new Map<number, Map<string, number>>();
  const add = (id: number, party: string, v: number) => {
    const pm = m.get(id) ?? new Map<string, number>();
    pm.set(party, money((pm.get(party) ?? 0) + v));
    m.set(id, pm);
  };
  if (includeStaticBalance) for (const a of accounts.values()) {
    if (a.isGroup || !a.balance || a.accountType === "Income" || a.accountType === "Expense") continue;
    if (!ids || ids.has(a.id)) add(a.id, "", a.balance);
  }
  for (const l of lines) {
    if (l.date > asOf || (ids && !ids.has(l.accountId))) continue;
    const a = accounts.get(l.accountId);
    const type = a?.accountType ?? "Asset";
    if ((type === "Income" || type === "Expense") && l.date < yearStart) continue;
    add(l.accountId, splits(a) ? l.party : "", isDebitNature(type) ? l.debit - l.credit : l.credit - l.debit);
  }
  return [...m.entries()].map(([id, pm]) => {
    const a = accounts.get(id);
    const rows = [...pm.entries()].map(([party, amount]) => ({ party, amount })).filter(r => Math.abs(r.amount) >= 0.005).sort((x, y) => sortText(x.party, y.party));
    return { accountId: id, accountNumber: a?.accountNumber ?? "", accountName: acctLabel(a, id), rows, total: money(rows.reduce((s, r) => s + r.amount, 0)) };
  }).filter(s => s.rows.length).sort(byNumber);
}

// ─────────────────────────── 查看客戶/供應商交易明細 ───────────────────────────

/** 每個客戶/供應商一段：期間內所有寫到這個對象的分錄行（不分科目），借方、貸方、月合計、合計。 */
export function partyTransactions(lines: BookLine[], startDate: string, endDate: string) {
  const m = new Map<string, BookLine[]>();
  for (const l of lines) {
    if (!l.party || l.date < startDate || l.date > endDate) continue;
    m.set(l.party, [...(m.get(l.party) ?? []), l]);
  }
  return [...m.entries()].map(([party, ls]) => {
    const rows = ls.sort((a, b) => a.date.localeCompare(b.date) || a.entryId - b.entryId || a.seq - b.seq)
      .map(l => ({ date: l.date, entryId: l.entryId, reference: l.reference, accountName: l.accountName, summary: l.summary, debit: l.debit, credit: l.credit }));
    return { party, rows, totalDebit: money(rows.reduce((s, r) => s + r.debit, 0)), totalCredit: money(rows.reduce((s, r) => s + r.credit, 0)) };
  }).sort((a, b) => sortText(a.party, b.party));
}
