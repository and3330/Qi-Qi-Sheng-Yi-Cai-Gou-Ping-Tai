import { useState } from "react";
import { Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListNewsletterSequences,
  getListNewsletterSequencesQueryKey,
  useCreateNewsletterSequence,
  useUpdateNewsletterSequence,
  useDeleteNewsletterSequence,
  type NewsletterSequence,
} from "@workspace/api-client-react";
import { Plus, Trash2, Workflow, Users, ListOrdered } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
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

export default function NewsletterSequences() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: sequences, isLoading } = useListNewsletterSequences();
  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: getListNewsletterSequencesQueryKey() });

  const createSeq = useCreateNewsletterSequence();
  const updateSeq = useUpdateNewsletterSequence();
  const deleteSeq = useDeleteNewsletterSequence();

  const [formOpen, setFormOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [fromEmail, setFromEmail] = useState("");

  const handleCreate = async () => {
    if (!name.trim()) {
      toast({ title: "請輸入序列名稱", variant: "destructive" });
      return;
    }
    try {
      await createSeq.mutateAsync({
        data: {
          name: name.trim(),
          description: description.trim() || null,
          fromEmail: fromEmail.trim() || null,
        },
      });
      toast({ title: "序列已建立", description: "請進入流程編輯器新增步驟" });
      setFormOpen(false);
      setName("");
      setDescription("");
      setFromEmail("");
      invalidate();
    } catch (e) {
      toast({ title: "建立失敗", description: errMessage(e, ""), variant: "destructive" });
    }
  };

  const toggleActive = async (s: NewsletterSequence, v: boolean) => {
    if (v && !s.stepCount) {
      toast({ title: "此序列尚無步驟", description: "請先在流程編輯器新增至少一個步驟", variant: "destructive" });
      return;
    }
    try {
      await updateSeq.mutateAsync({ id: s.id, data: { isActive: v } });
      invalidate();
      toast({ title: v ? "序列已啟用" : "序列已停用", description: v ? "新訂閱者將自動加入此序列" : undefined });
    } catch (e) {
      toast({ title: "更新失敗", description: errMessage(e, ""), variant: "destructive" });
    }
  };

  return (
    <AdminLayout title="電子報・自動序列">
      <ResendConfigBanner />
      <div className="mb-3 flex items-center justify-between">
        <div>
          <h2 className="flex items-center gap-2 text-base font-semibold">
            <Workflow size={18} /> 自動序列（Drip Sequence）
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            新訂閱者會自動加入所有「啟用中」的序列，依各步驟設定的延遲天數自動寄出。
          </p>
        </div>
        <Button size="sm" onClick={() => setFormOpen(true)} data-testid="button-add-sequence">
          <Plus size={16} /> 建立序列
        </Button>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        {isLoading ? (
          <>
            <Skeleton className="h-32" />
            <Skeleton className="h-32" />
          </>
        ) : !sequences?.length ? (
          <p className="col-span-2 rounded-xl border bg-white p-8 text-center text-sm text-muted-foreground" data-testid="text-no-sequences">
            尚未建立自動序列。建立後可在視覺化流程編輯器中設計每一步。
          </p>
        ) : (
          sequences.map((s) => (
            <div key={s.id} className="rounded-xl border bg-white p-4" data-testid={`card-sequence-${s.id}`}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold">{s.name}</span>
                    {s.isActive ? (
                      <Badge className="bg-green-100 text-green-700" variant="secondary">啟用中</Badge>
                    ) : (
                      <Badge className="bg-muted text-muted-foreground" variant="secondary">停用</Badge>
                    )}
                  </div>
                  {s.description && (
                    <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{s.description}</p>
                  )}
                </div>
                <Switch
                  checked={s.isActive}
                  onCheckedChange={(v) => toggleActive(s, v)}
                  data-testid={`switch-sequence-active-${s.id}`}
                />
              </div>
              <div className="mt-3 flex gap-4 text-xs text-muted-foreground">
                <span className="flex items-center gap-1">
                  <ListOrdered size={13} /> {s.stepCount ?? 0} 個步驟
                </span>
                <span className="flex items-center gap-1">
                  <Users size={13} /> {s.activeEnrollments ?? 0} 位進行中
                </span>
              </div>
              <div className="mt-3 flex gap-2">
                <Link href={`/admin/newsletter/sequences/${s.id}`}>
                  <Button variant="outline" size="sm" data-testid={`button-sequence-flow-${s.id}`}>
                    <Workflow size={14} /> 流程編輯器
                  </Button>
                </Link>
                <Button
                  variant="ghost"
                  size="sm"
                  className="ml-auto text-red-600"
                  onClick={async () => {
                    if (!confirm(`確定刪除序列「${s.name}」？步驟與入列記錄會一併刪除。`)) return;
                    try {
                      await deleteSeq.mutateAsync({ id: s.id });
                      invalidate();
                      toast({ title: "已刪除序列" });
                    } catch (e) {
                      toast({ title: "刪除失敗", description: errMessage(e, ""), variant: "destructive" });
                    }
                  }}
                  data-testid={`button-sequence-delete-${s.id}`}
                >
                  <Trash2 size={14} />
                </Button>
              </div>
            </div>
          ))
        )}
      </div>

      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>建立自動序列</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>序列名稱</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="例如：新會員歡迎系列" data-testid="input-sequence-name" />
            </div>
            <div className="space-y-1.5">
              <Label>說明（選填）</Label>
              <Textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} data-testid="input-sequence-description" />
            </div>
            <div className="space-y-1.5">
              <Label>寄件人 Email（選填，預設 onboarding@resend.dev）</Label>
              <Input value={fromEmail} onChange={(e) => setFromEmail(e.target.value)} placeholder="newsletter@yourdomain.com" data-testid="input-sequence-from" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setFormOpen(false)}>取消</Button>
            <Button onClick={handleCreate} disabled={createSeq.isPending} data-testid="button-confirm-add-sequence">
              建立
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AdminLayout>
  );
}
