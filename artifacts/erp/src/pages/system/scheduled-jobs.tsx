import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { Play, Clock, CheckCircle2, XCircle, AlertCircle } from "lucide-react";

const BASE = import.meta.env.BASE_URL.endsWith("/") ? import.meta.env.BASE_URL : import.meta.env.BASE_URL + "/";

interface Job {
  name: string;
  schedule: string;
  lastRunAt: string | null;
  lastStatus: string | null;
  lastError: string | null;
}

const LABELS: Record<string, { title: string; description: string }> = {
  overdue_invoice_check: { title: "逾期應收帳款檢查", description: "每日 09:00 檢查逾期 30 天以上未收發票，產生通知。" },
  low_stock_check: { title: "低庫存預警", description: "每日 09:30 檢查低於補貨點之商品，產生通知。" },
  ledger_balance_check: { title: "每日帳平檢查", description: "每天 08:00 檢查全部已過帳的分錄，借貸不相等就發通知。" },
};

function fmtCron(c: string) {
  const map: Record<string, string> = {
    "0 9 * * *": "每日 09:00", "30 9 * * *": "每日 09:30", "0 10 * * 1": "每週一 10:00",
  };
  return map[c] || c;
}

export default function ScheduledJobsPage() {
  const { toast } = useToast();
  const qc = useQueryClient();

  const { data, isLoading } = useQuery<{ jobs: Job[] }>({
    queryKey: ["scheduled-jobs"],
    queryFn: () => fetch(`/erp-api/scheduled-jobs`, { credentials: "include" }).then((r) => r.json()),
    refetchInterval: 10000,
  });

  const runMutation = useMutation({
    mutationFn: (name: string) =>
      fetch(`/erp-api/scheduled-jobs/${encodeURIComponent(name)}/run`, { method: "POST", credentials: "include" })
        .then(async (r) => { const d = await r.json(); if (!r.ok) throw new Error(d.error || "執行失敗"); return d; }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["scheduled-jobs"] }); qc.invalidateQueries({ queryKey: ["notifications"] }); toast({ title: "排程任務已執行" }); },
    onError: (e: any) => toast({ title: "執行失敗", description: e.message, variant: "destructive" }),
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">排程任務</h1>
        <p className="text-sm text-muted-foreground mt-1">系統自動排程作業，可手動觸發以立即執行。所有時間以 Asia/Taipei 為準。</p>
      </div>

      {isLoading && <div className="text-sm text-muted-foreground">載入中...</div>}

      <div className="grid gap-4">
        {data?.jobs.map((job) => {
          const label = LABELS[job.name] || { title: job.name, description: "" };
          return (
            <Card key={job.name} data-testid={`card-job-${job.name}`}>
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <CardTitle className="text-base flex items-center gap-2">
                      <Clock className="h-4 w-4 text-primary" />
                      {label.title}
                    </CardTitle>
                    <p className="text-xs text-muted-foreground mt-1">{label.description}</p>
                  </div>
                  <Button
                    size="sm"
                    onClick={() => runMutation.mutate(job.name)}
                    disabled={runMutation.isPending}
                    data-testid={`button-run-${job.name}`}
                  >
                    <Play className="h-3.5 w-3.5 mr-1.5" />立即執行
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="pt-0">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
                  <div>
                    <div className="text-xs text-muted-foreground">排程</div>
                    <div className="font-medium">{fmtCron(job.schedule)}</div>
                    <div className="text-[10px] text-muted-foreground font-mono">{job.schedule}</div>
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground">最近執行</div>
                    <div className="font-medium">{job.lastRunAt ? new Date(job.lastRunAt).toLocaleString("zh-TW") : "—"}</div>
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground">狀態</div>
                    <div>
                      {job.lastStatus === "success" && <Badge className="bg-green-100 text-green-800 hover:bg-green-100"><CheckCircle2 className="h-3 w-3 mr-1" />成功</Badge>}
                      {job.lastStatus === "error" && <Badge variant="destructive"><XCircle className="h-3 w-3 mr-1" />失敗</Badge>}
                      {!job.lastStatus && <Badge variant="outline"><AlertCircle className="h-3 w-3 mr-1" />尚未執行</Badge>}
                    </div>
                  </div>
                </div>
                {job.lastError && (
                  <div className="mt-3 p-2 bg-destructive/10 text-destructive text-xs rounded font-mono">{job.lastError}</div>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
