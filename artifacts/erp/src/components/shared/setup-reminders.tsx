import { useState } from "react";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, ChevronDown, ChevronRight, Circle, ListChecks } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/auth-context";
import { SYSTEM_ADMIN_ROLES } from "@/lib/roles";

interface Reminder { key: string; title: string; detail: string; path: string; kind: "auto" | "confirm"; done: boolean }

const CONFIRMED_KEY = "erp:setup-confirmed";

function readConfirmed(): string[] {
  try { return JSON.parse(localStorage.getItem(CONFIRMED_KEY) || "[]"); } catch { return []; }
}

/**
 * 上線前設定清單：只給老闆與管理員看。
 * 系統判斷得出來的項目會自動打勾；判斷不出來的要自己按「我已確認」。全部完成後不佔版面。
 */
export function SetupReminders() {
  const { hasRole } = useAuth();
  const isAdmin = hasRole(...SYSTEM_ADMIN_ROLES);
  const [confirmed, setConfirmed] = useState<string[]>(readConfirmed);
  const [open, setOpen] = useState(true);

  const { data } = useQuery<Reminder[]>({
    queryKey: ["/erp-api/setup/reminders"],
    enabled: isAdmin,
    staleTime: 5 * 60_000,
    retry: false,
    queryFn: async () => {
      const response = await fetch(`/erp-api/setup/reminders`, { credentials: "include" });
      if (!response.ok) throw new Error("無法取得設定狀態");
      return response.json();
    },
  });

  if (!isAdmin || !Array.isArray(data)) return null;
  const isDone = (r: Reminder) => r.kind === "auto" ? r.done : (r.done || confirmed.includes(r.key));
  const pending = data.filter(r => !isDone(r));
  if (pending.length === 0) return null;

  const confirm = (key: string) => {
    const next = [...new Set([...confirmed, key])];
    setConfirmed(next);
    try { localStorage.setItem(CONFIRMED_KEY, JSON.stringify(next)); } catch { /* 記不住也不影響操作 */ }
  };

  return (
    <div className="rounded-lg border border-blue-200 bg-blue-50/60 dark:border-blue-900 dark:bg-blue-950/30" data-testid="setup-reminders">
      <button type="button" onClick={() => setOpen(v => !v)} className="flex w-full items-center gap-3 p-4 text-left">
        <ListChecks className="h-5 w-5 shrink-0 text-blue-600 dark:text-blue-400" />
        <div className="min-w-0 flex-1">
          <p className="font-semibold">上線前設定：還有 {pending.length} 項沒完成</p>
          <p className="text-xs text-muted-foreground">沒設定時，特休、缺勤、薪資與帳務算出來的數字會不正確</p>
        </div>
        {open ? <ChevronDown className="h-4 w-4 shrink-0" /> : <ChevronRight className="h-4 w-4 shrink-0" />}
      </button>
      {open && (
        <ul className="divide-y divide-blue-200/70 border-t border-blue-200/70 dark:divide-blue-900 dark:border-blue-900">
          {data.map(r => {
            const done = isDone(r);
            return (
              <li key={r.key} className="flex items-start gap-3 px-4 py-3">
                {done ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-green-600 dark:text-green-400" /> : <Circle className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />}
                <div className="min-w-0 flex-1">
                  <p className={`text-sm font-medium ${done ? "text-muted-foreground line-through" : ""}`}>{r.title}</p>
                  {!done && <p className="mt-0.5 text-xs text-muted-foreground">{r.detail}</p>}
                </div>
                {!done && (
                  <div className="flex shrink-0 flex-col gap-1.5 sm:flex-row">
                    <Button asChild size="sm" variant="outline" className="h-8"><Link href={r.path}>前往設定</Link></Button>
                    {r.kind === "confirm" && <Button size="sm" variant="ghost" className="h-8" onClick={() => confirm(r.key)}>我已確認</Button>}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
