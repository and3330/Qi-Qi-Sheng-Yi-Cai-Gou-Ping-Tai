import { useState, useEffect } from "react";
import { ReportHeader } from "@/components/shared/report-header";
import { fmtMoney } from "@/lib/report-format";
import { useAutoReloadKey } from "@/lib/auto-refresh";
import { PageHeader } from "@/components/shared/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Printer, AlertTriangle } from "lucide-react";
import { ExportMenu } from "@/components/shared/export-menu";
import { MobileCard, MobileCardHeader, MobileCardGrid, MobileCardItem, MobileTotalCard } from "@/components/shared/mobile-card";
import type { ExportOptions } from "@/lib/export-utils";
import type { BudgetVsActualData, BudgetVsActualRow } from "./types";

const BASE = import.meta.env.BASE_URL.endsWith("/") ? import.meta.env.BASE_URL : import.meta.env.BASE_URL + "/";

export default function BudgetVsActualPage() {
  const reloadKey = useAutoReloadKey();
  const [startDate, setStartDate] = useState(() => `${new Date().getFullYear()}-01-01`);
  const [endDate, setEndDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [dimension, setDimension] = useState("department");
  const [data, setData] = useState<BudgetVsActualData | null>(null);
  const [loading, setLoading] = useState(false);

  const fetchReport = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ dimension });
      if (startDate) params.set("startDate", startDate);
      if (endDate) params.set("endDate", endDate);
      const res = await fetch(`/erp-api/reports/budget-vs-actual?${params}`);
      if (!res.ok) throw new Error("API error");
      setData(await res.json());
    } catch { setData(null); }
    setLoading(false);
  };

  useEffect(() => { fetchReport(); }, [reloadKey]);

  const fmt = (n: number) => fmtMoney(n, true);
  const varianceColor = (v: number) => v > 0 ? "text-green-600" : v < 0 ? "text-red-600" : "text-gray-400";

  const hasBudget = data ? (data.totals.budgetIncome !== 0 || data.totals.budgetExpense !== 0) : false;

  const buildExport = (): ExportOptions => {
    if (!data) return { title: "", subtitle: "", fileName: "", headers: [], columnKeys: [], rows: [] };
    const rows = (data.rows || []).map((r: BudgetVsActualRow) => ({
      name: r.name,
      budgetIncome: r.budgetIncome,
      budgetExpense: r.budgetExpense,
      actualIncome: r.actualIncome,
      actualExpense: r.actualExpense,
      varianceIncome: r.varianceIncome,
      varianceExpense: r.varianceExpense,
      actualNet: r.actualIncome - r.actualExpense,
    }));
    return {
      title: "預算 vs 實際",
      subtitle: `期間：${startDate} 至 ${endDate}`,
      fileName: `預算vs實際_${startDate}_${endDate}`,
      headers: ["名稱", "預算收入", "實際收入", "收入差異", "預算支出", "實際支出", "支出差異", "實際淨額"],
      columnKeys: ["name", "budgetIncome", "actualIncome", "varianceIncome", "budgetExpense", "actualExpense", "varianceExpense", "actualNet"],
      rows,
    };
  };

  const dimLabel = dimension === "department" ? "部門" : "專案";

  return (
    <div className="space-y-6" data-report>
      <ReportHeader />
      <PageHeader title="預算 vs 實際" description="按專案或部門比較預算與實際收支" />
      <Card>
        <CardContent className="py-4">
          <div className="flex flex-col sm:flex-row gap-3 sm:items-end w-full">
            <div className="flex-1 min-w-0">
              <label className="text-sm font-medium text-gray-600 mb-1 block">分析維度</label>
              <select className="w-full border rounded-md px-3 py-2 text-sm bg-white" value={dimension} onChange={e => setDimension(e.target.value)}>
                <option value="department">按部門</option>
                <option value="project">按專案</option>
              </select>
            </div>
            <div className="flex-1 min-w-0">
              <label className="text-sm font-medium text-gray-600 mb-1 block">起始日期</label>
              <Input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} />
            </div>
            <div className="flex-1 min-w-0">
              <label className="text-sm font-medium text-gray-600 mb-1 block">結束日期</label>
              <Input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} />
            </div>
            <div className="flex gap-2 w-full sm:w-auto mt-2 sm:mt-0">
              <Button onClick={fetchReport} disabled={loading} className="flex-1 sm:flex-none">{loading ? "查詢中..." : "查詢"}</Button>
              {data && <Button variant="outline" onClick={() => window.print()} className="flex-1 sm:flex-none"><Printer className="h-4 w-4 mr-1" />列印</Button>}
              {data && <ExportMenu getExportOptions={buildExport} />}
            </div>
          </div>
        </CardContent>
      </Card>

      {data && !hasBudget && (
        <Card className="border-amber-200 bg-amber-50">
          <CardContent className="py-3 flex items-center gap-2 text-amber-800 text-sm">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            <span>預算功能尚未設定 — 目前僅顯示實際收支資料。請先至{dimLabel}管理設定預算金額後再進行比較分析。</span>
          </CardContent>
        </Card>
      )}

      {data && (
        <Card>
          <CardHeader className="py-3 border-b">
            <CardTitle className="text-lg">
              {dimLabel}預算與實際比較
              <span className="text-sm font-normal text-gray-500 ml-2">{startDate} 至 {endDate}</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0 sm:p-0">
            {/* Mobile View */}
            <div className="block md:hidden p-4 bg-gray-50/50">
              {(data.rows || []).map((r: BudgetVsActualRow) => {
                const net = r.actualIncome - r.actualExpense;
                return (
                  <MobileCard key={r.id}>
                    <MobileCardHeader 
                      title={r.name}
                      value={fmt(net)}
                      titleClass="text-gray-900"
                      valueClass={net >= 0 ? "text-green-700 font-mono" : "text-red-700 font-mono"}
                    />
                    
                    <div className="mb-2 pb-2 border-b border-gray-100">
                      <div className="text-xs font-semibold text-gray-500 mb-2">收入</div>
                      <MobileCardGrid>
                        <MobileCardItem label="預算" value={fmt(r.budgetIncome)} valueClass="font-mono text-gray-500" />
                        <MobileCardItem label="實際" value={fmt(r.actualIncome)} valueClass="font-mono text-green-600" />
                        <MobileCardItem label="差異" value={fmt(r.varianceIncome)} valueClass={`font-mono ${varianceColor(r.varianceIncome)}`} />
                      </MobileCardGrid>
                    </div>
                    
                    <div>
                      <div className="text-xs font-semibold text-gray-500 mb-2">支出</div>
                      <MobileCardGrid>
                        <MobileCardItem label="預算" value={fmt(r.budgetExpense)} valueClass="font-mono text-gray-500" />
                        <MobileCardItem label="實際" value={fmt(r.actualExpense)} valueClass="font-mono text-red-600" />
                        <MobileCardItem label="差異" value={fmt(r.varianceExpense)} valueClass={`font-mono ${varianceColor(r.varianceExpense)}`} />
                      </MobileCardGrid>
                    </div>
                  </MobileCard>
                );
              })}
              {(data.rows || []).length === 0 && <div className="py-8 text-center text-gray-400">無資料</div>}
              {(data.rows || []).length > 0 && (
                <MobileTotalCard>
                  <div className="flex justify-between items-center mb-4">
                    <span className="text-gray-700 font-bold">合計實際淨額</span>
                    <span className={`font-mono text-xl ${(data.totals.actualIncome - data.totals.actualExpense) >= 0 ? "text-green-800" : "text-red-800"}`}>
                      {fmt(data.totals.actualIncome - data.totals.actualExpense)}
                    </span>
                  </div>
                  
                  <div className="mb-2 pb-2 border-b border-gray-200">
                    <div className="text-xs font-semibold text-gray-600 mb-2">收入合計</div>
                    <MobileCardGrid>
                      <MobileCardItem label="預算" value={fmt(data.totals.budgetIncome)} valueClass="font-mono text-gray-600" />
                      <MobileCardItem label="實際" value={fmt(data.totals.actualIncome)} valueClass="font-mono text-green-700" />
                      <MobileCardItem label="差異" value={fmt(data.totals.budgetIncome - data.totals.actualIncome)} valueClass={`font-mono ${varianceColor(data.totals.budgetIncome - data.totals.actualIncome)}`} />
                    </MobileCardGrid>
                  </div>
                  
                  <div>
                    <div className="text-xs font-semibold text-gray-600 mb-2">支出合計</div>
                    <MobileCardGrid>
                      <MobileCardItem label="預算" value={fmt(data.totals.budgetExpense)} valueClass="font-mono text-gray-600" />
                      <MobileCardItem label="實際" value={fmt(data.totals.actualExpense)} valueClass="font-mono text-red-700" />
                      <MobileCardItem label="差異" value={fmt(data.totals.budgetExpense - data.totals.actualExpense)} valueClass={`font-mono ${varianceColor(data.totals.budgetExpense - data.totals.actualExpense)}`} />
                    </MobileCardGrid>
                  </div>
                </MobileTotalCard>
              )}
            </div>

            {/* Desktop View */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-gray-50/50">
                    <th className="text-left px-4 py-2.5 font-semibold" rowSpan={2}>{dimLabel}</th>
                    <th className="text-center px-3 py-1.5 font-semibold border-b bg-green-50/50" colSpan={3}>收入</th>
                    <th className="text-center px-3 py-1.5 font-semibold border-b bg-red-50/50" colSpan={3}>支出</th>
                    <th className="text-right px-4 py-2.5 font-semibold" rowSpan={2}>實際淨額</th>
                  </tr>
                  <tr className="border-b bg-gray-50/50">
                    <th className="text-right px-3 py-1.5 font-semibold text-xs">預算</th>
                    <th className="text-right px-3 py-1.5 font-semibold text-xs">實際</th>
                    <th className="text-right px-3 py-1.5 font-semibold text-xs">差異</th>
                    <th className="text-right px-3 py-1.5 font-semibold text-xs">預算</th>
                    <th className="text-right px-3 py-1.5 font-semibold text-xs">實際</th>
                    <th className="text-right px-3 py-1.5 font-semibold text-xs">差異</th>
                  </tr>
                </thead>
                <tbody>
                  {(data.rows || []).map((r: BudgetVsActualRow) => {
                    const net = r.actualIncome - r.actualExpense;
                    return (
                      <tr key={r.id} className="border-b hover:bg-gray-50">
                        <td className="px-4 py-2 font-medium">{r.name}</td>
                        <td className="px-3 py-2 text-right font-mono text-gray-500">{fmt(r.budgetIncome)}</td>
                        <td className="px-3 py-2 text-right font-mono text-green-600">{fmt(r.actualIncome)}</td>
                        <td className={`px-3 py-2 text-right font-mono ${varianceColor(r.varianceIncome)}`}>{fmt(r.varianceIncome)}</td>
                        <td className="px-3 py-2 text-right font-mono text-gray-500">{fmt(r.budgetExpense)}</td>
                        <td className="px-3 py-2 text-right font-mono text-red-600">{fmt(r.actualExpense)}</td>
                        <td className={`px-3 py-2 text-right font-mono ${varianceColor(r.varianceExpense)}`}>{fmt(r.varianceExpense)}</td>
                        <td className={`px-4 py-2 text-right font-mono font-bold ${net >= 0 ? "text-green-700" : "text-red-700"}`}>{fmt(net)}</td>
                      </tr>
                    );
                  })}
                  {(data.rows || []).length === 0 && <tr><td colSpan={8} className="px-4 py-8 text-center text-gray-400">無資料</td></tr>}
                  <tr className="border-t-2 bg-gray-100 font-bold">
                    <td className="px-4 py-2.5">合計</td>
                    <td className="px-3 py-2.5 text-right font-mono text-gray-600">{fmt(data.totals.budgetIncome)}</td>
                    <td className="px-3 py-2.5 text-right font-mono text-green-700">{fmt(data.totals.actualIncome)}</td>
                    <td className={`px-3 py-2.5 text-right font-mono ${varianceColor(data.totals.budgetIncome - data.totals.actualIncome)}`}>{fmt(data.totals.budgetIncome - data.totals.actualIncome)}</td>
                    <td className="px-3 py-2.5 text-right font-mono text-gray-600">{fmt(data.totals.budgetExpense)}</td>
                    <td className="px-3 py-2.5 text-right font-mono text-red-700">{fmt(data.totals.actualExpense)}</td>
                    <td className={`px-3 py-2.5 text-right font-mono ${varianceColor(data.totals.budgetExpense - data.totals.actualExpense)}`}>{fmt(data.totals.budgetExpense - data.totals.actualExpense)}</td>
                    <td className={`px-4 py-2.5 text-right font-mono ${(data.totals.actualIncome - data.totals.actualExpense) >= 0 ? "text-green-800" : "text-red-800"}`}>{fmt(data.totals.actualIncome - data.totals.actualExpense)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {!data && !loading && <Card><CardContent className="py-12 text-center text-gray-400">點擊查詢以產生報表</CardContent></Card>}
    </div>
  );
}
