import { useMemo, useState } from 'react';
import { addMonths, eachDayOfInterval, endOfMonth, endOfWeek, format, isSameMonth, startOfMonth, startOfWeek, subMonths } from 'date-fns';
import { zhTW } from 'date-fns/locale';
import { useLocation } from 'wouter';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ChevronLeft, ChevronRight } from 'lucide-react';

const TYPE_LABELS: Record<string, string> = {
  leave: '請假',
  task: '任務',
  contract: '合約',
  payroll: '薪資',
  maintenance: '保養',
  manufacturing: '製令',
};

const TYPE_STYLES: Record<string, string> = {
  leave: 'bg-blue-100 text-blue-800',
  task: 'bg-violet-100 text-violet-800',
  contract: 'bg-amber-100 text-amber-800',
  payroll: 'bg-emerald-100 text-emerald-800',
  maintenance: 'bg-orange-100 text-orange-800',
  manufacturing: 'bg-slate-200 text-slate-800',
};

type CalendarEvent = { date: string; type: string; title: string; path: string };

export default function CalendarPage() {
  const [, navigate] = useLocation();
  const [month, setMonth] = useState(() => startOfMonth(new Date()));
  const monthParam = format(month, 'yyyy-MM');
  const { data: events = [], isLoading } = useQuery({
    queryKey: ['erp-calendar', monthParam],
    queryFn: async () => {
      const response = await fetch(`/api/erp/calendar?month=${monthParam}`, { credentials: 'include' });
      if (!response.ok) throw new Error(`載入行事曆失敗 (${response.status})`);
      return response.json() as Promise<CalendarEvent[]>;
    },
  });
  const days = useMemo(
    () => eachDayOfInterval({
      start: startOfWeek(startOfMonth(month), { weekStartsOn: 0 }),
      end: endOfWeek(endOfMonth(month), { weekStartsOn: 0 }),
    }),
    [month],
  );
  const eventsByDate = useMemo(() => {
    const grouped = new Map<string, typeof events>();
    for (const event of events) {
      const list = grouped.get(event.date) ?? [];
      list.push(event);
      grouped.set(event.date, list);
    }
    return grouped;
  }, [events]);

  return (
    <Card className="shadow-sm">
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle>{format(month, 'yyyy 年 M 月', { locale: zhTW })}</CardTitle>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" aria-label="上一個月" onClick={() => setMonth(subMonths(month, 1))}>
            <ChevronLeft className="size-4" />
          </Button>
          <Button variant="outline" onClick={() => setMonth(startOfMonth(new Date()))}>今天</Button>
          <Button variant="outline" size="icon" aria-label="下一個月" onClick={() => setMonth(addMonths(month, 1))}>
            <ChevronRight className="size-4" />
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-7 border-l border-t text-center text-xs font-medium text-muted-foreground">
          {['日', '一', '二', '三', '四', '五', '六'].map((label) => (
            <div key={label} className="border-b border-r bg-muted/40 py-2">週{label}</div>
          ))}
        </div>
        <div className="grid grid-cols-7 border-l">
          {days.map((day) => {
            const key = format(day, 'yyyy-MM-dd');
            return (
              <div key={key} className="min-h-28 border-b border-r p-1.5">
                <div className={`mb-1 text-right text-xs ${isSameMonth(day, month) ? 'text-foreground' : 'text-muted-foreground/50'}`}>
                  {format(day, 'd')}
                </div>
                <div className="space-y-1">
                  {(eventsByDate.get(key) ?? []).map((event, index) => (
                    <button
                      key={`${event.type}-${event.path}-${index}`}
                      type="button"
                      title={event.title}
                      onClick={() => navigate(event.path)}
                      className={`block w-full truncate rounded px-1.5 py-1 text-left text-xs transition-opacity hover:opacity-75 ${TYPE_STYLES[event.type] ?? 'bg-muted text-foreground'}`}
                    >
                      <span className="font-medium">{TYPE_LABELS[event.type] ?? event.type}</span>
                      {' · '}{event.title}
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
        {isLoading && <p className="py-3 text-center text-sm text-muted-foreground">載入行事曆中…</p>}
      </CardContent>
    </Card>
  );
}