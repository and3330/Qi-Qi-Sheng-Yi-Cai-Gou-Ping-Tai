import { useState, useEffect, type ReactNode } from "react";
import { DrillAmount } from "@/components/shared/account-drill";
import { DocListDrillDialog, SalarySlipOpener, type DocListTarget, type SalaryField, type SlipRef } from "@/components/shared/doc-list-drill";
import { ReportHeader } from "@/components/shared/report-header";
import { fmtMoney } from "@/lib/report-format";
import { useAutoReloadKey } from "@/lib/auto-refresh";
import { PageHeader } from "@/components/shared/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Printer, Wallet, Users, Building2 } from "lucide-react";
import { ExportMenu } from "@/components/shared/export-menu";
import { MobileCard, MobileCardHeader, MobileCardGrid, MobileCardItem } from "@/components/shared/mobile-card";
import type { ExportOptions } from "@/lib/export-utils";
import type { SalarySummaryData, MonthlyRow, SalaryDetailRow } from "./types";

const BASE = import.meta.env.BASE_URL.endsWith("/") ? import.meta.env.BASE_URL : import.meta.env.BASE_URL + "/";

/** 個人明細的一列：後端另外帶薪資單的編號，點金額開那張薪資單用 */
type SlipRow = SalaryDetailRow & { id?: number; employeeId?: number; year?: number; month?: number };

