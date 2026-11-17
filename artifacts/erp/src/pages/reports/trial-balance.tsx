import { useState, useEffect } from "react";
import { ReportHeader } from "@/components/shared/report-header";
import { fmtMoney } from "@/lib/report-format";
import { useAutoReloadKey } from "@/lib/auto-refresh";
import { PageHeader } from "@/components/shared/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Printer, CheckCircle2, AlertCircle } from "lucide-react";
import { ExportMenu } from "@/components/shared/export-menu";
import { MobileCard, MobileCardHeader, MobileCardGrid, MobileCardItem, MobileTotalCard } from "@/components/shared/mobile-card";
import type { ExportOptions } from "@/lib/export-utils";
import type { TrialBalanceData, TrialBalanceRow } from "./types";

const BASE = import.meta.env.BASE_URL.endsWith("/") ? import.meta.env.BASE_URL : import.meta.env.BASE_URL + "/";

export default function TrialBalancePage() {
  const reloadKey = useAutoReloadKey();
  const [startDate, setStartDate] = useState(() => `${new Date().getFullYear()}-01-01`);
  const [endDate, setEndDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [data, setData] = useState<TrialBalanceData | null>(null);
  const [loading, setLoading] = useState(false);

  const fetchReport = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (startDate) params.set("startDate", startDate);
      if (endDate) params.set("endDate", endDate);
      const res = await fetch(`/erp-api/reports/trial-balance?${params}`);
      if (!res.ok) throw new Error("API error");
      setData(await res.json());
    } catch { setData(null); }
    setLoading(false);
  };

  useEffect(() => { fetchReport(); }, [reloadKey]);

  const fmt = (n: number) => fmtMoney(n, true);

  const buildExport = (): ExportOptions => {
    if (!data) return { title: "", subtitle: "", fileName: "", headers: [], columnKeys: [], rows: [] };
    const rows = (data.rows || []).map((r: TrialBalanceRow) => ({
      code: r.accountNumber, name: r.accountName, type: r.accountType,
      debit: r.debit, credit: r.credit, debitBal: r.debitBalance, creditBal: r.creditBalance,
    }));
    rows.push({ code: "", name: "合計", type: "", debit: data.totalDebit, credit: data.totalCredit, debitBal: data.totalDebitBalance, creditBal: data.totalCreditBalance });
    return { title: "試算表", subtitle: `期間：${startDate} 至 ${endDate}`, fileName: `試算表_${startDate}_${endDate}`, headers: ["科目代碼", "科目名稱", "類型", "借方發生", "貸方發生", "借方餘額", "貸方餘額"], columnKeys: ["code", "name", "type", "debit", "credit", "debitBal", "creditBal"], rows };
  };

  const typeLabel: Record<string, string> = { Asset: "資產", Liability: "負債", Equity: "權益", Income: "收入", Expense: "費用" };

  return (
    <div className="space-y-6" data-report>
      <ReportHeader />
      <PageHeader title="試算表" description="各科目借貸方發生額及餘額彙總" />
      <Card>
        <CardContent className="py-4">
          <div className="flex flex-col sm:flex-row gap-3 sm:items-end w-full">
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
        <Card>
          <CardHeader className="py-3 border-b">
            <div className="flex items-center justify-between">
              <CardTitle className="text-center text-lg flex-1">
                試算表
                <div className="text-sm font-normal text-gray-500 mt-1">期間：{startDate} 至 {endDate}</div>
              </CardTitle>
              {data.isBalanced ? (
                <Badge variant="outline" className="text-green-600 border-green-300 bg-green-50 gap-1"><CheckCircle2 className="h-3.5 w-3.5" />平衡</Badge>
              ) : (
                <Badge variant="outline" className="text-red-600 border-red-300 bg-red-50 gap-1"><AlertCircle className="h-3.5 w-3.5" />不平衡</Badge>
              )}
            </div>
          </CardHeader>
          <CardContent className="p-0 sm:p-0">
            {/* Mobile View */}
            <div className="block md:hidden p-4 bg-gray-50/50">
              {(data.rows || []).map((r: TrialBalanceRow) => (
                <MobileCard key={r.accountId}>
                  <MobileCardHeader 
                    title={<div className="flex items-center gap-2">{r.accountName} <span className="text-xs font-normal text-gray-500 bg-gray-100 px-2 py-0.5 rounded">{typeLabel[r.accountType] || r.accountType}</span></div>}
                    value=""
                  />
                  <div className="text-xs font-mono text-gray-500 mb-3">{r.accountNumber}</div>
                  
                  <div className="mb-2 pb-2 border-b border-gray-100">
                    <div className="text-xs font-semibold text-gray-500 mb-1">發生額</div>
                    <MobileCardGrid>
                      <MobileCardItem label="借方" value={fmt(r.debit)} valueClass="font-mono text-gray-600" />
                      <MobileCardItem label="貸方" value={fmt(r.credit)} valueClass="font-mono text-gray-600" />
                    </MobileCardGrid>
                  </div>
                  
                  <div>
                    <div className="text-xs font-semibold text-gray-500 mb-1">餘額</div>
                    <MobileCardGrid>
                      <MobileCardItem label="借方" value={fmt(r.debitBalance)} valueClass="font-mono text-blue-600 font-medium" />
                      <MobileCardItem label="貸方" value={fmt(r.creditBalance)} valueClass="font-mono text-blue-600 font-medium" />
                    </MobileCardGrid>
                  </div>
                </MobileCard>
              ))}
              
              <MobileTotalCard>
                <div className="text-center font-bold text-gray-700 mb-3 pb-2 border-b border-gray-200">總計</div>
                
                <div className="mb-3 pb-3 border-b border-gray-200">
                  <div className="text-xs font-semibold text-gray-600 mb-2">發生額合計</div>
                  <MobileCardGrid>
                    <MobileCardItem label="借方" value={fmt(data.totalDebit)} valueClass="font-mono text-gray-800 text-lg" />
                    <MobileCardItem label="貸方" value={fmt(data.totalCredit)} valueClass="font-mono text-gray-800 text-lg" />
                  </MobileCardGrid>
                </div>
                
                <div>
                  <div className="text-xs font-semibold text-gray-600 mb-2">餘額合計</div>
                  <MobileCardGrid>
                    <MobileCardItem label="借方" value={fmt(data.totalDebitBalance)} valueClass="font-mono text-blue-700 text-lg" />
                    <MobileCardItem label="貸方" value={fmt(data.totalCreditBalance)} valueClass="font-mono text-blue-700 text-lg" />
                  </MobileCardGrid>
                </div>
              </MobileTotalCard>
            </div>

            {/* Desktop View */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-gray-50/50">
                    <th className="text-left px-4 py-2.5 font-semibold">科目代碼</th>
                    <th className="text-left px-4 py-2.5 font-semibold">科目名稱</th>
                    <th className="text-left px-4 py-2.5 font-semibold hidden md:table-cell">類型</th>
                    <th className="text-right px-4 py-2.5 font-semibold">借方發生</th>
                    <th className="text-right px-4 py-2.5 font-semibold">貸方發生</th>
                    <th className="text-right px-4 py-2.5 font-semibold">借方餘額</th>
                    <th className="text-right px-4 py-2.5 font-semibold">貸方餘額</th>
                  </tr>
                </thead>
                <tbody>
                  {(data.rows || []).map((r: TrialBalanceRow) => (
                    <tr key={r.accountId} className="border-b hover:bg-gray-50">
                      <td className="px-4 py-1.5 font-mono text-xs text-gray-500">{r.accountNumber}</td>
                      <td className="px-4 py-1.5">{r.accountName}</td>
                      <td className="px-4 py-1.5 hidden md:table-cell text-gray-500 text-xs">{typeLabel[r.accountType] || r.accountType}</td>
                      <td className="px-4 py-1.5 text-right font-mono">{fmt(r.debit)}</td>
                      <td className="px-4 py-1.5 text-right font-mono">{fmt(r.credit)}</td>
                      <td className="px-4 py-1.5 text-right font-mono text-blue-600">{fmt(r.debitBalance)}</td>
                      <td className="px-4 py-1.5 text-right font-mono text-blue-600">{fmt(r.creditBalance)}</td>
                    </tr>
                  ))}
                  <tr className="border-t-2 bg-gray-100 font-bold">
                    <td colSpan={3} className="px-4 py-2.5">合計</td>
                    <td className="px-4 py-2.5 text-right font-mono">{fmt(data.totalDebit)}</td>
                    <td className="px-4 py-2.5 text-right font-mono">{fmt(data.totalCredit)}</td>
                    <td className="px-4 py-2.5 text-right font-mono text-blue-700">{fmt(data.totalDebitBalance)}</td>
                    <td className="px-4 py-2.5 text-right font-mono text-blue-700">{fmt(data.totalCreditBalance)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {!data && !loading && <Card><CardContent className="py-12 text-center text-gray-400">點擊查詢以產生試算表</CardContent></Card>}
    </div>
  );
}
