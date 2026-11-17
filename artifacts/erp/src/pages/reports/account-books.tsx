import { useEffect, useMemo, useState, type ReactNode } from "react";
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

/** 會計帳簿：照 Ecount「會計 > 報表 > 帳簿」各張報表的查詢方式 */
export type Kind = "journal" | "period" | "account-party" | "party-account" | "account-summary" | "cash" | "trial";
const KINDS: [Kind, string, string][] = [
  ["journal", "日記簿", "依日期列出每張傳票的每一行；可依傳票號碼、科目、客戶/供應商、摘要、金額篩選。"],
  ["period", "日/月合計表", "每天或每月各科目的借貸方合計，段尾是日（月）總計。"],
  ["account-party", "科目/客戶/供應商明細帳", "先依科目、再依客戶/供應商分段，每段有結轉餘額、明細與合計。"],
  ["party-account", "客戶/供應商/科目明細帳", "先依客戶/供應商、再依科目分段。"],
  ["account-summary", "科目摘要明細帳", "先依科目、再依摘要分段。"],
  ["trial", "餘額試算表", "Ecount 累計格式：期末金額＝結轉金額＋本期借貸發生額，期末餘額＝兩者相減；上層科目一列小計。損益科目每年 1/1 歸零。"],
  ["cash", "現金出納帳", "現金科目的收支與餘額，對應科目是同一張傳票另一邊的科目；勾「包括存款」再加上銀行存款。"],
];

const fmt = (n: number) => fmtMoney(n);
const amt = (n: number) => (n ? fmtMoney(n) : "");
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
/** Ecount 查詢畫面下方的日期快捷鍵 */
export function quickRanges(): [string, string, string][] {
  const t = new Date();
  const day = (offset: number) => { const d = new Date(t); d.setDate(d.getDate() + offset); return d; };
  const monday = day(-((t.getDay() + 6) % 7));
  const lastMonday = new Date(monday); lastMonday.setDate(monday.getDate() - 7);
  const lastSunday = new Date(monday); lastSunday.setDate(monday.getDate() - 1);
  return [
    ["今日", ymd(t), ymd(t)], ["昨日", ymd(day(-1)), ymd(day(-1))],
    ["本週(~今天)", ymd(monday), ymd(t)], ["上週", ymd(lastMonday), ymd(lastSunday)],
    ["本月(~今天)", ymd(new Date(t.getFullYear(), t.getMonth(), 1)), ymd(t)],
    ["上個月", ymd(new Date(t.getFullYear(), t.getMonth() - 1, 1)), ymd(new Date(t.getFullYear(), t.getMonth(), 0))],
    ["最近30天", ymd(day(-29)), ymd(t)],
    ["本年度", `${t.getFullYear()}-01-01`, ymd(t)], ["去年度", `${t.getFullYear() - 1}-01-01`, `${t.getFullYear() - 1}-12-31`],
  ];
}
/** 傳票顯示成 Ecount 的「日期 -號碼」 */
export const refText = (date: string, reference: string, seq?: number) => {
  const m = /^\d{4}\/\d{2}\/\d{2}-(.+)$/.exec(reference);
  const base = m ? `${date.replace(/-/g, "/")} -${m[1]}` : `${date.replace(/-/g, "/")} ${reference}`;
  return seq ? `${base}-${seq}` : base;
};

interface JournalRow { date: string; entryId: number; reference: string; seq: number; accountNumber: string; accountName: string; party: string; summary: string; debit: number; credit: number; department: string | null; project: string | null }
interface JournalData { rows: JournalRow[]; entryCount: number; totalDebit: number; totalCredit: number }
interface PeriodData { periods: { period: string; rows: { accountId: number; accountNumber: string; accountName: string; debit: number; credit: number }[]; totalDebit: number; totalCredit: number }[]; totalDebit: number; totalCredit: number }
interface SubRow { date: string; entryId: number; reference: string; party: string; summary: string; accountName: string; debit: number; credit: number; balance: number }
interface SubSection { key: string; account: { id: number; accountNumber: string; accountName: string; accountType: string }; party: string; summary: string; openingBalance: number; totalDebit: number; totalCredit: number; closingBalance: number; rows: SubRow[] }
export interface SubData { filteredByDimension?: boolean; sections: SubSection[] }
interface TrialRowT { accountId: number; accountNumber: string; accountName: string; depth: number; isGroup: boolean; debitAmount: number; creditAmount: number; debitBalance: number; creditBalance: number }
interface TrialData { filteredByDimension?: boolean; rows: TrialRowT[]; total: { debitAmount: number; creditAmount: number; debitBalance: number; creditBalance: number } }
interface CashRow { date: string; entryId: number; reference: string; cashAccount: string; counterAccount: string; party: string; summary: string; debit: number; credit: number; balance: number }
interface CashData { filteredByDimension?: boolean; cashAccounts: { accountNumber: string; accountName: string }[]; openingBalance: number; rows: CashRow[]; totalDebit: number; totalCredit: number; closingBalance: number }
export type ViewType = "line" | "day" | "month" | "summary";

