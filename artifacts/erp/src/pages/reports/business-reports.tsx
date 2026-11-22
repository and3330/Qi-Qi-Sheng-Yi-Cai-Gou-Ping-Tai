import { useEffect, useState, type ReactNode } from "react";
import { departmentLabel, projectLabel } from "@/lib/select-options";
import { useLocation, useRoute } from "wouter";
import { Printer } from "lucide-react";
import { ReportHeader } from "@/components/shared/report-header";
import { PageHeader } from "@/components/shared/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ExportMenu } from "@/components/shared/export-menu";
import { AccountMultiPicker, type PickerAccount } from "@/components/accounting/account-multi-picker";
import { fmtMoney } from "@/lib/report-format";
import { useAutoReloadKey } from "@/lib/auto-refresh";
import type { ExportOptions } from "@/lib/export-utils";
import { clipPeriod, F8, quickRanges, refText, SubledgerView, type SubData, type ViewType } from "./account-books";
import { JournalEntryDialog } from "@/components/accounting/journal-entry-dialog";
import { AccountDrillDialog, DrillAmount, type DrillTarget } from "@/components/shared/account-drill";

/** 經營資料與其他帳簿：照 Ecount「會計 > 報表 > 經營資料／帳簿」的查詢方式 */
type Kind =
  | "fund-daily" | "fund-status" | "cash-movement" | "fund-detail" | "monthly-pl" | "summary"
  | "monthly-sales" | "monthly-purchase" | "receipts" | "payments" | "advances" | "ar-aging" | "ap-aging"
  | "account-changes" | "vat" | "ledger-1" | "ledger-2" | "party-tx" | "account-detail";
const KINDS: { k: Kind; label: string; desc: string; group: "經營資料" | "帳簿" | "財務報表" }[] = [
  { k: "fund-daily", label: "資金日報表", group: "經營資料", desc: "1. 資金情況（各帳戶結轉、增加、減少、今日餘額）2–3. 資金的增加／減少 4–7. 應收、應付帳款的增加／減少。" },
  { k: "fund-status", label: "資金情況表", group: "經營資料", desc: "各科目、各客戶/供應商的結轉、增加、減少、餘額。沒選科目時列資金、應收、應付科目。" },
  { k: "cash-movement", label: "現金流動", group: "經營資料", desc: "期初資金、依對應科目合計的資金增加與減少、期末資金；可和昨日、上個月或去年同期比較。" },
  { k: "fund-detail", label: "資金收支明細", group: "經營資料", desc: "資金的增加、資金的減少逐筆列出（對應科目、對應客戶、摘要、金額）。" },
  { k: "monthly-pl", label: "月損益報表", group: "經營資料", desc: "損益科目按月一欄，最後一欄合計；下方收入、費用、損益。" },
  { k: "summary", label: "會計合計表", group: "經營資料", desc: "依科目、客戶/供應商、部門、專案或月份合計借貸；依科目合計時有結轉餘額。" },
  { k: "monthly-sales", label: "月銷項合計表", group: "經營資料", desc: "每個客戶每月的含稅銷售額（收入＋銷項稅額）。" },
  { k: "monthly-purchase", label: "月進項合計表", group: "經營資料", desc: "每個供應商每月新增的應付帳款（含稅）。" },
  { k: "receipts", label: "收款單合計", group: "經營資料", desc: "每一筆收款：收款帳戶、貸方科目、客戶、摘要、金額、手續費、部門、專案。" },
  { k: "payments", label: "付款單合計", group: "經營資料", desc: "每一筆付款：付款帳戶、借方科目、供應商、摘要、金額、手續費、營業稅、部門、專案。" },
  { k: "advances", label: "暫付款單合計", group: "經營資料", desc: "暫付款（預付、代墊）科目的每一筆。" },
  { k: "ar-aging", label: "應收餘額分析表", group: "經營資料", desc: "截至查詢日每個客戶的應收餘額，按發生月份拆（先進先出：收款先沖最早的帳）。" },
  { k: "ap-aging", label: "應付餘額分析表", group: "經營資料", desc: "截至查詢日每個供應商的應付餘額，按發生月份拆。" },
  { k: "account-changes", label: "科目增減紀錄", group: "帳簿", desc: "所選科目每一天的增加、減少與餘額，段首是結轉餘額。" },
  { k: "vat", label: "進項/銷項帳簿", group: "帳簿", desc: "有營業稅的傳票：發票號碼、客戶/供應商、明細、稅前金額、營業稅。" },
  { k: "ledger-1", label: "客戶/供應商管理帳簿 I", group: "帳簿", desc: "應收（或應付）帳款依客戶/供應商分段的明細：結轉、每筆增減、餘額。" },
  { k: "ledger-2", label: "客戶/供應商管理帳簿 II", group: "帳簿", desc: "應收（或應付）帳款每個客戶/供應商一列：結轉、借方、貸方、餘額。" },
  { k: "party-tx", label: "查看客戶/供應商交易明細", group: "帳簿", desc: "每個客戶/供應商一段，列出期間內寫到這個對象的所有分錄行（不分科目）：借方、貸方、月合計、合計。" },
  { k: "account-detail", label: "科目明細表", group: "財務報表", desc: "截至查詢日每個科目的餘額，一個科目一段；往來科目（應收、應付、預付、暫收等）拆到客戶/供應商。收入、費用是當年 1/1 起累計。" },
];

const fmt = (n: number) => fmtMoney(n);
const amt = (n: number) => (n ? fmtMoney(n) : "");

/** 通用表格：每張報表先轉成這個格式，畫面與匯出共用 */
type RowStyle = "total" | "sub" | "head" | undefined;
/** entryId：整列點了開那張分錄。drill：每一格對應一個明細條件（null＝這格不能點） */
interface TRow { cells: string[]; style?: RowStyle; indent?: number; entryId?: number; drill?: Array<DrillTarget | null> }
/** 查詢當下的條件（點數字看明細要用同一組，不是畫面上後來改的） */
interface QueryScope { startDate: string; endDate: string; projectId: string; departmentId: string; party: string; reference: string; accountIds?: number[] }
/** 後端說「這個合計是哪幾個科目算的、增加記在哪一邊」；null＝明細會對不起來，不能點 */
type DrillAccounts = { accountIds: number[]; side: "debit" | "credit" } | null;
interface TSection { title?: string; headers: string[]; right: number[]; rows: TRow[] }

