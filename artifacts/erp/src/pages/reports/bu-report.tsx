import { useEffect, useState, Fragment } from "react";
import { ReportHeader } from "@/components/shared/report-header";
import { useAutoReloadKey } from "@/lib/auto-refresh";
import { ChevronDown, ChevronRight, Printer } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { AccountDrillDialog, DrillAmount, type DrillTarget } from "@/components/shared/account-drill";
import { MobileCard, MobileCardHeader, MobileCardGrid, MobileCardItem, MobileTotalCard } from "@/components/shared/mobile-card";

const BASE = import.meta.env.BASE_URL.endsWith("/") ? import.meta.env.BASE_URL : `${import.meta.env.BASE_URL}/`;

interface ProjectRow {
  projectId: number;
  name: string;
  revenue: number;
  expense: number;
  net: number;
}

interface BuRow {
  departmentId: number | null;
  name: string;
  revenue: number;
  expense: number;
  netProfit: number;
  internalTransferOut: number;
  internalTransferIn: number;
  adjustedNet: number;
  projects: ProjectRow[];
}

type Period = "month" | "quarter" | "year" | "custom";

function periodRange(period: Exclude<Period, "custom">) {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  const startMonth = period === "year" ? 0 : period === "quarter" ? Math.floor(month / 3) * 3 : month;
  const endMonth = period === "year" ? 11 : period === "quarter" ? startMonth + 2 : month;
  const date = (value: Date) => {
    const y = value.getFullYear();
    const m = String(value.getMonth() + 1).padStart(2, "0");
    const d = String(value.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  };
  return {
    start: date(new Date(year, startMonth, 1)),
    end: date(new Date(year, endMonth + 1, 0)),
  };
}

export default function BuReportPage() {
  const reloadKey = useAutoReloadKey();
  const initial = periodRange("month");
  const [period, setPeriod] = useState<Period>("month");
  const [startDate, setStartDate] = useState(initial.start);
  const [endDate, setEndDate] = useState(initial.end);
  const [rows, setRows] = useState<BuRow[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  // 畫面上的數字是哪一段期間查出來的（日期欄改了還沒按查詢時，明細要跟著畫面上的數字走）
  const [shownRange, setShownRange] = useState({ start: initial.start, end: initial.end });
  const [drill, setDrill] = useState<DrillTarget | null>(null);
  const { toast } = useToast();

  const fetchReport = async (start = startDate, end = endDate) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ startDate: start, endDate: end });
      const response = await fetch(`/erp-api/reports/bu?${params}`, { credentials: "include" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "無法取得 BU 報表");
      setRows(body);
      setShownRange({ start, end });
    } catch (error: any) {
      setRows([]);
      toast({ title: "查詢失敗", description: error.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  // 自動刷新時沿用目前選擇的日期區間，避免畫面資料與篩選條件不一致
  useEffect(() => { fetchReport(); }, [reloadKey]);

  const choosePeriod = (value: Period) => {
    setPeriod(value);
    if (value !== "custom") {
      const range = periodRange(value);
      setStartDate(range.start);
      setEndDate(range.end);
      fetchReport(range.start, range.end);
    }
  };

  const toggle = (row: BuRow) => {
    const key = row.departmentId == null ? "unallocated" : String(row.departmentId);
    setExpanded(previous => {
      const next = new Set(previous);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  };

  const money = (value: number) => new Intl.NumberFormat("zh-TW", {
    style: "currency", currency: "TWD", maximumFractionDigits: 0,
  }).format(value);
  const tone = (value: number) => value >= 0 ? "text-emerald-700" : "text-red-600";
  // 營收、費用點下去看分錄明細（不含內部轉撥，跟報表算法一致）；未歸屬部門那一列沒有部門可以篩，不能點
  const drillCell = (value: number, kind: "Income" | "Expense", name: string, dim: { departmentId?: number | null; projectId?: number }) => {
    if (dim.departmentId == null && dim.projectId == null) return money(value);
    return (
      <DrillAmount onClick={() => setDrill({ title: `${name} ${kind === "Income" ? "營收" : "費用"}`, accountTypes: [kind], ...dim, startDate: shownRange.start, endDate: shownRange.end, excludeInternal: true, note: "不含內部轉撥" })}>
        {money(value)}
      </DrillAmount>
    );
  };

  return (
    <div className="space-y-6" data-report>
      <ReportHeader />
      <PageHeader title="BU 報表" description="依部門（BU）檢視專案損益與內部轉撥" />
      <Card>
        <CardContent className="py-4 space-y-3">
          <div className="flex flex-wrap gap-2">
            {([["month", "本月"], ["quarter", "本季"], ["year", "本年"], ["custom", "自訂"]] as const).map(([value, label]) => (
              <Button key={value} size="sm" variant={period === value ? "default" : "outline"} onClick={() => choosePeriod(value)}>{label}</Button>
            ))}
          </div>
          <div className="flex flex-col sm:flex-row flex-wrap items-end gap-3 w-full">
            <div className="w-full sm:w-auto flex-1"><label className="text-sm font-medium">起始日期</label><Input type="date" className="w-full" value={startDate} onChange={event => { setStartDate(event.target.value); setPeriod("custom"); }} /></div>
            <div className="w-full sm:w-auto flex-1"><label className="text-sm font-medium">結束日期</label><Input type="date" className="w-full" value={endDate} onChange={event => { setEndDate(event.target.value); setPeriod("custom"); }} /></div>
            <Button className="w-full sm:w-auto" onClick={() => fetchReport()} disabled={loading}>{loading ? "查詢中..." : "查詢"}</Button>
            <Button variant="outline" onClick={() => window.print()} className="w-full sm:w-auto"><Printer className="h-4 w-4 mr-1" />列印</Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0 sm:p-0">
          {/* Mobile View */}
          <div className="block md:hidden p-4 bg-gray-50/50">
            {rows.map(row => {
              const key = row.departmentId == null ? "unallocated" : String(row.departmentId);
              const isExpanded = expanded.has(key);
              return (
                <MobileCard key={key}>
                  <MobileCardHeader 
                    title={
                      <div className="flex items-center gap-1 cursor-pointer" onClick={() => toggle(row)}>
                        {isExpanded ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
                        <span>{row.name}</span>
                      </div>
                    }
                    value={money(row.adjustedNet)}
                    titleClass="text-gray-900"
                    valueClass={tone(row.adjustedNet)}
                  />
                  {row.departmentId == null && <div className="text-xs text-amber-700 mb-2">請為專案指定所屬部門，以利正確歸屬 BU。</div>}
                  <MobileCardGrid>
                    <MobileCardItem label="營收" value={drillCell(row.revenue, "Income", row.name, { departmentId: row.departmentId })} />
                    <MobileCardItem label="費用" value={drillCell(row.expense, "Expense", row.name, { departmentId: row.departmentId })} />
                    <MobileCardItem label="內部轉出" value={money(row.internalTransferOut)} />
                    <MobileCardItem label="內部轉入" value={money(row.internalTransferIn)} />
                    <MobileCardItem label="損益" value={money(row.netProfit)} valueClass={tone(row.netProfit)} />
                  </MobileCardGrid>
                  
                  {isExpanded && (
                    <div className="mt-4 pt-3 border-t">
                      <div className="text-xs font-semibold text-gray-500 mb-2">專案明細</div>
                      {row.projects.length === 0 ? <p className="text-xs text-muted-foreground">此 BU 尚無專案</p> : (
                        <div className="space-y-3">
                          {row.projects.map(project => (
                            <div key={project.projectId} className="bg-gray-50 p-2 rounded text-sm">
                              <div className="font-medium mb-1 flex justify-between">
                                <span>{project.name}</span>
                                <span className={tone(project.net)}>{money(project.net)}</span>
                              </div>
                              <div className="flex justify-between text-xs text-gray-500">
                                <span>營收: {drillCell(project.revenue, "Income", project.name, { projectId: project.projectId })}</span>
                                <span>費用: {drillCell(project.expense, "Expense", project.name, { projectId: project.projectId })}</span>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </MobileCard>
              );
            })}
            {!loading && rows.length === 0 && <div className="py-8 text-center text-gray-400">此期間無資料</div>}
          </div>

          {/* Desktop View */}
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full min-w-[980px] text-sm">
              <thead><tr className="border-b bg-muted/50">
                <th className="px-4 py-3 text-left">部門（BU）</th>
                <th className="px-4 py-3 text-right">營收</th>
                <th className="px-4 py-3 text-right">費用</th>
                <th className="px-4 py-3 text-right">損益</th>
                <th className="px-4 py-3 text-right">內部轉出</th>
                <th className="px-4 py-3 text-right">內部轉入</th>
                <th className="px-4 py-3 text-right">調整後損益</th>
              </tr></thead>
              <tbody>
                {rows.map(row => {
                  const key = row.departmentId == null ? "unallocated" : String(row.departmentId);
                  const isExpanded = expanded.has(key);
                  return (
                    <FragmentRow key={key}>
                      <tr className="border-b hover:bg-muted/30">
                        <td className="px-4 py-3">
                          <button className="flex items-center gap-2 font-medium" onClick={() => toggle(row)}>
                            {isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                            {row.name}
                          </button>
                          {row.departmentId == null && <p className="ml-6 mt-1 text-xs text-amber-700">請為專案指定所屬部門，以利正確歸屬 BU。</p>}
                        </td>
                        <td className="px-4 py-3 text-right">{drillCell(row.revenue, "Income", row.name, { departmentId: row.departmentId })}</td>
                        <td className="px-4 py-3 text-right">{drillCell(row.expense, "Expense", row.name, { departmentId: row.departmentId })}</td>
                        <td className={`px-4 py-3 text-right font-medium ${tone(row.netProfit)}`}>{money(row.netProfit)}</td>
                        <td className="px-4 py-3 text-right">{money(row.internalTransferOut)}</td>
                        <td className="px-4 py-3 text-right">{money(row.internalTransferIn)}</td>
                        <td className={`px-4 py-3 text-right font-bold ${tone(row.adjustedNet)}`}>{money(row.adjustedNet)}</td>
                      </tr>
                      {isExpanded && (
                        <tr className="border-b bg-muted/20"><td colSpan={7} className="px-10 py-3">
                          {row.projects.length === 0 ? <p className="text-muted-foreground">此 BU 尚無專案</p> : (
                            <table className="w-full">
                              <thead><tr className="text-muted-foreground"><th className="py-2 text-left">專案</th><th className="py-2 text-right">營收</th><th className="py-2 text-right">費用</th><th className="py-2 text-right">損益</th></tr></thead>
                              <tbody>{row.projects.map(project => <tr key={project.projectId} className="border-t"><td className="py-2">{project.name}</td><td className="py-2 text-right">{drillCell(project.revenue, "Income", project.name, { projectId: project.projectId })}</td><td className="py-2 text-right">{drillCell(project.expense, "Expense", project.name, { projectId: project.projectId })}</td><td className={`py-2 text-right ${tone(project.net)}`}>{money(project.net)}</td></tr>)}</tbody>
                            </table>
                          )}
                        </td></tr>
                      )}
                    </FragmentRow>
                  );
                })}
                {!loading && rows.length === 0 && <tr><td colSpan={7} className="px-4 py-12 text-center text-muted-foreground">此期間無資料</td></tr>}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
      <AccountDrillDialog target={drill} onClose={() => setDrill(null)} />
    </div>
  );
}

function FragmentRow({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}