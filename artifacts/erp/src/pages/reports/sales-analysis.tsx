import { useState, useEffect } from "react";
import { ReportHeader } from "@/components/shared/report-header";
import { fmtMoney } from "@/lib/report-format";
import { useAutoReloadKey } from "@/lib/auto-refresh";
import { PageHeader } from "@/components/shared/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Printer, ShoppingCart, DollarSign } from "lucide-react";
import { ExportMenu } from "@/components/shared/export-menu";
import { MobileCard, MobileCardHeader, MobileCardGrid, MobileCardItem } from "@/components/shared/mobile-card";
import type { ExportOptions } from "@/lib/export-utils";
import type { SalesAnalysisData } from "./types";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from "recharts";

const BASE = import.meta.env.BASE_URL.endsWith("/") ? import.meta.env.BASE_URL : import.meta.env.BASE_URL + "/";

const CHART_COLORS = ["#3b82f6", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#06b6d4", "#ec4899", "#84cc16"];

interface SalesRow {
  name?: string;
  month?: string;
  itemName?: string;
  orderCount?: number;
  quantity?: number;
  totalAmount: number;
}

export default function SalesAnalysisPage() {
  const reloadKey = useAutoReloadKey();
  const [startDate, setStartDate] = useState(() => `${new Date().getFullYear()}-01-01`);
  const [endDate, setEndDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [groupBy, setGroupBy] = useState("customer");
  const [data, setData] = useState<SalesAnalysisData | null>(null);
  const [loading, setLoading] = useState(false);

  const fetchReport = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ groupBy });
      if (startDate) params.set("startDate", startDate);
      if (endDate) params.set("endDate", endDate);
      const res = await fetch(`/erp-api/reports/sales-analysis?${params}`);
      if (!res.ok) throw new Error("API error");
      setData(await res.json());
    } catch { setData(null); }
    setLoading(false);
  };

  useEffect(() => { fetchReport(); }, [reloadKey]);

  const fmt = (n: number) => fmtMoney(n);

  const buildExport = (): ExportOptions => {
    if (!data) return { title: "", subtitle: "", fileName: "", headers: [], columnKeys: [], rows: [] };
    const rows = (data.rows || []) as SalesRow[];
    if (groupBy === "customer" || groupBy === "salesperson") {
      return { title: `銷售分析（按${dimLabel}）`, subtitle: `${startDate} 至 ${endDate}`, fileName: `銷售分析_${dimLabel}_${startDate}_${endDate}`, headers: [dimLabel, "訂單數", "銷售額"], columnKeys: ["name", "orderCount", "totalAmount"], rows: rows.map(r => ({ name: r.name || "", orderCount: r.orderCount || 0, totalAmount: r.totalAmount })) };
    } else if (groupBy === "month") {
      return { title: "銷售分析（按月份）", subtitle: `${startDate} 至 ${endDate}`, fileName: `銷售分析_月份_${startDate}_${endDate}`, headers: ["月份", "訂單數", "銷售額"], columnKeys: ["month", "orderCount", "totalAmount"], rows: rows.map(r => ({ month: r.month || "", orderCount: r.orderCount || 0, totalAmount: r.totalAmount })) };
    }
    return { title: "銷售分析（按品項）", subtitle: `${startDate} 至 ${endDate}`, fileName: `銷售分析_品項_${startDate}_${endDate}`, headers: ["品項名稱", "數量", "銷售額"], columnKeys: ["itemName", "quantity", "totalAmount"], rows: rows.map(r => ({ itemName: r.itemName || "", quantity: r.quantity || 0, totalAmount: r.totalAmount })) };
  };

  const dimLabels: Record<string, string> = { customer: "客戶", month: "月份", item: "品項", salesperson: "業務員" };
  const dimLabel = dimLabels[groupBy] || "品項";

  const chartData = data ? (data.rows || []).slice(0, 10).map((r: SalesRow) => ({
    name: (groupBy === "customer" || groupBy === "salesperson") ? (r.name || "") : groupBy === "month" ? (r.month || "") : (r.itemName || ""),
    amount: r.totalAmount,
  })) : [];

  return (
    <div className="space-y-6" data-report>
      <ReportHeader />
      <PageHeader title="銷售分析" description="依客戶、業務員、月份或品項分析銷售資料" />
      <Card>
        <CardContent className="py-4">
          <div className="flex flex-col sm:flex-row gap-3 sm:items-end w-full">
            <div className="flex-1 min-w-0 w-full">
              <label className="text-sm font-medium text-gray-600 mb-1 block">分組方式</label>
              <select className="w-full border rounded-md px-3 py-2 text-sm bg-white" value={groupBy} onChange={e => setGroupBy(e.target.value)}>
                <option value="customer">按客戶</option>
                <option value="salesperson">按業務員</option>
                <option value="month">按月份</option>
                <option value="item">按品項</option>
              </select>
            </div>
            <div className="flex-1 min-w-0 w-full">
              <label className="text-sm font-medium text-gray-600 mb-1 block">起始日期</label>
              <Input type="date" className="w-full" value={startDate} onChange={e => setStartDate(e.target.value)} />
            </div>
            <div className="flex-1 min-w-0 w-full">
              <label className="text-sm font-medium text-gray-600 mb-1 block">結束日期</label>
              <Input type="date" className="w-full" value={endDate} onChange={e => setEndDate(e.target.value)} />
            </div>
            <div className="flex gap-2 w-full sm:w-auto mt-2 sm:mt-0">
              <Button onClick={fetchReport} disabled={loading} className="flex-1 sm:flex-none">{loading ? "查詢中..." : "查詢"}</Button>
              {data && <Button variant="outline" onClick={() => window.print()} className="flex-1 sm:flex-none"><Printer className="h-4 w-4 mr-1" />列印</Button>}
              {data && <ExportMenu getExportOptions={buildExport} />}
            </div>
          </div>
        </CardContent>
      </Card>

      {data && (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Card>
              <CardContent className="flex items-center gap-4 py-4">
                <div className="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center"><ShoppingCart className="h-5 w-5 text-blue-600" /></div>
                <div><div className="text-sm text-gray-500">總訂單數</div><div className="text-2xl font-bold">{data.totalOrders}</div></div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="flex items-center gap-4 py-4">
                <div className="w-10 h-10 rounded-full bg-green-100 flex items-center justify-center"><DollarSign className="h-5 w-5 text-green-600" /></div>
                <div><div className="text-sm text-gray-500">總銷售額</div><div className="text-2xl font-bold text-green-600">{fmt(data.totalAmount)}</div></div>
              </CardContent>
            </Card>
          </div>

          {chartData.length > 0 && (
            <Card>
              <CardHeader className="py-3 border-b"><CardTitle className="text-lg">銷售額圖表（前10名）</CardTitle></CardHeader>
              <CardContent className="pt-4">
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={chartData} margin={{ top: 5, right: 10, left: 20, bottom: 60 }}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="name" angle={-35} textAnchor="end" interval={0} tick={{ fontSize: 11 }} />
                    <YAxis tickFormatter={(v: number) => `$${(v / 1000).toFixed(0)}k`} />
                    <Tooltip formatter={(v: number) => [fmt(v), "銷售額"]} />
                    <Bar dataKey="amount" radius={[4, 4, 0, 0]}>
                      {chartData.map((_, idx) => (
                        <Cell key={idx} fill={CHART_COLORS[idx % CHART_COLORS.length]} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader className="py-3 border-b"><CardTitle className="text-lg">銷售分析（按{dimLabel}）</CardTitle></CardHeader>
            <CardContent className="p-0 sm:p-0">
              {/* Mobile View */}
              <div className="block md:hidden p-4 bg-gray-50/50">
                {(data.rows || []).map((r: SalesRow, idx: number) => {
                  const label = (groupBy === "customer" || groupBy === "salesperson") ? r.name : groupBy === "month" ? r.month : r.itemName;
                  const count = groupBy === "item" ? r.quantity : r.orderCount;
                  const pct = data.totalAmount > 0 ? ((r.totalAmount / data.totalAmount) * 100).toFixed(1) : "0.0";
                  return (
                    <MobileCard key={idx}>
                      <MobileCardHeader 
                        title={label}
                        value={fmt(r.totalAmount)}
                        titleClass="text-gray-900"
                        valueClass="text-green-700 font-mono"
                      />
                      <MobileCardGrid>
                        <MobileCardItem label={groupBy === "item" ? "數量" : "訂單數"} value={count} valueClass="font-mono text-gray-600" />
                        <MobileCardItem label="佔比" value={`${pct}%`} valueClass="font-mono text-gray-500" />
                      </MobileCardGrid>
                    </MobileCard>
                  );
                })}
                {(data.rows || []).length === 0 && <div className="py-8 text-center text-gray-400">無銷售資料</div>}
              </div>

              {/* Desktop View */}
              <div className="hidden md:block overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-gray-50/50">
                      <th className="text-left px-4 py-2.5 font-semibold">{dimLabel}</th>
                      <th className="text-right px-4 py-2.5 font-semibold">{groupBy === "item" ? "數量" : "訂單數"}</th>
                      <th className="text-right px-4 py-2.5 font-semibold">銷售額</th>
                      <th className="text-right px-4 py-2.5 font-semibold">佔比</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(data.rows || []).map((r: SalesRow, idx: number) => {
                      const label = (groupBy === "customer" || groupBy === "salesperson") ? r.name : groupBy === "month" ? r.month : r.itemName;
                      const count = groupBy === "item" ? r.quantity : r.orderCount;
                      const pct = data.totalAmount > 0 ? ((r.totalAmount / data.totalAmount) * 100).toFixed(1) : "0.0";
                      return (
                        <tr key={idx} className="border-b hover:bg-gray-50">
                          <td className="px-4 py-2 font-medium">{label}</td>
                          <td className="px-4 py-2 text-right">{count}</td>
                          <td className="px-4 py-2 text-right font-mono">{fmt(r.totalAmount)}</td>
                          <td className="px-4 py-2 text-right text-gray-500">{pct}%</td>
                        </tr>
                      );
                    })}
                    {(data.rows || []).length === 0 && <tr><td colSpan={4} className="px-4 py-8 text-center text-gray-400">無銷售資料</td></tr>}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </>
      )}

      {!data && !loading && <Card><CardContent className="py-12 text-center text-gray-400">點擊查詢以產生銷售分析</CardContent></Card>}
    </div>
  );
}
