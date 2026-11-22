import { useState, useEffect, type ReactNode } from "react";
import { projectLabel } from "@/lib/select-options";
import { ReportHeader } from "@/components/shared/report-header";
import { useListProjects, useListDepartments } from "@workspace/erp-api-client-react";
import { PageHeader } from "@/components/shared/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Building, Landmark, Wallet, Printer, ChevronDown, ChevronRight, CheckCircle2, AlertCircle, List, Table2 } from "lucide-react";
import { ExportMenu } from "@/components/shared/export-menu";
import { buildVerticalBalanceExport, buildCrossBalanceExport } from "@/lib/export-utils";
import { percentOf, scaledMoney } from "@/lib/statement-display";

import { LookupSelect } from "@/components/shared/lookup-select";
import { AccountDrillDialog, DrillAmount, type DrillTarget } from "@/components/shared/account-drill";
const BASE = import.meta.env.BASE_URL.endsWith("/") ? import.meta.env.BASE_URL : import.meta.env.BASE_URL + "/";

type FilterMode = "all" | "project" | "department";
type ViewMode = "vertical" | "horizontal";

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

interface SectionData {
  groups: GroupSection[];
  total: number;
}

interface EquityData extends SectionData {
  retainedEarnings: number;
  totalWithRetainedEarnings: number;
}

interface BalanceSheetData {
  endDate: string | null;
  assets: SectionData;
  liabilities: SectionData;
  equity: EquityData;
  totalAssets: number;
  totalLiabilitiesAndEquity: number;
  isBalanced: boolean;
}

const initialMonth = new Date().toISOString().slice(0, 7);
const monthEnd = (month: string) => {
  const [year, value] = month.split("-").map(Number);
  return new Date(Date.UTC(year, value, 0)).toISOString().slice(0, 10);
};

interface CrossRow {
  accountId: number;
  accountNumber: string;
  accountName: string;
  totalAmount: number;
  breakdown: Record<string, number>;
}

interface CrossColumn { id: string; name: string; }

/** 這次查詢實際用的條件（點數字看明細時要用同一組，不能用畫面上還沒按查詢的新條件） */
interface Queried { endDate: string; compareEnd: string; projectId?: number; departmentId?: number; filterLabel?: string }

const idsOf = (groups?: GroupSection[]) => (groups ?? []).flatMap(g => g.items.map(i => i.accountId));

/** 金額不是 0 才可以點開明細 */
function Drillable({ on, onClick, children }: { on: boolean; onClick: () => void; children: ReactNode }) {
  return on ? <DrillAmount onClick={onClick}>{children}</DrillAmount> : <>{children}</>;
}

interface CrossData {
  endDate: string | null;
  dimension: string;
  columns: CrossColumn[];
  assetRows: CrossRow[];
  liabilityRows: CrossRow[];
  equityRows: CrossRow[];
  retainedEarnings: { totalAmount: number; breakdown: Record<string, number> };
  totalAssets: number;
  totalLiabilities: number;
  totalEquity: number;
  totalEquityWithRetained: number;
  columnTotals: Record<string, { assets: number; liabilities: number; equity: number; retained: number }>;
}