interface FundParty { party: string; opening: number; increase: number; decrease: number; closing: number }
interface FundAcc extends Omit<FundParty, "party"> { accountId: number; accountNumber: string; accountName: string; parties: FundParty[] }
interface MoveRow { date: string; entryId?: number; reference: string; counterAccount?: string; party: string; summary: string; amount: number }
interface Moves { increase: MoveRow[]; decrease: MoveRow[]; totalIncrease: number; totalDecrease: number }
interface FundStatusData { rows: FundAcc[]; total: Omit<FundParty, "party">; fund?: Moves; receivable?: Moves; payable?: Moves; receivableDrill?: DrillAccounts; payableDrill?: DrillAccounts }
interface Flow { opening: number; increase: { account: string; amount: number }[]; decrease: { account: string; amount: number }[]; totalIncrease: number; totalDecrease: number; closing: number }
interface PLData { months: string[]; rows: { accountId: number; accountNumber: string; accountName: string; accountType?: string; depth: number; isGroup: boolean; months: number[]; total: number }[]; income: { months: number[]; total: number }; expense: { months: number[]; total: number }; net: { months: number[]; total: number } }
interface SumData { rows: { key1: string; key2: string; opening: number; debit: number; credit: number; amount: number }[]; total: { opening: number; debit: number; credit: number; amount: number }; drillable?: boolean }
interface PartyMonthData { months: string[]; rows: { party: string; months: number[]; total: number }[]; totals: number[]; total: number; drill?: DrillAccounts }
interface Voucher { date: string; entryId?: number; reference: string; fundAccount: string; account: string; party: string; summary: string; amount: number; fee: number; tax: number; department: string | null; project: string | null }
interface VatData { rows: { date: string; entryId?: number; reference: string; kind: "sales" | "purchase"; invoiceNumber: string; party: string; detail: string; net: number; tax: number }[]; sales: { net: number; tax: number }; purchase: { net: number; tax: number } }
interface ChangeSection { accountId?: number; accountNumber: string; accountName: string; opening: number; days: { date: string; increase: number; decrease: number; balance: number }[]; totalIncrease: number; totalDecrease: number; closing: number }
interface AccountDetail { sections: { accountId?: number; accountNumber: string; accountName: string; rows: { party: string; amount: number }[]; total: number }[] }
interface PartyTx { sections: { party: string; rows: { date: string; entryId?: number; reference: string; accountName: string; summary: string; debit: number; credit: number }[]; totalDebit: number; totalCredit: number }[] }
interface AgingData { months: string[]; rows: { party: string; total: number; buckets: number[] }[]; totals: number[]; total: number }

const SUM_KEYS: [string, string][] = [["account", "科目"], ["party", "客戶/供應商"], ["department", "部門"], ["project", "專案"], ["month", "月份"]];
const ym = (m: string) => m.replace("-", ".");
const d8 = (d: string) => d.replace(/-/g, "/");

/** totalDrill：合計那一格點了看哪些分錄（沒給就不能點）。每一列本身點了開那張分錄。 */
function moveSection(title: string, m: MoveRow[], total: number, withCounter: boolean, totalDrill?: DrillTarget | null): TSection {
  return {
    title,
    headers: withCounter ? ["日期-號碼", "對應科目", "對應客戶", "摘要", "金額"] : ["日期-號碼", "客戶/供應商", "摘要", "金額"],
    right: [withCounter ? 4 : 3],
    rows: [
      ...m.map(r => ({ cells: withCounter ? [refText(r.date, r.reference), r.counterAccount ?? "", r.party, r.summary, fmt(r.amount)] : [refText(r.date, r.reference), r.party, r.summary, fmt(r.amount)], entryId: r.entryId })),
      { cells: withCounter ? ["合計", "", "", "", fmt(total)] : ["合計", "", "", fmt(total)], style: "total" as const, drill: totalDrill ? [...Array<null>(withCounter ? 4 : 3).fill(null), totalDrill] : undefined },
    ],
  };
}

function fundStatusSection(d: FundStatusData, q: QueryScope, title?: string): TSection {
  const rows: TRow[] = [];
  // 增加、減少看查詢期間；今日餘額從頭累計到結束日。「（無客戶）」那一列沒辦法只篩出沒有對象的分錄，不能點。
  const drillOf = (t: Pick<DrillTarget, "title" | "accountIds" | "party">): Array<DrillTarget | null> => {
    const base = { ...t, endDate: q.endDate, projectId: q.projectId || undefined, departmentId: q.departmentId || undefined };
    const period = { ...base, startDate: q.startDate };
    return [null, null, null, period, period, base];
  };
  for (const a of d.rows) {
    const acc = `[${a.accountNumber}] ${a.accountName}`;
    const whole = a.accountId ? drillOf({ title: `${a.accountNumber} ${a.accountName}`, accountIds: [a.accountId] }) : undefined;
    const named = a.parties.filter(p => p.party);
    if (named.length === 0) { rows.push({ cells: [acc, "", fmt(a.opening), amt(a.increase), amt(a.decrease), fmt(a.closing)], drill: whole }); continue; }
    for (const p of a.parties) rows.push({
      cells: [acc, p.party || "（無客戶）", fmt(p.opening), amt(p.increase), amt(p.decrease), fmt(p.closing)],
      drill: a.accountId && p.party ? drillOf({ title: `${a.accountNumber} ${a.accountName}`, accountIds: [a.accountId], party: p.party }) : undefined,
    });
    rows.push({ cells: [acc, "合計", fmt(a.opening), amt(a.increase), amt(a.decrease), fmt(a.closing)], style: "sub", drill: whole });
  }
  const allIds = d.rows.map(a => a.accountId).filter(Boolean);
  rows.push({ cells: ["總計", "", fmt(d.total.opening), fmt(d.total.increase), fmt(d.total.decrease), fmt(d.total.closing)], style: "total", drill: allIds.length ? drillOf({ title: "總計", accountIds: allIds }) : undefined });
  return { title, headers: ["科目", "客戶/供應商", "結轉", "增加", "減少", "今日餘額"], right: [2, 3, 4, 5], rows };
}

