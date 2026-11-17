import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { Plus, ChevronLeft, ChevronRight, Trash2 } from "lucide-react";

const BASE = import.meta.env.BASE_URL.endsWith("/") ? import.meta.env.BASE_URL : import.meta.env.BASE_URL + "/";
const api = (path: string) => `/erp-api/${path}`;

const eventTypes = ["General", "Meeting", "Deadline", "Holiday", "Reminder", "Task"];
const eventTypeLabels: Record<string, string> = { General: "一般", Meeting: "會議", Deadline: "截止日", Holiday: "假日", Reminder: "提醒", Task: "任務" };
const colors = ["#3b82f6", "#ef4444", "#22c55e", "#f59e0b", "#8b5cf6", "#ec4899", "#06b6d4"];

/** 用本地日期（台灣時間）轉成 YYYY-MM-DD；toISOString 會換成 UTC，台灣午夜會變成前一天 */
const localYmd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

export default function Calendar() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [currentDate, setCurrentDate] = useState(new Date());
  const [viewMode, setViewMode] = useState<"month" | "week">("month");
  const [open, setOpen] = useState(false);
  const [selectedDate, setSelectedDate] = useState("");
  const [form, setForm] = useState({ title: "", description: "", eventType: "General", startDate: "", endDate: "", startTime: "", endTime: "", allDay: "Yes", location: "", color: "#3b82f6", assignedTo: "" });

  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();

  const startOfMonth = new Date(year, month, 1);
  const endOfMonth = new Date(year, month + 1, 0);
  const qStart = `${year}-${String(month + 1).padStart(2, "0")}-01`;
  const qEnd = `${year}-${String(month + 1).padStart(2, "0")}-${String(endOfMonth.getDate()).padStart(2, "0")}`;

  const { data: manualEvents = [] } = useQuery({ queryKey: ["calendar-events", qStart, qEnd], queryFn: () => fetch(api(`calendar-events?startDate=${qStart}&endDate=${qEnd}`)).then(r => r.json()) });
  const { data: aggregatedEvents = [] } = useQuery({ queryKey: ["calendar-events-agg", qStart, qEnd], queryFn: () => fetch(api(`calendar-events/aggregated?startDate=${qStart}&endDate=${qEnd}`)).then(r => r.json()) });
  const events = useMemo(() => [...manualEvents, ...aggregatedEvents], [manualEvents, aggregatedEvents]);

  const saveMutation = useMutation({
    mutationFn: (data: any) => fetch(api("calendar-events"), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) }).then(r => r.json()),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["calendar-events"] }); setOpen(false); toast({ title: "已建立事件" }); },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => fetch(api(`calendar-events/${id}`), { method: "DELETE" }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["calendar-events"] }); toast({ title: "已刪除" }); },
  });

  const prevMonth = () => setCurrentDate(new Date(year, month - 1, 1));
  const nextMonth = () => setCurrentDate(new Date(year, month + 1, 1));
  const prevWeek = () => setCurrentDate(new Date(currentDate.getTime() - 7 * 86400000));
  const nextWeek = () => setCurrentDate(new Date(currentDate.getTime() + 7 * 86400000));
  const today = () => setCurrentDate(new Date());

  const openCreate = (dateStr?: string) => {
    const d = dateStr || localYmd(new Date());
    setForm({ title: "", description: "", eventType: "General", startDate: d, endDate: d, startTime: "", endTime: "", allDay: "Yes", location: "", color: "#3b82f6", assignedTo: "" });
    setOpen(true);
  };

  const calendarDays = useMemo(() => {
    const days: { date: Date; isCurrentMonth: boolean }[] = [];
    const firstDayOfWeek = startOfMonth.getDay();
    for (let i = firstDayOfWeek - 1; i >= 0; i--) {
      days.push({ date: new Date(year, month, -i), isCurrentMonth: false });
    }
    for (let d = 1; d <= endOfMonth.getDate(); d++) {
      days.push({ date: new Date(year, month, d), isCurrentMonth: true });
    }
    const remaining = 42 - days.length;
    for (let d = 1; d <= remaining; d++) {
      days.push({ date: new Date(year, month + 1, d), isCurrentMonth: false });
    }
    return days;
  }, [year, month]);

  const getEventsForDate = (dateStr: string) => events.filter((e: any) => e.startDate === dateStr || (e.startDate <= dateStr && (e.endDate || e.startDate) >= dateStr));

  const todayStr = localYmd(new Date());
  const weekDays = ["日", "一", "二", "三", "四", "五", "六"];

  const weekDates = useMemo(() => {
    const dayOfWeek = currentDate.getDay();
    const startOfWeek = new Date(currentDate);
    startOfWeek.setDate(startOfWeek.getDate() - dayOfWeek);
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(startOfWeek);
      d.setDate(d.getDate() + i);
      return d;
    });
  }, [currentDate]);

  const hours = Array.from({ length: 14 }, (_, i) => i + 7);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">行事曆</h1>
        <div className="flex gap-2">
          <div className="flex rounded-md border">
            <Button variant={viewMode === "month" ? "default" : "ghost"} size="sm" className="rounded-r-none" onClick={() => setViewMode("month")}>月</Button>
            <Button variant={viewMode === "week" ? "default" : "ghost"} size="sm" className="rounded-l-none" onClick={() => setViewMode("week")}>週</Button>
          </div>
          <Button onClick={() => openCreate()}><Plus className="mr-2 h-4 w-4" />新增事件</Button>
        </div>
      </div>

      <Card>
        <CardContent className="p-4">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <Button variant="outline" size="icon" onClick={viewMode === "month" ? prevMonth : prevWeek}><ChevronLeft className="h-4 w-4" /></Button>
              <h2 className="text-lg font-semibold min-w-[180px] text-center">
                {viewMode === "month"
                  ? `${year} 年 ${month + 1} 月`
                  : `${weekDates[0].getMonth() + 1}/${weekDates[0].getDate()} ~ ${weekDates[6].getMonth() + 1}/${weekDates[6].getDate()}`}
              </h2>
              <Button variant="outline" size="icon" onClick={viewMode === "month" ? nextMonth : nextWeek}><ChevronRight className="h-4 w-4" /></Button>
            </div>
            <Button variant="outline" size="sm" onClick={today}>今天</Button>
          </div>

          {viewMode === "month" ? (
          <div className="grid grid-cols-7 gap-px bg-border rounded-lg overflow-hidden">
            {weekDays.map(d => <div key={d} className="bg-muted p-2 text-center text-sm font-medium">{d}</div>)}
            {calendarDays.map(({ date, isCurrentMonth }, i) => {
              const dateStr = localYmd(date);
              const dayEvents = getEventsForDate(dateStr);
              const isToday = dateStr === todayStr;
              return (
                <div key={i} className={`bg-card min-h-[100px] p-1 cursor-pointer hover:bg-accent/30 transition-colors ${!isCurrentMonth ? "opacity-40" : ""}`} onClick={() => openCreate(dateStr)}>
                  <div className={`text-sm mb-1 w-7 h-7 flex items-center justify-center rounded-full ${isToday ? "bg-primary text-primary-foreground font-bold" : ""}`}>{date.getDate()}</div>
                  <div className="space-y-0.5">
                    {dayEvents.slice(0, 3).map((ev: any) => (
                      <div key={ev.id} className="text-xs px-1 py-0.5 rounded truncate text-white" style={{ backgroundColor: ev.color || "#3b82f6" }} onClick={(e) => { e.stopPropagation(); }}>
                        {ev.title}
                      </div>
                    ))}
                    {dayEvents.length > 3 && <div className="text-xs text-muted-foreground px-1">+{dayEvents.length - 3} 更多</div>}
                  </div>
                </div>
              );
            })}
          </div>
          ) : (
          <div className="overflow-x-auto">
            <div className="grid grid-cols-8 gap-px bg-border rounded-lg overflow-hidden min-w-[700px]">
              <div className="bg-muted p-2 text-center text-sm font-medium">時間</div>
              {weekDates.map((d, i) => {
                const dateStr = localYmd(d);
                const isToday = dateStr === todayStr;
                return <div key={i} className={`bg-muted p-2 text-center text-sm font-medium ${isToday ? "bg-primary/10" : ""}`}>{weekDays[i]} {d.getDate()}</div>;
              })}
              {hours.map(h => (
                <>
                  <div key={`h-${h}`} className="bg-card p-1 text-xs text-muted-foreground text-right pr-2 border-t">{String(h).padStart(2, "0")}:00</div>
                  {weekDates.map((d, di) => {
                    const dateStr = localYmd(d);
                    const dayEvents = getEventsForDate(dateStr).filter((ev: any) => {
                      if (!ev.startTime) return h === 9;
                      const evHour = parseInt(ev.startTime.split(":")[0]);
                      return evHour === h;
                    });
                    return (
                      <div key={`${h}-${di}`} className="bg-card min-h-[50px] p-0.5 cursor-pointer hover:bg-accent/20 border-t" onClick={() => openCreate(dateStr)}>
                        {dayEvents.map((ev: any) => (
                          <div key={ev.id} className="text-xs px-1 py-0.5 rounded truncate text-white mb-0.5" style={{ backgroundColor: ev.color || "#3b82f6" }}>
                            {ev.title}
                          </div>
                        ))}
                      </div>
                    );
                  })}
                </>
              ))}
            </div>
          </div>
          )}

          {events.length > 0 && (
            <div className="mt-6">
              <h3 className="font-medium mb-3">本月事件</h3>
              <div className="space-y-2">
                {events.map((ev: any) => (
                  <div key={ev.id} className="flex items-center gap-3 p-2 rounded-lg border">
                    <div className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: ev.color || "#3b82f6" }} />
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-sm">{ev.title}</div>
                      <div className="text-xs text-muted-foreground">{ev.startDate}{ev.endDate && ev.endDate !== ev.startDate ? ` ~ ${ev.endDate}` : ""} {ev.startTime || ""}</div>
                    </div>
                    <span className="text-xs text-muted-foreground">{eventTypeLabels[ev.eventType] || ev.eventType}</span>
                    {typeof ev.id === "number" && <Button variant="ghost" size="icon" onClick={() => deleteMutation.mutate(ev.id)}><Trash2 className="h-4 w-4 text-destructive" /></Button>}
                  </div>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="md:max-w-lg">
          <DialogHeader><DialogTitle>新增事件</DialogTitle></DialogHeader>
          <div className="grid gap-4">
            <div><Label>標題</Label><Input value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} /></div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div><Label>類型</Label><Select value={form.eventType} onValueChange={v => setForm(f => ({ ...f, eventType: v }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{eventTypes.map(t => <SelectItem key={t} value={t}>{eventTypeLabels[t]}</SelectItem>)}</SelectContent></Select></div>
              <div><Label>顏色</Label><div className="flex gap-1 mt-2">{colors.map(c => <button key={c} className={`w-6 h-6 rounded-full border-2 ${form.color === c ? "border-foreground" : "border-transparent"}`} style={{ backgroundColor: c }} onClick={() => setForm(f => ({ ...f, color: c }))} />)}</div></div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div><Label>開始日期</Label><Input type="date" value={form.startDate} onChange={e => setForm(f => ({ ...f, startDate: e.target.value }))} /></div>
              <div><Label>結束日期</Label><Input type="date" value={form.endDate} onChange={e => setForm(f => ({ ...f, endDate: e.target.value }))} /></div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div><Label>開始時間</Label><Input type="time" value={form.startTime} onChange={e => setForm(f => ({ ...f, startTime: e.target.value }))} /></div>
              <div><Label>結束時間</Label><Input type="time" value={form.endTime} onChange={e => setForm(f => ({ ...f, endTime: e.target.value }))} /></div>
            </div>
            <div><Label>地點</Label><Input value={form.location} onChange={e => setForm(f => ({ ...f, location: e.target.value }))} /></div>
            <div><Label>說明</Label><Textarea value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>取消</Button>
            <Button onClick={() => saveMutation.mutate(form)} disabled={!form.title || !form.startDate}>儲存</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
