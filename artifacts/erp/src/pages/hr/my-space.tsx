import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { attendanceApi, attendanceRecordsApi, salarySlipsApi, ATTENDANCE_STATUS_LABEL, monthRange } from "@/lib/api";
import { LeaveBalanceCard } from "@/components/hr/leave-balance-card";
import { useAuth } from "@/contexts/auth-context";
import { PageHeader } from "@/components/shared/page-header";
import { DataTable } from "@/components/shared/data-table";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CalendarCheck, Clock, CalendarOff, AlertTriangle } from "lucide-react";

type Summary = {
  presentDays: number;
  lateCount: number;
  totalOvertimeHours: number;
  leaveDays: number;
  absentDays: number;
  totalWorkingHours: number;
};

const now = new Date();
const yearOptions = [now.getFullYear(), now.getFullYear() - 1];
const monthOptions = Array.from({ length: 12 }, (_, i) => i + 1);

export default function MySpacePage() {
  const { user } = useAuth();
  const employeeId = user?.employeeId ?? undefined;
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [slips, setSlips] = useState<any[]>([]);
  const [error, setError] = useState<string | null>(null);

  const range = monthRange(`${year}-${String(month).padStart(2, "0")}`);
  const { data: records, isLoading } = useQuery({
    queryKey: ["/attendance", range.from, range.to, employeeId],
    queryFn: () => attendanceRecordsApi.list({ ...range, employeeId }),
    enabled: !!employeeId,
  });

  useEffect(() => {
    if (!employeeId) return;
    setError(null);
    attendanceApi.monthlySummary(year, month, employeeId)
      .then((d: any) => setSummary(d.rows?.[0] ?? null))
      .catch((e: Error) => setError(e.message));
    salarySlipsApi.list({ employeeId })
      .then(setSlips)
      .catch(() => setSlips([]));
  }, [employeeId, year, month]);

  if (!employeeId) {
    return (
      <div className="space-y-6">
        <PageHeader title="我的出勤與薪資" description="查看自己的出勤紀錄與薪資單" />
        <Card>
          <CardContent className="p-6 text-sm text-red-600 flex items-center gap-2">
            <AlertTriangle className="h-4 w-4" /> 您的帳號尚未綁定員工，請聯絡管理員設定。
          </CardContent>
        </Card>
      </div>
    );
  }

  const monthRecords = (records || []).filter((r: any) =>
    r.date?.startsWith(`${year}-${String(month).padStart(2, "0")}`),
  );

  return (
    <div className="space-y-6">
      <PageHeader title="我的出勤與薪資" description="查看自己的出勤紀錄與薪資單" />

      <div className="flex gap-3">
        <Select value={String(year)} onValueChange={(v) => setYear(Number(v))}>
          <SelectTrigger className="w-28"><SelectValue /></SelectTrigger>
          <SelectContent>{yearOptions.map(y => <SelectItem key={y} value={String(y)}>{y} 年</SelectItem>)}</SelectContent>
        </Select>
        <Select value={String(month)} onValueChange={(v) => setMonth(Number(v))}>
          <SelectTrigger className="w-24"><SelectValue /></SelectTrigger>
          <SelectContent>{monthOptions.map(m => <SelectItem key={m} value={String(m)}>{m} 月</SelectItem>)}</SelectContent>
        </Select>
      </div>

      {error && <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700 dark:bg-red-950/40 dark:border-red-900 dark:text-red-300">{error}</div>}

      <LeaveBalanceCard employeeId={employeeId} />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4">
        <Card><CardContent className="p-4">
          <div className="flex items-center gap-2 text-sm text-muted-foreground"><CalendarCheck size={16} /> 出勤天數</div>
          <div className="text-2xl font-bold mt-1">{summary?.presentDays ?? "-"}</div>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <div className="flex items-center gap-2 text-sm text-muted-foreground"><Clock size={16} /> 加班時數</div>
          <div className="text-2xl font-bold mt-1">{summary?.totalOvertimeHours ?? "-"}</div>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <div className="flex items-center gap-2 text-sm text-muted-foreground"><CalendarOff size={16} /> 請假天數</div>
          <div className="text-2xl font-bold mt-1">{summary?.leaveDays ?? "-"}</div>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <div className="flex items-center gap-2 text-sm text-muted-foreground"><AlertTriangle size={16} /> 缺勤天數</div>
          <div className="text-2xl font-bold mt-1">{summary?.absentDays ?? "-"}</div>
        </CardContent></Card>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">本月出勤紀錄</CardTitle></CardHeader>
        <CardContent className="p-0 overflow-x-auto">
          <DataTable
            isLoading={isLoading}
            data={monthRecords}
            columns={[
              { header: "日期", accessor: "date" },
              { header: "狀態", accessor: (r: any) => <Badge variant={r.status === "Present" ? "default" : "secondary"}>{r.checkIn && !r.checkOut && r.date < new Date().toISOString().slice(0, 10) ? "未打下班卡" : ATTENDANCE_STATUS_LABEL[r.status] || r.status}</Badge> },
              { header: "上班", accessor: (r: any) => r.checkIn || "-" },
              { header: "下班", accessor: (r: any) => r.checkOut || "-" },
              { header: "工時", accessor: (r: any) => r.workingHours ?? "-", className: "hidden sm:table-cell" },
              { header: "加班", accessor: (r: any) => r.overtimeHours || 0, className: "hidden sm:table-cell" },
            ]}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">我的薪資單</CardTitle></CardHeader>
        <CardContent className="p-0 overflow-x-auto">
          <DataTable
            isLoading={false}
            data={slips}
            columns={[
              { header: "年月", accessor: (r: any) => `${r.year}/${String(r.month).padStart(2, "0")}` },
              { header: "本薪", accessor: (r: any) => Number(r.baseSalary).toLocaleString() },
              { header: "加班費", accessor: (r: any) => Number(r.overtimePay || 0).toLocaleString(), className: "hidden sm:table-cell" },
              { header: "應發", accessor: (r: any) => Number(r.grossSalary).toLocaleString(), className: "hidden sm:table-cell" },
              { header: "實發", accessor: (r: any) => <span className="font-semibold">{Number(r.netSalary ?? r.netPay ?? 0).toLocaleString()}</span> },
              { header: "狀態", accessor: (r: any) => <Badge variant={r.status === "Paid" ? "default" : "secondary"}>{r.status === "Paid" ? "已發放" : r.status === "Approved" ? "已核准" : "草稿"}</Badge> },
            ]}
          />
        </CardContent>
      </Card>
    </div>
  );
}
