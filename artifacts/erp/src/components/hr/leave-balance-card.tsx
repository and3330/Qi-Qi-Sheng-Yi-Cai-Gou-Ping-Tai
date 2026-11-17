import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { leavesApi } from "@/lib/api";
import { Palmtree } from "lucide-react";

/** 個人假勤餘額：特休剩幾天、什麼時候到期、下次發放，以及今年其他假別已請天數 */
export function LeaveBalanceCard({ employeeId }: { employeeId: number }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ["/leaves/balance", employeeId],
    queryFn: () => leavesApi.balance(employeeId),
    retry: false,
  });
  if (error) return null;
  const annual = data?.annual;
  const expiring = annual?.period && annual.remaining > 0 && (annual.daysToExpiry ?? 999) <= 60;

  return (
    <Card>
      <CardContent className="p-4 space-y-3">
        <div className="flex items-center gap-3">
          <div className="h-11 w-11 rounded-xl bg-primary/10 text-primary flex items-center justify-center shrink-0"><Palmtree className="h-5 w-5" /></div>
          <div className="min-w-0 flex-1">
            <div className="text-xs text-muted-foreground">特休剩餘{data ? `・年資 ${annual?.seniority}` : ""}</div>
            <div className="text-2xl font-bold leading-tight">
              {isLoading ? "…" : annual?.period ? <>{annual.remaining} <span className="text-sm font-normal text-muted-foreground">天</span></> : <span className="text-base font-medium">尚未滿半年</span>}
            </div>
          </div>
          {annual?.period && (
            <div className="text-right text-xs text-muted-foreground shrink-0">
              <div>本期 {annual.entitled} 天</div>
              <div>已休 {annual.used}{annual.pending > 0 ? `・待審 ${annual.pending}` : ""}</div>
            </div>
          )}
        </div>
        {annual && (
          <div className="text-xs text-muted-foreground space-y-0.5">
            {annual.period && (
              <div className={expiring ? "text-amber-600 dark:text-amber-400 font-medium" : ""}>
                使用期限 {annual.period.periodEnd}{expiring ? `，剩 ${annual.daysToExpiry} 天到期，沒休完會折發工資` : ""}
              </div>
            )}
            {annual.next && <div>下次發放：{annual.next.date}（{annual.next.label}，{annual.next.days} 天）</div>}
          </div>
        )}
        {data && data.usage.some(u => u.used > 0 || u.pending > 0) && (
          <div className="flex flex-wrap gap-1.5 pt-1 border-t">
            {data.usage.filter(u => u.used > 0 || u.pending > 0).map(u => (
              <span key={u.code} className="text-xs rounded-full bg-muted px-2.5 py-1">
                {u.label} {u.used + u.pending}{u.yearlyLimit !== null ? `／${u.yearlyLimit}` : ""} 天
              </span>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