export default function BalanceSheetPage() {
  const [endDate, setEndDate] = useState(() => monthEnd(initialMonth));
  const [dateMode, setDateMode] = useState<"month" | "custom">("month");
  const [month, setMonth] = useState(initialMonth);
  const [compareEndDate, setCompareEndDate] = useState(() => {
    const date = new Date();
    return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 0)).toISOString().slice(0, 10);
  });
  const [filterMode, setFilterMode] = useState<FilterMode>("all");
  const [projectId, setProjectId] = useState<number | "">("");
  const [departmentId, setDepartmentId] = useState<number | "">("");
  const [viewMode, setViewMode] = useState<ViewMode>("vertical");
  const [crossDimension, setCrossDimension] = useState<"project" | "department">("project");
  const [data, setData] = useState<BalanceSheetData | null>(null);
  const [crossData, setCrossData] = useState<CrossData | null>(null);
  const [compareData, setCompareData] = useState<BalanceSheetData | null>(null);
  const [loading, setLoading] = useState(false);
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});
  // Ecount 的顯示選項：千單位、百分比欄
  const [thousand, setThousand] = useState(false);
  const [showPct, setShowPct] = useState(false);
  const [drill, setDrill] = useState<DrillTarget | null>(null);
  const [queried, setQueried] = useState<Queried>({ endDate, compareEnd: "" });

  const { data: projects } = useListProjects();
  const { data: departments } = useListDepartments();

  const fetchReport = async () => {
    setLoading(true);
    try {
      if (viewMode === "vertical") {
        const params = new URLSearchParams();
        if (endDate) params.set("endDate", endDate);
        if (filterMode === "project" && projectId) params.set("projectId", String(projectId));
        if (filterMode === "department" && departmentId) params.set("departmentId", String(departmentId));
        const compareParams = new URLSearchParams(params);
        compareParams.set("endDate", compareEndDate);
        const [res, compareRes] = await Promise.all([
          fetch(`/erp-api/reports/balance-sheet?${params}`),
          fetch(`/erp-api/reports/balance-sheet?${compareParams}`),
        ]);
        if (!res.ok || !compareRes.ok) throw new Error("報表查詢失敗");
        const [json, compareJson] = await Promise.all([res.json(), compareRes.json()]);
        setData(json);
        setCompareData(compareJson);
        setQueried({
          endDate, compareEnd: compareEndDate,
          projectId: filterMode === "project" && projectId ? projectId : undefined,
          departmentId: filterMode === "department" && departmentId ? departmentId : undefined,
          filterLabel: filterLabel !== "全部" ? filterLabel : undefined,
        });
        setCrossData(null);
        const expanded: Record<string, boolean> = {};
        [...json.assets.groups, ...json.liabilities.groups, ...json.equity.groups].forEach((g: GroupSection) => {
          expanded[g.groupNumber] = true;
        });
        setExpandedGroups(expanded);
      } else {
        const params = new URLSearchParams();
        if (endDate) params.set("endDate", endDate);
        params.set("dimension", crossDimension);
        const res = await fetch(`/erp-api/reports/balance-sheet/cross?${params}`);
        const json = await res.json();
        setCrossData(json);
        setQueried({ endDate, compareEnd: "" });
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

  const filterLabel = filterMode === "project" && projectId
    ? `專案：${projects?.find(p => p.id === projectId)?.name || ""}`
    : filterMode === "department" && departmentId
    ? `部門：${departments?.find(d => d.id === departmentId)?.name || ""}`
    : "全部";

  const totalAssets = data?.totalAssets ?? crossData?.totalAssets ?? 0;
  const totalLiabilities = data?.liabilities.total ?? crossData?.totalLiabilities ?? 0;
  const totalEquity = data?.equity.totalWithRetainedEarnings ?? crossData?.totalEquityWithRetained ?? 0;
  const hasData = data || crossData;
  /** (%)(標準)：佔資產總計的比例 */
  const pctCell = (value: number, base: number) => showPct ? <td className="px-3 py-2 text-right font-mono text-xs text-gray-500">{percentOf(value, base)}</td> : null;

  // 點數字看明細：資產負債表是「到截止日為止」的餘額，所以只帶截止日
  const openDrill = (title: string, accountIds: number[], compare = false, note?: string) => {
    if (accountIds.length === 0) return;
    setDrill({
      title, accountIds,
      endDate: compare ? queried.compareEnd : queried.endDate,
      projectId: queried.projectId,
      departmentId: queried.departmentId,
      note: [queried.filterLabel, note].filter(Boolean).join("・") || undefined,
    });
  };
  const openCrossDrill = (row: CrossRow, col?: CrossColumn) => setDrill({
    title: `${row.accountNumber} ${row.accountName}`,
    accountIds: [row.accountId],
    endDate: queried.endDate,
    ...(col
      ? crossData?.dimension === "department"
        ? { departmentId: Number(col.id), exactDimension: true, note: `部門：${col.name}` }
        : { projectId: Number(col.id), note: `專案：${col.name}` }
      : {}),
  });
  const assetIds = idsOf(data?.assets.groups);
  const liabilityIds = idsOf(data?.liabilities.groups);
  const equityIds = idsOf(data?.equity.groups);
  const compareAssetIds = idsOf(compareData?.assets.groups);
  const compareLiabilityIds = idsOf(compareData?.liabilities.groups);
  const compareEquityIds = idsOf(compareData?.equity.groups);
  /** 權益合計含「本期損益（保留盈餘）」，那一塊不是權益科目的分錄，明細裡看不到 */
  const equityNote = (retained?: number) => retained ? "不含本期損益（保留盈餘）" : undefined;

  return (
    <div className="space-y-6" data-report>
      <ReportHeader />
      <PageHeader title="資產負債表" description="查看公司資產、負債及權益的財務狀況" />

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
              {projects?.map((p: any) => <option key={p.id} value={p.id}>{projectLabel(p)}{p.isActive === false ? "（已停用）" : ""}</option>)}
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
            <Button size="sm" variant={dateMode === "month" ? "default" : "outline"} onClick={() => setDateMode("month")}>月底</Button>
            <Button size="sm" variant={dateMode === "custom" ? "default" : "outline"} onClick={() => setDateMode("custom")}>自訂日期</Button>
            {dateMode === "month" && (
              <Input className="w-44" type="month" value={month} onChange={e => {
                setMonth(e.target.value);
                setEndDate(monthEnd(e.target.value));
                const [year, value] = e.target.value.split("-").map(Number);
                setCompareEndDate(new Date(Date.UTC(year, value - 1, 0)).toISOString().slice(0, 10));
              }} />
            )}
            <label className="flex items-center gap-1.5 text-sm"><input type="checkbox" checked={thousand} onChange={e => setThousand(e.target.checked)} />千單位</label>
            {viewMode === "vertical" && <label className="flex items-center gap-1.5 text-sm"><input type="checkbox" checked={showPct} onChange={e => setShowPct(e.target.checked)} />顯示百分比(%)</label>}
            {viewMode === "vertical" && (
              <div>
                <label className="text-xs text-gray-500 block mb-1">比較截止日</label>
                <Input className="w-44" type="date" value={compareEndDate} onChange={e => setCompareEndDate(e.target.value)} />
              </div>
            )}
          </div>

          <div className="flex flex-col sm:flex-row gap-3 items-end">
            <div className="flex-1 min-w-0">
              <label className="text-sm font-medium text-gray-600 mb-1 block">截止日期</label>
              <Input type="date" value={endDate} onChange={e => { setEndDate(e.target.value); setDateMode("custom"); }} />
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
                  if (viewMode === "horizontal" && crossData) return buildCrossBalanceExport(crossData);
                  return buildVerticalBalanceExport(data!, filterLabel);
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
                <div className="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center">
                  <Building className="h-5 w-5 text-blue-600" />
                </div>
                <div>
                  <div className="text-sm text-gray-500">資產總計</div>
                  <div className="text-xl font-bold text-blue-600">{fmt(totalAssets)}</div>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="flex items-center gap-4 py-4">
                <div className="w-10 h-10 rounded-full bg-orange-100 flex items-center justify-center">
                  <Landmark className="h-5 w-5 text-orange-600" />
                </div>
                <div>
                  <div className="text-sm text-gray-500">負債總計</div>
                  <div className="text-xl font-bold text-orange-600">{fmt(totalLiabilities)}</div>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="flex items-center gap-4 py-4">
                <div className="w-10 h-10 rounded-full bg-purple-100 flex items-center justify-center">
                  <Wallet className="h-5 w-5 text-purple-600" />
                </div>
                <div>
                  <div className="text-sm text-gray-500">權益總計</div>
                  <div className="text-xl font-bold text-purple-600">{fmt(totalEquity)}</div>
                </div>
              </CardContent>
            </Card>
          </div>

          {viewMode === "vertical" && data && (
            <Card className="print:shadow-none">
              <CardHeader className="py-3 border-b">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-center text-lg flex-1">
                    資產負債表
                    <div className="text-sm font-normal text-gray-500 mt-1">
                      截止日期：{data.endDate || "今日"}
                      {filterLabel !== "全部" && <span className="ml-2 text-blue-600">（{filterLabel}）</span>}
                      {thousand && <span className="ml-2">單位：千元</span>}
                    </div>
                  </CardTitle>
                  {data.isBalanced ? (
                    <Badge variant="outline" className="text-green-600 border-green-300 bg-green-50 gap-1">
                      <CheckCircle2 className="h-3.5 w-3.5" />平衡
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="text-red-600 border-red-300 bg-red-50 gap-1">
                      <AlertCircle className="h-3.5 w-3.5" />不平衡
                    </Badge>
                  )}
                </div>
              </CardHeader>
              <CardContent className="p-0 overflow-x-auto">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b bg-gray-50/50">
                        <th className="text-left px-4 py-2.5 font-semibold w-24">科目代碼</th>
                        <th className="text-left px-4 py-2.5 font-semibold">科目名稱</th>
                        <th className="text-right px-4 py-2.5 font-semibold w-36">本期餘額</th>
                        {showPct && <th className="text-right px-3 py-2.5 font-semibold w-20">(%)(標準)</th>}
                        <th className="text-right px-4 py-2.5 font-semibold w-36">{compareEndDate} 餘額</th>
                        {showPct && <th className="text-right px-3 py-2.5 font-semibold w-20">(%)(比較)</th>}
                        <th className="text-right px-4 py-2.5 font-semibold w-36">變動</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr className="bg-blue-50/50 border-b">
                        <td colSpan={2} className="px-4 py-2.5 font-bold text-blue-800">壹、資產</td>
                        <td className="px-4 py-2.5 text-right font-bold text-blue-800"><Drillable on={data.totalAssets !== 0 && assetIds.length > 0} onClick={() => openDrill("資產合計", assetIds)}>{fmt(data.totalAssets)}</Drillable></td>
                        {pctCell(data.totalAssets, data.totalAssets)}
                        <td className="px-4 py-2.5 text-right text-gray-600"><Drillable on={(compareData?.totalAssets || 0) !== 0 && compareAssetIds.length > 0} onClick={() => openDrill("資產合計", compareAssetIds, true)}>{fmt(compareData?.totalAssets || 0)}</Drillable></td>
                        {pctCell(compareData?.totalAssets || 0, compareData?.totalAssets || 0)}
                        <td className="px-4 py-2.5 text-right">{fmt(data.totalAssets - (compareData?.totalAssets || 0))}</td>
                      </tr>
                      {data.assets.groups.map(group => (
                        <SectionRows key={group.groupNumber} group={group} compareGroups={compareData?.assets.groups} expanded={expandedGroups[group.groupNumber]} onToggle={() => toggleGroup(group.groupNumber)} colorClass="text-blue-700" fmt={fmt} pctCell={pctCell} base={data.totalAssets} compareBase={compareData?.totalAssets || 0} onDrill={openDrill} />
                      ))}
                      {data.assets.groups.length === 0 && (
                        <tr><td colSpan={5} className="px-8 py-2 text-gray-400">無資產資料</td></tr>
                      )}
                      <tr className="bg-orange-50/50 border-b border-t-2">
                        <td colSpan={2} className="px-4 py-2.5 font-bold text-orange-800">貳、負債</td>
                        <td className="px-4 py-2.5 text-right font-bold text-orange-800"><Drillable on={data.liabilities.total !== 0 && liabilityIds.length > 0} onClick={() => openDrill("負債合計", liabilityIds)}>{fmt(data.liabilities.total)}</Drillable></td>
                        {pctCell(data.liabilities.total, data.totalAssets)}
                        <td className="px-4 py-2.5 text-right text-gray-600"><Drillable on={(compareData?.liabilities.total || 0) !== 0 && compareLiabilityIds.length > 0} onClick={() => openDrill("負債合計", compareLiabilityIds, true)}>{fmt(compareData?.liabilities.total || 0)}</Drillable></td>
                        {pctCell(compareData?.liabilities.total || 0, compareData?.totalAssets || 0)}
                        <td className="px-4 py-2.5 text-right">{fmt(data.liabilities.total - (compareData?.liabilities.total || 0))}</td>
                      </tr>
                      {data.liabilities.groups.map(group => (
                        <SectionRows key={group.groupNumber} group={group} compareGroups={compareData?.liabilities.groups} expanded={expandedGroups[group.groupNumber]} onToggle={() => toggleGroup(group.groupNumber)} colorClass="text-orange-700" fmt={fmt} pctCell={pctCell} base={data.totalAssets} compareBase={compareData?.totalAssets || 0} onDrill={openDrill} />
                      ))}
                      {data.liabilities.groups.length === 0 && (
                        <tr><td colSpan={3} className="px-8 py-2 text-gray-400">無負債資料</td></tr>
                      )}
                      <tr className="bg-purple-50/50 border-b border-t-2">
                        <td colSpan={2} className="px-4 py-2.5 font-bold text-purple-800">參、權益</td>
                        <td className="px-4 py-2.5 text-right font-bold text-purple-800"><Drillable on={data.equity.total !== 0 && equityIds.length > 0} onClick={() => openDrill("權益合計", equityIds, false, equityNote(data.equity.retainedEarnings))}>{fmt(data.equity.totalWithRetainedEarnings)}</Drillable></td>
                        {pctCell(data.equity.totalWithRetainedEarnings, data.totalAssets)}
                        <td className="px-4 py-2.5 text-right text-gray-600"><Drillable on={(compareData?.equity.total || 0) !== 0 && compareEquityIds.length > 0} onClick={() => openDrill("權益合計", compareEquityIds, true, equityNote(compareData?.equity.retainedEarnings))}>{fmt(compareData?.equity.totalWithRetainedEarnings || 0)}</Drillable></td>
                        {pctCell(compareData?.equity.totalWithRetainedEarnings || 0, compareData?.totalAssets || 0)}
                        <td className="px-4 py-2.5 text-right">{fmt(data.equity.totalWithRetainedEarnings - (compareData?.equity.totalWithRetainedEarnings || 0))}</td>
                      </tr>
                      {data.equity.groups.map(group => (
                        <SectionRows key={group.groupNumber} group={group} compareGroups={compareData?.equity.groups} expanded={expandedGroups[group.groupNumber]} onToggle={() => toggleGroup(group.groupNumber)} colorClass="text-purple-700" fmt={fmt} pctCell={pctCell} base={data.totalAssets} compareBase={compareData?.totalAssets || 0} onDrill={openDrill} />
                      ))}
                      {data.equity.retainedEarnings !== 0 && (
                        <tr className="border-b bg-purple-50/30">
                          <td className="px-4 py-2 pl-8 font-mono text-xs text-gray-400">-</td>
                          <td className="px-4 py-2 pl-10 text-purple-600 font-medium">本期損益（保留盈餘）</td>
                          <td className={`px-4 py-2 text-right font-mono ${data.equity.retainedEarnings >= 0 ? "text-green-600" : "text-red-600"}`}>
                            {fmt(data.equity.retainedEarnings)}
                          </td>
                          {pctCell(data.equity.retainedEarnings, data.totalAssets)}
                          <td className="px-4 py-2 text-right">{fmt(compareData?.equity.retainedEarnings || 0)}</td>
                          {pctCell(compareData?.equity.retainedEarnings || 0, compareData?.totalAssets || 0)}
                          <td className="px-4 py-2 text-right">{fmt(data.equity.retainedEarnings - (compareData?.equity.retainedEarnings || 0))}</td>
                        </tr>
                      )}
                      {data.equity.groups.length === 0 && data.equity.retainedEarnings === 0 && (
                        <tr><td colSpan={3} className="px-8 py-2 text-gray-400">無權益資料</td></tr>
                      )}
                      <tr className="border-t-2 bg-gray-100">
                        <td colSpan={2} className="px-4 py-3 font-bold text-gray-900 text-base">負債及權益合計</td>
                        <td className="px-4 py-3 text-right font-bold text-base text-gray-900">
                          {fmt(data.totalLiabilitiesAndEquity)}
                        </td>
                        {pctCell(data.totalLiabilitiesAndEquity, data.totalAssets)}
                        <td className="px-4 py-3 text-right font-bold">{fmt(compareData?.totalLiabilitiesAndEquity || 0)}</td>
                        {pctCell(compareData?.totalLiabilitiesAndEquity || 0, compareData?.totalAssets || 0)}
                        <td className="px-4 py-3 text-right font-bold">{fmt(data.totalLiabilitiesAndEquity - (compareData?.totalLiabilitiesAndEquity || 0))}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          )}

          {viewMode === "horizontal" && crossData && (
            <Card className="print:shadow-none">
              <CardHeader className="py-3 border-b">
                <CardTitle className="text-center text-lg">
                  資產負債表 — {crossData.dimension === "project" ? "專案" : "部門"}橫向比較
                  <div className="text-sm font-normal text-gray-500 mt-1">
                    截止日期：{crossData.endDate || "今日"}{thousand && "　單位：千元"}
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
                      <CrossSectionBlock
                        label="壹、資產"
                        rows={crossData.assetRows}
                        total={crossData.totalAssets}
                        cols={crossData.columns}
                        colTotalKey="assets"
                        columnTotals={crossData.columnTotals}
                        bgClass="bg-blue-50"
                        textClass="text-blue-800"
                        totalBgClass="bg-blue-100/50"
                        emptyLabel="無資產資料"
                        fmt={fmtCross}
                        onDrill={openCrossDrill}
                      />
                      <CrossSectionBlock
                        label="貳、負債"
                        rows={crossData.liabilityRows}
                        total={crossData.totalLiabilities}
                        cols={crossData.columns}
                        colTotalKey="liabilities"
                        columnTotals={crossData.columnTotals}
                        bgClass="bg-orange-50"
                        textClass="text-orange-800"
                        totalBgClass="bg-orange-100/50"
                        emptyLabel="無負債資料"
                        fmt={fmtCross}
                        onDrill={openCrossDrill}
                        borderTop
                      />

                      <tr className="bg-purple-50 border-b border-t-2 font-bold">
                        <td colSpan={2} className="px-3 py-2.5 text-purple-800 sticky left-0 bg-purple-50 z-10 border-r">參、權益</td>
                        <td className="px-3 py-2.5 text-right text-purple-800 bg-purple-100/50 border-r">{fmtCross(crossData.totalEquityWithRetained)}</td>
                        {crossData.columns.map(c => {
                          const ct = crossData.columnTotals[c.id];
                          return (
                            <td key={c.id} className="px-3 py-2.5 text-right text-purple-700 border-r last:border-r-0">
                              {fmtCross((ct?.equity || 0) + (ct?.retained || 0))}
                            </td>
                          );
                        })}
                      </tr>
                      {crossData.equityRows.map(row => (
                        <CrossRowTr key={row.accountId} row={row} cols={crossData.columns} fmt={fmtCross} onDrill={openCrossDrill} />
                      ))}
                      {crossData.retainedEarnings.totalAmount !== 0 && (
                        <tr className="border-b bg-purple-50/30">
                          <td className="px-3 py-1.5 font-mono text-xs text-gray-400 sticky left-0 bg-purple-50/30 z-10 border-r">-</td>
                          <td className="px-3 py-1.5 text-purple-600 font-medium sticky left-[80px] bg-purple-50/30 z-10 border-r">本期損益（保留盈餘）</td>
                          <td className={`px-3 py-1.5 text-right font-mono border-r ${crossData.retainedEarnings.totalAmount >= 0 ? "text-green-600" : "text-red-600"}`}>
                            {fmtCross(crossData.retainedEarnings.totalAmount)}
                          </td>
                          {crossData.columns.map(c => {
                            const v = crossData.retainedEarnings.breakdown[c.id] || 0;
                            return (
                              <td key={c.id} className={`px-3 py-1.5 text-right font-mono border-r last:border-r-0 ${v >= 0 ? "text-green-600" : "text-red-600"}`}>
                                {fmtCross(v)}
                              </td>
                            );
                          })}
                        </tr>
                      )}
                      {crossData.equityRows.length === 0 && crossData.retainedEarnings.totalAmount === 0 && (
                        <tr><td colSpan={3 + crossData.columns.length} className="px-3 py-2 text-gray-400 text-center">無權益資料</td></tr>
                      )}

                      <tr className="border-t-2 bg-gray-100 font-bold">
                        <td colSpan={2} className="px-3 py-3 text-gray-900 text-base sticky left-0 bg-gray-100 z-10 border-r">負債及權益合計</td>
                        <td className="px-3 py-3 text-right text-base text-gray-900 border-r">
                          {fmtCross(crossData.totalLiabilities + crossData.totalEquityWithRetained)}
                        </td>
                        {crossData.columns.map(c => {
                          const ct = crossData.columnTotals[c.id];
                          return (
                            <td key={c.id} className="px-3 py-3 text-right font-mono text-gray-900 border-r last:border-r-0">
                              {fmtCross((ct?.liabilities || 0) + (ct?.equity || 0) + (ct?.retained || 0))}
                            </td>
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
            選擇截止日期後點擊查詢以產生資產負債表
          </CardContent>
        </Card>
      )}

      <AccountDrillDialog target={drill} onClose={() => setDrill(null)} />
    </div>
  );
}

function CrossRowTr({ row, cols, fmt, onDrill }: { row: CrossRow; cols: CrossColumn[]; fmt: (n: number) => string; onDrill: (row: CrossRow, col?: CrossColumn) => void }) {
  return (
    <tr className="border-b hover:bg-gray-50">
      <td className="px-3 py-1.5 font-mono text-xs text-gray-400 sticky left-0 bg-white z-10 border-r">{row.accountNumber}</td>
      <td className="px-3 py-1.5 text-gray-600 sticky left-[80px] bg-white z-10 border-r truncate max-w-[160px]" title={row.accountName}>{row.accountName}</td>
      <td className="px-3 py-1.5 text-right font-mono text-gray-800 bg-blue-50/30 border-r"><Drillable on={row.totalAmount !== 0} onClick={() => onDrill(row)}>{fmt(row.totalAmount)}</Drillable></td>
      {cols.map(c => {
        const value = row.breakdown[c.id] || 0;
        // 「未指定」那一欄沒有對應的專案／部門，不開明細
        const canDrill = value !== 0 && c.id !== "__none__" && Number.isFinite(Number(c.id));
        return (
          <td key={c.id} className="px-3 py-1.5 text-right font-mono text-gray-600 border-r last:border-r-0"><Drillable on={canDrill} onClick={() => onDrill(row, c)}>{fmt(value)}</Drillable></td>
        );
      })}
    </tr>
  );
}

function CrossSectionBlock({ label, rows, total, cols, colTotalKey, columnTotals, bgClass, textClass, totalBgClass, emptyLabel, fmt, borderTop, onDrill }: {
  label: string;
  rows: CrossRow[];
  total: number;
  cols: CrossColumn[];
  colTotalKey: string;
  columnTotals: Record<string, Record<string, number>>;
  bgClass: string;
  textClass: string;
  totalBgClass: string;
  emptyLabel: string;
  fmt: (n: number) => string;
  borderTop?: boolean;
  onDrill: (row: CrossRow, col?: CrossColumn) => void;
}) {
  return (
    <>
      <tr className={`${bgClass} border-b ${borderTop ? "border-t-2" : ""} font-bold`}>
        <td colSpan={2} className={`px-3 py-2.5 ${textClass} sticky left-0 ${bgClass} z-10 border-r`}>{label}</td>
        <td className={`px-3 py-2.5 text-right ${textClass} ${totalBgClass} border-r`}>{fmt(total)}</td>
        {cols.map(c => (
          <td key={c.id} className={`px-3 py-2.5 text-right ${textClass.replace("800", "700")} border-r last:border-r-0`}>
            {fmt((columnTotals[c.id] as any)?.[colTotalKey] || 0)}
          </td>
        ))}
      </tr>
      {rows.map(row => (
        <CrossRowTr key={row.accountId} row={row} cols={cols} fmt={fmt} onDrill={onDrill} />
      ))}
      {rows.length === 0 && (
        <tr><td colSpan={3 + cols.length} className="px-3 py-2 text-gray-400 text-center">{emptyLabel}</td></tr>
      )}
    </>
  );
}

function SectionRows({ group, compareGroups, expanded, onToggle, colorClass, fmt, pctCell, base, compareBase, onDrill }: {
  group: GroupSection;
  compareGroups?: GroupSection[];
  expanded: boolean;
  onToggle: () => void;
  colorClass: string;
  fmt: (n: number) => string;
  pctCell: (value: number, base: number) => ReactNode;
  base: number;
  compareBase: number;
  onDrill: (title: string, accountIds: number[], compare?: boolean) => void;
}) {
  const compareGroup = compareGroups?.find(item => item.groupNumber === group.groupNumber);
  const groupIds = group.items.map(i => i.accountId);
  const compareGroupIds = (compareGroup?.items ?? []).map(i => i.accountId);
  return (
    <>
      <tr className="border-b cursor-pointer hover:bg-gray-50/50" onClick={onToggle}>
        <td className="px-4 py-2 font-mono text-xs text-gray-500">{group.groupNumber}</td>
        <td className="px-4 py-2 font-medium flex items-center gap-1">
          {expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
          {group.groupName}
        </td>
        <td className={`px-4 py-2 text-right font-semibold ${colorClass}`}><Drillable on={group.subtotal !== 0 && groupIds.length > 0} onClick={() => onDrill(group.groupName, groupIds)}>{fmt(group.subtotal)}</Drillable></td>
        {pctCell(group.subtotal, base)}
        <td className="px-4 py-2 text-right text-gray-500"><Drillable on={(compareGroup?.subtotal || 0) !== 0 && compareGroupIds.length > 0} onClick={() => onDrill(group.groupName, compareGroupIds, true)}>{fmt(compareGroup?.subtotal || 0)}</Drillable></td>
        {pctCell(compareGroup?.subtotal || 0, compareBase)}
        <td className="px-4 py-2 text-right text-gray-500">{fmt(group.subtotal - (compareGroup?.subtotal || 0))}</td>
      </tr>
      {expanded && group.items.map(item => {
        const prior = compareGroup?.items.find(row => row.accountId === item.accountId)?.amount || 0;
        return (
        <tr key={item.accountId} className="border-b hover:bg-gray-50">
          <td className="px-4 py-1.5 pl-8 font-mono text-xs text-gray-400">{item.accountNumber}</td>
          <td className="px-4 py-1.5 pl-10 text-gray-600">{item.accountName}</td>
          <td className="px-4 py-1.5 text-right font-mono text-gray-700"><Drillable on={item.amount !== 0} onClick={() => onDrill(`${item.accountNumber} ${item.accountName}`, [item.accountId])}>{fmt(item.amount)}</Drillable></td>
          {pctCell(item.amount, base)}
          <td className="px-4 py-1.5 text-right font-mono text-gray-500"><Drillable on={prior !== 0} onClick={() => onDrill(`${item.accountNumber} ${item.accountName}`, [item.accountId], true)}>{fmt(prior)}</Drillable></td>
          {pctCell(prior, compareBase)}
          <td className="px-4 py-1.5 text-right font-mono text-gray-500">{fmt(item.amount - prior)}</td>
        </tr>
        );
      })}
    </>
  );
}
