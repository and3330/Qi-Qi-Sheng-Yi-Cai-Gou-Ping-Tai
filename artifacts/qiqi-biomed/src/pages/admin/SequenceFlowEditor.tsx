import { useEffect, useState } from "react";
import { Link, useRoute } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetNewsletterSequence,
  getGetNewsletterSequenceQueryKey,
  getListNewsletterSequencesQueryKey,
  useCreateNewsletterSequenceStep,
  useUpdateNewsletterSequenceStep,
  useDeleteNewsletterSequenceStep,
  useUpdateNewsletterSequence,
  type NewsletterSequenceStep,
} from "@workspace/api-client-react";
import {
  ArrowLeft,
  Plus,
  Trash2,
  Pencil,
  GripVertical,
  Mail,
  Clock,
  UserPlus,
  Flag,
  Save,
} from "lucide-react";
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

function errMessage(e: unknown, fallback: string) {
  const anyE = e as any;
  return anyE?.data?.error || anyE?.message || fallback;
}

type LocalStep = {
  id: number;
  subject: string;
  htmlContent: string;
  delayDays: number;
};

export default function SequenceFlowEditor() {
  const [, params] = useRoute("/admin/newsletter/sequences/:id");
  const sequenceId = Number(params?.id);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: sequence, isLoading } = useGetNewsletterSequence(sequenceId, {
    query: {
      queryKey: getGetNewsletterSequenceQueryKey(sequenceId),
      enabled: Number.isInteger(sequenceId) && sequenceId > 0,
    },
  });

  const createStep = useCreateNewsletterSequenceStep();
  const updateStep = useUpdateNewsletterSequenceStep();
  const deleteStep = useDeleteNewsletterSequenceStep();
  const updateSeq = useUpdateNewsletterSequence();

  // 本地流程狀態（拖拉排序後按「儲存流程」寫回）
  const [steps, setSteps] = useState<LocalStep[]>([]);
  const [dirty, setDirty] = useState(false);
  useEffect(() => {
    if (sequence?.steps) {
      setSteps(
        sequence.steps.map((s: NewsletterSequenceStep) => ({
          id: s.id,
          subject: s.subject,
          htmlContent: s.htmlContent ?? "",
          delayDays: s.delayDays,
        })),
      );
      setDirty(false);
    }
  }, [sequence]);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: getGetNewsletterSequenceQueryKey(sequenceId) });
    queryClient.invalidateQueries({ queryKey: getListNewsletterSequencesQueryKey() });
  };

  /* 拖拉排序 */
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);
  const handleDrop = (target: number) => {
    if (dragIndex == null || dragIndex === target) {
      setDragIndex(null);
      setOverIndex(null);
      return;
    }
    setSteps((prev) => {
      const next = [...prev];
      const [moved] = next.splice(dragIndex, 1);
      next.splice(target, 0, moved);
      return next;
    });
    setDirty(true);
    setDragIndex(null);
    setOverIndex(null);
  };

  /* 步驟編輯 dialog */
  const [editOpen, setEditOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [subject, setSubject] = useState("");
  const [html, setHtml] = useState("");
  const [delayDays, setDelayDays] = useState(0);

  const openCreate = () => {
    setEditingId(null);
    setSubject("");
    setHtml("<p>您好，</p>");
    setDelayDays(steps.length === 0 ? 0 : 3);
    setEditOpen(true);
  };
  const openEdit = (s: LocalStep) => {
    setEditingId(s.id);
    setSubject(s.subject);
    setHtml(s.htmlContent);
    setDelayDays(s.delayDays);
    setEditOpen(true);
  };

  const handleSaveStep = async () => {
    if (!subject.trim()) {
      toast({ title: "請輸入郵件主旨", variant: "destructive" });
      return;
    }
    try {
      if (editingId != null) {
        await updateStep.mutateAsync({
          id: editingId,
          data: { subject: subject.trim(), htmlContent: html, delayDays },
        });
        toast({ title: "步驟已更新" });
      } else {
        await createStep.mutateAsync({
          id: sequenceId,
          data: {
            subject: subject.trim(),
            htmlContent: html,
            delayDays,
            stepOrder: steps.length + 1,
          },
        });
        toast({ title: "步驟已新增" });
      }
      setEditOpen(false);
      invalidate();
    } catch (e) {
      toast({ title: "儲存失敗", description: errMessage(e, ""), variant: "destructive" });
    }
  };

  /** 將目前排序寫回步驟 stepOrder，並把流程佈局存到 flowData */
  const handleSaveFlow = async () => {
    try {
      for (let i = 0; i < steps.length; i++) {
        await updateStep.mutateAsync({
          id: steps[i].id,
          data: { stepOrder: i + 1 },
        });
      }
      const flowData = {
        version: 1,
        nodes: [
          { id: "trigger", type: "trigger", position: { x: 0, y: 0 } },
          ...steps.map((s, i) => ({
            id: `step-${s.id}`,
            type: "email",
            stepId: s.id,
            position: { x: 0, y: (i + 1) * 140 },
            data: { subject: s.subject, delayDays: s.delayDays },
          })),
          { id: "end", type: "end", position: { x: 0, y: (steps.length + 1) * 140 } },
        ],
        edges: [
          ...(steps.length
            ? [{ id: "e-trigger", source: "trigger", target: `step-${steps[0].id}` }]
            : [{ id: "e-trigger-end", source: "trigger", target: "end" }]),
          ...steps.slice(0, -1).map((s, i) => ({
            id: `e-${s.id}`,
            source: `step-${s.id}`,
            target: `step-${steps[i + 1].id}`,
          })),
          ...(steps.length
            ? [{ id: "e-end", source: `step-${steps[steps.length - 1].id}`, target: "end" }]
            : []),
        ],
      };
      await updateSeq.mutateAsync({ id: sequenceId, data: { flowData } });
      setDirty(false);
      invalidate();
      toast({ title: "流程已儲存" });
    } catch (e) {
      toast({ title: "儲存失敗", description: errMessage(e, ""), variant: "destructive" });
    }
  };

  if (isLoading || !sequence) {
    return (
      <AdminLayout title="序列流程編輯器">
        <Skeleton className="h-40 w-full max-w-md" />
      </AdminLayout>
    );
  }

  let cumulativeDays = 0;

  return (
    <AdminLayout title={`序列流程 — ${sequence.name}`}>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Link href="/admin/newsletter/sequences">
          <Button variant="ghost" size="sm" data-testid="button-back-to-sequences">
            <ArrowLeft size={16} /> 返回序列列表
          </Button>
        </Link>
        {sequence.isActive ? (
          <Badge className="bg-green-100 text-green-700" variant="secondary">啟用中</Badge>
        ) : (
          <Badge className="bg-muted text-muted-foreground" variant="secondary">停用</Badge>
        )}
        <span className="text-xs text-muted-foreground">
          進行中 {sequence.activeEnrollments ?? 0} 人・已完成 {(sequence as any).completedEnrollments ?? 0} 人
        </span>
        <div className="ml-auto flex gap-2">
          <Button variant="outline" size="sm" onClick={openCreate} data-testid="button-add-step">
            <Plus size={16} /> 新增步驟
          </Button>
          <Button size="sm" onClick={handleSaveFlow} disabled={updateSeq.isPending || updateStep.isPending} data-testid="button-save-flow">
            <Save size={16} /> 儲存流程{dirty ? " *" : ""}
          </Button>
        </div>
      </div>

      <div className="mx-auto max-w-xl">
        {/* 觸發節點 */}
        <div className="rounded-xl border-2 border-dashed border-primary/40 bg-primary/5 p-4 text-center" data-testid="node-trigger">
          <p className="flex items-center justify-center gap-2 text-sm font-semibold text-primary">
            <UserPlus size={16} /> 觸發：新訂閱者加入
          </p>
          <p className="mt-1 text-xs text-muted-foreground">訂閱者建立時自動進入此序列</p>
        </div>

        {steps.map((s, i) => {
          cumulativeDays += s.delayDays;
          return (
            <div key={s.id}>
              {/* 連接線與延遲 */}
              <div className="flex flex-col items-center py-1">
                <div className="h-4 w-px bg-border" />
                <span className="flex items-center gap-1 rounded-full border bg-white px-3 py-1 text-xs text-muted-foreground">
                  <Clock size={12} />
                  {s.delayDays === 0 ? "立即" : `等待 ${s.delayDays} 天`}
                  <span className="text-muted-foreground/60">（第 {cumulativeDays} 天）</span>
                </span>
                <div className="h-4 w-px bg-border" />
              </div>
              {/* 步驟節點（可拖拉） */}
              <div
                draggable
                onDragStart={() => setDragIndex(i)}
                onDragOver={(e) => {
                  e.preventDefault();
                  setOverIndex(i);
                }}
                onDragLeave={() => setOverIndex((v) => (v === i ? null : v))}
                onDrop={() => handleDrop(i)}
                onDragEnd={() => {
                  setDragIndex(null);
                  setOverIndex(null);
                }}
                className={`group cursor-grab rounded-xl border bg-white p-4 shadow-sm transition-all active:cursor-grabbing ${
                  overIndex === i && dragIndex !== null && dragIndex !== i
                    ? "border-primary ring-2 ring-primary/30"
                    : ""
                } ${dragIndex === i ? "opacity-50" : ""}`}
                data-testid={`node-step-${s.id}`}
              >
                <div className="flex items-center gap-3">
                  <GripVertical size={16} className="shrink-0 text-muted-foreground/50" />
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <Mail size={16} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-xs text-muted-foreground">步驟 {i + 1}</p>
                    <p className="truncate text-sm font-medium">{s.subject}</p>
                  </div>
                  <div className="flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                    <Button variant="ghost" size="sm" onClick={() => openEdit(s)} data-testid={`button-edit-step-${s.id}`}>
                      <Pencil size={14} />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-red-600"
                      onClick={async () => {
                        if (!confirm(`確定刪除步驟「${s.subject}」？`)) return;
                        try {
                          await deleteStep.mutateAsync({ id: s.id });
                          invalidate();
                          toast({ title: "已刪除步驟" });
                        } catch (e) {
                          toast({ title: "刪除失敗", description: errMessage(e, ""), variant: "destructive" });
                        }
                      }}
                      data-testid={`button-delete-step-${s.id}`}
                    >
                      <Trash2 size={14} />
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          );
        })}

        {/* 結束節點 */}
        <div className="flex flex-col items-center py-1">
          <div className="h-6 w-px bg-border" />
        </div>
        <div className="rounded-xl border bg-muted/40 p-3 text-center" data-testid="node-end">
          <p className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
            <Flag size={14} /> 序列結束
          </p>
        </div>

        {!steps.length && (
          <p className="mt-4 text-center text-sm text-muted-foreground" data-testid="text-no-steps">
            尚無步驟。按「新增步驟」加入第一封郵件。
          </p>
        )}
        {steps.length > 1 && (
          <p className="mt-4 text-center text-xs text-muted-foreground">
            拖拉節點可調整順序，調整後記得按「儲存流程」。
          </p>
        )}
      </div>

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{editingId != null ? "編輯步驟" : "新增步驟"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid gap-3 md:grid-cols-2">
              <div className="space-y-1.5">
                <Label>郵件主旨</Label>
                <Input value={subject} onChange={(e) => setSubject(e.target.value)} data-testid="input-step-subject" />
              </div>
              <div className="space-y-1.5">
                <Label>延遲天數（距上一步）</Label>
                <Input
                  type="number"
                  min={0}
                  value={delayDays}
                  onChange={(e) => setDelayDays(Math.max(0, Math.floor(Number(e.target.value) || 0)))}
                  data-testid="input-step-delay"
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>HTML 內容</Label>
              <Textarea rows={10} className="font-mono text-xs" value={html} onChange={(e) => setHtml(e.target.value)} data-testid="textarea-step-html" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOpen(false)}>取消</Button>
            <Button onClick={handleSaveStep} disabled={createStep.isPending || updateStep.isPending} data-testid="button-save-step">
              儲存
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AdminLayout>
  );
}