const th = "px-3 py-2 font-semibold";
const td = "px-3 py-1.5";
const num = "px-3 py-1.5 text-right font-mono";

export default function AccountBooksPage() {
  const [, params] = useRoute("/reports/books/:kind");
  const [, navigate] = useLocation();
  const kind: Kind = (KINDS.find(k => k[0] === params?.kind)?.[0]) ?? "journal";
  const meta = KINDS.find(k => k[0] === kind)!;
  const reloadKey = useAutoReloadKey();

  const lastMonth = quickRanges()[5];
  const [startDate, setStartDate] = useState(lastMonth[1]);
  const [endDate, setEndDate] = useState(lastMonth[2]);
  const [accountIds, setAccountIds] = useState<number[]>([]);
  const [departmentId, setDepartmentId] = useState("");
  const [projectId, setProjectId] = useState("");
  const [party, setParty] = useState("");
  const [summary, setSummary] = useState("");
  const [reference, setReference] = useState("");
  const [minAmount, setMinAmount] = useState("");
  const [maxAmount, setMaxAmount] = useState("");
  const [unbalancedOnly, setUnbalancedOnly] = useState(false);
  const [mode, setMode] = useState<"month" | "day">("month");
  const [view, setView] = useState<ViewType>("line");
  const [showOpening, setShowOpening] = useState(true);
  const [hideEmpty, setHideEmpty] = useState(true);
  const [includeBank, setIncludeBank] = useState(false);
  const [includeZero, setIncludeZero] = useState(false);

  const [accounts, setAccounts] = useState<PickerAccount[]>([]);
  const [departments, setDepartments] = useState<{ id: number; name: string }[]>([]);
  const [projects, setProjects] = useState<{ id: number; name: string }[]>([]);
  const [data, setData] = useState<{ kind: Kind; body: unknown } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch(`/erp-api/accounts`).then(r => r.json()).then(d => setAccounts(Array.isArray(d) ? d : [])).catch(() => {});
    fetch(`/erp-api/departments`).then(r => r.json()).then(d => setDepartments(Array.isArray(d) ? d : [])).catch(() => {});
    fetch(`/erp-api/projects`).then(r => r.json()).then(d => setProjects(Array.isArray(d) ? d : [])).catch(() => {});
  }, [reloadKey]);
  useEffect(() => { setData(null); setError(""); }, [kind]);

  const isSub = kind === "account-party" || kind === "party-account" || kind === "account-summary";

  const fetchReport = async () => {
    const p = new URLSearchParams();
    if (startDate) p.set("startDate", startDate);
    if (endDate) p.set("endDate", endDate);
    if (departmentId) p.set("departmentId", departmentId);
    if (projectId) p.set("projectId", projectId);
    let url = "";
    if (kind === "journal") {
      url = "/erp-api/reports/books/journal";
      if (accountIds.length) p.set("accountIds", accountIds.join(","));
      if (party) p.set("party", party);
      if (summary) p.set("summary", summary);
      if (reference) p.set("reference", reference);
      if (minAmount) p.set("minAmount", minAmount);
      if (maxAmount) p.set("maxAmount", maxAmount);
      if (unbalancedOnly) p.set("unbalancedOnly", "1");
    } else if (kind === "period") {
      url = "/erp-api/reports/books/period-totals"; p.set("mode", mode);
    } else if (isSub) {
      if (accountIds.length === 0 && !party && !window.confirm("沒有選科目，會查詢全部科目，需要比較久的時間。要繼續嗎？")) return;
      url = "/erp-api/reports/books/subledger"; p.set("group", kind);
      if (accountIds.length) p.set("accountIds", accountIds.join(",")); else p.set("all", "1");
      if (party) p.set("party", party);
      if (summary) p.set("summary", summary);
      if (hideEmpty) p.set("hideEmpty", "1");
    } else if (kind === "trial") {
      url = "/erp-api/reports/books/trial-balance";
      if (includeZero) p.set("includeZero", "1");
    } else {
      url = "/erp-api/reports/books/cash";
      if (includeBank) p.set("includeBank", "1");
    }
    setLoading(true); setError("");
    try {
      const res = await fetch(`${url}?${p}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "查詢失敗");
      setData({ kind, body: json });
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "查詢失敗");
    }
    setLoading(false);
  };

  const filterText = [
    departmentId && `部門：${departments.find(d => String(d.id) === departmentId)?.name ?? ""}`,
    projectId && `專案：${projects.find(p => String(p.id) === projectId)?.name ?? ""}`,
  ].filter(Boolean).join("　");
  const subtitle = `期間：${startDate} 至 ${endDate}${filterText ? `　${filterText}` : ""}`;

  const buildExport = (): ExportOptions => {
    if (!data) throw new Error("請先查詢");
    const base = { title: meta[1], subtitle, fileName: `${meta[1].replace(/\//g, "-")}_${startDate}_${endDate}` };
    if (data.kind === "journal") {
      const d = data.body as JournalData;
      return { ...base, headers: ["單據號碼", "科目", "客戶/供應商", "摘要", "部門", "專案", "借方金額", "貸方金額"], columnKeys: ["ref", "acc", "party", "summary", "dept", "proj", "dr", "cr"],
        rows: [...d.rows.map(r => ({ ref: refText(r.date, r.reference, r.seq), acc: r.accountName, party: r.party, summary: r.summary, dept: r.department || "", proj: r.project || "", dr: amt(r.debit), cr: amt(r.credit) })),
          { ref: "合計", acc: "", party: "", summary: "", dept: "", proj: "", dr: fmt(d.totalDebit), cr: fmt(d.totalCredit) }] };
    }
    if (data.kind === "period") {
      const d = data.body as PeriodData;
      const rows: Record<string, string>[] = [];
      for (const p of d.periods) {
        for (const r of p.rows) rows.push({ period: p.period, acc: `[${r.accountNumber}] ${r.accountName}`, dr: amt(r.debit), cr: amt(r.credit) });
        rows.push({ period: p.period, acc: mode === "day" ? "[日總計]" : "[月總計]", dr: fmt(p.totalDebit), cr: fmt(p.totalCredit) });
      }
      return { ...base, headers: [mode === "day" ? "日期" : "月份", "科目名稱", "借方合計", "貸方合計"], columnKeys: ["period", "acc", "dr", "cr"], rows };
    }
    if (data.kind === "trial") {
      const d = data.body as TrialData;
      return { ...base, headers: ["期末餘額(借方)", "期末金額(借方)", "科目名稱", "期末金額(貸方)", "期末餘額(貸方)"], columnKeys: ["db", "da", "acc", "ca", "cb"],
        rows: [...d.rows.map(r => ({ db: amt(r.debitBalance), da: amt(r.debitAmount), acc: `${"　".repeat(r.depth)}[${r.accountNumber}] ${r.accountName}`, ca: amt(r.creditAmount), cb: amt(r.creditBalance) })),
          { db: fmt(d.total.debitBalance), da: fmt(d.total.debitAmount), acc: "合計", ca: fmt(d.total.creditAmount), cb: fmt(d.total.creditBalance) }] };
    }
    if (data.kind === "cash") {
      const d = data.body as CashData;
      return { ...base, headers: ["日期-號碼", "現金科目", "對應科目名稱", "對應客戶/供應商名稱", "摘要", "借方金額", "貸方金額", "餘額"], columnKeys: ["ref", "cash", "counter", "party", "summary", "dr", "cr", "bal"],
        rows: [{ ref: "結轉餘額", cash: "", counter: "", party: "", summary: "", dr: "", cr: "", bal: fmt(d.openingBalance) },
          ...d.rows.map(r => ({ ref: refText(r.date, r.reference), cash: r.cashAccount, counter: r.counterAccount, party: r.party, summary: r.summary, dr: amt(r.debit), cr: amt(r.credit), bal: fmt(r.balance) })),
          { ref: "合計", cash: "", counter: "", party: "", summary: "", dr: fmt(d.totalDebit), cr: fmt(d.totalCredit), bal: fmt(d.closingBalance) }] };
    }
    const d = data.body as SubData;
    const rows: Record<string, string>[] = [];
    for (const s of d.sections) {
      const head = `[${s.account.accountNumber}] ${s.account.accountName} / ${sectionLabel(data.kind, s)}`;
      rows.push({ head, ref: "結轉餘額", summary: "", dr: "", cr: "", bal: fmt(s.openingBalance) });
      for (const r of s.rows) rows.push({ head, ref: refText(r.date, r.reference), summary: r.summary, dr: amt(r.debit), cr: amt(r.credit), bal: fmt(r.balance) });
      rows.push({ head, ref: "合計", summary: "", dr: fmt(s.totalDebit), cr: fmt(s.totalCredit), bal: fmt(s.closingBalance) });
    }
    return { ...base, headers: ["科目／對象", "日期-號碼", "摘要", "借方金額", "貸方金額", "餘額"], columnKeys: ["head", "ref", "summary", "dr", "cr", "bal"], rows };
  };

  const select = "h-10 w-full rounded-md border border-input bg-background px-3 text-sm";
  const field = (label: string, node: ReactNode) => (
    <div><label className="mb-1 block text-sm font-medium text-muted-foreground">{label}</label>{node}</div>
  );

  return (
    <div className="space-y-6" data-report>
      <ReportHeader />
      <PageHeader title={meta[1]} description={meta[2]} />
      <div className="flex flex-wrap gap-1 print:hidden" role="tablist" aria-label="帳簿">
        {KINDS.map(([k, label]) => (
          <Button key={k} size="sm" variant={k === kind ? "default" : "outline"} role="tab" aria-selected={k === kind} onClick={() => navigate(`/reports/books/${k}`)}>{label}</Button>
        ))}
      </div>
      <Card className="print:hidden">
        <CardContent className="space-y-3 py-4">
          {kind === "period" && (
            <div className="flex flex-wrap items-center gap-x-5 text-sm">
              <span className="text-muted-foreground">類型</span>
              <label className="flex items-center gap-1.5"><input type="radio" name="pt-mode" checked={mode === "month"} onChange={() => setMode("month")} />月計表</label>
              <label className="flex items-center gap-1.5"><input type="radio" name="pt-mode" checked={mode === "day"} onChange={() => setMode("day")} />日計表</label>
            </div>
          )}
          {isSub && (
            <div className="flex flex-wrap items-center gap-x-5 text-sm">
              <span className="text-muted-foreground">類型</span>
              {([["line", "按行"], ["day", "按日期"], ["month", "按月"], ["summary", kind === "party-account" ? "按科目合計" : kind === "account-summary" ? "按摘要" : "按客戶/供應商合計"]] as [ViewType, string][]).map(([v, label]) => (
                <label key={v} className="flex items-center gap-1.5"><input type="radio" name="sub-view" checked={view === v} onChange={() => setView(v)} />{label}</label>
              ))}
            </div>
          )}
          <div className="flex flex-wrap items-end gap-3">
            {field("起始日期", <Input type="date" className="w-40" value={startDate} onChange={e => setStartDate(e.target.value)} />)}
            {field("結束日期", <Input type="date" className="w-40" value={endDate} onChange={e => setEndDate(e.target.value)} />)}
          </div>
          <div className="flex flex-wrap gap-1">
            {quickRanges().map(([label, f, t]) => (
              <Button key={label} type="button" size="sm" variant={startDate === f && endDate === t ? "default" : "ghost"} onClick={() => { setStartDate(f); setEndDate(t); }}>{label}</Button>
            ))}
          </div>
          <div className="grid gap-3 md:grid-cols-3">
            {(kind === "journal" || isSub) && <div className="md:col-span-1">{field("會計科目", <AccountMultiPicker accounts={accounts} value={accountIds} onChange={setAccountIds} />)}</div>}
            {field("部門", (
              <select className={select} value={departmentId} onChange={e => setDepartmentId(e.target.value)} aria-label="部門">
                <option value="">全部部門</option>
                {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            ))}
            {field("專案", (
              <select className={select} value={projectId} onChange={e => setProjectId(e.target.value)} aria-label="專案">
                <option value="">全部專案</option>
                {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            ))}
            {(kind === "journal" || kind === "account-party" || kind === "party-account") && field("客戶/供應商", <Input value={party} onChange={e => setParty(e.target.value)} placeholder="名稱的一部分" />)}
            {(kind === "journal" || kind === "account-summary") && field("摘要", <Input value={summary} onChange={e => setSummary(e.target.value)} placeholder="摘要的一部分" />)}
            {kind === "journal" && field("會計憑證號碼", <Input value={reference} onChange={e => setReference(e.target.value)} placeholder="例如 2026/10/01-3 或 JE-202610" />)}
            {kind === "journal" && field("金額", (
              <div className="flex items-center gap-2">
                <Input type="number" value={minAmount} onChange={e => setMinAmount(e.target.value)} aria-label="最低金額" />
                <span>~</span>
                <Input type="number" value={maxAmount} onChange={e => setMaxAmount(e.target.value)} aria-label="最高金額" />
              </div>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
            <span className="text-muted-foreground">其他</span>
            {kind === "journal" && <label className="flex items-center gap-1.5"><input type="checkbox" checked={unbalancedOnly} onChange={e => setUnbalancedOnly(e.target.checked)} />僅顯示借/貸不等的資料</label>}
            {isSub && <label className="flex items-center gap-1.5"><input type="checkbox" checked={showOpening} onChange={e => setShowOpening(e.target.checked)} />包括上個月結轉金額</label>}
            {isSub && <label className="flex items-center gap-1.5"><input type="checkbox" checked={hideEmpty} onChange={e => setHideEmpty(e.target.checked)} />{kind === "party-account" ? "沒有交易明細的科目除外" : "沒有交易明細的客戶/供應商除外"}</label>}
            {kind === "trial" && <label className="flex items-center gap-1.5"><input type="checkbox" checked={includeZero} onChange={e => setIncludeZero(e.target.checked)} />包括0餘額</label>}
            {kind === "cash" && <label className="flex items-center gap-1.5"><input type="checkbox" checked={includeBank} onChange={e => setIncludeBank(e.target.checked)} />包括存款</label>}
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
      {data?.kind === "journal" && <JournalView d={data.body as JournalData} subtitle={subtitle} />}
      {data?.kind === "period" && <PeriodView d={data.body as PeriodData} mode={mode} subtitle={subtitle} />}
      {data && (data.kind === "account-party" || data.kind === "party-account" || data.kind === "account-summary") && (
        <SubledgerView kind={data.kind} d={data.body as SubData} view={view} showOpening={showOpening} subtitle={subtitle} />
      )}
      {data?.kind === "trial" && <TrialView d={data.body as TrialData} subtitle={subtitle} />}
      {data?.kind === "cash" && <CashView d={data.body as CashData} subtitle={subtitle} />}
      {!data && !loading && <Card><CardContent className="py-12 text-center text-muted-foreground">設定條件後按「查詢(F8)」</CardContent></Card>}
    </div>
  );
}

/** 跟 Ecount 一樣按 F8 查詢 */
export function F8({ onQuery }: { onQuery: () => void }) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === "F8") { e.preventDefault(); onQuery(); } };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  });
  return null;
}

function sectionLabel(kind: Kind, s: SubSection) {
  if (kind === "account-summary") return s.summary || "（無摘要）";
  return s.party || "（無客戶/供應商）";
}

function ReportTable({ children, minWidth = 860 }: { children: ReactNode; minWidth?: number }) {
  return <Card><CardContent className="overflow-x-auto p-0"><table className="w-full text-sm" style={{ minWidth }}>{children}</table></CardContent></Card>;
}

function JournalView({ d, subtitle }: { d: JournalData; subtitle: string }) {
  return (
    <>
      <p className="text-sm text-muted-foreground">{subtitle}　{d.entryCount} 張傳票、{d.rows.length} 行</p>
      <ReportTable minWidth={1000}>
        <thead><tr className="border-b bg-muted/40 text-muted-foreground">
          <th className={`${th} text-left`}>單據號碼</th><th className={`${th} text-left`}>科目名</th><th className={`${th} text-left`}>客戶/供應商名</th>
          <th className={`${th} text-left`}>摘要</th><th className={`${th} text-left`}>部門</th><th className={`${th} text-left`}>專案</th>
          <th className={`${th} w-28 text-right`}>借方金額</th><th className={`${th} w-28 text-right`}>貸方金額</th>
        </tr></thead>
        <tbody>
          {d.rows.map((r, i) => (
            <tr key={`${r.entryId}-${r.seq}-${i}`} className={`border-b hover:bg-muted/40 ${i > 0 && d.rows[i - 1].entryId !== r.entryId ? "border-t-muted-foreground/30" : ""}`}>
              <td className={`${td} whitespace-nowrap font-mono text-xs`}>{refText(r.date, r.reference, r.seq)}</td>
              <td className={td}>{r.accountName}</td>
              <td className={`${td} max-w-[180px] truncate`}>{r.party}</td>
              <td className={`${td} max-w-[280px] truncate`} title={r.summary}>{r.summary}</td>
              <td className={`${td} whitespace-nowrap`}>{r.department || ""}</td>
              <td className={`${td} max-w-[160px] truncate`}>{r.project || ""}</td>
              <td className={num}>{amt(r.debit)}</td><td className={num}>{amt(r.credit)}</td>
            </tr>
          ))}
          <tr className="border-t-2 bg-primary/5 font-semibold">
            <td colSpan={6} className="px-3 py-2">合計</td>
            <td className="px-3 py-2 text-right font-mono">{fmt(d.totalDebit)}</td><td className="px-3 py-2 text-right font-mono">{fmt(d.totalCredit)}</td>
          </tr>
        </tbody>
      </ReportTable>
    </>
  );
}

function PeriodView({ d, mode, subtitle }: { d: PeriodData; mode: "day" | "month"; subtitle: string }) {
  if (d.periods.length === 0) return <Card><CardContent className="py-12 text-center text-muted-foreground">這段期間沒有傳票</CardContent></Card>;
  return (
    <>
      <p className="text-sm text-muted-foreground">{subtitle}</p>
      {d.periods.map(p => (
        <ReportTable key={p.period} minWidth={560}>
          <thead>
            <tr className="border-b"><th colSpan={3} className={`${th} text-left`}>{mode === "day" ? p.period.replace(/-/g, "/") : `${p.period.replace("-", "/")}`}</th></tr>
            <tr className="border-b bg-muted/40 text-muted-foreground">
              <th className={`${th} w-36 text-right`}>借方合計</th><th className={`${th} text-center`}>科目名稱</th><th className={`${th} w-36 text-right`}>貸方合計</th>
            </tr>
          </thead>
          <tbody>
            {p.rows.map(r => (
              <tr key={r.accountId} className="border-b hover:bg-muted/40">
                <td className={num}>{amt(r.debit)}</td><td className={`${td} text-center`}>[{r.accountNumber}] {r.accountName}</td><td className={num}>{amt(r.credit)}</td>
              </tr>
            ))}
            <tr className="border-t-2 bg-primary/5 font-semibold">
              <td className="px-3 py-2 text-right font-mono">{fmt(p.totalDebit)}</td><td className="px-3 py-2 text-center">{mode === "day" ? "[日總計]" : "[月總計]"}</td><td className="px-3 py-2 text-right font-mono">{fmt(p.totalCredit)}</td>
            </tr>
          </tbody>
        </ReportTable>
      ))}
      {d.periods.length > 1 && (
        <p className="text-right text-sm font-semibold">期間總計　借方 {fmt(d.totalDebit)}　貸方 {fmt(d.totalCredit)}</p>
      )}
    </>
  );
}

type SubDisplay = { kind: "row"; r: SubRow } | { kind: "group"; label: string; debit: number; credit: number; balance: number } | { kind: "subtotal"; label: string; debit: number; credit: number };
function subRows(rows: SubRow[], view: ViewType): SubDisplay[] {
  if (view === "line") {
    const out: SubDisplay[] = [];
    let month = "", dr = 0, cr = 0;
    const flush = () => { if (month) out.push({ kind: "subtotal", label: `${month.replace("-", "/")} 合計`, debit: dr, credit: cr }); };
    for (const r of rows) {
      const m = r.date.slice(0, 7);
      if (m !== month) { flush(); month = m; dr = 0; cr = 0; }
      dr += r.debit; cr += r.credit;
      out.push({ kind: "row", r });
    }
    flush();
    return out;
  }
  const out: SubDisplay[] = [];
  for (const r of rows) {
    const key = view === "day" ? r.date.replace(/-/g, "/") : r.date.slice(0, 7).replace("-", "/");
    const last = out[out.length - 1];
    if (last && last.kind === "group" && last.label === key) { last.debit += r.debit; last.credit += r.credit; last.balance = r.balance; }
    else out.push({ kind: "group", label: key, debit: r.debit, credit: r.credit, balance: r.balance });
  }
  return out;
}

export function SubledgerView({ kind, d, view, showOpening, subtitle }: { kind: Kind; d: SubData; view: ViewType; showOpening: boolean; subtitle: string }) {
  const sections = useMemo(() => d.sections, [d]);
  if (sections.length === 0) return <Card><CardContent className="py-12 text-center text-muted-foreground">沒有符合條件的資料</CardContent></Card>;
  if (view === "summary") {
    const firstCol = kind === "party-account" ? "客戶/供應商" : "科目";
    const secondCol = kind === "party-account" ? "科目" : kind === "account-summary" ? "摘要" : "客戶/供應商";
    return (
      <>
        <p className="text-sm text-muted-foreground">{subtitle}</p>
        <ReportTable minWidth={820}>
          <thead><tr className="border-b bg-muted/40 text-muted-foreground">
            <th className={`${th} text-left`}>{firstCol}</th><th className={`${th} text-left`}>{secondCol}</th>
            {showOpening && <th className={`${th} w-32 text-right`}>結轉餘額</th>}
            <th className={`${th} w-32 text-right`}>借方金額</th><th className={`${th} w-32 text-right`}>貸方金額</th><th className={`${th} w-32 text-right`}>餘額</th>
          </tr></thead>
          <tbody>
            {sections.map(s => {
              const acc = `[${s.account.accountNumber}] ${s.account.accountName}`;
              const other = sectionLabel(kind, s);
              return (
                <tr key={s.key} className="border-b hover:bg-muted/40">
                  <td className={td}>{kind === "party-account" ? other : acc}</td><td className={td}>{kind === "party-account" ? acc : other}</td>
                  {showOpening && <td className={num}>{fmt(s.openingBalance)}</td>}
                  <td className={num}>{amt(s.totalDebit)}</td><td className={num}>{amt(s.totalCredit)}</td>
                  <td className={num}>{fmt(showOpening ? s.closingBalance : s.closingBalance - s.openingBalance)}</td>
                </tr>
              );
            })}
            <tr className="border-t-2 bg-primary/5 font-semibold">
              <td colSpan={showOpening ? 3 : 2} className="px-3 py-2">合計（{sections.length} 組）</td>
              <td className="px-3 py-2 text-right font-mono">{fmt(sections.reduce((a, s) => a + s.totalDebit, 0))}</td>
              <td className="px-3 py-2 text-right font-mono">{fmt(sections.reduce((a, s) => a + s.totalCredit, 0))}</td>
              <td />
            </tr>
          </tbody>
        </ReportTable>
      </>
    );
  }
  return (
    <>
      <p className="text-sm text-muted-foreground">{subtitle}　共 {sections.length} 組</p>
      {sections.map(s => {
        const shift = showOpening ? 0 : s.openingBalance;
        const title = kind === "party-account"
          ? `${sectionLabel(kind, s)} / [${s.account.accountNumber}] ${s.account.accountName}`
          : `[${s.account.accountNumber}] ${s.account.accountName} / ${sectionLabel(kind, s)}`;
        return (
          <div key={s.key} className="space-y-1 break-inside-avoid">
            <p className="text-sm font-semibold">{title}</p>
            <ReportTable minWidth={760}>
              <thead><tr className="border-b bg-muted/40 text-muted-foreground">
                <th className={`${th} w-40 text-left`}>日期-號碼</th>
                {kind === "account-summary" && <th className={`${th} text-left`}>客戶/供應商</th>}
                <th className={`${th} text-left`}>摘要</th>
                <th className={`${th} w-28 text-right`}>借方金額</th><th className={`${th} w-28 text-right`}>貸方金額</th><th className={`${th} w-32 text-right`}>餘額</th>
              </tr></thead>
              <tbody>
                {showOpening && (
                  <tr className="border-b bg-primary/5">
                    <td colSpan={kind === "account-summary" ? 3 : 2} className={`${td} font-semibold`}>結轉餘額</td>
                    <td className={num} /><td className={num} /><td className={`${num} font-semibold`}>{fmt(s.openingBalance)}</td>
                  </tr>
                )}
                {subRows(s.rows, view).map((x, i) => x.kind === "row" ? (
                  <tr key={i} className="border-b hover:bg-muted/40">
                    <td className={`${td} whitespace-nowrap font-mono text-xs`}>{refText(x.r.date, x.r.reference)}</td>
                    {kind === "account-summary" && <td className={`${td} max-w-[180px] truncate`}>{x.r.party}</td>}
                    <td className={`${td} max-w-[320px] truncate`} title={x.r.summary}>{x.r.summary}</td>
                    <td className={num}>{amt(x.r.debit)}</td><td className={num}>{amt(x.r.credit)}</td><td className={num}>{fmt(x.r.balance - shift)}</td>
                  </tr>
                ) : x.kind === "subtotal" ? (
                  <tr key={i} className="border-b bg-muted/30 text-muted-foreground">
                    <td colSpan={kind === "account-summary" ? 3 : 2} className={`${td} text-right font-medium`}>{x.label}</td>
                    <td className={num}>{fmt(x.debit)}</td><td className={num}>{fmt(x.credit)}</td><td />
                  </tr>
                ) : (
                  <tr key={i} className="border-b hover:bg-muted/40">
                    <td colSpan={kind === "account-summary" ? 3 : 2} className={td}>{x.label}</td>
                    <td className={num}>{amt(x.debit)}</td><td className={num}>{amt(x.credit)}</td><td className={num}>{fmt(x.balance - shift)}</td>
                  </tr>
                ))}
                <tr className="border-t-2 bg-primary/5 font-semibold">
                  <td colSpan={kind === "account-summary" ? 3 : 2} className="px-3 py-2">合計</td>
                  <td className="px-3 py-2 text-right font-mono">{fmt(s.totalDebit)}</td><td className="px-3 py-2 text-right font-mono">{fmt(s.totalCredit)}</td>
                  <td className="px-3 py-2 text-right font-mono">{fmt(s.closingBalance - shift)}</td>
                </tr>
              </tbody>
            </ReportTable>
          </div>
        );
      })}
    </>
  );
}

function CashView({ d, subtitle }: { d: CashData; subtitle: string }) {
  return (
    <>
      <p className="text-sm text-muted-foreground">{subtitle}　現金科目：{d.cashAccounts.map(a => `[${a.accountNumber}] ${a.accountName}`).join("、") || "（找不到 1111 現金科目）"}</p>
      <ReportTable minWidth={1000}>
        <thead><tr className="border-b bg-muted/40 text-muted-foreground">
          <th className={`${th} w-40 text-left`}>日期-號碼</th>
          {d.cashAccounts.length > 1 && <th className={`${th} text-left`}>現金科目</th>}
          <th className={`${th} text-left`}>對應科目名稱</th><th className={`${th} text-left`}>對應客戶/供應商名稱</th><th className={`${th} text-left`}>摘要</th>
          <th className={`${th} w-28 text-right`}>借方金額</th><th className={`${th} w-28 text-right`}>貸方金額</th><th className={`${th} w-32 text-right`}>餘額</th>
        </tr></thead>
        <tbody>
          <tr className="border-b bg-primary/5">
            <td colSpan={d.cashAccounts.length > 1 ? 5 : 4} className={`${td} font-semibold`}>結轉餘額</td>
            <td className={num} /><td className={num} /><td className={`${num} font-semibold`}>{fmt(d.openingBalance)}</td>
          </tr>
          {d.rows.map((r, i) => (
            <tr key={`${r.entryId}-${i}`} className="border-b hover:bg-muted/40">
              <td className={`${td} whitespace-nowrap font-mono text-xs`}>{refText(r.date, r.reference)}</td>
              {d.cashAccounts.length > 1 && <td className={td}>{r.cashAccount}</td>}
              <td className={td}>{r.counterAccount}</td><td className={`${td} max-w-[180px] truncate`}>{r.party}</td>
              <td className={`${td} max-w-[280px] truncate`} title={r.summary}>{r.summary}</td>
              <td className={num}>{amt(r.debit)}</td><td className={num}>{amt(r.credit)}</td><td className={num}>{fmt(r.balance)}</td>
            </tr>
          ))}
          <tr className="border-t-2 bg-primary/5 font-semibold">
            <td colSpan={d.cashAccounts.length > 1 ? 5 : 4} className="px-3 py-2">合計</td>
            <td className="px-3 py-2 text-right font-mono">{fmt(d.totalDebit)}</td><td className="px-3 py-2 text-right font-mono">{fmt(d.totalCredit)}</td>
            <td className="px-3 py-2 text-right font-mono">{fmt(d.closingBalance)}</td>
          </tr>
        </tbody>
      </ReportTable>
    </>
  );
}

function TrialView({ d, subtitle }: { d: TrialData; subtitle: string }) {
  return (
    <>
      <p className="text-sm text-muted-foreground">{subtitle}</p>
      <ReportTable minWidth={820}>
        <thead><tr className="border-b bg-muted/40 text-muted-foreground">
          <th className={`${th} w-32 text-right`}>期末餘額(借方)</th><th className={`${th} w-32 text-right`}>期末金額(借方)</th>
          <th className={`${th} text-center`}>科目名稱</th>
          <th className={`${th} w-32 text-right`}>期末金額(貸方)</th><th className={`${th} w-32 text-right`}>期末餘額(貸方)</th>
        </tr></thead>
        <tbody>
          {d.rows.map(r => (
            <tr key={`${r.accountId}-${r.accountName}`} className={`border-b hover:bg-muted/40 ${r.isGroup ? "bg-muted/20 font-semibold" : ""}`}>
              <td className={num}>{amt(r.debitBalance)}</td><td className={num}>{amt(r.debitAmount)}</td>
              <td className={td} style={{ paddingLeft: 12 + r.depth * 16 }}>[{r.accountNumber}] {r.accountName}</td>
              <td className={num}>{amt(r.creditAmount)}</td><td className={num}>{amt(r.creditBalance)}</td>
            </tr>
          ))}
          <tr className="border-t-2 bg-primary/5 font-semibold">
            <td className="px-3 py-2 text-right font-mono">{fmt(d.total.debitBalance)}</td><td className="px-3 py-2 text-right font-mono">{fmt(d.total.debitAmount)}</td>
            <td className="px-3 py-2 text-center">合計</td>
            <td className="px-3 py-2 text-right font-mono">{fmt(d.total.creditAmount)}</td><td className="px-3 py-2 text-right font-mono">{fmt(d.total.creditBalance)}</td>
          </tr>
        </tbody>
      </ReportTable>
    </>
  );
}
