import { useState, useEffect } from "react";
import { ReportHeader } from "@/components/shared/report-header";
import { fmtMoney } from "@/lib/report-format";
import { useAutoReloadKey } from "@/lib/auto-refresh";
import { PageHeader } from "@/components/shared/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Printer, AlertTriangle } from "lucide-react";
import { ExportMenu } from "@/components/shared/export-menu";
import { MobileCard, MobileCardHeader, MobileCardGrid, MobileCardItem, MobileTotalCard } from "@/components/shared/mobile-card";
import type { ExportOptions } from "@/lib/export-utils";
import type { AgingData, AgingRow, AgingSummary } from "./types";

const BASE = import.meta.env.BASE_URL.endsWith("/") ? import.meta.env.BASE_URL : import.meta.env.BASE_URL + "/";

type AgingKey = "current" | "d30" | "d60" | "d90" | "d120";

const agingValue = (obj: AgingRow | AgingSummary, key: AgingKey): number => obj[key];

export default function ApAgingPage() {
  const reloadKey = useAutoReloadKey();
  const [data, setData] = useState<AgingData | null>(null);
  const [loading, setLoading] = useState(false);

  const fetchReport = async () => {
    setLoading(true);
    try {
      const res = await fetch(`/erp-api/reports/ap-aging`);
      if (!res.ok) throw new Error("API error");
      setData(await res.json());
    } catch { setData(null); }
    setLoading(false);
  };

  useEffect(() => { fetchReport(); }, [reloadKey]);

  const fmt = (n: number) => fmtMoney(n, true);

  const buildExport = (): ExportOptions => {
    if (!data) return { title: "", subtitle: "", fileName: "", headers: [], columnKeys: [], rows: [] };
    const rows = (data.rows || []).map((r: AgingRow) => ({
      name: r.supplierName || "", code: r.supplierCode || "", current: r.current, d30: r.d30, d60: r.d60, d90: r.d90, d120: r.d120, total: r.total,
    }));
    rows.push({ name: "合計", code: "", current: data.summary.current, d30: data.summary.d30, d60: data.summary.d60, d90: data.summary.d90, d120: data.summary.d120, total: data.summary.total });
    return { title: "應付帳款帳齡分析", subtitle: `基準日：${data.asOfDate}`, fileName: `應付帳款帳齡_${data.asOfDate}`, headers: ["供應商名稱", "供應商代碼", "未到期", "1-30天", "31-60天", "61-90天", "90天以上", "合計"], columnKeys: ["name", "code", "current", "d30", "d60", "d90", "d120", "total"], rows };
  };

  const cols: { key: AgingKey; label: string }[] = [
    { key: "current", label: "未到期" },
    { key: "d30", label: "1-30天" },
    { key: "d60", label: "31-60天" },
    { key: "d90", label: "61-90天" },
    { key: "d120", label: "90天以上" },
  ];

  return (
    <div className="space-y-6" data-report>
      <ReportHeader />
      <PageHeader title="應付帳款帳齡分析" description="按到期天數分析未付帳款" />
      <Card>
        <CardContent className="py-4">
          <div className="flex flex-col sm:flex-row gap-3 sm:items-center w-full">
            <Button onClick={fetchReport} disabled={loading} className="w-full sm:w-auto">{loading ? "載入中..." : "重新整理"}</Button>
            {data && <Button variant="outline" onClick={() => window.print()} className="w-full sm:w-auto"><Printer className="h-4 w-4 mr-1" />列印</Button>}
            {data && <div className="w-full sm:w-auto"><ExportMenu getExportOptions={buildExport} /></div>}
            {data && <span className="text-sm text-gray-500 sm:ml-auto text-center w-full sm:w-auto">基準日：{data.asOfDate}</span>}
          </div>
        </CardContent>
      </Card>

      {data && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            {cols.map(c => (
              <Card key={c.key}>
                <CardContent className="py-3 text-center">
                  <div className="text-xs text-gray-500 mb-1">{c.label}</div>
                  <div className="text-lg font-bold">{fmt(agingValue(data.summary, c.key))}</div>
                </CardContent>
              </Card>
            ))}
            <Card className="bg-orange-50 border-orange-200">
              <CardContent className="py-3 text-center">
                <div className="text-xs text-orange-600 mb-1">總計</div>
                <div className="text-lg font-bold text-orange-700">{fmt(data.summary.total)}</div>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader className="py-3 border-b"><CardTitle className="text-lg">帳齡明細</CardTitle></CardHeader>
            <CardContent className="p-0 sm:p-0">
              {/* Mobile View */}
              <div className="block md:hidden p-4 bg-gray-50/50">
                {(data.rows || []).map((r: AgingRow, idx: number) => (
                  <MobileCard key={idx}>
                    <MobileCardHeader 
                      title={
                        <div className="flex items-center">
                          {r.supplierName}
                          {(r.d90 > 0 || r.d120 > 0) && <AlertTriangle className="inline h-4 w-4 text-red-500 ml-1.5" />}
                        </div>
                      }
                      value={fmt(r.total)}
                      titleClass="text-gray-900"
                      valueClass="text-orange-700 font-mono"
                    />
                    <MobileCardGrid>
                      <MobileCardItem label="供應商代碼" value={r.supplierCode || "-"} />
                      <MobileCardItem label="未到期" value={fmt(r.current)} valueClass="font-mono" right />
                      <MobileCardItem label="1-30天" value={fmt(r.d30)} valueClass="font-mono" right />
                      <MobileCardItem label="31-60天" value={fmt(r.d60)} valueClass="font-mono" right />
                      <MobileCardItem label="61-90天" value={fmt(r.d90)} valueClass="font-mono text-red-600" right />
                      <MobileCardItem label="90天以上" value={fmt(r.d120)} valueClass="font-mono text-red-600" right />
                    </MobileCardGrid>
                  </MobileCard>
                ))}
                {data.rows.length === 0 && <div className="py-8 text-center text-gray-400">目前無應付帳款</div>}
                {data.rows.length > 0 && (
                  <MobileTotalCard>
                    <div className="flex justify-between items-center mb-3">
                      <span className="text-gray-700 font-bold">總計</span>
                      <span className="text-orange-700 font-mono text-xl">{fmt(data.summary.total)}</span>
                    </div>
                    <MobileCardGrid>
                      <MobileCardItem label="未到期" value={fmt(data.summary.current)} valueClass="font-mono" right />
                      <MobileCardItem label="1-30天" value={fmt(data.summary.d30)} valueClass="font-mono" right />
                      <MobileCardItem label="31-60天" value={fmt(data.summary.d60)} valueClass="font-mono" right />
                      <MobileCardItem label="61-90天" value={fmt(data.summary.d90)} valueClass="font-mono text-red-600" right />
                      <MobileCardItem label="90天以上" value={fmt(data.summary.d120)} valueClass="font-mono text-red-600" right />
                    </MobileCardGrid>
                  </MobileTotalCard>
                )}
              </div>

              {/* Desktop View */}
              <div className="hidden md:block overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-gray-50/50">
                      <th className="text-left px-4 py-2.5 font-semibold">供應商名稱</th>
                      <th className="text-left px-4 py-2.5 font-semibold hidden md:table-cell">供應商代碼</th>
                      {cols.map(c => <th key={c.key} className="text-right px-3 py-2.5 font-semibold">{c.label}</th>)}
                      <th className="text-right px-4 py-2.5 font-semibold">合計</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(data.rows || []).map((r: AgingRow, idx: number) => (
                      <tr key={idx} className="border-b hover:bg-gray-50">
                        <td className="px-4 py-1.5 font-medium">
                          {r.supplierName}
                          {(r.d90 > 0 || r.d120 > 0) && <AlertTriangle className="inline h-3.5 w-3.5 text-red-500 ml-1" />}
                        </td>
                        <td className="px-4 py-1.5 text-gray-500 hidden md:table-cell">{r.supplierCode || "-"}</td>
                        {cols.map(c => <td key={c.key} className={`px-3 py-1.5 text-right font-mono ${c.key === "d90" || c.key === "d120" ? "text-red-600" : ""}`}>{fmt(agingValue(r, c.key))}</td>)}
                        <td className="px-4 py-1.5 text-right font-mono font-bold">{fmt(r.total)}</td>
                      </tr>
                    ))}
                    {data.rows.length === 0 && <tr><td colSpan={8} className="px-4 py-8 text-center text-gray-400">目前無應付帳款</td></tr>}
                    <tr className="border-t-2 bg-gray-100 font-bold">
                      <td className="px-4 py-2.5" colSpan={2}>合計</td>
                      {cols.map(c => <td key={c.key} className="px-3 py-2.5 text-right font-mono">{fmt(agingValue(data.summary, c.key))}</td>)}
                      <td className="px-4 py-2.5 text-right font-mono text-orange-700">{fmt(data.summary.total)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </>
      )}

      {!data && !loading && <Card><CardContent className="py-12 text-center text-gray-400">載入中...</CardContent></Card>}
    </div>
  );
}