function flowRows(cur: Flow, cmp: Flow | null): TRow[] {
  const accts = (side: "increase" | "decrease") => [...new Set([...cur[side].map(x => x.account), ...(cmp?.[side].map(x => x.account) ?? [])])];
  const val = (f: Flow | null, side: "increase" | "decrease", a: string) => f?.[side].find(x => x.account === a)?.amount ?? 0;
  const row = (cells: string[], style?: RowStyle): TRow => ({ cells: cmp ? cells : cells.slice(0, 3), style });
  return [
    row(["期初餘額", "", fmt(cur.opening), cmp ? fmt(cmp.opening) : ""], "head"),
    ...accts("increase").map(a => row(["增加", a, amt(val(cur, "increase", a)), amt(val(cmp, "increase", a))])),
    row(["增加", "小計", fmt(cur.totalIncrease), cmp ? fmt(cmp.totalIncrease) : ""], "sub"),
    ...accts("decrease").map(a => row(["減少", a, amt(val(cur, "decrease", a)), amt(val(cmp, "decrease", a))])),
    row(["減少", "小計", fmt(cur.totalDecrease), cmp ? fmt(cmp.totalDecrease) : ""], "sub"),
    row(["期末餘額", "", fmt(cur.closing), cmp ? fmt(cmp.closing) : ""], "total"),
  ];
}

