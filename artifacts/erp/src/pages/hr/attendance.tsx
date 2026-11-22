import { useListEmployees } from "@workspace/erp-api-client-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { DataTable } from "@/components/shared/data-table";
import { PageHeader } from "@/components/shared/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DocWindow } from "@/components/shared/doc-window";
import { SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { LookupSelect } from "@/components/shared/lookup-select";
import { useToast } from "@/hooks/use-toast";
import { attendanceApi, attendanceRecordsApi, ATTENDANCE_STATUS_LABEL, monthRange, taipeiToday, type AttendanceRecord } from "@/lib/api";
import { ClipboardPen, Pencil, MapPin } from "lucide-react";

type MonthlyRow = {
  id?: number; employeeId: number; employeeCode: string; employeeName: string;
  presentDays: number; lateCount: number; totalLateMinutes: number; earlyLeaveCount: number;
  totalWorkingHours: number; totalOvertimeHours: number; leaveDays: number; absentDays: number;
  workingDays: number; missingCheckoutDays: number;
};

type Editing = { record: AttendanceRecord | null; employeeId: string; date: string; checkIn: string; checkOut: string; reason: string };

export default function AttendancePage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const today = taipeiToday();
  const [view, setView] = useState<"daily" | "monthly">("daily");
  const [month, setMonth] = useState(today.slice(0, 7));
  const [onlyProblems, setOnlyProblems] = useState(false);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [saving, setSaving] = useState(false);
  const range = monthRange(month);

  const { data: records, isLoading } = useQuery({
    queryKey: ["/attendance", range.from, range.to],
    queryFn: () => attendanceRecordsApi.list(range),
  });
  const { data: summary, isLoading: summaryLoading } = useQuery({
    queryKey: ["/attendance/monthly-summary", month],
    queryFn: () => { const [y, m] = month.split("-").map(Number); return attendanceApi.monthlySummary(y, m) as Promise<{ workingDays: number; holidays: string[]; rows: MonthlyRow[] }>; },
    enabled: view === "monthly",
  });
  const { data: employees } = useListEmployees(undefined, { query: { enabled: !!editing && !editing.record } as any });

  const missingCheckout = (r: AttendanceRecord) => !!r.checkIn && !r.checkOut && r.date < today;
  const hasProblem = (r: AttendanceRecord) => missingCheckout(r) || r.lateMinutes > 0 || r.earlyLeaveMinutes > 0 || r.status === "Absent";
  const rows = (records || []).filter(r => !onlyProblems || hasProblem(r));

  const save = async () => {
    if (!editing) return;
    setSaving(true);
    try {
      const body = { checkIn: editing.checkIn, checkOut: editing.checkOut || undefined, reason: editing.reason };
      if (editing.record) await attendanceRecordsApi.correct(editing.record.id, body);
      else await attendanceRecordsApi.manual({ employeeId: Number(editing.employeeId), date: editing.date, ...body });
      toast({ title: editing.record ? "打卡紀錄已更正" : "已補登打卡" });
      setEditing(null);
      queryClient.invalidateQueries({ queryKey: ["/attendance"] });
      queryClient.invalidateQueries({ queryKey: ["/attendance/monthly-summary"] });
    } catch (e: any) {
      toast({ title: "儲存失敗", description: e?.message, variant: "destructive" });
    } finally { setSaving(false); }
  };

  return (
    <div className="space-y-4 md:space-y-6">
      <PageHeader
        title="出勤紀錄"
        description="每日打卡、月結與補登更正"
        action={<Button onClick={() => setEditing({ record: null, employeeId: "", date: today, checkIn: "09:00", checkOut: "18:00", reason: "" })}><ClipboardPen className="h-4 w-4 mr-2" />補登打卡</Button>}
      />
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant={view === "daily" ? "default" : "outline"} onClick={() => setView("daily")}>每日紀錄</Button>
        <Button size="sm" variant={view === "monthly" ? "default" : "outline"} onClick={() => setView("monthly")}>月結檢視</Button>
        <Input type="month" className="w-40" value={month} onChange={e => e.target.value && setMonth(e.target.value)} />
        {view === "daily" && <Button size="sm" variant={onlyProblems ? "secondary" : "ghost"} onClick={() => setOnlyProblems(v => !v)}>只看異常</Button>}
      </div>

      {view === "daily" ? (
        <Card>
          <CardContent className="p-0 overflow-x-auto">
            <DataTable layoutId="attendance-records"
              isLoading={isLoading}
              data={rows}
              emptyMessage={onlyProblems ? "這個月沒有異常紀錄" : "這個月還沒有打卡紀錄"}
              columns={[
                { header: "員工", accessor: (r: AttendanceRecord) => <div><span className="font-medium">{r.employeeName}</span><span className="ml-2 text-xs text-muted-foreground">{r.employeeCode}</span></div> },
                { header: "日期", accessor: "date" },
                {
                  header: "狀態",
                  accessor: (r: AttendanceRecord) => missingCheckout(r)
                    ? <Badge variant="destructive">未打下班卡</Badge>
                    : <Badge variant={r.status === "Present" ? "default" : r.status === "Absent" || r.status === "Late" ? "destructive" : "secondary"}>{ATTENDANCE_STATUS_LABEL[r.status] || r.status}</Badge>,
                },
                { header: "上班", accessor: (r: AttendanceRecord) => r.checkIn || "—" },
                { header: "下班", accessor: (r: AttendanceRecord) => r.checkOut || "—" },
                { header: "工時", accessor: (r: AttendanceRecord) => r.workingHours != null ? `${r.workingHours.toFixed(1)} 時` : "—" },
                {
                  header: "異常",
                  accessor: (r: AttendanceRecord) => {
                    const parts = [
                      r.lateMinutes > 0 ? `遲到 ${r.lateMinutes} 分` : null,
                      r.earlyLeaveMinutes > 0 ? `早退 ${r.earlyLeaveMinutes} 分` : null,
                      r.overtimeHours > 0 ? `加班 ${r.overtimeHours.toFixed(1)} 時` : null,
                    ].filter(Boolean);
                    return parts.length > 0 ? parts.join("、") : "—";
                  },
                },
                {
                  header: "地點",
                  accessor: (r: AttendanceRecord) => {
                    const names = [...new Set([r.checkInLocationName, r.checkOutLocationName].filter(Boolean))];
                    const raw = [r.checkInLocation, r.checkOutLocation].filter(Boolean).join(" / ");
                    if (names.length === 0 && !raw) return "—";
                    return <span title={raw} className="inline-flex items-center gap-1"><MapPin className="h-3.5 w-3.5" />{names.join(" / ") || "已定位"}</span>;
                  },
                  className: "hidden lg:table-cell",
                },
                { header: "備註", accessor: (r: AttendanceRecord) => r.note || "—", className: "hidden xl:table-cell max-w-[240px] truncate" },
                {
                  header: "操作",
                  accessor: (r: AttendanceRecord) => (
                    <Button size="sm" variant="ghost" className="h-8 px-2" onClick={() => setEditing({ record: r, employeeId: String(r.employeeId), date: r.date, checkIn: r.checkIn || "09:00", checkOut: r.checkOut || "", reason: "" })}>
                      <Pencil className="h-3.5 w-3.5 mr-1" />更正
                    </Button>
                  ),
                },
              ]}
            />
          </CardContent>
        </Card>
      ) : (
        <>
          {summary && (
            <p className="text-sm text-muted-foreground">
              {month.replace("-", " 年 ")} 月應出勤 {summary.workingDays} 天（已排除六日{summary.holidays.length > 0 ? `與 ${summary.holidays.length} 天假日` : ""}）。缺勤只算已經過去的日子；假日請到「行事曆」新增類型為「假日」的事件。
            </p>
          )}
          <Card>
            <CardContent className="p-0 overflow-x-auto">
              <DataTable layoutId="attendance-summary"
                isLoading={summaryLoading}
                data={summary?.rows.map(r => ({ ...r, id: r.employeeId }))}
                defaultPageSize={0}
                emptyMessage="沒有資料"
                columns={[
                  { header: "員工", accessor: (r: MonthlyRow) => <div><span className="font-medium">{r.employeeName}</span><span className="ml-2 text-xs text-muted-foreground">{r.employeeCode}</span></div> },
                  { header: "出勤", accessor: (r: MonthlyRow) => `${r.presentDays}／${r.workingDays} 天` },
                  { header: "遲到", accessor: (r: MonthlyRow) => r.lateCount > 0 ? `${r.lateCount} 次（${r.totalLateMinutes} 分）` : "—" },
                  { header: "早退", accessor: (r: MonthlyRow) => r.earlyLeaveCount > 0 ? `${r.earlyLeaveCount} 次` : "—" },
                  { header: "總工時", accessor: (r: MonthlyRow) => Number(r.totalWorkingHours || 0).toFixed(1) },
                  { header: "加班", accessor: (r: MonthlyRow) => r.totalOvertimeHours > 0 ? `${Number(r.totalOvertimeHours).toFixed(1)} 時` : "—" },
                  { header: "請假", accessor: (r: MonthlyRow) => r.leaveDays > 0 ? `${r.leaveDays} 天` : "—" },
                  { header: "缺勤", accessor: (r: MonthlyRow) => r.absentDays > 0 ? <span className="text-red-600 dark:text-red-400 font-medium">{r.absentDays} 天</span> : "—" },
                  { header: "未打下班卡", accessor: (r: MonthlyRow) => r.missingCheckoutDays > 0 ? <span className="text-amber-600 dark:text-amber-400 font-medium">{r.missingCheckoutDays} 天</span> : "—" },
                ]}
              />
            </CardContent>
          </Card>
        </>
      )}

      <DocWindow
        open={!!editing}
        onClose={() => setEditing(null)}
        name={editing?.record ? "更正打卡" : "補登打卡"}
        description={editing?.record ? `${editing.record.employeeName} ${editing.record.date}` : undefined}
        footer={<>
          <Button variant="outline" onClick={() => setEditing(null)}>取消</Button>
          <Button onClick={save} disabled={saving || !editing?.reason.trim() || !editing?.checkIn || (!editing?.record && !editing?.employeeId)}>儲存</Button>
        </>}
      >
          {editing && (
            <div className="space-y-4">
              {!editing.record && (
                <>
                  <div className="space-y-1.5">
                    <Label>員工</Label>
                    <LookupSelect value={editing.employeeId} onValueChange={(v) => setEditing({ ...editing, employeeId: v })}>
                      <SelectTrigger><SelectValue placeholder="請選擇員工" /></SelectTrigger>
                      <SelectContent>
                        {employees?.map((e: any) => <SelectItem key={e.id} value={String(e.id)}>{e.employeeId} - {e.firstName}{e.lastName}</SelectItem>)}
                      </SelectContent>
                    </LookupSelect>
                  </div>
                  <div className="space-y-1.5"><Label>日期</Label><Input type="date" max={today} value={editing.date} onChange={e => setEditing({ ...editing, date: e.target.value })} /></div>
                </>
              )}
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5"><Label>上班時間</Label><Input type="time" value={editing.checkIn} onChange={e => setEditing({ ...editing, checkIn: e.target.value })} /></div>
                <div className="space-y-1.5"><Label>下班時間</Label><Input type="time" value={editing.checkOut} onChange={e => setEditing({ ...editing, checkOut: e.target.value })} /></div>
              </div>
              <div className="space-y-1.5"><Label>原因</Label><Input value={editing.reason} onChange={e => setEditing({ ...editing, reason: e.target.value })} placeholder="例如：忘記打下班卡，主管確認 18:00 離開" /></div>
              <p className="text-xs text-muted-foreground">遲到、工時、加班會依班別重新計算；原本的時間與經手人會留在備註。</p>
            </div>
          )}
      </DocWindow>
    </div>
  );
}
