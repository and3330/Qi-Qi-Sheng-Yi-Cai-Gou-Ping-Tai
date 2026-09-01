import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListNewsletterCampaigns,
  getListNewsletterCampaignsQueryKey,
  useCreateNewsletterCampaign,
  useUpdateNewsletterCampaign,
  useDeleteNewsletterCampaign,
  useSendNewsletterCampaign,
  useScheduleNewsletterCampaign,
  useListNewsletterCampaignLogs,
  useGetNewsletterUsage,
  getGetNewsletterUsageQueryKey,
  useListNewsletterDomains,
  type NewsletterCampaign,
} from "@workspace/api-client-react";
import { Plus, Send, Clock, Trash2, Pencil, FileText, BarChart3 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { AdminLayout } from "./AdminLayout";
import { ResendConfigBanner } from "./NewsletterDomains";

function errMessage(e: unknown, fallback: string) {
  const anyE = e as any;
  return anyE?.data?.error || anyE?.message || fallback;
}

const statusLabel: Record<string, { text: string; cls: string }> = {
  draft: { text: "草稿", cls: "bg-muted text-muted-foreground" },
  scheduled: { text: "已排程", cls: "bg-blue-100 text-blue-700" },
  sending: { text: "發送中", cls: "bg-amber-100 text-amber-700" },
  sent: { text: "已發送", cls: "bg-green-100 text-green-700" },
  failed: { text: "發送失敗", cls: "bg-red-100 text-red-700" },
};

function CampaignLogsDialog({
  campaign,
  onClose,
}: {
  campaign: NewsletterCampaign;
  onClose: () => void;
}) {
  const { data: logs, isLoading } = useListNewsletterCampaignLogs(campaign.id);
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>發送記錄 — {campaign.name}</DialogTitle>
        </DialogHeader>
        <div className="mb-2 flex gap-4 text-sm">
          <span>收件人：{campaign.recipientCount ?? 0}</span>
          <span className="text-green-700">成功：{campaign.sentCount ?? 0}</span>
          <span className="text-red-600">失敗：{campaign.failedCount ?? 0}</span>
        </div>
        <div className="max-h-[50vh] overflow-y-auto rounded-lg border">
          {isLoading ? (
            <Skeleton className="m-3 h-8" />
          ) : !logs?.length ? (
            <p className="p-6 text-center text-sm text-muted-foreground">尚無發送記錄</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-white">
                <tr className="border-b text-left text-xs text-muted-foreground">
                  <th className="p-2">Email</th>
                  <th className="p-2">狀態</th>
                  <th className="p-2">錯誤</th>
                  <th className="p-2">時間</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((l) => (
                  <tr key={l.id} className="border-b last:border-0">
                    <td className="p-2">{l.email}</td>
                    <td className="p-2">
                      {l.status === "sent" ? (
                        <Badge className="bg-green-100 text-green-700" variant="secondary">成功</Badge>
                      ) : (
                        <Badge className="bg-red-100 text-red-700" variant="secondary">失敗</Badge>
                      )}
                    </td>
                    <td className="max-w-[220px] truncate p-2 text-xs text-red-600" title={l.error ?? ""}>
                      {l.error ?? "-"}
                    </td>
                    <td className="p-2 text-xs text-muted-foreground">
                      {new Date(l.sentAt).toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default function NewsletterCampaigns() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: campaigns, isLoading } = useListNewsletterCampaigns();
  const { data: usage } = useGetNewsletterUsage();
  const { data: domains } = useListNewsletterDomains();

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: getListNewsletterCampaignsQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetNewsletterUsageQueryKey() });
  };

  const createCampaign = useCreateNewsletterCampaign();
  const updateCampaign = useUpdateNewsletterCampaign();
  const deleteCampaign = useDeleteNewsletterCampaign();
  const sendCampaign = useSendNewsletterCampaign();
  const scheduleCampaign = useScheduleNewsletterCampaign();

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<NewsletterCampaign | null>(null);
  const [name, setName] = useState("");
  const [subject, setSubject] = useState("");
  const [fromEmail, setFromEmail] = useState("");
  const [html, setHtml] = useState("");
  const [tagFilter, setTagFilter] = useState("");

  const [scheduleFor, setScheduleFor] = useState<NewsletterCampaign | null>(null);
  const [scheduleAt, setScheduleAt] = useState("");
  const [logsFor, setLogsFor] = useState<NewsletterCampaign | null>(null);

  const verifiedDomain = domains?.find((d) => d.status === "verified")?.domain;
  const defaultFrom = verifiedDomain ? `newsletter@${verifiedDomain}` : "onboarding@resend.dev";

  const openCreate = () => {
    setEditing(null);
    setName("");
    setSubject("");
    setFromEmail(defaultFrom);
    setHtml("<h1>您好</h1>\n<p>這是一封電子報。</p>");
    setTagFilter("");
    setFormOpen(true);
  };
  const openEdit = (c: NewsletterCampaign) => {
    setEditing(c);
    setName(c.name);
    setSubject(c.subject);
    setFromEmail(c.fromEmail);
    setHtml(c.htmlContent ?? "");
    setTagFilter(c.tagFilter ?? "");
    setFormOpen(true);
  };

  const handleSave = async () => {
    if (!name.trim() || !subject.trim() || !fromEmail.trim()) {
      toast({ title: "名稱、主旨與寄件人必填", variant: "destructive" });
      return;
    }
    try {
      const data = {
        name: name.trim(),
        subject: subject.trim(),
        fromEmail: fromEmail.trim(),
        htmlContent: html,
        tagFilter: tagFilter.trim() || null,
      };
      if (editing) {
        await updateCampaign.mutateAsync({ id: editing.id, data });
        toast({ title: "活動已更新" });
      } else {
        await createCampaign.mutateAsync({ data });
        toast({ title: "活動已建立" });
      }
      setFormOpen(false);
      invalidate();
    } catch (e) {
      toast({ title: "儲存失敗", description: errMessage(e, ""), variant: "destructive" });
    }
  };

  return (
    <AdminLayout title="電子報・郵件活動">
      <ResendConfigBanner />

      {usage && (
        <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
          <div className="rounded-xl border bg-white p-4">
            <p className="text-xs text-muted-foreground">本月寄出</p>
            <p className="text-xl font-bold" data-testid="text-usage-month-sent">{usage.thisMonth.sent}</p>
          </div>
          <div className="rounded-xl border bg-white p-4">
            <p className="text-xs text-muted-foreground">本月失敗</p>
            <p className="text-xl font-bold text-red-600">{usage.thisMonth.failed}</p>
          </div>
          <div className="rounded-xl border bg-white p-4">
            <p className="text-xs text-muted-foreground">累計寄出</p>
            <p className="text-xl font-bold">{usage.allTime.sent}</p>
          </div>
          <div className="rounded-xl border bg-white p-4">
            <p className="text-xs text-muted-foreground">累計失敗</p>
            <p className="text-xl font-bold text-red-600">{usage.allTime.failed}</p>
          </div>
        </div>
      )}

      <div className="mb-3 flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-base font-semibold">
          <FileText size={18} /> 郵件活動
        </h2>
        <Button size="sm" onClick={openCreate} data-testid="button-add-campaign">
          <Plus size={16} /> 建立活動
        </Button>
      </div>

      <div className="rounded-xl border bg-white">
        {isLoading ? (
          <div className="space-y-2 p-4">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
          </div>
        ) : !campaigns?.length ? (
          <p className="p-8 text-center text-sm text-muted-foreground" data-testid="text-no-campaigns">
            尚未建立郵件活動。
          </p>
        ) : (
          <div className="divide-y">
            {campaigns.map((c) => {
              const st = statusLabel[c.status] ?? { text: c.status, cls: "bg-muted" };
              const editable = ["draft", "scheduled", "failed"].includes(c.status);
              return (
                <div key={c.id} className="flex flex-wrap items-center gap-3 p-4" data-testid={`row-campaign-${c.id}`}>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{c.name}</span>
                      <Badge className={st.cls} variant="secondary">{st.text}</Badge>
                      {c.tagFilter && (
                        <Badge variant="outline" className="text-xs">標籤：{c.tagFilter}</Badge>
                      )}
                    </div>
                    <p className="truncate text-xs text-muted-foreground">
                      {c.subject} · 寄件人 {c.fromEmail}
                      {c.status === "scheduled" && c.scheduledAt
                        ? ` · 排程 ${new Date(c.scheduledAt).toLocaleString()}`
                        : ""}
                      {c.status === "sent" && c.sentAt
                        ? ` · 寄出 ${new Date(c.sentAt).toLocaleString()}（成功 ${c.sentCount}/${c.recipientCount}）`
                        : ""}
                    </p>
                  </div>
                  <div className="flex gap-1">
                    <Button variant="ghost" size="sm" onClick={() => setLogsFor(c)} data-testid={`button-campaign-logs-${c.id}`}>
                      <BarChart3 size={14} />
                    </Button>
                    {editable && (
                      <>
                        <Button variant="ghost" size="sm" onClick={() => openEdit(c)} data-testid={`button-campaign-edit-${c.id}`}>
                          <Pencil size={14} />
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            setScheduleFor(c);
                            const dt = new Date(Date.now() + 3600_000);
                            dt.setMinutes(0, 0, 0);
                            setScheduleAt(
                              `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}T${String(dt.getHours()).padStart(2, "0")}:00`,
                            );
                          }}
                          data-testid={`button-campaign-schedule-${c.id}`}
                        >
                          <Clock size={14} /> 排程
                        </Button>
                        <Button
                          size="sm"
                          disabled={sendCampaign.isPending}
                          onClick={async () => {
                            if (!confirm(`確定立即發送「${c.name}」給所有符合條件的訂閱者？`)) return;
                            try {
                              await sendCampaign.mutateAsync({ id: c.id });
                              toast({ title: "已開始發送", description: "批次寄送進行中，可稍後查看發送記錄" });
                              invalidate();
                            } catch (e) {
                              toast({ title: "發送失敗", description: errMessage(e, ""), variant: "destructive" });
                            }
                          }}
                          data-testid={`button-campaign-send-${c.id}`}
                        >
                          <Send size={14} /> 發送
                        </Button>
                      </>
                    )}
                    {c.status !== "sending" && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-red-600"
                        onClick={async () => {
                          if (!confirm(`確定刪除活動「${c.name}」？發送記錄也會一併刪除。`)) return;
                          try {
                            await deleteCampaign.mutateAsync({ id: c.id });
                            invalidate();
                            toast({ title: "已刪除活動" });
                          } catch (e) {
                            toast({ title: "刪除失敗", description: errMessage(e, ""), variant: "destructive" });
                          }
                        }}
                        data-testid={`button-campaign-delete-${c.id}`}
                      >
                        <Trash2 size={14} />
                      </Button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{editing ? "編輯活動" : "建立郵件活動"}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label>活動名稱</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="例如：九月促銷通知" data-testid="input-campaign-name" />
            </div>
            <div className="space-y-1.5">
              <Label>寄件人 Email</Label>
              <Input value={fromEmail} onChange={(e) => setFromEmail(e.target.value)} placeholder="newsletter@yourdomain.com" data-testid="input-campaign-from" />
            </div>
            <div className="space-y-1.5 md:col-span-2">
              <Label>郵件主旨</Label>
              <Input value={subject} onChange={(e) => setSubject(e.target.value)} data-testid="input-campaign-subject" />
            </div>
            <div className="space-y-1.5 md:col-span-2">
              <Label>HTML 內容</Label>
              <Textarea rows={10} className="font-mono text-xs" value={html} onChange={(e) => setHtml(e.target.value)} data-testid="textarea-campaign-html" />
            </div>
            <div className="space-y-1.5">
              <Label>標籤篩選（選填，只寄給含此標籤者）</Label>
              <Input value={tagFilter} onChange={(e) => setTagFilter(e.target.value)} placeholder="留空 = 全部訂閱者" data-testid="input-campaign-tag-filter" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setFormOpen(false)}>取消</Button>
            <Button onClick={handleSave} disabled={createCampaign.isPending || updateCampaign.isPending} data-testid="button-save-campaign">
              儲存
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!scheduleFor} onOpenChange={(v) => !v && setScheduleFor(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>排程發送 — {scheduleFor?.name}</DialogTitle>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label>發送時間</Label>
            <Input
              type="datetime-local"
              value={scheduleAt}
              onChange={(e) => setScheduleAt(e.target.value)}
              data-testid="input-schedule-at"
            />
            <p className="text-xs text-muted-foreground">系統每分鐘檢查一次，到期後自動批次發送。</p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setScheduleFor(null)}>取消</Button>
            <Button
              disabled={scheduleCampaign.isPending}
              onClick={async () => {
                if (!scheduleFor || !scheduleAt) return;
                const when = new Date(scheduleAt);
                if (Number.isNaN(when.getTime()) || when.getTime() <= Date.now()) {
                  toast({ title: "排程時間必須在未來", variant: "destructive" });
                  return;
                }
                try {
                  await scheduleCampaign.mutateAsync({
                    id: scheduleFor.id,
                    data: { scheduledAt: when.toISOString() },
                  });
                  toast({ title: "已排程", description: when.toLocaleString() });
                  setScheduleFor(null);
                  invalidate();
                } catch (e) {
                  toast({ title: "排程失敗", description: errMessage(e, ""), variant: "destructive" });
                }
              }}
              data-testid="button-confirm-schedule"
            >
              確認排程
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {logsFor && <CampaignLogsDialog campaign={logsFor} onClose={() => setLogsFor(null)} />}
    </AdminLayout>
  );
}