/** 把每張報表的回應轉成表格 */
function toSections(kind: Kind, body: unknown, opts: { key1: string; key2: string; compareLabel: string; txMode: string; txView: string; q: QueryScope; typeOf: (accountId: number) => string | undefined; accounts: PickerAccount[] }): TSection[] {
  const q = opts.q;
  const dim = { projectId: q.projectId || undefined, departmentId: q.departmentId || undefined };
  const pageRange = { startDate: q.startDate, endDate: q.endDate };
  switch (kind) {
    case "fund-daily": {
      const d = body as FundStatusData;
      const s: TSection[] = [fundStatusSection(d, q, "1. 資金情況")];
      if (d.fund) s.push(moveSection("2. 資金的增加", d.fund.increase, d.fund.totalIncrease, true), moveSection("3. 資金的減少", d.fund.decrease, d.fund.totalDecrease, true));
      // 應收、應付的增減合計：就是這幾個科目在期間內的借方或貸方合計，點了看那些分錄
      const sideDrill = (a: DrillAccounts | undefined, name: string, increase: boolean): DrillTarget | null => (a ? {
        title: name, accountIds: a.accountIds, ...pageRange, ...dim,
        note: `這個數字是下面的「${(a.side === "debit") === increase ? "借方" : "貸方"}合計」`,
      } : null);
      if (d.receivable) s.push(
        moveSection("4. 應收帳款的增加", d.receivable.increase, d.receivable.totalIncrease, false, sideDrill(d.receivableDrill, "應收帳款的增加", true)),
        moveSection("5. 應收帳款的減少", d.receivable.decrease, d.receivable.totalDecrease, false, sideDrill(d.receivableDrill, "應收帳款的減少", false)),
      );
      if (d.payable) s.push(
        moveSection("6. 應付帳款的增加", d.payable.increase, d.payable.totalIncrease, false, sideDrill(d.payableDrill, "應付帳款的增加", true)),
        moveSection("7. 應付帳款的減少", d.payable.decrease, d.payable.totalDecrease, false, sideDrill(d.payableDrill, "應付帳款的減少", false)),
      );
      return s;
    }
    case "fund-status": return [fundStatusSection(body as FundStatusData, q)];
    case "cash-movement": {
      const d = body as { current: Flow; compare: (Flow & { startDate: string; endDate: string }) | null };
      const headers = ["類型", "科目", "本期"];
      if (d.compare) headers.push(`${opts.compareLabel}（${d8(d.compare.startDate)}~${d8(d.compare.endDate)}）`);
      return [{ headers, right: [2, 3], rows: flowRows(d.current, d.compare) }];
    }
    case "fund-detail": {
      const d = body as Moves;
      return [moveSection("資金的增加", d.increase, d.totalIncrease, true), moveSection("資金的減少", d.decrease, d.totalDecrease, true)];
    }
    case "monthly-pl": {
      const d = body as PLData;
      // 每個月那一格只看那個月（夾在查詢期間裡），合計看整段查詢期間
      const monthly = (t: Pick<DrillTarget, "title" | "accountIds" | "accountTypes">): Array<DrillTarget | null> => [
        null,
        ...d.months.map(m => ({ ...t, ...(clipPeriod(m, q.startDate, q.endDate) ?? pageRange), ...dim })),
        { ...t, ...pageRange, ...dim },
      ];
      const line = (label: string, v: { months: number[]; total: number }, style: RowStyle, type?: string): TRow => ({
        cells: [label, ...v.months.map(fmt), fmt(v.total)], style,
        drill: type ? monthly({ title: label, accountTypes: [type] }) : undefined,
      });
      return [{
        headers: ["財務報表顯示名", ...d.months.map(ym), "合計"], right: d.months.map((_, i) => i + 1).concat(d.months.length + 1),
        rows: [
          ...d.rows.map(r => ({
            cells: [`[${r.accountNumber}] ${r.accountName}`, ...r.months.map(amt), fmt(r.total)], indent: r.depth, style: r.isGroup ? "sub" as const : undefined,
            // 「（本科目）」那一列是上層科目自己的分錄，沒辦法只篩自己，不能點
            drill: r.accountId && !r.accountName.endsWith("（本科目）") ? monthly({ title: `${r.accountNumber} ${r.accountName}`, accountIds: [r.accountId] }) : undefined,
          })),
          line("收入合計", d.income, "sub", "Income"), line("費用合計", d.expense, "sub", "Expense"), line("本期損益", d.net, "total"),
        ],
      }];
    }
    case "summary": {
      const d = body as SumData;
      const withOpening = opts.key1 === "account" && !opts.key2;
      const n1 = SUM_KEYS.find(k => k[0] === opts.key1)?.[1] ?? "", n2 = SUM_KEYS.find(k => k[0] === opts.key2)?.[1];
      const headers = [n1, ...(n2 ? [n2] : []), ...(withOpening ? ["結轉餘額"] : []), "借方", "貸方", withOpening ? "金額" : "借方−貸方"];
      const base = n2 ? 2 : 1;
      const cells = (r: SumData["total"], k1: string, k2: string) => [k1, ...(n2 ? [k2] : []), ...(withOpening ? [fmt(r.opening)] : []), amt(r.debit), amt(r.credit), fmt(r.amount)];
      // 借方、貸方可以點（看期間內算進去的分錄）。結轉餘額、金額是另外算出來的，分錄明細對不上，不能點。
      // 合計條件是部門、專案的那一列，還有空白的那一列，分錄明細沒辦法用同樣的條件篩，不能點。
      const picked = q.accountIds?.length ? q.accountIds : undefined;
      const part = (key: string, value: string): Partial<DrillTarget> | null => {
        if (!key) return {};
        if (!value) return null;
        if (key === "party") return { party: value };
        if (key === "month") return clipPeriod(value, q.startDate, q.endDate);
        if (key === "account") { const hit = opts.accounts.filter(a => `[${a.accountNumber}] ${a.accountName}` === value); return hit.length === 1 ? { accountIds: [hit[0].id] } : null; }
        return null;
      };
      const sumDrill = (title: string, k1: string, k2: string, isTotal = false): Array<DrillTarget | null> | undefined => {
        if (!d.drillable) return undefined;
        const a = isTotal ? {} : part(opts.key1, k1), b = isTotal ? {} : part(opts.key2, k2);
        if (!a || !b) return undefined;
        const t = { title, ...pageRange, ...dim, ...(picked ? { accountIds: picked } : {}), ...a, ...b };
        // 有篩客戶/供應商（名稱的一部分）時，只有「指定了對象」的那幾列篩得一樣
        if (q.party && !("party" in t)) return undefined;
        const lead = Array<null>(base + (withOpening ? 1 : 0)).fill(null);
        return [...lead, { ...t, note: "這個數字是下面的「借方合計」" }, { ...t, note: "這個數字是下面的「貸方合計」" }, null];
      };
      return [{
        headers, right: headers.map((_, i) => i).filter(i => i >= base),
        rows: [
          ...d.rows.map(r => ({ cells: cells(r, r.key1 || "（空白）", r.key2 || "（空白）"), drill: sumDrill([r.key1, r.key2].filter(Boolean).join("・"), r.key1, r.key2) })),
          { cells: cells(d.total, "合計", ""), style: "total", drill: sumDrill("合計", "", "", true) },
        ],
      }];
    }
    case "monthly-sales": case "monthly-purchase": {
      const d = body as PartyMonthData;
      // 每一格＝這個對象、這個月，算進去的科目（後端給）的分錄。沒有對象的那一列篩不出來，不能點。
      // 合計列是全部對象（有篩客戶/供應商時也是），所以不帶對象。
      const acc = d.drill;
      const cell = (party: string | null, m?: string): DrillTarget | null => (!acc || party === "" ? null : {
        title: party ?? "合計", accountIds: acc.accountIds, ...(party ? { party } : {}), ...((m ? clipPeriod(m, q.startDate, q.endDate) : null) ?? pageRange), ...dim,
        note: kind === "monthly-sales" ? "含稅銷售額＝收入加銷項稅額，是下面的「本期淨額」" : "只算新增的應付，是下面的「貸方合計」（付款不扣）",
      });
      const line = (party: string | null) => [null, ...d.months.map(m => cell(party, m)), cell(party)];
      return [{
        headers: [kind === "monthly-sales" ? "客戶名稱" : "供應商名稱", ...d.months.map(ym), "合計"], right: d.months.map((_, i) => i + 1).concat(d.months.length + 1),
        rows: [...d.rows.map(r => ({ cells: [r.party || "（無客戶）", ...r.months.map(amt), fmt(r.total)], drill: line(r.party) })), { cells: ["合計", ...d.totals.map(fmt), fmt(d.total)], style: "total", drill: line(null) }],
      }];
    }
    case "receipts": case "payments": case "advances": {
      const d = body as { rows: Voucher[]; total: number; totalFee: number };
      const acc = kind === "receipts" ? "收款帳號名稱" : kind === "payments" ? "付款帳號名稱" : "資金帳號名稱";
      const tax = d.rows.reduce((s, r) => s + r.tax, 0);
      return [{
        headers: ["日期-號碼", acc, "科目名稱", "客戶/供應商", "摘要", "金額", "手續費", "營業稅", "部門", "專案"], right: [5, 6, 7],
        rows: [
          ...d.rows.map(r => ({ cells: [refText(r.date, r.reference), r.fundAccount, r.account, r.party, r.summary, fmt(r.amount), amt(r.fee), amt(r.tax), r.department ?? "", r.project ?? ""], entryId: r.entryId })),
          { cells: [`合計（${d.rows.length} 筆）`, "", "", "", "", fmt(d.total), fmt(d.totalFee), fmt(tax), "", ""], style: "total" },
        ],
      }];
    }
    case "ar-aging": case "ap-aging": {
      const d = body as AgingData;
      const who = kind === "ar-aging" ? "客戶名" : "供應商名";
      return [{
        headers: [who, kind === "ar-aging" ? "總債權" : "總債務", ...d.months.map(ym), "其他"], right: [1, 2, 3, 4, 5, 6],
        rows: [...d.rows.map(r => ({ cells: [r.party || "（無客戶/期初）", fmt(r.total), ...r.buckets.map(amt)] })), { cells: ["合計", fmt(d.total), ...d.totals.map(fmt)], style: "total" }],
      }];
    }
    case "account-changes": {
      const d = body as { sections: ChangeSection[] };
      return d.sections.map(s => {
        // 有篩客戶/供應商（名稱的一部分）時，明細沒辦法用同樣的方式篩，數字會對不起來，所以不給點
        const t = s.accountId && !q.party ? { title: `${s.accountNumber} ${s.accountName}`, accountIds: [s.accountId], ...dim } : null;
        return {
          title: `[${s.accountNumber}] ${s.accountName}`, headers: ["日期", "增加", "減少", "餘額"], right: [1, 2, 3],
          rows: [
            { cells: ["結轉餘額", "", "", fmt(s.opening)], style: "head" as const },
            ...s.days.map(x => ({
              cells: [d8(x.date), amt(x.increase), amt(x.decrease), fmt(x.balance)],
              drill: t ? [null, { ...t, startDate: x.date, endDate: x.date }, { ...t, startDate: x.date, endDate: x.date }, { ...t, endDate: x.date }] : undefined,
            })),
            { cells: ["合計", fmt(s.totalIncrease), fmt(s.totalDecrease), fmt(s.closing)], style: "total" as const, drill: t ? [null, { ...t, ...pageRange }, { ...t, ...pageRange }, { ...t, endDate: q.endDate }] : undefined },
          ],
        };
      });
    }
    case "vat": {
      const d = body as VatData;
      const out: TSection[] = [];
      for (const k of ["sales", "purchase"] as const) {
        const rows = d.rows.filter(r => r.kind === k);
        if (rows.length === 0) continue;
        const name = k === "sales" ? "銷項" : "進項";
        out.push({
          title: `${name}帳簿`, headers: ["日期-號碼", "發票號碼", k === "sales" ? "客戶" : "供應商", "明細", `${name}稅前價格`, `${name}營業稅`], right: [4, 5],
          rows: [...rows.map(r => ({ cells: [refText(r.date, r.reference), r.invoiceNumber, r.party, r.detail, fmt(r.net), fmt(r.tax)], entryId: r.entryId })), { cells: [`合計（${rows.length} 筆）`, "", "", "", fmt(d[k].net), fmt(d[k].tax)], style: "total" }],
        });
      }
      return out;
    }
    case "account-detail": {
      const d = body as AccountDetail;
      return d.sections.map(s => {
        // 餘額算到查詢日；收入、費用是當年 1/1 起累計（知道科目類別才帶起始日）
        const type = s.accountId ? opts.typeOf(s.accountId) : undefined;
        const t: DrillTarget | null = s.accountId ? {
          title: `${s.accountNumber} ${s.accountName}`, accountIds: [s.accountId], endDate: q.endDate, ...dim,
          ...(type === "Income" || type === "Expense" ? { startDate: `${q.endDate.slice(0, 4)}-01-01` } : {}),
        } : null;
        // 沒有對象的那一列：整個科目只有這一列時等於科目餘額，可以點；跟其他對象並列時沒辦法只篩出它，不能點
        const rowDrill = (party: string): DrillTarget | null => (!t ? null : party ? { ...t, party } : s.rows.length === 1 && !q.party ? t : null);
        return {
          title: `[${s.accountNumber}] ${s.accountName}`, headers: ["科目名稱", "客戶/供應商名稱", "金額"], right: [2],
          rows: [
            ...s.rows.map(r => ({ cells: [s.accountName, r.party, fmt(r.amount)], drill: [null, null, rowDrill(r.party)] })),
            // 有篩客戶/供應商時，合計只是篩到的那幾列相加，不是整個科目，不能點
            { cells: ["合計", "", fmt(s.total)], style: "total" as const, drill: [null, null, q.party ? null : t] },
          ],
        };
      });
    }
    case "party-tx": {
      const d = body as PartyTx;
      // 這個對象在期間內的全部分錄行（不分科目）。有篩單據號碼時合計只是篩到的幾筆，不能點。
      const partyDrill = (party: string, period?: string): DrillTarget | null => (!party || q.reference ? null
        : { title: party, party, ...((period ? clipPeriod(period, q.startDate, q.endDate) : null) ?? pageRange), ...dim, note: "不分科目" });
      if (opts.txMode === "sum") {
        return [{
          headers: ["客戶/供應商", "借方金額", "貸方金額"], right: [1, 2],
          rows: [
            ...d.sections.map(s => ({ cells: [s.party, amt(s.totalDebit), amt(s.totalCredit)], drill: [null, partyDrill(s.party), partyDrill(s.party)] })),
            { cells: [`合計（${d.sections.length} 個）`, fmt(d.sections.reduce((t, s) => t + s.totalDebit, 0)), fmt(d.sections.reduce((t, s) => t + s.totalCredit, 0))], style: "total" },
          ],
        }];
      }
      return d.sections.map(s => {
        const rows: TRow[] = [];
        if (opts.txView === "line") {
          let month = "", dr = 0, cr = 0;
          const flush = () => { if (month) rows.push({ cells: [`${month.replace("-", "/")} 合計`, "", "", fmt(dr), fmt(cr)], style: "sub", drill: [null, null, null, partyDrill(s.party, month), partyDrill(s.party, month)] }); };
          for (const r of s.rows) {
            if (r.date.slice(0, 7) !== month) { flush(); month = r.date.slice(0, 7); dr = 0; cr = 0; }
            dr += r.debit; cr += r.credit;
            rows.push({ cells: [refText(r.date, r.reference), r.accountName, r.summary, amt(r.debit), amt(r.credit)], entryId: r.entryId });
          }
          flush();
        } else {
          const g = new Map<string, [number, number]>();
          for (const r of s.rows) {
            const k = opts.txView === "day" ? d8(r.date) : r.date.slice(0, 7).replace("-", "/");
            const v = g.get(k) ?? [0, 0]; v[0] += r.debit; v[1] += r.credit; g.set(k, v);
          }
          for (const [k, [dr, cr]] of g) rows.push({ cells: [k, "", "", amt(dr), amt(cr)], drill: [null, null, null, partyDrill(s.party, k), partyDrill(s.party, k)] });
        }
        rows.push({ cells: ["合計", "", "", fmt(s.totalDebit), fmt(s.totalCredit)], style: "total", drill: [null, null, null, partyDrill(s.party), partyDrill(s.party)] });
        return { title: s.party, headers: ["日期-號碼", "科目", "摘要", "借方金額", "貸方金額"], right: [3, 4], rows };
      });
    }
    default: return [];
  }
}

