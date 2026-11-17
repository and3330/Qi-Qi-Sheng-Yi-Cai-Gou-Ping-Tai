import { useState, useEffect, useMemo, useRef } from "react";
import { useListEmployees } from "@workspace/erp-api-client-react";
import { attendanceApi, attendanceRecordsApi, leavesApi, monthRange, taipeiToday } from "@/lib/api";
import { PageHeader } from "@/components/shared/page-header";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { MapPin, LogIn, LogOut, ChevronLeft, ChevronRight, CheckCircle2, Clock, XCircle, AlertCircle, RefreshCw } from "lucide-react";
import { useAuth } from "@/contexts/auth-context";
import { ROLE_EMPLOYEE } from "@/lib/roles";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { 
  format, 
  startOfMonth, 
  endOfMonth, 
  eachDayOfInterval, 
  isSameMonth, 
  isSameDay, 
  isToday, 
  addMonths, 
  subMonths,
  startOfWeek,
  endOfWeek,
  isBefore,
  startOfDay,
  parseISO,
  getDay
} from "date-fns";
import { zhTW } from "date-fns/locale";

import { LookupSelect } from "@/components/shared/lookup-select";
type ShiftInfo = {
  name: string;
  startTime: string;
  endTime: string;
  breakStart: string | null;
  breakEnd: string | null;
  workingHours: number;
};

