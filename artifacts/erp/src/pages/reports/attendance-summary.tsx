import { useState, useEffect } from "react";
import { ReportHeader } from "@/components/shared/report-header";
import { useAutoReloadKey } from "@/lib/auto-refresh";
import { PageHeader } from "@/components/shared/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Printer, Users, Clock, AlertCircle } from "lucide-react";
import { ExportMenu } from "@/components/shared/export-menu";
import { MobileCard, MobileCardHeader, MobileCardGrid, MobileCardItem } from "@/components/shared/mobile-card";
import type { ExportOptions } from "@/lib/export-utils";
import type { AttendanceSummaryData, AttendanceRow } from "./types";

const BASE = import.meta.env.BASE_URL.endsWith("/") ? import.meta.env.BASE_URL : import.meta.env.BASE_URL + "/";

export default function AttendanceSummaryPage() {
  const reloadKey = useAutoReloadKey();
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [data, setData] = useState<AttendanceSummaryData | null>(null);
  const [loading, setLoading] = useState(false);

  const fetchReport = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ year: String(year), month: String(month) });
      const res = await fetch(`/erp-api/reports/attendance-summary?${params}`);
      if (!res.ok) throw new Error("API error");
      setData(await res.json());
    } catch { setData(null); }
    setLoading(false);
  };

  useEffect(() => { fetchReport(); }, [reloadKey]);

  const buildExport = (): ExportOptions => ({
    title: "出勤彙總表",
    subtitle: `${year}年${month}月`,
    fileName: `出勤彙總_${year}_${String(month).padStart(2, "0")}`,
    headers: ["員工編號", "姓名", "出勤天數", "缺勤天數", "遲到次數", "遲到分鐘", "早退次數", "工作時數", "加班時數", "出勤率(%)"],
    columnKeys: ["employeeId", "employeeName", "present", "absent", "late", "totalLateMinutes", "earlyLeave", "totalHours", "totalOvertimeHours", "attendanceRate"],
    rows: (data?.rows || []).map((r: AttendanceRow) => ({
      employeeId: r.employeeId,
      employeeName: r.employeeName,
      present: r.present,
      absent: r.absent,
      late: r.late,
      totalLateMinutes: r.totalLateMinutes,
      earlyLeave: r.earlyLeave,
      totalHours: r.totalHours,
      totalOvertimeHours: r.totalOvertimeHours,
      attendanceRate: r.attendanceRate,
    })),
  });

  const months = Array.from({ length: 12 }, (_, i) => i + 1);
  const years = Array.from({ length: 5 }, (_, i) => now.getFullYear() - 2 + i);

  return (
    <div className="space-y-6" data-report>
      <ReportHeader money={false} />
      <PageHeader title="出勤彙總表" description="查詢月度員工出勤統計" />
      <Card>
        <CardContent className="py-4">
          <div className="flex flex-col sm:flex-row gap-3 sm:items-end w-full">
            <div className="flex-1 min-w-0">
              <label className="text-sm font-medium text-gray-600 mb-1 block">年度</label>
              <select className="w-full border rounded-md px-3 py-2 text-sm bg-white" value={year} onChange={e => setYear(Number(e.target.value))}>
                {years.map(y => <option key={y} value={y}>{y}年</option>)}
              </select>
            </div>
            <div className="flex-1 min-w-0">
              <label className="text-sm font-medium text-gray-600 mb-1 block">月份</label>
              <select className="w-full border rounded-md px-3 py-2 text-sm bg-white" value={month} onChange={e => setMonth(Number(e.target.value))}>
                {months.map(m => <option key={m} value={m}>{m}月</option>)}
              </select>
            </div>
            <div className="flex gap-2 w-full sm:w-auto">
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
                <div><div className="text-sm text-gray-500">員工數</div><div className="text-2xl font-bold">{data.summary.totalEmployees}</div></div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="flex items-center gap-4 py-4">
                <div className="w-10 h-10 rounded-full bg-green-100 flex items-center justify-center"><Clock className="h-5 w-5 text-green-600" /></div>
                <div><div className="text-sm text-gray-500">平均出勤率</div><div className="text-2xl font-bold text-green-600">{data.summary.avgAttendanceRate}%</div></div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="flex items-center gap-4 py-4">
                <div className="w-10 h-10 rounded-full bg-orange-100 flex items-center justify-center"><AlertCircle className="h-5 w-5 text-orange-600" /></div>
                <div><div className="text-sm text-gray-500">遲到總次數</div><div className="text-2xl font-bold text-orange-600">{data.summary.totalLate}</div></div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="flex items-center gap-4 py-4">
                <div className="w-10 h-10 rounded-full bg-yellow-100 flex items-center justify-center"><AlertCircle className="h-5 w-5 text-yellow-600" /></div>
                <div><div className="text-sm text-gray-500">早退總次數</div><div className="text-2xl font-bold text-yellow-600">{data.summary.totalEarlyLeave || 0}</div></div>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader className="py-3 border-b"><CardTitle className="text-lg">{year}年{month}月 出勤明細</CardTitle></CardHeader>
            <CardContent className="p-0 sm:p-0">
              {/* Mobile View */}
              <div className="block md:hidden p-4 bg-gray-50/50">
                {(data.rows || []).map((r: AttendanceRow, idx: number) => (
                  <MobileCard key={idx}>
                    <MobileCardHeader 
                      title={`${r.employeeName} (${r.employeeId})`}
                      value={`${r.attendanceRate}%`}
                      titleClass="text-gray-900"
                      valueClass={r.attendanceRate >= 90 ? "text-green-600" : r.attendanceRate >= 70 ? "text-orange-600" : "text-red-600"}
                    />
                    <MobileCardGrid>
                      <MobileCardItem label="出勤天數" value={r.present} valueClass="text-green-600" />
                      <MobileCardItem label="缺勤天數" value={r.absent} valueClass="text-red-600" />
                      <MobileCardItem label="遲到" value={`${r.late}次 (${r.totalLateMinutes}分)`} valueClass="text-orange-600" />
                      <MobileCardItem label="早退" value={`${r.earlyLeave || 0}次`} valueClass="text-yellow-600" />
                      <MobileCardItem label="工作時數" value={r.totalHours} valueClass="font-mono" />
                      <MobileCardItem label="加班時數" value={r.totalOvertimeHours || 0} valueClass="font-mono" />
                    </MobileCardGrid>
                  </MobileCard>
                ))}
                {data.rows.length === 0 && <div className="py-8 text-center text-gray-400">無出勤資料</div>}
              </div>

              {/* Desktop View */}
              <div className="hidden md:block overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-gray-50/50">
                      <th className="text-left px-4 py-2.5 font-semibold">員工編號</th>
                      <th className="text-left px-4 py-2.5 font-semibold">姓名</th>
                      <th className="text-right px-3 py-2.5 font-semibold">出勤</th>
                      <th className="text-right px-3 py-2.5 font-semibold">缺勤</th>
                       <th className="text-right px-3 py-2.5 font-semibold">遲到</th>
                       <th className="text-right px-3 py-2.5 font-semibold">遲到分鐘</th>
                      <th className="text-right px-3 py-2.5 font-semibold">早退</th>
                      <th className="text-right px-3 py-2.5 font-semibold">工時</th>
                       <th className="text-right px-3 py-2.5 font-semibold">加班</th>
                      <th className="text-right px-4 py-2.5 font-semibold">出勤率</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(data.rows || []).map((r: AttendanceRow, idx: number) => (
                      <tr key={idx} className="border-b hover:bg-gray-50">
                        <td className="px-4 py-1.5 font-mono text-xs">{r.employeeId}</td>
                        <td className="px-4 py-1.5 font-medium">{r.employeeName}</td>
                        <td className="px-3 py-1.5 text-right text-green-600">{r.present}</td>
                        <td className="px-3 py-1.5 text-right text-red-600">{r.absent}</td>
                        <td className="px-3 py-1.5 text-right text-orange-600">{r.late}</td>
                        <td className="px-3 py-1.5 text-right text-orange-600">{r.totalLateMinutes || 0}</td>
                        <td className="px-3 py-1.5 text-right text-yellow-600">{r.earlyLeave || 0}</td>
                        <td className="px-3 py-1.5 text-right font-mono">{r.totalHours}</td>
                        <td className="px-3 py-1.5 text-right font-mono">{r.totalOvertimeHours || 0}</td>
                        <td className={`px-4 py-1.5 text-right font-bold ${r.attendanceRate >= 90 ? "text-green-600" : r.attendanceRate >= 70 ? "text-orange-600" : "text-red-600"}`}>{r.attendanceRate}%</td>
                      </tr>
                    ))}
                    {(data.rows || []).length === 0 && <tr><td colSpan={10} className="px-4 py-8 text-center text-gray-400">無出勤資料</td></tr>}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </>
      )}

      {!data && !loading && <Card><CardContent className="py-12 text-center text-gray-400">點擊查詢以產生出勤彙總</CardContent></Card>}
    </div>
  );
}
