import { useState, useEffect, type ReactNode } from "react";
import { ReportHeader } from "@/components/shared/report-header";
import { percentOf, scaledMoney } from "@/lib/statement-display";
import { useListProjects, useListDepartments } from "@workspace/erp-api-client-react";
import { PageHeader } from "@/components/shared/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { TrendingUp, TrendingDown, DollarSign, Printer, ChevronDown, ChevronRight, List, Table2 } from "lucide-react";
import { ExportMenu } from "@/components/shared/export-menu";
import { buildVerticalIncomeExport, buildCrossIncomeExport } from "@/lib/export-utils";

import { LookupSelect } from "@/components/shared/lookup-select";
const BASE = import.meta.env.BASE_URL.endsWith("/") ? import.meta.env.BASE_URL : import.meta.env.BASE_URL + "/";

type FilterMode = "all" | "project" | "department";
type ViewMode = "vertical" | "horizontal";
type PeriodMode = "month" | "quarter" | "year" | "custom";

interface LineItem {
  accountId: number;
  accountNumber: string;
  accountName: string;
  amount: number;
}

interface GroupSection {
  groupName: string;
  groupNumber: string;
  items: LineItem[];
  subtotal: number;
}

interface IncomeStatementData {
  startDate: string | null;
  endDate: string | null;
  income: GroupSection[];
  expense: GroupSection[];
  totalIncome: number;
  totalExpense: number;
  netProfit: number;
  projectBreakdown?: Array<{ projectId: number; projectName: string; income: number; expense: number; net: number }>;
}

const today = new Date();
const currentMonth = today.toISOString().slice(0, 7);
const currentYear = String(today.getFullYear());
const currentQuarter = `${today.getFullYear()}-Q${Math.floor(today.getMonth() / 3) + 1}`;
function periodDates(mode: PeriodMode, value: string): [string, string] {
  if (mode === "month") {
    const [y, m] = value.split("-").map(Number);
    return [`${value}-01`, new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10)];
  }
  if (mode === "quarter") {
    const [year, quarter] = value.split("-Q").map(Number);
    const month = (quarter - 1) * 3;
    return [
      `${year}-${String(month + 1).padStart(2, "0")}-01`,
      new Date(Date.UTC(year, month + 3, 0)).toISOString().slice(0, 10),
    ];
  }
  return [`${value}-01-01`, `${value}-12-31`];
}

function shiftYearClamped(dateText: string, years: number): string {
  const [year, month, day] = dateText.split("-").map(Number);
  const targetYear = year + years;
  const lastDay = new Date(Date.UTC(targetYear, month, 0)).getUTCDate();
  return new Date(Date.UTC(targetYear, month - 1, Math.min(day, lastDay))).toISOString().slice(0, 10);
}

function previousPeriodDates(mode: PeriodMode, value: string, startDate: string, endDate: string): [string, string] {
  if (mode === "year") return periodDates("year", String(Number(value) - 1));
  if (mode === "month") {
    const [year, month] = value.split("-").map(Number);
    const previous = new Date(Date.UTC(year, month - 2, 1)).toISOString().slice(0, 7);
    return periodDates("month", previous);
  }
  if (mode === "quarter") {
    const [year, quarter] = value.split("-Q").map(Number);
    const previousQuarter = quarter === 1 ? `${year - 1}-Q4` : `${year}-Q${quarter - 1}`;
    return periodDates("quarter", previousQuarter);
  }
  const currentStart = new Date(`${startDate}T00:00:00Z`);
  const currentEnd = new Date(`${endDate}T00:00:00Z`);
  const compareEndDate = new Date(currentStart.getTime() - 86400000);
  const compareStartDate = new Date(compareEndDate.getTime() - (currentEnd.getTime() - currentStart.getTime()));
  return [compareStartDate.toISOString().slice(0, 10), compareEndDate.toISOString().slice(0, 10)];
}

interface CrossRow {
  accountId: number;
  accountNumber: string;
  accountName: string;
  totalAmount: number;
  breakdown: Record<string, number>;
}

interface CrossColumn { id: string; name: string; }

interface CrossData {
  startDate: string | null;
  endDate: string | null;
  dimension: string;
  columns: CrossColumn[];
  incomeRows: CrossRow[];
  expenseRows: CrossRow[];
  totalIncome: number;
  totalExpense: number;
  netProfit: number;
  columnTotals: Record<string, { income: number; expense: number; net: number }>;
}