export default function ClockInPage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const isEmployee = user?.role === ROLE_EMPLOYEE;
  const { data: employees } = useListEmployees(undefined, { query: { enabled: !isEmployee } as any });
  const [selectedEmployee, setSelectedEmployee] = useState<string>("");

  useEffect(() => {
    // 帳號有綁員工就預設替自己打卡（管理者還是可以改選別人）
    if (user?.employeeId) setSelectedEmployee(String(user.employeeId));
  }, [user?.employeeId]);

  const [currentTime, setCurrentTime] = useState(new Date());
  const [clockedIn, setClockedIn] = useState(false);
  const [clockInTime, setClockInTime] = useState<string | null>(null);
  const [attendanceId, setAttendanceId] = useState<number | null>(null);
  const [completed, setCompleted] = useState(false);
  const [lateMinutes, setLateMinutes] = useState(0);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [shift, setShift] = useState<ShiftInfo | null>(null);
  const [note, setNote] = useState("");
  const [locationHint, setLocationHint] = useState("打卡時將取得您的即時位置");
  const [punching, setPunching] = useState(false);
  
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const [summary, setSummary] = useState<any>(null);

  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  // 一律以台北時區為準,避免裝置時區不同造成跨日誤判
  const taipeiDateKey = (d: Date = new Date()) =>
    new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
  const todayStr = () => taipeiDateKey();

  const loadTodayState = () => {
    if (!selectedEmployee) return;
    attendanceApi.todayState(Number(selectedEmployee), todayStr())
      .then(({ record, shift: selectedShift }) => {
        setShift(selectedShift);
        setAttendanceId(record?.id ?? null);
        setClockInTime(record?.checkIn ?? null);
        setClockedIn(Boolean(record?.checkIn && !record?.checkOut));
        setCompleted(Boolean(record?.checkOut));
        setLateMinutes(record?.lateMinutes ?? 0);
        if (record?.checkOut) {
          setMessage({ type: "success", text: `今日已完成打卡：${record.checkIn} - ${record.checkOut}` });
        } else if (record?.checkIn) {
          setMessage({ type: "success", text: `已上班打卡 ${record.checkIn}` });
        } else {
          setMessage(null);
        }
      })
      .catch((e: Error) => setMessage({ type: "error", text: e.message }));
  };

  useEffect(() => {
    if (!selectedEmployee) {
      setShift(null);
      setClockedIn(false);
      setClockInTime(null);
      setAttendanceId(null);
      setCompleted(false);
      setLateMinutes(0);
      setSummary(null);
      return;
    }
    loadTodayState();
  }, [selectedEmployee]);

  useEffect(() => {
    if (!selectedEmployee) return;
    const year = currentMonth.getFullYear();
    const month = currentMonth.getMonth() + 1;
    attendanceApi.monthlySummary(year, month, Number(selectedEmployee))
      .then(data => {
        if (data.rows && data.rows.length > 0) {
           setSummary(data.rows[0]);
        } else {
           setSummary(null);
        }
      });
  }, [selectedEmployee, currentMonth]);

  const getFreshLocation = (): Promise<string | undefined> =>
    new Promise(resolve => {
      if (!navigator.geolocation) {
        setLocationHint("此裝置不支援定位");
        resolve(undefined);
        return;
      }
      setLocationHint("正在取得即時位置…");
      navigator.geolocation.getCurrentPosition(
        position => {
          setLocationHint("已取得即時打卡位置");
          resolve(`${position.coords.latitude.toFixed(6)},${position.coords.longitude.toFixed(6)}`);
        },
        () => {
          setLocationHint("無法取得位置（請確認已允許定位權限）");
          resolve(undefined);
        },
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 },
      );
    });

  const handleClockIn = async () => {
    if (!selectedEmployee || punching) return;
    setPunching(true);
    try {
      const location = await getFreshLocation();
      const result = await attendanceApi.clockIn(Number(selectedEmployee), location, note);
      setAttendanceId(result.id);
      setClockInTime(result.checkIn);
      setClockedIn(true);
      setLateMinutes(result.lateMinutes || 0);
      setMessage({ type: "success", text: result.lateMinutes > 0
        ? `打卡成功！遲到 ${result.lateMinutes} 分鐘`
        : `打卡成功！上班時間：${result.checkIn}（準時）` });
      setNote("");
      queryClient.invalidateQueries({ queryKey: ["/attendance"] });
      // trigger summary reload
      const year = currentMonth.getFullYear();
      const month = currentMonth.getMonth() + 1;
      attendanceApi.monthlySummary(year, month, Number(selectedEmployee)).then(d => setSummary(d.rows?.[0]));
    } catch (e: any) {
      setMessage({ type: "error", text: e.message || "打卡失敗" });
    } finally {
      setPunching(false);
    }
  };

  const handleClockOut = async () => {
    if (!attendanceId || !clockInTime || punching) return;
    setPunching(true);
    try {
      const location = await getFreshLocation();
      const result = await attendanceApi.clockOut(attendanceId, location, note);
      setClockedIn(false);
      setCompleted(true);
      const details = [
        `工作 ${Number(result.workingHours).toFixed(1)} 小時`,
        result.earlyLeaveMinutes > 0 ? `早退 ${result.earlyLeaveMinutes} 分鐘` : "準時下班",
        result.overtimeHours > 0 ? `加班 ${result.overtimeHours} 小時` : null,
      ].filter(Boolean).join("，");
      setMessage({ type: "success", text: `下班打卡成功！${details}` });
      setNote("");
      queryClient.invalidateQueries({ queryKey: ["/attendance"] });
      const year = currentMonth.getFullYear();
      const month = currentMonth.getMonth() + 1;
      attendanceApi.monthlySummary(year, month, Number(selectedEmployee)).then(d => setSummary(d.rows?.[0]));
    } catch (e: any) {
      setMessage({ type: "error", text: e.message || "打卡失敗" });
    } finally {
      setPunching(false);
    }
  };

  const employeeName = useMemo(() => {
    if (isEmployee) return user?.displayName;
    const emp = employees?.find(e => String(e.id) === selectedEmployee);
    return emp ? `${emp.firstName}${emp.lastName}` : "未選擇";
  }, [isEmployee, user, employees, selectedEmployee]);

  const initials = employeeName ? employeeName.slice(0, 2) : "?";

  // Calendar logic
  const monthStart = startOfMonth(currentMonth);
  const monthEnd = endOfMonth(monthStart);
  const startDate = startOfWeek(monthStart, { weekStartsOn: 0 });
  const endDate = endOfWeek(monthEnd, { weekStartsOn: 0 });
  const calendarDays = eachDayOfInterval({ start: startDate, end: endDate });
  const today = startOfDay(new Date());

  const calendarRange = monthRange(format(currentMonth, "yyyy-MM"));
  const { data: calendarRecords = [] } = useQuery({
    queryKey: ["/attendance", calendarRange.from, calendarRange.to, selectedEmployee],
    queryFn: () => attendanceRecordsApi.list({ ...calendarRange, employeeId: Number(selectedEmployee) }),
    enabled: !!selectedEmployee,
  });
  const { data: calendarLeaves = [] } = useQuery({
    queryKey: ["/leaves", "calendar", calendarRange.from, calendarRange.to, selectedEmployee],
    queryFn: () => leavesApi.list({ ...calendarRange, employeeId: Number(selectedEmployee) }),
    enabled: !!selectedEmployee,
  });
  const leaveForDay = (date: Date) => {
    const dStr = format(date, "yyyy-MM-dd");
    return calendarLeaves.find(l => l.status === "Approved" && l.fromDate <= dStr && l.toDate >= dStr);
  };
  // 之前忘記打下班卡的日子（今天以前、有上班卡沒下班卡）
  const forgotten = calendarRecords.filter(r => r.checkIn && !r.checkOut && r.date < taipeiToday() && r.id !== attendanceId);

  const getRecordForDay = (date: Date) => {
    const dStr = format(date, "yyyy-MM-dd");
    return calendarRecords.find(r => r.date === dStr);
  };

  const selectedRecord = getRecordForDay(selectedDate);
  const selectedLeave = leaveForDay(selectedDate);

  const prevMonth = () => setCurrentMonth(subMonths(currentMonth, 1));
  const nextMonth = () => setCurrentMonth(addMonths(currentMonth, 1));

  return (
    <div className="max-w-md mx-auto space-y-4 pb-12">
      {/* Admin Employee Selector */}
      {!isEmployee && (
        <Card className="shadow-sm">
          <CardContent className="p-4">
            <label className="text-xs font-semibold text-muted-foreground mb-1.5 block">選擇要打卡的員工</label>
            <LookupSelect value={selectedEmployee} onValueChange={setSelectedEmployee}>
              <SelectTrigger className="h-12"><SelectValue placeholder="請選擇員工" /></SelectTrigger>
              <SelectContent>
                {employees?.map((emp) => (
                  <SelectItem key={emp.id} value={String(emp.id)}>
                    {emp.employeeId} - {emp.firstName}{emp.lastName}
                  </SelectItem>
                ))}
              </SelectContent>
            </LookupSelect>
          </CardContent>
        </Card>
      )}

      {/* Personal Info Area */}
      <Card className="overflow-hidden shadow-sm">
        <CardContent className="p-5 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Avatar className="h-14 w-14 border-2 border-primary/10">
              <AvatarFallback className="bg-primary/5 text-primary text-lg font-bold">{initials}</AvatarFallback>
            </Avatar>
            <div>
              <h2 className="text-xl font-bold text-foreground">{employeeName}</h2>
              <p className="text-sm text-muted-foreground font-medium">{format(new Date(), "yyyy 年 MM 月 dd 日 (EEEE)", { locale: zhTW })}</p>
            </div>
          </div>
        </CardContent>
        <div className="bg-muted/30 px-5 py-3 border-t grid grid-cols-3 gap-2 divide-x">
          <div className="text-center">
            <div className="text-xs text-muted-foreground mb-0.5">本月出勤</div>
            <div className="text-lg font-semibold text-foreground">{summary?.presentDays || 0} <span className="text-xs font-normal text-muted-foreground">天</span></div>
          </div>
          <div className="text-center">
            <div className="text-xs text-muted-foreground mb-0.5">遲到/早退</div>
            <div className="text-lg font-semibold text-orange-600 dark:text-orange-400">{(summary?.lateCount || 0) + (summary?.earlyLeaveCount || 0)} <span className="text-xs font-normal text-muted-foreground">次</span></div>
          </div>
          <div className="text-center">
            <div className="text-xs text-muted-foreground mb-0.5">請假</div>
            <div className="text-lg font-semibold text-blue-600 dark:text-blue-400">{summary?.leaveDays || 0} <span className="text-xs font-normal text-muted-foreground">天</span></div>
          </div>
        </div>
      </Card>

      {/* Big Action Area */}
      <Card className="shadow-sm relative overflow-hidden">
        <div className="absolute top-0 inset-x-0 h-2 bg-gradient-to-r from-blue-500 to-primary"></div>
        <CardContent className="pt-8 pb-8 px-6 flex flex-col items-center text-center">
          
          <div className="text-5xl font-mono tracking-tighter font-bold text-foreground mb-2">
            {format(currentTime, "HH:mm:ss")}
          </div>
          <div className="text-sm text-muted-foreground mb-8 bg-muted px-3 py-1 rounded-full flex items-center gap-1.5">
            <Clock className="w-3.5 h-3.5" />
            {shift ? `${shift.startTime} - ${shift.endTime}` : "標準班制 09:00 - 18:00"}
          </div>

          <div className="w-full max-w-[280px] mx-auto mb-6">
            {!selectedEmployee ? (
              <div className="h-48 rounded-3xl bg-muted flex items-center justify-center text-muted-foreground">
                請先選擇員工
              </div>
            ) : completed ? (
              <Button disabled className="w-full h-48 rounded-[2rem] text-2xl font-bold flex flex-col gap-3 bg-muted text-muted-foreground opacity-100 border-2 border-border shadow-inner">
                <CheckCircle2 className="w-12 h-12" />
                今日已完成打卡
              </Button>
            ) : clockedIn ? (
              <Button 
                onClick={handleClockOut} 
                disabled={punching}
                className="w-full h-48 rounded-[2rem] text-2xl font-bold flex flex-col gap-3 shadow-[0_8px_30px_rgb(249,115,22,0.3)] bg-gradient-to-b from-orange-400 to-orange-500 hover:from-orange-500 hover:to-orange-600 border-none transition-transform active:scale-95"
              >
                {punching ? <RefreshCw className="w-12 h-12 animate-spin" /> : <LogOut className="w-12 h-12" />}
                {punching ? "打卡中…" : "下班打卡"}
              </Button>
            ) : (
              <Button 
                onClick={handleClockIn} 
                disabled={punching}
                className="w-full h-48 rounded-[2rem] text-2xl font-bold flex flex-col gap-3 shadow-[0_8px_30px_rgb(59,130,246,0.3)] bg-gradient-to-b from-blue-500 to-blue-600 hover:from-blue-600 hover:to-blue-700 border-none transition-transform active:scale-95"
              >
                {punching ? <RefreshCw className="w-12 h-12 animate-spin" /> : <LogIn className="w-12 h-12" />}
                {punching ? "打卡中…" : "上班打卡"}
              </Button>
            )}
          </div>

          <div className="w-full space-y-3">
            <div className="relative">
              <Input 
                value={note} 
                onChange={e => setNote(e.target.value)} 
                placeholder="新增備註（例如：外勤、交通延誤）" 
                className="bg-muted/50 border-transparent text-center h-12 rounded-xl focus-visible:ring-1"
                disabled={completed || !selectedEmployee}
              />
            </div>
            
            {message && (
              <div className={`p-3 rounded-xl text-sm font-medium flex flex-col items-center gap-1 text-center animate-in fade-in slide-in-from-bottom-2 ${message.type === "success" ? "bg-green-50 text-green-700 dark:bg-green-950/40 dark:text-green-300" : "bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300"}`}>
                {message.type === "success" ? <CheckCircle2 className="w-5 h-5" /> : <AlertCircle className="w-5 h-5" />}
                {message.text}
              </div>
            )}

            <div className="flex items-center justify-center gap-1.5 text-xs text-muted-foreground mt-2">
              <MapPin className="h-3.5 w-3.5" /> {locationHint}
            </div>

            {forgotten.length > 0 && (
              <div className="p-3 rounded-xl text-sm bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300 text-left">
                <div className="font-medium flex items-center gap-1.5"><AlertCircle className="w-4 h-4" /> 有 {forgotten.length} 天忘記打下班卡</div>
                <div className="text-xs mt-1">{forgotten.map(r => r.date.slice(5)).join("、")}，請聯絡人資更正，否則當天工時無法計算。</div>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Calendar Area */}
      <Card className="shadow-sm">
        <CardHeader className="px-5 py-4 border-b flex flex-row items-center justify-between space-y-0">
          <Button variant="ghost" size="icon" onClick={prevMonth} className="h-8 w-8 rounded-full"><ChevronLeft className="h-4 w-4" /></Button>
          <div className="font-bold text-base">{format(currentMonth, "yyyy 年 MM 月")}</div>
          <Button variant="ghost" size="icon" onClick={nextMonth} className="h-8 w-8 rounded-full"><ChevronRight className="h-4 w-4" /></Button>
        </CardHeader>
        <CardContent className="p-4">
          <div className="grid grid-cols-7 gap-1 mb-2 text-center">
            {["日","一","二","三","四","五","六"].map(day => (
              <div key={day} className="text-xs font-semibold text-muted-foreground py-1">{day}</div>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-1">
            {calendarDays.map((date, i) => {
              const isCurrentMonth = isSameMonth(date, currentMonth);
              const isSelected = isSameDay(date, selectedDate);
              const isTodayDate = isToday(date);
              const isFuture = isBefore(today, date);
              
              const record = getRecordForDay(date);
              const onLeave = leaveForDay(date);
              let statusColor = "";
              if (onLeave && !record) {
                statusColor = "bg-blue-500";
              } else if (record) {
                if (record.status === "Present") statusColor = "bg-emerald-500";
                else if (record.status === "Late" || record.status === "Early Leave") statusColor = "bg-orange-500";
                else if (record.status === "Absent") statusColor = "bg-red-500";
                else if (record.status === "On Leave") statusColor = "bg-blue-500";
                else statusColor = "bg-emerald-500";
              } else if (!isFuture && isCurrentMonth) {
                // If it's a past weekday (1-5) and no record, it's missing (gray or red?)
                const day = getDay(date);
                if (day !== 0 && day !== 6 && !isTodayDate) {
                  statusColor = "bg-red-300 dark:bg-red-500/60"; 
                }
              }

              return (
                <button
                  key={i}
                  onClick={() => setSelectedDate(date)}
                  className={`
                    relative aspect-square flex items-center justify-center rounded-full text-sm transition-all
                    ${!isCurrentMonth ? "text-muted-foreground/30" : "text-foreground font-medium"}
                    ${isSelected ? "bg-primary text-primary-foreground shadow-md ring-2 ring-primary ring-offset-2" : "hover:bg-muted"}
                    ${isTodayDate && !isSelected ? "text-primary font-bold" : ""}
                  `}
                >
                  {format(date, "d")}
                  {statusColor && (
                    <span className={`absolute bottom-1 w-1 h-1 rounded-full ${statusColor} ${isSelected && statusColor === 'bg-primary' ? 'bg-white' : ''}`}></span>
                  )}
                </button>
              );
            })}
          </div>

          {/* Selected Date Details */}
          <div className="mt-6 pt-4 border-t">
            <h3 className="text-sm font-bold mb-3 flex items-center gap-2">
              {format(selectedDate, "MM月dd日")} 明細
              {isToday(selectedDate) && <Badge variant="secondary" className="text-[10px] h-5 px-1.5 bg-blue-100 text-blue-700 hover:bg-blue-100 border-0">今天</Badge>}
            </h3>
            
            {selectedRecord ? (
              <div className="bg-muted/40 rounded-xl p-3.5 space-y-3">
                <div className="flex justify-between items-start">
                  <Badge className={`
                    ${selectedRecord.status === 'Present' ? 'bg-emerald-100 text-emerald-700 hover:bg-emerald-100' : ''}
                    ${selectedRecord.status === 'Late' ? 'bg-orange-100 text-orange-700 hover:bg-orange-100' : ''}
                    ${selectedRecord.status === 'Absent' ? 'bg-red-100 text-red-700 hover:bg-red-100' : ''}
                    ${selectedRecord.status === 'On Leave' ? 'bg-blue-100 text-blue-700 hover:bg-blue-100' : ''}
                    border-0 shadow-none
                  `}>
                    {selectedRecord.status === 'Present' ? '正常出勤' : 
                     selectedRecord.status === 'Late' ? '遲到' : 
                     selectedRecord.status === 'Absent' ? '缺勤' : 
                     selectedRecord.status === 'On Leave' ? '請假' : selectedRecord.status}
                  </Badge>
                  {selectedRecord.workingHours && (
                    <span className="text-xs font-medium text-muted-foreground">{selectedRecord.workingHours} 小時</span>
                  )}
                </div>
                
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div className="bg-card p-2.5 rounded-lg border shadow-sm flex flex-col">
                    <span className="text-xs text-muted-foreground mb-1">上班</span>
                    <span className="font-semibold text-foreground text-base">{selectedRecord.checkIn || "--:--"}</span>
                  </div>
                  <div className="bg-card p-2.5 rounded-lg border shadow-sm flex flex-col">
                    <span className="text-xs text-muted-foreground mb-1">下班</span>
                    <span className="font-semibold text-foreground text-base">{selectedRecord.checkOut || "--:--"}</span>
                  </div>
                </div>

                {(selectedRecord.lateMinutes > 0 || selectedRecord.earlyLeaveMinutes > 0 || selectedRecord.note) && (
                  <div className="text-xs space-y-1.5 pt-1">
                    {selectedRecord.lateMinutes > 0 && <div className="text-orange-600 flex items-center gap-1"><AlertCircle className="w-3.5 h-3.5"/> 遲到 {selectedRecord.lateMinutes} 分鐘</div>}
                    {selectedRecord.earlyLeaveMinutes > 0 && <div className="text-orange-600 flex items-center gap-1"><AlertCircle className="w-3.5 h-3.5"/> 早退 {selectedRecord.earlyLeaveMinutes} 分鐘</div>}
                    {selectedRecord.note && <div className="text-muted-foreground flex items-start gap-1"><span className="shrink-0 mt-0.5 opacity-60">📝</span> {selectedRecord.note}</div>}
                  </div>
                )}
              </div>
            ) : (
              <div className="text-center py-6 text-muted-foreground bg-muted/20 rounded-xl border border-dashed text-sm">
                {selectedLeave ? "請假（已核准）" : "無打卡紀錄"}
              </div>
            )}
            <div className="flex flex-wrap gap-x-4 gap-y-1 mt-3 text-[11px] text-muted-foreground">
              <span className="inline-flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />正常</span>
              <span className="inline-flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-orange-500" />遲到</span>
              <span className="inline-flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-blue-500" />請假</span>
              <span className="inline-flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-red-300" />沒有紀錄</span>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
