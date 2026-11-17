import { useEffect, useState } from "react";
import { useListProjects, useCreateProject, useUpdateProject, useDeleteProject } from "@workspace/erp-api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { DataTable } from "@/components/shared/data-table";
import { PageHeader } from "@/components/shared/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { Plus, Pencil, Trash2, Power, TrendingUp, ChevronRight, ChevronDown, FolderPlus } from "lucide-react";
import { useLocation } from "wouter";
import { useAuth } from "@/contexts/auth-context";
import { FINANCE_ROLES } from "@/lib/roles";
import { useBatchSelection } from "@/hooks/use-batch-selection";
import { BatchActionBar, type BatchField } from "@/components/shared/batch-action-bar";
import { CheckboxCell, CheckboxHeader } from "@/components/shared/checkbox-column";

import { LookupSelect } from "@/components/shared/lookup-select";
const statusMap: Record<string, string> = { Open: "進行中", Completed: "已完成", Cancelled: "已取消" };
const priorityMap: Record<string, string> = { Low: "低", Medium: "中", High: "高" };
const statusOptions = ["Open", "Completed", "Cancelled"];
const priorityOptions = ["Low", "Medium", "High"];

type ProjForm = {
  name: string; status: string; priority: string; progress: string;
  startDate: string; endDate: string; description: string; departmentId: string; parentId: string;
};
const emptyForm: ProjForm = { name: "", status: "Open", priority: "Medium", progress: "0", startDate: new Date().toISOString().slice(0, 10), endDate: "", description: "", departmentId: "", parentId: "" };