export default function SalarySummaryPage() {
  const reloadKey = useAutoReloadKey();
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState<number | "">(now.getMonth() + 1);
  const [data, setData] = useState<SalarySummaryData | null>(null);
  const [loading, setLoading] = useState(false);

  const fetchReport = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ year: String(year) });
      if (month !== "") params.set("month", String(month));
      const res = await fetch(`/erp-api/reports/salary-summary?${params}`);
      if (!res.ok) throw new Error("API error");
      setData(await res.json());
    } catch { setData(null); }
    setLoading(false);
  };

  useEffect(() => { fetchReport(); }, [reloadKey]);

  const fmt = (n: number) => fmtMoney(n);
  const [docs, setDocs] = useState<DocListTarget | null>(null);
  const [slip, setSlip] = useState<SlipRef | null>(null);
  // 點數字看算進去的薪資單：年度、月份用「查出這份報表時」的（data 裡的）；月度彙總的一列再限定那個月
  const drill = (n: number | undefined, shown: ReactNode, field: SalaryField, label: string, period?: string) => {
    if (!data || !n) return shown;
    const [py, pm] = period ? period.split("-").map(Number) : [data.year ?? undefined, data.month ?? undefined];
    return (
      <DrillAmount onClick={() => setDocs({ kind: "salary-slips", title: period ? `${period} ${label}` : label, year: py || undefined, month: pm || undefined, field })}>
        {shown}
      </DrillAmount>
    );
  };
  // 個人明細的金額就是一張薪資單，點了直接開那張
  const openSlip = (r: SlipRow, shown: ReactNode) => (r.id && r.employeeId && r.year && r.month
    ? <DrillAmount title="點一下開這張薪資單" onClick={() => setSlip({ id: r.id!, employeeId: r.employeeId!, year: r.year!, month: r.month! })}>{shown}</DrillAmount>
    : shown);
  const months = Array.from({ length: 12 }, (_, i) => i + 1);
  const years = Array.from({ length: 5 }, (_, i) => now.getFullYear() - 2 + i);

  const buildExport = (): ExportOptions => ({
    title: "薪資彙總表",
    subtitle: `${year}年${month ? month + "月" : "全年"}`,
    fileName: `薪資彙總_${year}_${month || "全年"}`,
    headers: ["期間", "人數", "應發總額", "應扣總額", "實發總額", "雇主勞保", "雇主健保", "雇主勞退"],
    columnKeys: ["period", "count", "grossTotal", "deductions", "netTotal", "laborInsEmpr", "healthInsEmpr", "pensionEmpr"],
    rows: (data?.monthlyRows || []).map((r: MonthlyRow) => ({
      period: r.period,
      count: r.count,
      grossTotal: r.grossTotal,
      deductions: r.deductions,
      netTotal: r.netTotal,
      laborInsEmpr: r.laborInsEmpr,
      healthInsEmpr: r.healthInsEmpr,
      pensionEmpr: r.pensionEmpr,
    })),
  });

  return (
    <div className="space-y-6" data-report>
      <ReportHeader />
      <PageHeader title="薪資彙總表" description="查詢月度/年度薪資統計及社保費用" />
      <Card>
        <CardContent className="py-4">
          <div className="flex flex-col sm:flex-row gap-3 sm:items-end w-full">
            <div className="flex-1 min-w-0 w-full">
              <label className="text-sm font-medium text-gray-600 mb-1 block">年度</label>
              <select className="w-full border rounded-md px-3 py-2 text-sm bg-white" value={year} onChange={e => setYear(Number(e.target.value))}>
                {years.map(y => <option key={y} value={y}>{y}年</option>)}
              </select>
            </div>
            <div className="flex-1 min-w-0 w-full">
              <label className="text-sm font-medium text-gray-600 mb-1 block">月份</label>
              <select className="w-full border rounded-md px-3 py-2 text-sm bg-white" value={month} onChange={e => setMonth(e.target.value === "" ? "" : Number(e.target.value))}>
                <option value="">全年</option>
                {months.map(m => <option key={m} value={m}>{m}月</option>)}
              </select>
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
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
            <Card>
              <CardContent className="flex items-center gap-4 py-4">
                <div className="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center"><Users className="h-5 w-5 text-blue-600" /></div>
                <div><div className="text-sm text-gray-500">薪資單數</div><div className="text-xl font-bold">{drill(data.totals.slipCount, data.totals.slipCount, "net", "薪資單")}</div></div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="flex items-center gap-4 py-4">
                <div className="w-10 h-10 rounded-full bg-green-100 flex items-center justify-center"><Wallet className="h-5 w-5 text-green-600" /></div>
                <div><div className="text-sm text-gray-500">應發總額</div><div className="text-xl font-bold text-green-600">{drill(data.totals.grossTotal, fmt(data.totals.grossTotal), "gross", "應發總額")}</div></div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="flex items-center gap-4 py-4">
                <div className="w-10 h-10 rounded-full bg-purple-100 flex items-center justify-center"><Wallet className="h-5 w-5 text-purple-600" /></div>
                <div><div className="text-sm text-gray-500">實發總額</div><div className="text-xl font-bold text-purple-600">{drill(data.totals.netTotal, fmt(data.totals.netTotal), "net", "實發總額")}</div></div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="flex items-center gap-4 py-4">
                <div className="w-10 h-10 rounded-full bg-orange-100 flex items-center justify-center"><Building2 className="h-5 w-5 text-orange-600" /></div>
                <div><div className="text-sm text-gray-500">雇主負擔</div><div className="text-xl font-bold text-orange-600">{drill(data.totals.laborInsEmployer + data.totals.healthInsEmployer + data.totals.pensionEmployer, fmt(data.totals.laborInsEmployer + data.totals.healthInsEmployer + data.totals.pensionEmployer), "employer", "雇主負擔")}</div></div>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader className="py-3 border-b"><CardTitle className="text-lg">月度彙總</CardTitle></CardHeader>
            <CardContent className="p-0 sm:p-0">
              {/* Mobile View */}
              <div className="block md:hidden p-4 bg-gray-50/50">
                {(data.monthlyRows || []).map((r: MonthlyRow) => (
                  <MobileCard key={r.period}>
                    <MobileCardHeader 
                      title={r.period}
                      value={drill(r.netTotal, fmt(r.netTotal), "net", "實發總額", r.period)}
                      titleClass="text-gray-900"
                      valueClass="text-green-600 font-mono"
                    />
                    <MobileCardGrid>
                      <MobileCardItem label="應發總額" value={drill(r.grossTotal, fmt(r.grossTotal), "gross", "應發總額", r.period)} valueClass="font-mono text-gray-900" />
                      <MobileCardItem label="應扣總額" value={drill(r.deductions, fmt(r.deductions), "deductions", "應扣總額", r.period)} valueClass="font-mono text-red-600" />
                      <MobileCardItem label="人數" value={drill(r.count, r.count, "net", "薪資單", r.period)} valueClass="font-mono text-gray-600" />
                      <MobileCardItem label="雇主負擔" value={drill(r.laborInsEmpr + r.healthInsEmpr + r.pensionEmpr, fmt(r.laborInsEmpr + r.healthInsEmpr + r.pensionEmpr), "employer", "雇主負擔", r.period)} valueClass="font-mono text-gray-500" />
                    </MobileCardGrid>
                  </MobileCard>
                ))}
                {(data.monthlyRows || []).length === 0 && <div className="py-8 text-center text-gray-400">無薪資資料</div>}
              </div>

              {/* Desktop View */}
              <div className="hidden md:block overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-gray-50/50">
                      <th className="text-left px-4 py-2.5 font-semibold">期間</th>
                      <th className="text-right px-3 py-2.5 font-semibold">人數</th>
                      <th className="text-right px-3 py-2.5 font-semibold">應發總額</th>
                      <th className="text-right px-3 py-2.5 font-semibold">應扣總額</th>
                      <th className="text-right px-3 py-2.5 font-semibold">實發總額</th>
                      <th className="text-right px-3 py-2.5 font-semibold hidden lg:table-cell">雇主勞保</th>
                      <th className="text-right px-3 py-2.5 font-semibold hidden lg:table-cell">雇主健保</th>
                      <th className="text-right px-4 py-2.5 font-semibold hidden lg:table-cell">雇主勞退</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(data.monthlyRows || []).map((r: MonthlyRow) => (
                      <tr key={r.period} className="border-b hover:bg-gray-50">
                        <td className="px-4 py-2 font-medium">{r.period}</td>
                        <td className="px-3 py-2 text-right">{drill(r.count, r.count, "net", "薪資單", r.period)}</td>
                        <td className="px-3 py-2 text-right font-mono">{drill(r.grossTotal, fmt(r.grossTotal), "gross", "應發總額", r.period)}</td>
                        <td className="px-3 py-2 text-right font-mono text-red-600">{drill(r.deductions, fmt(r.deductions), "deductions", "應扣總額", r.period)}</td>
                        <td className="px-3 py-2 text-right font-mono text-green-600 font-bold">{drill(r.netTotal, fmt(r.netTotal), "net", "實發總額", r.period)}</td>
                        <td className="px-3 py-2 text-right font-mono hidden lg:table-cell">{drill(r.laborInsEmpr, fmt(r.laborInsEmpr), "laborInsEmployer", "雇主勞保", r.period)}</td>
                        <td className="px-3 py-2 text-right font-mono hidden lg:table-cell">{drill(r.healthInsEmpr, fmt(r.healthInsEmpr), "healthInsEmployer", "雇主健保", r.period)}</td>
                        <td className="px-4 py-2 text-right font-mono hidden lg:table-cell">{drill(r.pensionEmpr, fmt(r.pensionEmpr), "pensionEmployer", "雇主勞退", r.period)}</td>
                      </tr>
                    ))}
                    {(data.monthlyRows || []).length === 0 && <tr><td colSpan={8} className="px-4 py-8 text-center text-gray-400">無薪資資料</td></tr>}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>

          {(data.detailRows || []).length > 0 && (
            <Card>
              <CardHeader className="py-3 border-b"><CardTitle className="text-lg">個人明細</CardTitle></CardHeader>
              <CardContent className="p-0 sm:p-0">
                {/* Mobile View */}
                <div className="block md:hidden p-4 bg-gray-50/50">
                  {data.detailRows.map((r: SlipRow, idx: number) => (
                    <MobileCard key={idx}>
                      <MobileCardHeader
                        title={`${r.employeeName} (${r.period})`}
                        value={openSlip(r, fmt(r.netSalary))}
                        titleClass="text-gray-900"
                        valueClass="text-green-600 font-mono"
                      />
                      <div className="text-xs text-gray-500 mb-3 flex justify-between items-center">
                        <span>狀態: {r.status === "confirmed" ? "已確認" : r.status === "paid" ? "已發放" : "草稿"}</span>
                      </div>
                      <MobileCardGrid>
                        <MobileCardItem label="應發" value={openSlip(r, fmt(r.grossSalary))} valueClass="font-mono text-gray-900" />
                        <MobileCardItem label="扣除" value={openSlip(r, fmt(r.totalDeductions))} valueClass="font-mono text-red-600" />
                      </MobileCardGrid>
                    </MobileCard>
                  ))}
                </div>

                {/* Desktop View */}
                <div className="hidden md:block overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b bg-gray-50/50">
                        <th className="text-left px-4 py-2.5 font-semibold">姓名</th>
                        <th className="text-left px-3 py-2.5 font-semibold">期間</th>
                        <th className="text-right px-3 py-2.5 font-semibold">應發</th>
                        <th className="text-right px-3 py-2.5 font-semibold">扣除</th>
                        <th className="text-right px-3 py-2.5 font-semibold">實發</th>
                        <th className="text-center px-3 py-2.5 font-semibold">狀態</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.detailRows.map((r: SlipRow, idx: number) => (
                        <tr key={idx} className="border-b hover:bg-gray-50">
                          <td className="px-4 py-1.5 font-medium">{r.employeeName}</td>
                          <td className="px-3 py-1.5">{r.period}</td>
                          <td className="px-3 py-1.5 text-right font-mono">{openSlip(r, fmt(r.grossSalary))}</td>
                          <td className="px-3 py-1.5 text-right font-mono text-red-600">{openSlip(r, fmt(r.totalDeductions))}</td>
                          <td className="px-3 py-1.5 text-right font-mono text-green-600 font-bold">{openSlip(r, fmt(r.netSalary))}</td>
                          <td className="px-3 py-1.5 text-center text-xs">{r.status === "confirmed" ? "已確認" : r.status === "paid" ? "已發放" : "草稿"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          )}
        </>
      )}

      {!data && !loading && <Card><CardContent className="py-12 text-center text-gray-400">點擊查詢以產生薪資彙總</CardContent></Card>}
      <DocListDrillDialog target={docs} onClose={() => setDocs(null)} />
      <SalarySlipOpener slip={slip} onClose={() => setSlip(null)} />
    </div>
  );
}
