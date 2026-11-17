import { useState, useEffect } from "react";
import { ReportHeader } from "@/components/shared/report-header";
import { fmtMoney } from "@/lib/report-format";
import { useAutoReloadKey } from "@/lib/auto-refresh";
import { PageHeader } from "@/components/shared/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Printer } from "lucide-react";
import { ExportMenu } from "@/components/shared/export-menu";
import { DateRangePresets } from "@/components/shared/date-range-presets";
import { AccountMultiPicker, type PickerAccount } from "@/components/accounting/account-multi-picker";
import type { ExportOptions } from "@/lib/export-utils";
import { JournalEntryDialog } from "@/components/accounting/journal-entry-dialog";

interface LedgerRow { date: string; entryId: number; reference: string | null; party: string | null; summary: string; debit: number; credit: number; balance: number; department: string | null; project: string | null }
interface LedgerSection { account: { id: number; accountNumber: string; accountName: string; accountType: string }; openingBalance: number; closingBalance: number; totalDebit: number; totalCredit: number; rows: LedgerRow[] }
interface LedgerData { startDate: string | null; endDate: string | null; filteredByDimension: boolean; accounts: LedgerSection[] }

const fmt = fmtMoney;

type ViewType = "line" | "day" | "month" | "summary";
const VIEW_TYPES: [ViewType, string][] = [["line", "按行"], ["day", "按日期"], ["month", "按月"], ["summary", "按科目合計"]];

const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
/** Ecount 查詢畫面下方的日期快捷鍵 */
function quickRanges(): [string, string, string][] {
  const t = new Date();
  const day = (offset: number) => { const d = new Date(t); d.setDate(d.getDate() + offset); return d; };
  const monday = day(-((t.getDay() + 6) % 7));
  const lastMonday = new Date(monday); lastMonday.setDate(monday.getDate() - 7);
  const lastSunday = new Date(monday); lastSunday.setDate(monday.getDate() - 1);
  const firstOfMonth = new Date(t.getFullYear(), t.getMonth(), 1);
  const lastMonthStart = new Date(t.getFullYear(), t.getMonth() - 1, 1);
  const lastMonthEnd = new Date(t.getFullYear(), t.getMonth(), 0);
  return [
    ["今日", ymd(t), ymd(t)], ["昨日", ymd(day(-1)), ymd(day(-1))],
    ["本週(~今天)", ymd(monday), ymd(t)], ["上週", ymd(lastMonday), ymd(lastSunday)],
    ["本月(~今天)", ymd(firstOfMonth), ymd(t)], ["上個月", ymd(lastMonthStart), ymd(lastMonthEnd)],
    ["本年度", `${t.getFullYear()}-01-01`, ymd(t)], ["去年度", `${t.getFullYear() - 1}-01-01`, `${t.getFullYear() - 1}-12-31`],
  ];
}

/** 「日期-號碼」：Ecount 搬來的用 Ecount 號碼（2026/10/27 -19），系統單據用來源單號，其他用分錄編號 */
function dateNo(r: LedgerRow): string {
  const d = r.date.replace(/-/g, "/");
  const ec = /^\d{4}\/\d{2}\/\d{2}-(\d+)$/.exec(r.reference || "");
  return ec ? `${d} -${ec[1]}` : `${d} ${r.reference || ""}`.trim();
}

type DisplayRow =
  | { kind: "row"; row: LedgerRow }
  | { kind: "group"; label: string; debit: number; credit: number; balance: number }
  | { kind: "subtotal"; label: string; debit: number; credit: number };

/** 按行時每個月結束插一列月合計；按日期／按月就把同一天／同一月加總成一列 */
function displayRows(rows: LedgerRow[], view: ViewType): DisplayRow[] {
  if (view === "line") {
    const out: DisplayRow[] = [];
    let month = "", d = 0, c = 0;
    const flush = () => { if (month) out.push({ kind: "subtotal", label: `${month.replace("-", "/")} 合計`, debit: d, credit: c }); };
    for (const r of rows) {
      const m = r.date.slice(0, 7);
      if (m !== month) { flush(); month = m; d = 0; c = 0; }
      d += r.debit; c += r.credit;
      out.push({ kind: "row", row: r });
    }
    flush();
    return out;
  }
  const key = (r: LedgerRow) => view === "day" ? r.date : r.date.slice(0, 7);
  const groups: DisplayRow[] = [];
  for (const r of rows) {
    const last = groups[groups.length - 1] as Extract<DisplayRow, { kind: "group" }> | undefined;
    if (last && last.label === key(r)) { last.debit += r.debit; last.credit += r.credit; last.balance = r.balance; }
    else groups.push({ kind: "group", label: key(r), debit: r.debit, credit: r.credit, balance: r.balance });
  }
  return groups;
}