export default function IncomeStatementPage() {
  const [startDate, setStartDate] = useState(() => `${new Date().getFullYear()}-01-01`);
  const [endDate, setEndDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [periodMode, setPeriodMode] = useState<PeriodMode>("year");
  const [periodValue, setPeriodValue] = useState(currentYear);
  const [comparison, setComparison] = useState<"previous" | "lastYear">("lastYear");
  const [filterMode, setFilterMode] = useState<FilterMode>("all");
  const [projectId, setProjectId] = useState<number | "">("");
  const [departmentId, setDepartmentId] = useState<number | "">("");
  const [viewMode, setViewMode] = useState<ViewMode>("vertical");
  const [crossDimension, setCrossDimension] = useState<"project" | "department">("project");
  const [data, setData] = useState<IncomeStatementData | null>(null);
  const [crossData, setCrossData] = useState<CrossData | null>(null);
  const [compareData, setCompareData] = useState<IncomeStatementData | null>(null);
  const [loading, setLoading] = useState(false);
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});
  // Ecount 的顯示選項：千單位、百分比欄
  const [thousand, setThousand] = useState(false);
  const [showPct, setShowPct] = useState(false);

  const { data: projects } = useListProjects();
  const { data: departments } = useListDepartments();

  const fetchReport = async () => {
    setLoading(true);
    try {
      if (viewMode === "vertical") {
        const params = new URLSearchParams();
        if (startDate) params.set("startDate", startDate);
        if (endDate) params.set("endDate", endDate);
        if (filterMode === "project" && projectId) params.set("projectId", String(projectId));
        if (filterMode === "department" && departmentId) params.set("departmentId", String(departmentId));
        const [compareStart, compareEnd] = comparison === "lastYear"
          ? [shiftYearClamped(startDate, -1), shiftYearClamped(endDate, -1)]
          : previousPeriodDates(periodMode, periodValue, startDate, endDate);
        const compareParams = new URLSearchParams(params);
        compareParams.set("startDate", compareStart);
        compareParams.set("endDate", compareEnd);
        const [res, compareRes] = await Promise.all([
          fetch(`/erp-api/reports/income-statement?${params}`),
          fetch(`/erp-api/reports/income-statement?${compareParams}`),
        ]);
        if (!res.ok || !compareRes.ok) throw new Error("報表查詢失敗");
        const [json, compareJson] = await Promise.all([res.json(), compareRes.json()]);
        setData(json);
        setCompareData(compareJson);
        setCrossData(null);
        const expanded: Record<string, boolean> = {};
        [...json.income, ...json.expense].forEach((g: GroupSection) => { expanded[g.groupNumber] = true; });
        setExpandedGroups(expanded);
      } else {
        const params = new URLSearchParams();
        if (startDate) params.set("startDate", startDate);
        if (endDate) params.set("endDate", endDate);
        params.set("dimension", crossDimension);
        const res = await fetch(`/erp-api/reports/income-statement/cross?${params}`);
        const json = await res.json();
        setCrossData(json);
        setData(null);
        setCompareData(null);
      }
    } catch {
      setData(null);
      setCrossData(null);
    }
    setLoading(false);
  };

  useEffect(() => {
    setData(null);
    setCrossData(null);
    fetchReport();
  }, [viewMode, crossDimension]);

  const toggleGroup = (key: string) => {
    setExpandedGroups(prev => ({ ...prev, [key]: !prev[key] }));
  };

  const fmt = (n: number) => scaledMoney(n, thousand);
  const fmtCross = (n: number) => n === 0 ? "-" : fmt(n);
  const pct = (current: number, prior: number) => prior === 0 ? "—" : `${(((current - prior) / Math.abs(prior)) * 100).toFixed(1)}%`;
  /** (%)(標準)：佔營業收入的比例 */
  const pctCell = (value: number, base: number) => showPct ? <td className="px-3 py-2 text-right font-mono text-xs text-gray-500">{percentOf(value, base)}</td> : null;

  const applyPeriod = (mode: PeriodMode, value: string) => {
    setPeriodMode(mode);
    setPeriodValue(value);
    if (mode !== "custom") {
      const [start, end] = periodDates(mode, value);
      setStartDate(start);
      setEndDate(end);
    }
  };

  const filterLabel = filterMode === "project" && projectId
    ? `專案：${projects?.find(p => p.id === projectId)?.name || ""}`
    : filterMode === "department" && departmentId
    ? `部門：${departments?.find(d => d.id === departmentId)?.name || ""}`
    : "全部";

  const totalIncome = data?.totalIncome ?? crossData?.totalIncome ?? 0;
  const totalExpense = data?.totalExpense ?? crossData?.totalExpense ?? 0;
  const netProfit = data?.netProfit ?? crossData?.netProfit ?? 0;
  const hasData = data || crossData;

  return (
    <div className="space-y-6" data-report>
      <ReportHeader />
      <PageHeader title="損益表" description="查詢期間營業收入、成本與淨損益" />

      <Card>
        <CardContent className="py-4 space-y-4">
          <div className="flex flex-col sm:flex-row gap-3 justify-between">
            <div className="flex gap-2">
              <button
                onClick={() => setViewMode("vertical")}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-all flex items-center gap-1.5 ${viewMode === "vertical" ? "bg-blue-600 text-white shadow-sm" : "bg-gray-100 text-gray-600 hover:bg-gray-200"}`}
              >
                <List className="h-4 w-4" />直向
              </button>
              <button
                onClick={() => setViewMode("horizontal")}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-all flex items-center gap-1.5 ${viewMode === "horizontal" ? "bg-blue-600 text-white shadow-sm" : "bg-gray-100 text-gray-600 hover:bg-gray-200"}`}
              >
                <Table2 className="h-4 w-4" />橫向比較
              </button>
            </div>
          </div>

          {viewMode === "vertical" && (
            <div className="flex gap-2">
              {(["all", "project", "department"] as FilterMode[]).map(mode => (
                <button
                  key={mode}
                  onClick={() => { setFilterMode(mode); setProjectId(""); setDepartmentId(""); }}
                  className={`px-3 py-1.5 rounded-md text-sm font-medium transition-all ${filterMode === mode ? "bg-gray-800 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"}`}
                >
                  {mode === "all" ? "全部" : mode === "project" ? "按專案" : "按部門"}
                </button>
              ))}
            </div>
          )}

          {viewMode === "vertical" && filterMode === "project" && (
            <LookupSelect value={projectId} onChange={e => setProjectId(e.target.value ? Number(e.target.value) : "")} className="w-full border rounded-lg px-3 py-2 text-sm bg-white">
              <option value="">請選擇專案</option>
              {projects?.map((p: any) => <option key={p.id} value={p.id}>{p.name}{p.isActive === false ? "（已停用）" : ""}</option>)}
            </LookupSelect>
          )}

          {viewMode === "vertical" && filterMode === "department" && (
            <LookupSelect value={departmentId} onChange={e => setDepartmentId(e.target.value ? Number(e.target.value) : "")} className="w-full border rounded-lg px-3 py-2 text-sm bg-white">
              <option value="">請選擇部門</option>
              {departments?.map((d: any) => <option key={d.id} value={d.id}>{d.name}{d.isActive === false ? "（已停用）" : ""}</option>)}
            </LookupSelect>
          )}

          {viewMode === "horizontal" && (
            <div className="flex gap-2">
              {(["project", "department"] as const).map(d => (
                <button
                  key={d}
                  onClick={() => setCrossDimension(d)}
                  className={`px-3 py-1.5 rounded-md text-sm font-medium transition-all ${crossDimension === d ? "bg-gray-800 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"}`}
                >
                  {d === "project" ? "按專案展開" : "按部門展開"}
                </button>
              ))}
            </div>
          )}

          <div className="flex flex-wrap gap-2 items-end">
            {(["month", "quarter", "year", "custom"] as PeriodMode[]).map(mode => (
              <Button key={mode} size="sm" variant={periodMode === mode ? "default" : "outline"}
                onClick={() => applyPeriod(mode, mode === "month" ? currentMonth : mode === "quarter" ? currentQuarter : mode === "year" ? currentYear : periodValue)}>
                {mode === "month" ? "月" : mode === "quarter" ? "季" : mode === "year" ? "年" : "自訂"}
              </Button>
            ))}
            {periodMode === "month" && <Input className="w-44" type="month" value={periodValue} onChange={e => applyPeriod("month", e.target.value)} />}
            {periodMode === "quarter" && (
              <select className="border rounded-md px-3 py-2 text-sm" value={periodValue} onChange={e => applyPeriod("quarter", e.target.value)}>
                {[0, 1, 2, 3].flatMap(offset => [1, 2, 3, 4].map(q => {
                  const value = `${today.getFullYear() - offset}-Q${q}`;
                  return <option key={value} value={value}>{today.getFullYear() - offset} 第 {q} 季</option>;
                }))}
              </select>
            )}
            {periodMode === "year" && <Input className="w-32" type="number" min="2000" max="2100" value={periodValue} onChange={e => applyPeriod("year", e.target.value)} />}
            <label className="flex items-center gap-1.5 text-sm"><input type="checkbox" checked={thousand} onChange={e => setThousand(e.target.checked)} />千單位</label>
            {viewMode === "vertical" && <label className="flex items-center gap-1.5 text-sm"><input type="checkbox" checked={showPct} onChange={e => setShowPct(e.target.checked)} />顯示百分比(%)</label>}
            {viewMode === "vertical" && (
              <select className="border rounded-md px-3 py-2 text-sm ml-auto" value={comparison} onChange={e => setComparison(e.target.value as "previous" | "lastYear")}>
                <option value="lastYear">去年同期</option>
                <option value="previous">上期</option>
              </select>
            )}
          </div>

          <div className="flex flex-col sm:flex-row gap-3 items-end">
            <div className="flex-1 min-w-0">
              <label className="text-sm font-medium text-gray-600 mb-1 block">起始日期</label>
              <Input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} />
            </div>
            <div className="flex-1 min-w-0">
              <label className="text-sm font-medium text-gray-600 mb-1 block">結束日期</label>
              <Input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} />
            </div>
            <Button onClick={fetchReport} disabled={loading} className="shrink-0">
              {loading ? "查詢中..." : "查詢"}
            </Button>
            {hasData && (
              <Button variant="outline" onClick={() => window.print()} className="shrink-0">
                <Printer className="h-4 w-4 mr-1" />列印
              </Button>
            )}
            {hasData && (
              <ExportMenu
                getExportOptions={() => {
                  if (viewMode === "horizontal" && crossData) return buildCrossIncomeExport(crossData);
                  return buildVerticalIncomeExport(data!, filterLabel);
                }}
              />
            )}
          </div>
        </CardContent>
      </Card>

      {hasData && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <Card>
              <CardContent className="flex items-center gap-4 py-4">
                <div className="w-10 h-10 rounded-full bg-green-100 flex items-center justify-center">
                  <TrendingUp className="h-5 w-5 text-green-600" />
                </div>
                <div>
                  <div className="text-sm text-gray-500">營業收入合計</div>
                  <div className="text-xl font-bold text-green-600">{fmt(totalIncome)}</div>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="flex items-center gap-4 py-4">
                <div className="w-10 h-10 rounded-full bg-red-100 flex items-center justify-center">
                  <TrendingDown className="h-5 w-5 text-red-600" />
                </div>
                <div>
                  <div className="text-sm text-gray-500">營業成本及費用合計</div>
                  <div className="text-xl font-bold text-red-600">{fmt(totalExpense)}</div>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="flex items-center gap-4 py-4">
                <div className="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center">
                  <DollarSign className="h-5 w-5 text-blue-600" />
                </div>
                <div>
                  <div className="text-sm text-gray-500">本期淨損益</div>
                  <div className={`text-xl font-bold ${netProfit >= 0 ? "text-green-600" : "text-red-600"}`}>
                    {fmt(netProfit)}
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {viewMode === "vertical" && data && (
            <Card className="print:shadow-none">
              <CardHeader className="py-3 border-b">
                <CardTitle className="text-center text-lg">
                  損益表
                  <div className="text-sm font-normal text-gray-500 mt-1">
                    期間：{data.startDate || "期初"} 至 {data.endDate || "今日"}
                    {filterLabel !== "全部" && <span className="ml-2 text-blue-600">（{filterLabel}）</span>}
                    {thousand && <span className="ml-2">單位：千元</span>}
                  </div>
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0 overflow-x-auto">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm min-w-[800px]">
                    <thead>
                      <tr className="border-b bg-muted/40">
                        <th className="text-left px-4 py-2.5 font-semibold w-24">科目代碼</th>
                        <th className="text-left px-4 py-2.5 font-semibold">科目名稱</th>
                        <th className="text-right px-4 py-2.5 font-semibold w-36">本期</th>
                        {showPct && <th className="text-right px-3 py-2.5 font-semibold w-20">(%)(標準)</th>}
                        <th className="text-right px-4 py-2.5 font-semibold w-36">{comparison === "lastYear" ? "去年同期" : "上期"}</th>
                        {showPct && <th className="text-right px-3 py-2.5 font-semibold w-20">(%)(比較)</th>}
                        <th className="text-right px-4 py-2.5 font-semibold w-24">差異 %</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr className="bg-green-50/50 border-b">
                        <td colSpan={2} className="px-4 py-2.5 font-bold text-green-800">壹、營業收入</td>
                        <td className="px-4 py-2.5 text-right font-bold text-green-800">{fmt(data.totalIncome)}</td>
                        {pctCell(data.totalIncome, data.totalIncome)}
                        <td className="px-4 py-2.5 text-right text-gray-600">{fmt(compareData?.totalIncome || 0)}</td>
                        {pctCell(compareData?.totalIncome || 0, compareData?.totalIncome || 0)}
                        <td className="px-4 py-2.5 text-right">{pct(data.totalIncome, compareData?.totalIncome || 0)}</td>
                      </tr>
                      {data.income.map(group => (
                        <GroupRows key={group.groupNumber} group={group} compareGroups={compareData?.income} expanded={expandedGroups[group.groupNumber]} onToggle={() => toggleGroup(group.groupNumber)} colorClass="text-green-700" fmt={fmt} pctCell={pctCell} base={data.totalIncome} compareBase={compareData?.totalIncome || 0} />
                      ))}
                      {data.income.length === 0 && (
                        <tr><td colSpan={5} className="px-8 py-2 text-gray-400">無收入資料</td></tr>
                      )}
                      <tr className="bg-red-50/50 border-b border-t-2">
                        <td colSpan={2} className="px-4 py-2.5 font-bold text-red-800">貳、營業成本及費用</td>
                        <td className="px-4 py-2.5 text-right font-bold text-red-800">{fmt(data.totalExpense)}</td>
                        {pctCell(data.totalExpense, data.totalIncome)}
                        <td className="px-4 py-2.5 text-right text-gray-600">{fmt(compareData?.totalExpense || 0)}</td>
                        {pctCell(compareData?.totalExpense || 0, compareData?.totalIncome || 0)}
                        <td className="px-4 py-2.5 text-right">{pct(data.totalExpense, compareData?.totalExpense || 0)}</td>
                      </tr>
                      {data.expense.map(group => (
                        <GroupRows key={group.groupNumber} group={group} compareGroups={compareData?.expense} expanded={expandedGroups[group.groupNumber]} onToggle={() => toggleGroup(group.groupNumber)} colorClass="text-red-700" fmt={fmt} pctCell={pctCell} base={data.totalIncome} compareBase={compareData?.totalIncome || 0} />
                      ))}
                      {data.expense.length === 0 && (
                        <tr><td colSpan={3} className="px-8 py-2 text-gray-400">無費用資料</td></tr>
                      )}
                      <tr className="border-t-2 bg-blue-50/50">
                        <td colSpan={2} className="px-4 py-3 font-bold text-blue-900 text-base">參、本期淨損益</td>
                        <td className={`px-4 py-3 text-right font-bold text-base ${data.netProfit >= 0 ? "text-green-700" : "text-red-700"}`}>
                          {fmt(data.netProfit)}
                        </td>
                        {pctCell(data.netProfit, data.totalIncome)}
                        <td className="px-4 py-3 text-right font-bold">{fmt(compareData?.netProfit || 0)}</td>
                        {pctCell(compareData?.netProfit || 0, compareData?.totalIncome || 0)}
                        <td className="px-4 py-3 text-right font-bold">{pct(data.netProfit, compareData?.netProfit || 0)}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          )}

          {viewMode === "vertical" && data?.projectBreakdown && filterMode === "department" && (
            <Card>
              <CardHeader><CardTitle className="text-base">部門專案損益明細</CardTitle></CardHeader>
              <CardContent className="p-0 overflow-x-auto">
                <table className="w-full text-sm min-w-[600px]">
                  <thead><tr className="bg-muted/40 border-b"><th className="text-left p-3">專案</th><th className="text-right p-3">收入</th><th className="text-right p-3">費用</th><th className="text-right p-3">淨損益</th></tr></thead>
                  <tbody>{data.projectBreakdown.map(row => <tr key={row.projectId} className="border-b hover:bg-muted/50"><td className="p-3">{row.projectName}</td><td className="p-3 text-right">{fmt(row.income)}</td><td className="p-3 text-right">{fmt(row.expense)}</td><td className={`p-3 text-right font-medium ${row.net >= 0 ? "text-green-700" : "text-red-700"}`}>{fmt(row.net)}</td></tr>)}</tbody>
                </table>
              </CardContent>
            </Card>
          )}

          {viewMode === "horizontal" && crossData && (
            <Card className="print:shadow-none">
              <CardHeader className="py-3 border-b">
                <CardTitle className="text-center text-lg">
                  損益表 — {crossData.dimension === "project" ? "專案" : "部門"}橫向比較
                  <div className="text-sm font-normal text-gray-500 mt-1">
                    期間：{crossData.startDate || "期初"} 至 {crossData.endDate || "今日"}
                  </div>
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0 overflow-x-auto">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm border-collapse min-w-[800px]">
                    <thead>
                      <tr className="border-b bg-gray-50">
                        <th className="text-left px-3 py-2.5 font-semibold sticky left-0 bg-gray-50 z-10 min-w-[80px] border-r">科目代碼</th>
                        <th className="text-left px-3 py-2.5 font-semibold sticky left-[80px] bg-gray-50 z-10 min-w-[140px] border-r">科目名稱</th>
                        <th className="text-right px-3 py-2.5 font-semibold min-w-[110px] bg-blue-50 border-r">全部合計</th>
                        {crossData.columns.map(c => (
                          <th key={c.id} className="text-right px-3 py-2.5 font-semibold min-w-[110px] border-r last:border-r-0">
                            <div className="truncate max-w-[120px]" title={c.name}>{c.name}</div>
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      <tr className="bg-green-50 border-b font-bold">
                        <td colSpan={2} className="px-3 py-2.5 text-green-800 sticky left-0 bg-green-50 z-10 border-r">壹、營業收入</td>
                        <td className="px-3 py-2.5 text-right text-green-800 bg-green-100/50 border-r">{fmtCross(crossData.totalIncome)}</td>
                        {crossData.columns.map(c => (
                          <td key={c.id} className="px-3 py-2.5 text-right text-green-700 border-r last:border-r-0">{fmtCross(crossData.columnTotals[c.id]?.income || 0)}</td>
                        ))}
                      </tr>
                      {crossData.incomeRows.map(row => (
                        <CrossRowTr key={row.accountId} row={row} cols={crossData.columns} fmt={fmtCross} />
                      ))}
                      {crossData.incomeRows.length === 0 && (
                        <tr><td colSpan={3 + crossData.columns.length} className="px-3 py-2 text-gray-400 text-center">無收入資料</td></tr>
                      )}
                      <tr className="bg-red-50 border-b border-t-2 font-bold">
                        <td colSpan={2} className="px-3 py-2.5 text-red-800 sticky left-0 bg-red-50 z-10 border-r">貳、營業成本及費用</td>
                        <td className="px-3 py-2.5 text-right text-red-800 bg-red-100/50 border-r">{fmtCross(crossData.totalExpense)}</td>
                        {crossData.columns.map(c => (
                          <td key={c.id} className="px-3 py-2.5 text-right text-red-700 border-r last:border-r-0">{fmtCross(crossData.columnTotals[c.id]?.expense || 0)}</td>
                        ))}
                      </tr>
                      {crossData.expenseRows.map(row => (
                        <CrossRowTr key={row.accountId} row={row} cols={crossData.columns} fmt={fmtCross} />
                      ))}
                      {crossData.expenseRows.length === 0 && (
                        <tr><td colSpan={3 + crossData.columns.length} className="px-3 py-2 text-gray-400 text-center">無費用資料</td></tr>
                      )}
                      <tr className="border-t-2 bg-blue-50 font-bold">
                        <td colSpan={2} className="px-3 py-3 text-blue-900 text-base sticky left-0 bg-blue-50 z-10 border-r">參、本期淨損益</td>
                        <td className={`px-3 py-3 text-right text-base border-r ${crossData.netProfit >= 0 ? "text-green-700" : "text-red-700"}`}>{fmtCross(crossData.netProfit)}</td>
                        {crossData.columns.map(c => {
                          const net = crossData.columnTotals[c.id]?.net || 0;
                          return (
                            <td key={c.id} className={`px-3 py-3 text-right font-mono border-r last:border-r-0 ${net >= 0 ? "text-green-700" : "text-red-700"}`}>{fmtCross(net)}</td>
                          );
                        })}
                      </tr>
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          )}
        </>
      )}

      {!hasData && !loading && (
        <Card>
          <CardContent className="py-12 text-center text-gray-400">
            選擇日期區間後點擊查詢以產生損益表
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function CrossRowTr({ row, cols, fmt }: { row: CrossRow; cols: CrossColumn[]; fmt: (n: number) => string }) {
  return (
    <tr className="border-b hover:bg-gray-50">
      <td className="px-3 py-1.5 font-mono text-xs text-gray-400 sticky left-0 bg-white z-10 border-r">{row.accountNumber}</td>
      <td className="px-3 py-1.5 text-gray-600 sticky left-[80px] bg-white z-10 border-r truncate max-w-[160px]" title={row.accountName}>{row.accountName}</td>
      <td className="px-3 py-1.5 text-right font-mono text-gray-800 bg-blue-50/30 border-r">{fmt(row.totalAmount)}</td>
      {cols.map(c => (
        <td key={c.id} className="px-3 py-1.5 text-right font-mono text-gray-600 border-r last:border-r-0">{fmt(row.breakdown[c.id] || 0)}</td>
      ))}
    </tr>
  );
}

function GroupRows({ group, compareGroups, expanded, onToggle, colorClass, fmt, pctCell, base, compareBase }: {
  group: GroupSection;
  compareGroups?: GroupSection[];
  expanded: boolean;
  onToggle: () => void;
  colorClass: string;
  fmt: (n: number) => string;
  pctCell: (value: number, base: number) => ReactNode;
  base: number;
  compareBase: number;
}) {
  const compareGroup = compareGroups?.find(g => g.groupNumber === group.groupNumber);
  const pct = (current: number, prior: number) => prior === 0 ? "—" : `${(((current - prior) / Math.abs(prior)) * 100).toFixed(1)}%`;
  return (
    <>
      <tr className="border-b cursor-pointer hover:bg-gray-50/50" onClick={onToggle}>
        <td className="px-4 py-2 font-mono text-xs text-gray-500">{group.groupNumber}</td>
        <td className="px-4 py-2 font-medium flex items-center gap-1">
          {expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
          {group.groupName}
        </td>
        <td className={`px-4 py-2 text-right font-semibold ${colorClass}`}>{fmt(group.subtotal)}</td>
        {pctCell(group.subtotal, base)}
        <td className="px-4 py-2 text-right text-gray-500">{fmt(compareGroup?.subtotal || 0)}</td>
        {pctCell(compareGroup?.subtotal || 0, compareBase)}
        <td className="px-4 py-2 text-right text-gray-500">{pct(group.subtotal, compareGroup?.subtotal || 0)}</td>
      </tr>
      {expanded && group.items.map(item => {
        const prior = compareGroup?.items.find(i => i.accountId === item.accountId)?.amount || 0;
        return (
        <tr key={item.accountId} className="border-b hover:bg-gray-50">
          <td className="px-4 py-1.5 pl-8 font-mono text-xs text-gray-400">{item.accountNumber}</td>
          <td className="px-4 py-1.5 pl-10 text-gray-600">{item.accountName}</td>
          <td className="px-4 py-1.5 text-right font-mono text-gray-700">{fmt(item.amount)}</td>
          {pctCell(item.amount, base)}
          <td className="px-4 py-1.5 text-right font-mono text-gray-500">{fmt(prior)}</td>
          {pctCell(prior, compareBase)}
          <td className="px-4 py-1.5 text-right text-gray-500">{pct(item.amount, prior)}</td>
        </tr>
        );
      })}
    </>
  );
}