export default function ProjectsPage() {
  const [, navigate] = useLocation();
  const canSeeFinancials = useAuth().hasRole(...FINANCE_ROLES);
  const { data: projects, isLoading } = useListProjects();
  const queryClient = useQueryClient();
  const createMut = useCreateProject();
  const updateMut = useUpdateProject();
  const deleteMut = useDeleteProject();
  const { toast } = useToast();
  const [showInactive, setShowInactive] = useState(false);
  // 主、子專案：主專案底下的子專案預設收起來，點箭頭才展開（例如「夏令營」底下每年一個子專案）
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const toggleExpand = (id: number) => setExpanded(prev => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  const shown = (projects || []).filter((p: any) => showInactive || p.isActive !== false);
  const shownIds = new Set(shown.map((p: any) => p.id));
  const childrenOf = (id: number) => shown.filter((p: any) => p.parentId === id).sort((a: any, b: any) => String(a.name).localeCompare(String(b.name), "zh-Hant"));
  // 主專案被隱藏（停用）時，子專案當成一般專案列出來，不會跟著不見
  // 有子專案的主專案排在最前面，其餘照名稱排
  const topLevel = shown.filter((p: any) => !p.parentId || !shownIds.has(p.parentId))
    .sort((a: any, b: any) => (childrenOf(b.id).length > 0 ? 1 : 0) - (childrenOf(a.id).length > 0 ? 1 : 0) || String(a.name).localeCompare(String(b.name), "zh-Hant"));
  const visibleProjects = topLevel.flatMap((p: any) => {
    const kids = childrenOf(p.id);
    return [{ ...p, childCount: kids.length }, ...(expanded.has(p.id) ? kids.map((k: any) => ({ ...k, isChild: true })) : [])];
  });
  const parentChoices = (projects || []).filter((p: any) => !p.parentId && p.isActive !== false);
  const batch = useBatchSelection(visibleProjects);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [form, setForm] = useState<ProjForm>(emptyForm);
  const [departments, setDepartments] = useState<any[]>([]);

  useEffect(() => {
    const base = import.meta.env.BASE_URL.endsWith("/") ? import.meta.env.BASE_URL : `${import.meta.env.BASE_URL}/`;
    fetch(`/erp-api/departments`, { credentials: "include" })
      .then(response => response.ok ? response.json() : [])
      .then(rows => setDepartments(rows.filter((row: any) => row.isActive !== false)))
      .catch(() => setDepartments([]));
  }, []);

  const openCreate = (parent?: any) => {
    setEditing(null);
    setForm({ ...emptyForm, ...(parent ? { parentId: String(parent.id), departmentId: parent.departmentId ? String(parent.departmentId) : "" } : {}) });
    if (parent) setExpanded(prev => new Set(prev).add(parent.id));
    setOpen(true);
  };
  const openEdit = (p: any) => {
    setEditing(p);
    setForm({
      name: p.name || "", status: p.status || "Open", priority: p.priority || "Medium",
      progress: String(p.progress || 0), startDate: p.startDate || "", endDate: p.endDate || "",
      description: p.description || "", departmentId: p.departmentId ? String(p.departmentId) : "", parentId: p.parentId ? String(p.parentId) : "",
    });
    setOpen(true);
  };

  const handleSave = async () => {
    if (!form.name) { toast({ title: "請填寫專案名稱", variant: "destructive" }); return; }
    const payload = { ...form, progress: Number(form.progress), departmentId: form.departmentId ? Number(form.departmentId) : null, parentId: form.parentId ? Number(form.parentId) : null };
    try {
      if (editing) {
        await updateMut.mutateAsync({ id: editing.id, data: payload as any });
        toast({ title: "專案已更新" });
      } else {
        await createMut.mutateAsync({ data: payload as any });
        toast({ title: "專案已建立" });
      }
      setOpen(false);
    } catch (err: any) {
      toast({ title: "操作失敗", description: err.message, variant: "destructive" });
    }
  };

  const handleDelete = async (p: any) => {
    if (!confirm(`確定刪除專案「${p.name}」？`)) return;
    try {
      await deleteMut.mutateAsync({ id: p.id });
      toast({ title: "專案已刪除" });
    } catch (err: any) {
      toast({ title: "刪除失敗", description: err.message, variant: "destructive" });
    }
  };

  const toggleActive = async (p: any) => {
    try {
      await updateMut.mutateAsync({ id: p.id, data: { isActive: !(p.isActive !== false) } as any });
      toast({ title: p.isActive !== false ? `${p.name} 已停用` : `${p.name} 已啟用`, description: "歷史資料仍會出現在會計報表中" });
    } catch (err: any) {
      toast({ title: "操作失敗", description: err.message, variant: "destructive" });
    }
  };

  const F = (key: keyof ProjForm) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setForm(p => ({ ...p, [key]: e.target.value }));

  return (
    <div className="space-y-6">
      <PageHeader title="專案管理" description="管理所有專案">
        <label className="flex items-center gap-1.5 text-sm cursor-pointer select-none mr-2">
          <input type="checkbox" className="h-4 w-4 accent-primary" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} />
          顯示已停用
        </label>
        <Button onClick={() => openCreate()}><Plus size={16} className="mr-1" />新增專案</Button>
      </PageHeader>
      {batch.count > 0 && (
        <BatchActionBar
          count={batch.count}
          entityName="專案"
          entityEndpoint="projects"
          ids={batch.ids}
          batchFields={[
            {key:"status",label:"狀態",type:"select",options:[{value:"Open",label:"進行中"},{value:"Completed",label:"已完成"},{value:"Cancelled",label:"已取消"}]},
            {key:"departmentId",label:"所屬部門",type:"select",clearable:true,options:departments.map((d: any) => ({ value: String(d.id), label: d.name }))},
            // 移動專案：掛到某個主專案底下；清空＝變回獨立的主專案
            {key:"parentId",label:"主專案（移動專案）",type:"select",clearable:true,options:parentChoices.filter((p: any) => !batch.ids.includes(p.id)).map((p: any) => ({ value: String(p.id), label: p.name }))},
          ] as BatchField[]}
          onClear={batch.clearSelection}
          onComplete={() => queryClient.invalidateQueries({ queryKey: ["/erp-api/projects"] })}
        />
      )}
      <Card>
        <CardContent className="p-0 overflow-x-auto">
          <DataTable
            isLoading={isLoading}
            data={visibleProjects}
            columns={[
              { header: () => <CheckboxHeader checked={batch.allSelected} indeterminate={batch.someSelected} onChange={batch.toggleAll} />, accessor: (r: any) => <CheckboxCell checked={batch.selectedIds.has(r.id)} onChange={() => batch.toggle(r.id)} />, className: "w-10" },
              { header: "專案名稱", accessor: (r: any) => (
                <span className={`inline-flex items-center gap-2 ${r.isChild ? "pl-7" : ""}`}>
                  {r.childCount > 0 ? (
                    <button type="button" className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded hover:bg-accent" aria-label={expanded.has(r.id) ? "收起子專案" : "展開子專案"} aria-expanded={expanded.has(r.id)} onClick={(e) => { e.stopPropagation(); toggleExpand(r.id); }} data-testid={`button-expand-project-${r.id}`}>
                      {expanded.has(r.id) ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                    </button>
                  ) : r.isChild ? <span className="text-muted-foreground">└</span> : <span className="inline-block w-7" />}
                  <span className={r.isActive === false ? "text-gray-400 line-through" : r.childCount > 0 ? "font-medium" : ""}>{r.name}</span>
                  {r.childCount > 0 && <Badge variant="outline" className="text-[10px]">{r.childCount} 個子專案</Badge>}
                  {r.isActive === false && <Badge variant="secondary" className="text-[10px]">已停用</Badge>}
                </span>
              ) },
              { header: "所屬部門", accessor: (r: any) => r.departmentName || "未分配", className: "hidden md:table-cell" },
              {
                header: "狀態",
                accessor: (r) => (
                  <Badge variant={r.status === "Completed" ? "default" : r.status === "Cancelled" ? "destructive" : "secondary"}>
                    {statusMap[r.status] || r.status}
                  </Badge>
                ),
              },
              { header: "優先級", accessor: (r) => <Badge variant="outline">{priorityMap[r.priority || "Medium"] || r.priority}</Badge>, className: "hidden sm:table-cell" },
              {
                header: "進度",
                accessor: (r) => (
                  <div className="flex items-center gap-2">
                    <div className="w-24 h-2 bg-muted rounded-full overflow-hidden hidden sm:block">
                      <div className="h-full bg-primary rounded-full transition-all" style={{ width: `${r.progress || 0}%` }} />
                    </div>
                    <span className="text-xs text-muted-foreground">{r.progress || 0}%</span>
                  </div>
                ),
              },
              { header: "開始日期", accessor: (r) => r.startDate || "-", className: "hidden lg:table-cell" },
              { header: "結束日期", accessor: (r) => r.endDate || "-", className: "hidden lg:table-cell" },
              {
                header: "操作",
                accessor: (r) => (
                  <div className="flex gap-1">
                    <Button variant="ghost" size="icon" title={r.isActive === false ? "啟用" : "停用"} onClick={() => toggleActive(r)}>
                      <Power size={14} className={r.isActive === false ? "text-gray-400" : "text-emerald-600"} />
                    </Button>
                    {canSeeFinancials && (
                      <Button variant="ghost" size="icon" title="專案損益" onClick={() => navigate(`/projects/financials?id=${r.id}`)}><TrendingUp size={14} /></Button>
                    )}
                    {!r.parentId && r.isActive !== false && <Button variant="ghost" size="icon" title="新增子專案" aria-label="新增子專案" onClick={() => openCreate(r)}><FolderPlus size={14} /></Button>}
                    <Button variant="ghost" size="icon" onClick={() => openEdit(r)}><Pencil size={14} /></Button>
                    <Button variant="ghost" size="icon" onClick={() => handleDelete(r)}><Trash2 size={14} className="text-destructive" /></Button>
                  </div>
                ),
                className: "w-44",
              },
            ]}
          />
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="md:max-w-lg max-h-[90dvh] overflow-y-auto">
          <DialogHeader><DialogTitle>{editing ? "編輯專案" : "新增專案"}</DialogTitle></DialogHeader>
          <div className="grid gap-4 py-2">
            <div><Label>專案名稱 *</Label><Input value={form.name} onChange={F("name")} placeholder={form.parentId ? "例如：2027 夏令營" : ""} /></div>
            <div><Label>主專案</Label>
              <select className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" value={form.parentId} onChange={F("parentId")} data-testid="select-parent-project" disabled={!!editing && (projects || []).some((p: any) => p.parentId === editing.id)}>
                <option value="">（沒有，這是獨立專案或主專案）</option>
                {parentChoices.filter((p: any) => !editing || p.id !== editing.id).map((p: any) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
              <p className="mt-1 text-xs text-muted-foreground">{!!editing && (projects || []).some((p: any) => p.parentId === editing.id) ? "這個專案底下已經有子專案，所以不能再掛到別的主專案底下。" : "每年都會辦的活動，可以建一個主專案（例如「夏令營」），每年各建一個子專案掛在它底下。主專案的損益會自動加總所有子專案。"}</p>
            </div>
            <div><Label>所屬部門</Label>
              <LookupSelect className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" value={form.departmentId} onChange={F("departmentId")}>
                <option value="">未分配</option>
                {departments.map((department: any) => <option key={department.id} value={department.id}>{department.name}</option>)}
              </LookupSelect>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div><Label>狀態</Label>
                <select className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" value={form.status} onChange={F("status")}>
                  {statusOptions.map(s => <option key={s} value={s}>{statusMap[s]}</option>)}
                </select>
              </div>
              <div><Label>優先級</Label>
                <select className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" value={form.priority} onChange={F("priority")}>
                  {priorityOptions.map(s => <option key={s} value={s}>{priorityMap[s]}</option>)}
                </select>
              </div>
              <div><Label>進度 (%)</Label><Input type="number" min={0} max={100} value={form.progress} onChange={F("progress")} /></div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div><Label>開始日期</Label><Input type="date" value={form.startDate} onChange={F("startDate")} /></div>
              <div><Label>結束日期</Label><Input type="date" value={form.endDate} onChange={F("endDate")} /></div>
            </div>
            <div><Label>說明</Label><textarea className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm min-h-[60px]" value={form.description} onChange={F("description")} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>取消</Button>
            <Button onClick={handleSave} disabled={createMut.isPending || updateMut.isPending}>
              {createMut.isPending || updateMut.isPending ? "處理中..." : editing ? "更新" : "建立"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