export default function GeneralLedgerPage() {
  const reloadKey = useAutoReloadKey();
  const [startDate, setStartDate] = useState(() => `${new Date().getFullYear()}-01-01`);
  const [endDate, setEndDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [accountIds, setAccountIds] = useState<number[]>([]);
  const [departmentId, setDepartmentId] = useState("");
  const [projectId, setProjectId] = useState("");
  const [hideEmpty, setHideEmpty] = useState(true);
  const [view, setView] = useState<ViewType>("line");
  const [showOpening, setShowOpening] = useState(true);
  const [accounts, setAccounts] = useState<PickerAccount[]>([]);
  const [departments, setDepartments] = useState<{ id: number; name: string }[]>([]);
  const [projects, setProjects] = useState<{ id: number; name: string }[]>([]);
  const [data, setData] = useState<LedgerData | null>(null);
  const [openEntryId, setOpenEntryId] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch(`/erp-api/accounts`).then(r => r.json()).then(d => setAccounts(Array.isArray(d) ? d : [])).catch(() => {});
    fetch(`/erp-api/departments`).then(r => r.json()).then(d => setDepartments(Array.isArray(d) ? d : [])).catch(() => {});
    fetch(`/erp-api/projects`).then(r => r.json()).then(d => setProjects(Array.isArray(d) ? d : [])).catch(() => {});
  }, [reloadKey]);

  const fetchReport = async () => {
    // 跟 Ecount 一樣：沒選科目就查全部科目，資料多會比較久，先確認
    if (accountIds.length === 0 && !window.confirm("沒有選科目，會查詢全部科目，需要比較久的時間。要繼續嗎？")) return;
    setLoading(true); setError("");
    try {
      const params = new URLSearchParams({ accountIds: accountIds.join(","), hideEmpty: hideEmpty ? "1" : "0" });
      if (accountIds.length === 0) params.set("all", "1");
      if (startDate) params.set("startDate", startDate);
      if (endDate) params.set("endDate", endDate);
      if (departmentId) params.set("departmentId", departmentId);
      if (projectId) params.set("projectId", projectId);
      const res = await fetch(`/erp-api/reports/general-ledger/multi?${params}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "查詢失敗");
      setData(json);
    } catch (e: any) {
      setError(e.message || "查詢失敗");
    }
    setLoading(false);
  };

  const filterText = [departmentId && `部門：${departments.find(d => String(d.id) === departmentId)?.name}`, projectId && `專案：${projects.find(p => String(p.id) === projectId)?.name}`].filter(Boolean).join("　");

  const buildExport = (): ExportOptions => {
    if (!data) throw new Error("請先查詢");
    const rows: Record<string, string>[] = [];
    for (const s of data.accounts) {
      rows.push({ date: `${s.account.accountNumber} ${s.account.accountName}`, desc: "上期結轉", party: "", debit: "", credit: "", balance: fmt(s.openingBalance) });
      for (const r of s.rows) rows.push({ date: dateNo(r), desc: r.summary, party: r.party || "", debit: r.debit ? fmt(r.debit) : "", credit: r.credit ? fmt(r.credit) : "", balance: fmt(r.balance) });
      rows.push({ date: "", desc: "合計", party: "", debit: fmt(s.totalDebit), credit: fmt(s.totalCredit), balance: fmt(s.closingBalance) });
    }
    return {
      title: "總分類帳", subtitle: `期間：${startDate} 至 ${endDate}${filterText ? `　${filterText}` : ""}`, fileName: `總分類帳_${startDate}_${endDate}`,
      headers: ["日期-號碼", "摘要", "客戶/供應商名稱", "借方金額", "貸方金額", "餘額"],
      columnKeys: ["date", "desc", "party", "debit", "credit", "balance"], rows,
    };
  };

  const select = "h-10 w-full rounded-md border border-input bg-background px-3 text-sm";

  return (
    <div className="space-y-6" data-report>
      <ReportHeader />
      <PageHeader title="總分類帳" description="科目可以複選；勾上層科目會帶出底下全部科目。可再依部門、專案篩選。" />
      <Card>
        <CardContent className="py-4 space-y-3">
          <div className="grid gap-3 md:grid-cols-[2fr_1fr_1fr]">
            <div>
              <label className="mb-1 block text-sm font-medium text-muted-foreground">科目</label>
              <AccountMultiPicker accounts={accounts} value={accountIds} onChange={setAccountIds} />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-muted-foreground">部門</label>
              <select className={select} value={departmentId} onChange={e => setDepartmentId(e.target.value)} aria-label="部門">
                <option value="">全部部門</option>
                {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-muted-foreground">專案</label>
              <select className={select} value={projectId} onChange={e => setProjectId(e.target.value)} aria-label="專案">
                <option value="">全部專案</option>
                {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <div><label className="mb-1 block text-sm font-medium text-muted-foreground">起始日期</label><Input type="date" className="w-40" value={startDate} onChange={e => setStartDate(e.target.value)} /></div>
            <div><label className="mb-1 block text-sm font-medium text-muted-foreground">結束日期</label><Input type="date" className="w-40" value={endDate} onChange={e => setEndDate(e.target.value)} /></div>
            <DateRangePresets from={startDate} to={endDate} onChange={({ from, to }) => { setStartDate(from); setEndDate(to); }} />
          </div>
          <div className="flex flex-wrap gap-1">
            {quickRanges().map(([label, f, t]) => (
              <Button key={label} type="button" size="sm" variant={startDate === f && endDate === t ? "default" : "ghost"} onClick={() => { setStartDate(f); setEndDate(t); }}>{label}</Button>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
            <span className="text-muted-foreground">類型</span>
            {VIEW_TYPES.map(([v, label]) => (
              <label key={v} className="flex items-center gap-1.5"><input type="radio" name="gl-view" checked={view === v} onChange={() => setView(v)} />{label}</label>
            ))}
            <span className="ml-2 text-muted-foreground">其他</span>
            <label className="flex items-center gap-1.5"><input type="checkbox" checked={showOpening} onChange={e => setShowOpening(e.target.checked)} />包括上期結轉金額</label>
            <label className="flex items-center gap-1.5"><input type="checkbox" checked={hideEmpty} onChange={e => setHideEmpty(e.target.checked)} />沒有交易的科目不顯示</label>
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <div className="ml-auto flex gap-2">
              <Button onClick={fetchReport} disabled={loading}>{loading ? "查詢中..." : "查詢"}</Button>
              {data && <Button variant="outline" onClick={() => window.print()}><Printer className="mr-1 h-4 w-4" />列印</Button>}
              {data && <ExportMenu getExportOptions={buildExport} />}
            </div>
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          {data?.filteredByDimension && <p className="text-xs text-muted-foreground">有篩部門或專案時，期初餘額只算篩得到的分錄；開帳時輸入的期初金額沒有分部門，不算在內。</p>}
        </CardContent>
      </Card>

      {data && data.accounts.length === 0 && <Card><CardContent className="py-12 text-center text-muted-foreground">這段期間選到的科目都沒有交易</CardContent></Card>}

      {data && data.accounts.length > 0 && view === "summary" && (
        <Card>
          <CardContent className="overflow-x-auto p-0">
            <table className="w-full min-w-[720px] text-sm">
              <thead>
                <tr className="border-b bg-muted/40 text-muted-foreground">
                  <th className="px-3 py-2 text-left font-semibold">科目</th>
                  {showOpening && <th className="w-32 px-3 py-2 text-right font-semibold">上期結轉</th>}
                  <th className="w-32 px-3 py-2 text-right font-semibold">借方</th>
                  <th className="w-32 px-3 py-2 text-right font-semibold">貸方</th>
                  <th className="w-32 px-3 py-2 text-right font-semibold">期末餘額</th>
                </tr>
              </thead>
              <tbody>
                {data.accounts.map(s => (
                  <tr key={s.account.id} className="border-b hover:bg-muted/40">
                    <td className="px-3 py-1.5">[{s.account.accountNumber}] {s.account.accountName}</td>
                    {showOpening && <td className="px-3 py-1.5 text-right font-mono">{fmt(s.openingBalance)}</td>}
                    <td className="px-3 py-1.5 text-right font-mono">{fmt(s.totalDebit)}</td>
                    <td className="px-3 py-1.5 text-right font-mono">{fmt(s.totalCredit)}</td>
                    <td className="px-3 py-1.5 text-right font-mono">{fmt(showOpening ? s.closingBalance : s.closingBalance - s.openingBalance)}</td>
                  </tr>
                ))}
                <tr className="border-t-2 bg-primary/5 font-semibold">
                  <td className="px-3 py-2">合計（{data.accounts.length} 個科目）</td>
                  {showOpening && <td />}
                  <td className="px-3 py-2 text-right font-mono">{fmt(data.accounts.reduce((a, s) => a + s.totalDebit, 0))}</td>
                  <td className="px-3 py-2 text-right font-mono">{fmt(data.accounts.reduce((a, s) => a + s.totalCredit, 0))}</td>
                  <td />
                </tr>
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}

      {view !== "summary" && data?.accounts.map(s => {
        const shift = showOpening ? 0 : s.openingBalance; // 不含上期結轉時，餘額從 0 起算
        // 跟 Ecount 一樣，結轉金額放在借方或貸方欄，合計也把它加進去
        const debitSide = ["asset", "expense"].includes(s.account.accountType.toLowerCase()) === s.openingBalance >= 0;
        const openD = showOpening && debitSide ? Math.abs(s.openingBalance) : 0;
        const openC = showOpening && !debitSide ? Math.abs(s.openingBalance) : 0;
        return (
        <Card key={s.account.id}>
          <CardHeader className="border-b py-3">
            <CardTitle className="flex flex-wrap items-baseline justify-between gap-2 text-base">
              <span>[{s.account.accountNumber}] {s.account.accountName}</span>
              <span className="text-sm font-normal text-muted-foreground">{s.rows.length} 筆　期間：{startDate} 至 {endDate}{filterText && `　${filterText}`}</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="overflow-x-auto p-0">
            <table className="w-full min-w-[760px] text-sm">
              <thead>
                <tr className="border-b bg-muted/40 text-muted-foreground">
                  <th className="w-44 px-3 py-2 text-left font-semibold">日期-號碼</th>
                  <th className="px-3 py-2 text-left font-semibold">摘要</th>
                  <th className="w-48 px-3 py-2 text-left font-semibold">客戶/供應商名稱</th>
                  <th className="w-28 px-3 py-2 text-right font-semibold">借方</th>
                  <th className="w-28 px-3 py-2 text-right font-semibold">貸方</th>
                  <th className="w-32 px-3 py-2 text-right font-semibold">餘額</th>
                </tr>
              </thead>
              <tbody>
                {showOpening && (
                  <tr className="border-b bg-primary/5">
                    <td colSpan={3} className="px-3 py-1.5 font-semibold">上期結轉</td>
                    <td className="px-3 py-1.5 text-right font-mono">{openD ? fmt(openD) : ""}</td>
                    <td className="px-3 py-1.5 text-right font-mono">{openC ? fmt(openC) : ""}</td>
                    <td className="px-3 py-1.5 text-right font-mono font-semibold">{fmt(s.openingBalance)}</td>
                  </tr>
                )}
                {displayRows(s.rows, view).map((d, i) => d.kind === "row" ? (
                  <tr key={`${d.row.entryId}-${i}`} className="border-b hover:bg-muted/40">
                    <td className="whitespace-nowrap px-3 py-1.5">
                      <button type="button" className="text-left text-primary hover:underline" onClick={() => setOpenEntryId(d.row.entryId)} title="打開這張分錄">{dateNo(d.row)}</button>
                    </td>
                    <td className="max-w-[360px] truncate px-3 py-1.5" title={d.row.summary}>{d.row.summary}</td>
                    <td className="max-w-[200px] truncate px-3 py-1.5">{d.row.party || ""}</td>
                    <td className="px-3 py-1.5 text-right font-mono">{d.row.debit ? fmt(d.row.debit) : ""}</td>
                    <td className="px-3 py-1.5 text-right font-mono">{d.row.credit ? fmt(d.row.credit) : ""}</td>
                    <td className="px-3 py-1.5 text-right font-mono">{fmt(d.row.balance - shift)}</td>
                  </tr>
                ) : d.kind === "subtotal" ? (
                  <tr key={`sub-${i}`} className="border-b bg-muted/30 text-muted-foreground">
                    <td colSpan={3} className="px-3 py-1.5 text-right font-medium">{d.label}</td>
                    <td className="px-3 py-1.5 text-right font-mono">{fmt(d.debit)}</td>
                    <td className="px-3 py-1.5 text-right font-mono">{fmt(d.credit)}</td>
                    <td />
                  </tr>
                ) : (
                  <tr key={`grp-${i}`} className="border-b hover:bg-muted/40">
                    <td colSpan={3} className="whitespace-nowrap px-3 py-1.5">{view === "month" ? d.label.replace("-", "/") : d.label}</td>
                    <td className="px-3 py-1.5 text-right font-mono">{d.debit ? fmt(d.debit) : ""}</td>
                    <td className="px-3 py-1.5 text-right font-mono">{d.credit ? fmt(d.credit) : ""}</td>
                    <td className="px-3 py-1.5 text-right font-mono">{fmt(d.balance - shift)}</td>
                  </tr>
                ))}
                <tr className="border-t-2 bg-primary/5 font-semibold">
                  <td colSpan={3} className="px-3 py-2">合計／期末餘額</td>
                  <td className="px-3 py-2 text-right font-mono">{fmt(s.totalDebit + openD)}</td>
                  <td className="px-3 py-2 text-right font-mono">{fmt(s.totalCredit + openC)}</td>
                  <td className="px-3 py-2 text-right font-mono">{fmt(s.closingBalance - shift)}</td>
                </tr>
              </tbody>
            </table>
          </CardContent>
        </Card>
        );
      })}

      <JournalEntryDialog entryId={openEntryId} onClose={() => setOpenEntryId(null)} />
      {!data && !loading && <Card><CardContent className="py-12 text-center text-muted-foreground">選好科目（可複選）後按「查詢」；不選科目會查全部科目</CardContent></Card>}
    </div>
  );
}
