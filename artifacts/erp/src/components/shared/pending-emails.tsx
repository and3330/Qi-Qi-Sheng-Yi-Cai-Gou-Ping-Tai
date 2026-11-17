import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Mail, Send, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";

interface PendingEmail {
  id: number;
  docType: string;
  docId: number;
  recipient: string;
  subject: string;
  trigger: string;
  createdAt: string;
}

const DOC_LABEL: Record<string, string> = { quotation: "報價單", sales_order: "銷售訂單", invoice: "發票" };

const request = async (path: string, init?: RequestInit) => {
  const response = await fetch(`/erp-api${path}`, { credentials: "include", headers: { "Content-Type": "application/json" }, ...init });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "操作失敗");
  return data;
};

/**
 * 等人確認的信。AI 助理只能「提出要寄」，按下確認之前不會寄給客戶。
 * 沒有待確認的信時整塊不顯示。
 */
export function PendingEmails({ docType }: { docType?: string } = {}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data = [] } = useQuery<PendingEmail[]>({
    queryKey: ["/erp-api/email/pending"],
    queryFn: () => request("/email/pending"),
    refetchInterval: 60_000,
    retry: false, // 沒有寄信權限的人會被擋，不用一直重試
  });
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["/erp-api/email/pending"] });

  const send = useMutation({
    mutationFn: (id: number) => request(`/email/pending/${id}/send`, { method: "POST" }),
    onSuccess: () => { toast({ title: "信已寄出" }); refresh(); },
    onError: (e: Error) => { toast({ title: "寄送失敗", description: e.message, variant: "destructive" }); refresh(); },
  });
  const reject = useMutation({
    mutationFn: (id: number) => request(`/email/pending/${id}/reject`, { method: "POST" }),
    onSuccess: () => { toast({ title: "已取消，不會寄出" }); refresh(); },
    onError: (e: Error) => toast({ title: "操作失敗", description: e.message, variant: "destructive" }),
  });

  const rows = (Array.isArray(data) ? data : []).filter((row) => !docType || row.docType === docType);
  if (rows.length === 0) return null;
  const busy = send.isPending || reject.isPending;

  return (
    <Card data-testid="pending-emails">
      <CardContent className="p-4">
        <h2 className="mb-1 flex items-center gap-2 text-base font-semibold"><Mail size={18} className="text-primary" />待確認的信（{rows.length}）</h2>
        <p className="mb-3 text-sm text-muted-foreground">AI 助理提出要寄給客戶的信。按「確認寄出」才會真的寄；信件內容由系統依單據產生。</p>
        <ul className="divide-y rounded-lg border">
          {rows.map((row) => (
            <li key={row.id} className="flex flex-wrap items-center gap-3 px-3 py-2.5">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{row.subject}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {DOC_LABEL[row.docType] || row.docType}　·　收件人 {row.recipient}　·　{new Date(row.createdAt).toLocaleString("zh-TW", { hour12: false })}
                </p>
              </div>
              <div className="flex gap-2">
                <Button size="sm" disabled={busy} onClick={() => { if (confirm(`確定寄給 ${row.recipient}？`)) send.mutate(row.id); }} data-testid={`button-send-pending-email-${row.id}`}>
                  <Send size={14} className="mr-1.5" />確認寄出
                </Button>
                <Button size="sm" variant="outline" disabled={busy} onClick={() => reject.mutate(row.id)} data-testid={`button-reject-pending-email-${row.id}`}>
                  <X size={14} className="mr-1.5" />不寄
                </Button>
              </div>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