const th = "px-3 py-2 font-semibold";

function SectionTable({ s, onOpenEntry, onDrill }: { s: TSection; onOpenEntry: (id: number) => void; onDrill: (t: DrillTarget) => void }) {
  const right = new Set(s.right);
  return (
    <div className="space-y-1 break-inside-avoid">
      {s.title && <p className="text-sm font-semibold">{s.title}</p>}
      <Card><CardContent className="overflow-x-auto p-0">
        <table className="w-full text-sm" style={{ minWidth: Math.max(560, s.headers.length * 110) }}>
          <thead><tr className="border-b bg-muted/40 text-muted-foreground">
            {s.headers.map((h, i) => <th key={i} className={`${th} ${right.has(i) ? "text-right" : "text-left"}`}>{h}</th>)}
          </tr></thead>
          <tbody>
            {s.rows.length === 0 && <tr><td colSpan={s.headers.length} className="px-3 py-6 text-center text-muted-foreground">沒有資料</td></tr>}
            {s.rows.map((r, i) => {
              const entryId = r.entryId;
              return (
                <tr key={i} onClick={entryId ? () => onOpenEntry(entryId) : undefined}
                  className={`${r.style === "total" ? "border-t-2 bg-primary/5 font-semibold" : r.style === "sub" ? "border-b bg-muted/30 font-medium" : r.style === "head" ? "border-b bg-primary/5" : "border-b hover:bg-muted/40"}${entryId ? " cursor-pointer" : ""}`}>
                  {r.cells.map((c, j) => {
                    const t = c ? r.drill?.[j] : null;
                    return (
                      <td key={j} className={`px-3 py-1.5 ${right.has(j) ? "text-right font-mono" : ""} ${j === 0 ? "whitespace-nowrap" : "max-w-[300px] truncate"}`} title={c}
                        style={j === 0 && r.indent ? { paddingLeft: 12 + r.indent * 16 } : undefined}>{t ? <DrillAmount onClick={() => onDrill(t)}>{c}</DrillAmount> : c}</td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </CardContent></Card>
    </div>
  );
}

export default function BusinessReportsPage() {
  const [, params] = useRoute("/reports/business/:kind");
  const [, navigate] = useLocation();
  const kind: Kind = KINDS.find(k => k.k === params?.kind)?.k ?? "fund-daily";
  const meta = KINDS.find(k => k.k === kind)!;
  const reloadKey = useAutoReloadKey();

  const lastMonth = quickRanges()[5];
  const [startDate, setStartDate] = useState(lastMonth[1]);
  const [endDate, setEndDate] = useState(lastMonth[2]);
  const [accountIds, setAccountIds] = useState<number[]>([]);
  const [departmentId, setDepartmentId] = useState("");
  const [projectId, setProjectId] = useState("");
  const [party, setParty] = useState("");
  const [reference, setReference] = useState("");
  const [invoiceNumber, setInvoiceNumber] = useState("");
  const [compare, setCompare] = useState("none");
  const [key1, setKey1] = useState("account");
  const [key2, setKey2] = useState("");
  const [vatKind, setVatKind] = useState("all");
  const [side, setSide] = useState<"receivable" | "payable">("receivable");
  const [view, setView] = useState<ViewType>("line");
  const [txMode, setTxMode] = useState("detail");
  const [txView, setTxView] = useState("line");
  const [includeZero, setIncludeZero] = useState(false);

  const [accounts, setAccounts] = useState<PickerAccount[]>([]);
  const [departments, setDepartments] = useState<{ id: number; name: string }[]>([]);
  const [projects, setProjects] = useState<{ id: number; name: string }[]>([]);
  const [data, setData] = useState<{ kind: Kind; body: unknown; key1: string; key2: string; compare: string; txMode: string; txView: string; q: QueryScope } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [openEntryId, setOpenEntryId] = useState<number | null>(null);
  const [drill, setDrill] = useState<DrillTarget | null>(null);

  useEffect(() => {
    fetch(`/erp-api/accounts`).then(r => r.json()).then(d => setAccounts(Array.isArray(d) ? d : [])).catch(() => {});
    fetch(`/erp-api/departments`).then(r => r.json()).then(d => setDepartments(Array.isArray(d) ? d : [])).catch(() => {});
    fetch(`/erp-api/projects`).then(r => r.json()).then(d => setProjects(Array.isArray(d) ? d : [])).catch(() => {});
  }, [reloadKey]);
  useEffect(() => { setData(null); setError(""); }, [kind]);

  const isLedger = kind === "ledger-1" || kind === "ledger-2";
  const isAging = kind === "ar-aging" || kind === "ap-aging" || kind === "account-detail";
  const usesAccounts = kind === "fund-status" || kind === "summary" || kind === "account-changes" || kind === "account-detail";
  const usesParty = !["fund-daily", "fund-status", "cash-movement", "fund-detail", "monthly-pl"].includes(kind);

  const fetchReport = async () => {
    const p = new URLSearchParams();
    if (!isAging && startDate) p.set("startDate", startDate);
    if (endDate) p.set("endDate", endDate);
    if (departmentId) p.set("departmentId", departmentId);
    if (projectId) p.set("projectId", projectId);
    if (usesAccounts && accountIds.length) p.set("accountIds", accountIds.join(","));
    if (usesParty && party) p.set("party", party);
    let url = "";
    switch (kind) {
      case "fund-daily": url = "fund-status"; p.set("detail", "1"); break;
      case "fund-status": url = "fund-status"; break;
      case "cash-movement": url = "cash-movement"; p.set("compare", compare); break;
      case "fund-detail": url = "fund-detail"; break;
      case "monthly-pl": url = "monthly-pl"; break;
      case "summary": url = "summary"; p.set("key1", key1); if (key2) p.set("key2", key2); break;
      case "monthly-sales": url = "monthly-party"; p.set("kind", "sales"); break;
      case "monthly-purchase": url = "monthly-party"; p.set("kind", "purchase"); break;
      case "receipts": url = "vouchers"; p.set("kind", "receipt"); if (reference) p.set("reference", reference); break;
      case "payments": url = "vouchers"; p.set("kind", "payment"); if (reference) p.set("reference", reference); break;
      case "advances": url = "vouchers"; p.set("kind", "advance"); if (reference) p.set("reference", reference); break;
      case "ar-aging": url = "balance-aging"; p.set("type", "receivable"); break;
      case "ap-aging": url = "balance-aging"; p.set("type", "payable"); break;
      case "account-changes":
        if (accountIds.length === 0) { setError("請先選會計科目"); return; }
        url = "account-changes"; break;
      case "account-detail": url = "account-detail"; if (includeZero) p.set("includeZero", "1"); break;
      case "party-tx": url = "party-transactions"; if (reference) p.set("reference", reference); break;
      case "vat": url = "vat"; p.set("kind", vatKind); if (invoiceNumber) p.set("invoiceNumber", invoiceNumber); break;
      case "ledger-1": case "ledger-2": {
        const re = side === "receivable" ? /^114[1-2]/ : /^214[1-2]/;
        const ids = accounts.filter(a => !a.isGroup && re.test(a.accountNumber)).map(a => a.id);
        if (ids.length === 0) { setError("找不到應收（1141/1142）或應付（2141/2142）帳款科目"); return; }
        url = "subledger"; p.set("group", "account-party"); p.set("accountIds", ids.join(",")); p.set("hideEmpty", "1");
        break;
      }
    }
    setLoading(true); setError("");
    try {
      const res = await fetch(`/erp-api/reports/books/${url}?${p}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "查詢失敗");
      setData({ kind, body: json, key1, key2, compare, txMode, txView, q: { startDate, endDate, projectId, departmentId, party: usesParty ? party : "", reference: p.get("reference") ?? "", accountIds: usesAccounts ? accountIds : [] } });
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "查詢失敗");
    }
    setLoading(false);
  };

  const compareLabel = ({ prevDay: "前一天同期", prevMonth: "上個月同期", lastYear: "去年同期" } as Record<string, string>)[data?.compare ?? ""] ?? "比較";
  const typeOf = (accountId: number) => (accounts.find(a => a.id === accountId) as (PickerAccount & { accountType?: string }) | undefined)?.accountType;
  const sections = data && !(data.kind === "ledger-1" || data.kind === "ledger-2") ? toSections(data.kind, data.body, { key1: data.key1, key2: data.key2, compareLabel, txMode: data.txMode, txView: data.txView, q: data.q, typeOf, accounts }) : [];

  const filterText = [
    departmentId && `部門：${departments.find(d => String(d.id) === departmentId)?.name ?? ""}`,
    projectId && `專案：${projects.find(p => String(p.id) === projectId)?.name ?? ""}`,
    usesParty && party && `客戶/供應商：${party}`,
  ].filter(Boolean).join("　");
  const subtitle = `${isAging ? `查詢日：${endDate}` : `期間：${startDate} 至 ${endDate}`}${filterText ? `　${filterText}` : ""}`;

  const buildExport = (): ExportOptions => {
    if (!data) throw new Error("請先查詢");
    const fileName = `${meta.label.replace(/\//g, "-")}_${startDate}_${endDate}`;
    if (data.kind === "ledger-1" || data.kind === "ledger-2") {
      const d = data.body as SubData;
      const rows: Record<string, string>[] = [];
      for (const s of d.sections) {
        if (data.kind === "ledger-2") { rows.push({ party: s.party || "（無客戶）", acc: s.account.accountName, ref: "", summary: "", open: fmt(s.openingBalance), dr: amt(s.totalDebit), cr: amt(s.totalCredit), bal: fmt(s.closingBalance) }); continue; }
        rows.push({ party: s.party, acc: s.account.accountName, ref: "結轉餘額", summary: "", open: "", dr: "", cr: "", bal: fmt(s.openingBalance) });
        for (const r of s.rows) rows.push({ party: s.party, acc: s.account.accountName, ref: refText(r.date, r.reference), summary: r.summary, open: "", dr: amt(r.debit), cr: amt(r.credit), bal: fmt(r.balance) });
        rows.push({ party: s.party, acc: s.account.accountName, ref: "合計", summary: "", open: "", dr: fmt(s.totalDebit), cr: fmt(s.totalCredit), bal: fmt(s.closingBalance) });
      }
      return { title: meta.label, subtitle, fileName, headers: ["客戶/供應商", "科目", "日期-號碼", "摘要", "結轉", "借方", "貸方", "餘額"], columnKeys: ["party", "acc", "ref", "summary", "open", "dr", "cr", "bal"], rows };
    }
    // 多段的報表匯出成一張表：第一欄放段名
    const multi = sections.length > 1;
    const width = Math.max(...sections.map(s => s.headers.length));
    const keys = Array.from({ length: width + (multi ? 1 : 0) }, (_, i) => `c${i}`);
    const headers = multi ? ["段落", ...Array.from({ length: width }, (_, i) => sections[0].headers[i] ?? "")] : sections[0]?.headers ?? [];
    const rows: Record<string, string>[] = [];
    for (const s of sections) {
      if (multi) rows.push(Object.fromEntries(keys.map((k, i) => [k, i === 0 ? s.title ?? "" : s.headers[i - 1] ?? ""])));
      for (const r of s.rows) {
        const cells = multi ? [s.title ?? "", ...r.cells] : r.cells;
        rows.push(Object.fromEntries(keys.map((k, i) => [k, cells[i] ?? ""])));
      }
    }
    return { title: meta.label, subtitle, fileName, headers, columnKeys: keys, rows };
  };

  const select = "h-10 w-full rounded-md border border-input bg-background px-3 text-sm";
  const field = (label: string, node: ReactNode) => (
    <div><label className="mb-1 block text-sm font-medium text-muted-foreground">{label}</label>{node}</div>
  );
  const radio = (name: string, value: string, current: string, set: (v: string) => void, label: string) => (
    <label key={value} className="flex items-center gap-1.5"><input type="radio" name={name} checked={current === value} onChange={() => set(value)} />{label}</label>
  );

  return (
    <div className="space-y-6" data-report>
      <ReportHeader />
      <PageHeader title={meta.label} description={meta.desc} />
      <div className="space-y-1 print:hidden">
        {(["經營資料", "帳簿", "財務報表"] as const).map(g => (
          <div key={g} className="flex flex-wrap items-center gap-1" role="tablist" aria-label={g}>
            <span className="w-16 text-xs text-muted-foreground">{g}</span>
            {KINDS.filter(x => x.group === g).map(x => (
              <Button key={x.k} size="sm" variant={x.k === kind ? "default" : "outline"} role="tab" aria-selected={x.k === kind} onClick={() => navigate(`/reports/business/${x.k}`)}>{x.label}</Button>
            ))}
          </div>
        ))}
      </div>
      <Card className="print:hidden">
        <CardContent className="space-y-3 py-4">
          {kind === "cash-movement" && (
            <div className="flex flex-wrap items-center gap-x-5 text-sm">
              <span className="text-muted-foreground">比較期間</span>
              {([["none", "不比較"], ["prevDay", "前一天"], ["prevMonth", "上個月"], ["lastYear", "去年同期"]] as const).map(([v, l]) => radio("cm-compare", v, compare, setCompare, l))}
            </div>
          )}
          {kind === "party-tx" && (
            <div className="flex flex-wrap items-center gap-x-5 text-sm">
              <span className="text-muted-foreground">類型</span>
              {radio("tx-mode", "detail", txMode, setTxMode, "明細")}
              {radio("tx-mode", "sum", txMode, setTxMode, "合計")}
              {txMode === "detail" && <>
                <span className="ml-4" />
                {([["line", "按行"], ["day", "按日期"], ["month", "按月"]] as const).map(([v, l]) => radio("tx-view", v, txView, setTxView, l))}
              </>}
            </div>
          )}
          {kind === "account-detail" && (
            <label className="flex items-center gap-1.5 text-sm"><input type="checkbox" checked={includeZero} onChange={e => setIncludeZero(e.target.checked)} />包括0餘額</label>
          )}
          {kind === "vat" && (
            <div className="flex flex-wrap items-center gap-x-5 text-sm">
              <span className="text-muted-foreground">類型</span>
              {([["all", "全部"], ["sales", "銷項"], ["purchase", "進項"]] as const).map(([v, l]) => radio("vat-kind", v, vatKind, setVatKind, l))}
            </div>
          )}
          {isLedger && (
            <div className="flex flex-wrap items-center gap-x-5 text-sm">
              <span className="text-muted-foreground">帳款</span>
              {radio("ledger-side", "receivable", side, v => setSide(v as "receivable" | "payable"), "應收帳款（客戶）")}
              {radio("ledger-side", "payable", side, v => setSide(v as "receivable" | "payable"), "應付帳款（供應商）")}
              {kind === "ledger-1" && <>
                <span className="ml-4 text-muted-foreground">類型</span>
                {([["line", "按憑證"], ["day", "按日期"], ["month", "按月"]] as const).map(([v, l]) => radio("ledger-view", v, view, x => setView(x as ViewType), l))}
              </>}
            </div>
          )}
          <div className="flex flex-wrap items-end gap-3">
            {!isAging && field("起始日期", <Input type="date" className="w-40" value={startDate} onChange={e => setStartDate(e.target.value)} />)}
            {field(isAging ? "查詢日期" : "結束日期", <Input type="date" className="w-40" value={endDate} onChange={e => setEndDate(e.target.value)} />)}
          </div>
          {!isAging && (
            <div className="flex flex-wrap gap-1">
              {quickRanges().map(([label, f, t]) => (
                <Button key={label} type="button" size="sm" variant={startDate === f && endDate === t ? "default" : "ghost"} onClick={() => { setStartDate(f); setEndDate(t); }}>{label}</Button>
              ))}
            </div>
          )}
          <div className="grid gap-3 md:grid-cols-3">
            {usesAccounts && field("會計科目", <AccountMultiPicker accounts={accounts} value={accountIds} onChange={setAccountIds} />)}
            {field("部門", (
              <select className={select} value={departmentId} onChange={e => setDepartmentId(e.target.value)} aria-label="部門">
                <option value="">全部部門</option>
                {departments.map(d => <option key={d.id} value={d.id}>{departmentLabel(d)}</option>)}
              </select>
            ))}
            {field("專案", (
              <select className={select} value={projectId} onChange={e => setProjectId(e.target.value)} aria-label="專案">
                <option value="">全部專案</option>
                {projects.map(p => <option key={p.id} value={p.id}>{projectLabel(p)}</option>)}
              </select>
            ))}
            {usesParty && field("客戶/供應商", <Input value={party} onChange={e => setParty(e.target.value)} placeholder="名稱的一部分" />)}
            {(kind === "receipts" || kind === "payments" || kind === "advances" || kind === "party-tx") && field("單據號碼", <Input value={reference} onChange={e => setReference(e.target.value)} placeholder="例如 2026/10/01-3" />)}
            {kind === "vat" && field("發票號碼", <Input value={invoiceNumber} onChange={e => setInvoiceNumber(e.target.value)} placeholder="號碼的一部分" />)}
            {kind === "summary" && field("合計條件 1", (
              <select className={select} value={key1} onChange={e => setKey1(e.target.value)} aria-label="合計條件 1">
                {SUM_KEYS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            ))}
            {kind === "summary" && field("合計條件 2", (
              <select className={select} value={key2} onChange={e => setKey2(e.target.value)} aria-label="合計條件 2">
                <option value="">（不用）</option>
                {SUM_KEYS.filter(([v]) => v !== key1).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="ml-auto flex gap-2">
              <Button onClick={fetchReport} disabled={loading}>{loading ? "查詢中..." : "查詢(F8)"}</Button>
              {data && <Button variant="outline" onClick={() => window.print()}><Printer className="mr-1 h-4 w-4" />列印</Button>}
              {data && <ExportMenu getExportOptions={buildExport} />}
            </div>
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          {(data?.body as { filteredByDimension?: boolean } | undefined)?.filteredByDimension && <p className="text-xs text-muted-foreground">有篩部門或專案時，結轉餘額只算篩得到的分錄；開帳時輸入的期初金額沒有分部門，不算在內。</p>}
        </CardContent>
      </Card>

      <F8 onQuery={fetchReport} />
      {data && <p className="text-sm text-muted-foreground">{subtitle}</p>}
      {data && (data.kind === "ledger-1" || data.kind === "ledger-2") && (
        <SubledgerView kind="account-party" d={data.body as SubData} view={data.kind === "ledger-2" ? "summary" : view} showOpening subtitle={subtitle} scope={data.q} />
      )}
      {sections.map((s, i) => <SectionTable key={`${data?.kind}-${i}`} s={s} onOpenEntry={setOpenEntryId} onDrill={setDrill} />)}
      <JournalEntryDialog entryId={openEntryId} onClose={() => setOpenEntryId(null)} />
      <AccountDrillDialog target={drill} onClose={() => setDrill(null)} />
      {!data && !loading && <Card><CardContent className="py-12 text-center text-muted-foreground">設定條件後按「查詢(F8)」</CardContent></Card>}
    </div>
  );
}
