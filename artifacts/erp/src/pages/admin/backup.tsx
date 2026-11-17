import { useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2, DatabaseBackup, Download, Trash2, AlertTriangle, Upload, RotateCcw } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const BASE = import.meta.env.BASE_URL.endsWith("/") ? import.meta.env.BASE_URL : import.meta.env.BASE_URL + "/";

interface BackupEntry {
  name: string;
  path: string;
  size: number;
  sizeMb: number;
  createdAt: string;
}

async function api<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`/erp-api${path}`, {
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

export default function BackupPage() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [running, setRunning] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data: backups, isLoading } = useQuery<BackupEntry[]>({
    queryKey: ["backups"],
    queryFn: () => api<BackupEntry[]>("/backup"),
  });

  const runBackup = useMutation({
    mutationFn: () => api<BackupEntry>("/backup/run", { method: "POST" }),
    onMutate: () => setRunning(true),
    onSettled: () => setRunning(false),
    onSuccess: (b) => {
      toast({ title: "備份完成", description: `${b.name}（${b.sizeMb} MB）` });
      qc.invalidateQueries({ queryKey: ["backups"] });
    },
    onError: (e: Error) => toast({ title: "備份失敗", description: e.message, variant: "destructive" }),
  });

  const restoreUpload = useMutation({
    mutationFn: async (file: File) => {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch(`/erp-api/backup/restore`, { method: "POST", credentials: "include", body: fd });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        throw new Error(err.error || `HTTP ${res.status}`);
      }
      return res.json();
    },
    onMutate: () => setRestoring(true),
    onSettled: () => setRestoring(false),
    onSuccess: (r: any) => {
      toast({ title: "還原完成", description: `已從 ${r.restored} 還原資料庫` });
      qc.invalidateQueries();
    },
    onError: (e: Error) => toast({ title: "還原失敗", description: e.message, variant: "destructive" }),
  });

  const restoreExisting = useMutation({
    mutationFn: (name: string) => api<{ ok: boolean; restored: string }>(`/backup/restore-existing/${encodeURIComponent(name)}`, { method: "POST" }),
    onMutate: () => setRestoring(true),
    onSettled: () => setRestoring(false),
    onSuccess: (r) => {
      toast({ title: "還原完成", description: `已從 ${r.restored} 還原資料庫` });
      qc.invalidateQueries();
    },
    onError: (e: Error) => toast({ title: "還原失敗", description: e.message, variant: "destructive" }),
  });

  const del = useMutation({
    mutationFn: (name: string) => api<void>(`/backup/${encodeURIComponent(name)}`, { method: "DELETE" }),
    onSuccess: () => {
      toast({ title: "已刪除" });
      qc.invalidateQueries({ queryKey: ["backups"] });
    },
    onError: (e: Error) => toast({ title: "刪除失敗", description: e.message, variant: "destructive" }),
  });

  const totalMb = (backups || []).reduce((s, b) => s + b.sizeMb, 0);

  return (
    <div className="space-y-4 max-w-5xl" data-testid="page-backup">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><DatabaseBackup className="h-6 w-6" /> 資料庫備份</h1>
          <p className="text-sm text-muted-foreground mt-1">使用 pg_dump 備份完整資料庫到 Object Storage（custom format，可平行還原）</p>
        </div>
        <div className="flex gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept=".dump,application/octet-stream"
            className="hidden"
            data-testid="input-restore-file"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (!f) return;
              const sizeMb = Math.round((f.size / 1024 / 1024) * 100) / 100;
              if (!confirm(`⚠️ 確定要用「${f.name}」（${sizeMb} MB）覆蓋目前資料庫？\n\n這會清除所有現有資料並改為備份檔內容，無法復原！\n還原期間系統會短暫不可用，完成後需重新登入。\n\n建議先「立即備份」一份再執行。`)) {
                e.target.value = "";
                return;
              }
              restoreUpload.mutate(f);
              e.target.value = "";
            }}
          />
          <Button
            variant="outline"
            onClick={() => fileInputRef.current?.click()}
            disabled={restoring || running}
            data-testid="button-upload-restore"
          >
            {restoring ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}
            上傳並還原
          </Button>
          <Button onClick={() => runBackup.mutate()} disabled={running || restoring} data-testid="button-run-backup">
            {running ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <DatabaseBackup className="mr-2 h-4 w-4" />}
            立即備份
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">備份歷史</CardTitle>
          <div className="text-xs text-muted-foreground">
            共 {backups?.length || 0} 份 · 累計 {Math.round(totalMb * 100) / 100} MB
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> 載入中...</div>
          ) : !backups || backups.length === 0 ? (
            <div className="text-sm text-muted-foreground py-8 text-center">
              尚無備份。點擊「立即備份」開始。
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-xs text-muted-foreground border-b">
                  <tr>
                    <th className="text-left py-2 font-medium">檔名</th>
                    <th className="text-left py-2 font-medium">建立時間</th>
                    <th className="text-right py-2 font-medium">大小</th>
                    <th className="text-right py-2 font-medium">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {backups.map((b) => (
                    <tr key={b.path} className="border-b hover:bg-muted/30" data-testid={`row-backup-${b.name}`}>
                      <td className="py-2 font-mono text-xs">{b.name}</td>
                      <td className="py-2 text-xs">{new Date(b.createdAt).toLocaleString("zh-TW")}</td>
                      <td className="py-2 text-right">{b.sizeMb} MB</td>
                      <td className="py-2 text-right">
                        <a
                          href={`/erp-api/backup/download/${encodeURIComponent(b.name)}`}
                          className="inline-flex items-center gap-1 text-primary hover:underline mr-3 text-xs"
                          data-testid={`link-download-${b.name}`}
                        >
                          <Download className="h-3 w-3" /> 下載
                        </a>
                        <button
                          onClick={() => {
                            if (confirm(`⚠️ 確定要用「${b.name}」（${b.sizeMb} MB）覆蓋目前資料庫？\n\n這會清除所有現有資料並改為備份檔內容，無法復原！\n還原期間系統會短暫不可用，完成後需重新登入。`)) {
                              restoreExisting.mutate(b.name);
                            }
                          }}
                          disabled={restoring || running}
                          className="inline-flex items-center gap-1 text-amber-600 hover:underline mr-3 text-xs disabled:opacity-50"
                          data-testid={`button-restore-${b.name}`}
                        >
                          <RotateCcw className="h-3 w-3" /> 還原
                        </button>
                        <button
                          onClick={() => { if (confirm(`確定刪除 ${b.name}?`)) del.mutate(b.name); }}
                          className="inline-flex items-center gap-1 text-destructive hover:underline text-xs"
                          data-testid={`button-delete-${b.name}`}
                        >
                          <Trash2 className="h-3 w-3" /> 刪除
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-4 text-xs text-muted-foreground space-y-2">
          <div className="flex items-start gap-2">
            <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
            <div>
              <div className="font-medium text-foreground mb-1">還原方式</div>
              <div>· <b>從備份歷史還原</b>：點清單中「還原」按鈕（同環境用，例如測試環境想回到某個時間點）</div>
              <div>· <b>跨環境同步</b>：在來源環境（例：測試）按「立即備份」→「下載」.dump → 切到目標環境（例：正式）→「上傳並還原」</div>
              <div className="mt-2 text-amber-600">⚠️ 還原會 <b>覆蓋</b> 目前所有資料（含登入帳號），執行前務必先備份一份保險。</div>
              <div className="mt-1">建議：每天備份一次，保留最近 14 份。後續會加上自動排程。</div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
