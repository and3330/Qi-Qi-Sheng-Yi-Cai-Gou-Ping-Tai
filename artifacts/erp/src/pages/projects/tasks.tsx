import { useMemo, useState } from "react";
import { selectableProjects, projectLabel, projectPickerLabel } from "@/lib/select-options";
import { useListTasks, useCreateTask, useUpdateTask, useDeleteTask, useListProjects } from "@workspace/erp-api-client-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { DataTable } from "@/components/shared/data-table";
import { PageHeader } from "@/components/shared/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DocWindow, DocStatus, statusTone } from "@/components/shared/doc-window";
import { useToast } from "@/hooks/use-toast";
import { Plus, Pencil, Trash2, Search } from "lucide-react";
import { useBatchSelection } from "@/hooks/use-batch-selection";
import { BatchActionBar, type BatchField } from "@/components/shared/batch-action-bar";
import { CheckboxCell, CheckboxHeader } from "@/components/shared/checkbox-column";

/**
 * 任務管理：每一列可以點開編輯；勾選多筆後可以一次改任何欄位
 * （狀態、優先級、所屬專案、負責人、到期日），或一次放進同一個「組別」。
 */
const statusMap: Record<string, string> = { Open: "待辦", Working: "進行中", Completed: "已完成", Cancelled: "已取消" };
const priorityMap: Record<string, string> = { Low: "低", Medium: "中", High: "高" };
const statusOptions = ["Open", "Working", "Completed", "Cancelled"];
const priorityOptions = ["Low", "Medium", "High"];
const NO_GROUP = "__nogroup__";
const selectClass = "flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm";

type TaskForm = {
  subject: string; projectId: string; assignedTo: string; taskGroup: string; status: string; priority: string;
  dueDate: string; description: string;
};
const emptyForm: TaskForm = { subject: "", projectId: "", assignedTo: "", taskGroup: "", status: "Open", priority: "Medium", dueDate: "", description: "" };

export default function TasksPage() {
  const { data: tasks, isLoading } = useListTasks();
  const { data: projects } = useListProjects();
  const { data: employees } = useQuery<any[]>({
    queryKey: ["/erp-api/employees", "task-assignees"],
    queryFn: async () => { const r = await fetch("/erp-api/employees"); return r.ok ? r.json() : []; },
  });
  const queryClient = useQueryClient();
  const createMut = useCreateTask();
  const updateMut = useUpdateTask();
  const deleteMut = useDeleteTask();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [form, setForm] = useState<TaskForm>(emptyForm);
  const [search, setSearch] = useState("");
  const [groupFilter, setGroupFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [projectFilter, setProjectFilter] = useState("");

  const all = (tasks || []) as any[];
  const groups = useMemo(() => Array.from(new Set(all.map(t => t.taskGroup).filter(Boolean))).sort((a, b) => String(a).localeCompare(String(b), "zh-Hant")) as string[], [all]);
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return all.filter(t => {
      if (groupFilter === NO_GROUP ? !!t.taskGroup : groupFilter && t.taskGroup !== groupFilter) return false;
      if (statusFilter && t.status !== statusFilter) return false;
      if (projectFilter && String(t.projectId || "") !== projectFilter) return false;
      if (q && !`${t.title || ""} ${t.projectName || ""} ${t.assigneeName || ""} ${t.taskGroup || ""}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [all, search, groupFilter, statusFilter, projectFilter]);
  // 全選只選目前篩選出來的
  const batch = useBatchSelection(filtered);
  const activeEmployees = (employees || []).filter((e: any) => !e.status || e.status === "Active" || e.status === "在職");
  const usedProjects = useMemo(() => (projects || []).filter((p: any) => all.some(t => t.projectId === p.id)), [projects, all]);

  const openCreate = () => { setEditing(null); setForm({ ...emptyForm, taskGroup: groupFilter && groupFilter !== NO_GROUP ? groupFilter : "", projectId: projectFilter }); setOpen(true); };
  const openEdit = (t: any) => {
    setEditing(t);
    setForm({
      subject: t.title || "", projectId: String(t.projectId || ""), assignedTo: String(t.assignedTo || ""), taskGroup: t.taskGroup || "",
      status: t.status || "Open", priority: t.priority || "Medium",
      dueDate: t.dueDate || "",
      description: t.description || "",
    });
    setOpen(true);
  };
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["/erp-api/tasks"] });

  const handleSave = async () => {
    if (!form.subject) { toast({ title: "請填寫任務主題", variant: "destructive" }); return; }
    const payload: any = {
      title: form.subject, description: form.description || undefined,
      status: form.status, priority: form.priority,
      projectId: form.projectId ? Number(form.projectId) : null,
      assignedTo: form.assignedTo ? Number(form.assignedTo) : null,
      dueDate: form.dueDate || null,
      taskGroup: form.taskGroup.trim() || null,
    };
    try {
      if (editing) {
        await updateMut.mutateAsync({ id: editing.id, data: payload });
        toast({ title: "任務已更新" });
      } else {
        await createMut.mutateAsync({ data: payload });
        toast({ title: "任務已建立" });
      }
      setOpen(false);
      refresh();
    } catch (err: any) {
      toast({ title: "操作失敗", description: err.message, variant: "destructive" });
    }
  };

  const handleDelete = async (t: any) => {
    if (!confirm(`確定刪除任務「${t.title}」？`)) return;
    try {
      await deleteMut.mutateAsync({ id: t.id });
      toast({ title: "任務已刪除" });
      refresh();
    } catch (err: any) {
      toast({ title: "刪除失敗", description: err.message, variant: "destructive" });
    }
  };

  const F = (key: keyof TaskForm) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setForm(p => ({ ...p, [key]: e.target.value }));

  const batchFields: BatchField[] = [
    { key: "taskGroup", label: "組別（放進同一組）", type: "text", suggestions: groups, clearable: true },
    { key: "status", label: "狀態", type: "select", options: statusOptions.map(s => ({ value: s, label: statusMap[s] })) },
    { key: "priority", label: "優先級", type: "select", options: priorityOptions.map(s => ({ value: s, label: priorityMap[s] })) },
    { key: "projectId", label: "所屬專案", type: "select", options: [{ value: "__none__", label: "（不屬於任何專案）" }, ...selectableProjects(projects).map((p: any) => ({ value: String(p.id), label: projectLabel(p) }))] },
    { key: "assignedTo", label: "負責人", type: "select", options: [{ value: "__none__", label: "（不指定）" }, ...activeEmployees.map((e: any) => ({ value: String(e.id), label: e.fullName || e.name }))] },
    { key: "dueDate", label: "到期日", type: "date", clearable: true },
  ];

  const chip = (active: boolean) => `shrink-0 rounded-full border px-3 py-1.5 text-sm transition-colors ${active ? "border-primary bg-primary text-primary-foreground" : "bg-background hover:bg-muted"}`;

  return (
    <div className="space-y-4">
      <PageHeader title="任務管理" description="追蹤所有專案任務；勾選多筆可以一次修改，或放進同一個組別">
        <Button onClick={openCreate}><Plus size={16} className="mr-1" />新增任務</Button>
      </PageHeader>

      <div className="flex flex-col gap-2 md:flex-row md:items-center">
        <div className="relative md:w-72">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input className="pl-9" placeholder="搜尋主題、專案、負責人、組別" value={search} onChange={e => setSearch(e.target.value)} aria-label="搜尋任務" />
        </div>
        <select className={`${selectClass} md:w-40`} value={statusFilter} onChange={e => setStatusFilter(e.target.value)} aria-label="狀態">
          <option value="">全部狀態</option>
          {statusOptions.map(s => <option key={s} value={s}>{statusMap[s]}</option>)}
        </select>
        <select className={`${selectClass} md:w-56`} value={projectFilter} onChange={e => setProjectFilter(e.target.value)} aria-label="專案">
          <option value="">全部專案</option>
          {usedProjects.map((p: any) => <option key={p.id} value={p.id}>{projectLabel(p)}</option>)}
        </select>
        <span className="text-sm text-muted-foreground md:ml-auto">共 {filtered.length} 筆</span>
      </div>

      {(groups.length > 0) && (
        <div className="flex gap-2 overflow-x-auto pb-1" role="tablist" aria-label="組別">
          <button type="button" className={chip(groupFilter === "")} onClick={() => setGroupFilter("")}>全部組別</button>
          {groups.map(g => (
            <button type="button" key={g} className={chip(groupFilter === g)} onClick={() => setGroupFilter(g)} data-testid={`task-group-${g}`}>
              {g}（{all.filter(t => t.taskGroup === g).length}）
            </button>
          ))}
          <button type="button" className={chip(groupFilter === NO_GROUP)} onClick={() => setGroupFilter(NO_GROUP)}>未分組（{all.filter(t => !t.taskGroup).length}）</button>
        </div>
      )}

      {batch.count > 0 && (
        <BatchActionBar
          count={batch.count}
          entityName="任務"
          entityEndpoint="tasks"
          ids={batch.ids}
          batchFields={batchFields}
          onClear={batch.clearSelection}
          onComplete={refresh}
        />
      )}
      <Card>
        <CardContent className="p-0 overflow-x-auto">
          <DataTable
            isLoading={isLoading}
            data={filtered}
            onRowClick={openEdit}
            emptyMessage={all.length === 0 ? "還沒有任務，按右上角「新增任務」建立第一筆" : "沒有符合條件的任務"}
            columns={[
              { header: () => <CheckboxHeader checked={batch.allSelected} indeterminate={batch.someSelected} onChange={batch.toggleAll} />, accessor: (r: any) => <span onClick={e => e.stopPropagation()}><CheckboxCell checked={batch.selectedIds.has(r.id)} onChange={() => batch.toggle(r.id)} /></span>, className: "w-10" },
              { header: "主題", accessor: (r: any) => r.title || "-" },
              { header: "組別", accessor: (r: any) => r.taskGroup ? <Badge variant="outline">{r.taskGroup}</Badge> : <span className="text-muted-foreground">-</span> },
              { header: "所屬專案", accessor: (r: any) => r.projectName || "-", className: "hidden sm:table-cell" },
              { header: "負責人", accessor: (r: any) => r.assigneeName || "-", className: "hidden md:table-cell" },
              {
                header: "狀態",
                accessor: (r: any) => (
                  <Badge variant={r.status === "Completed" ? "default" : r.status === "Cancelled" ? "destructive" : "secondary"}>
                    {statusMap[r.status] || r.status}
                  </Badge>
                ),
              },
              { header: "優先級", accessor: (r: any) => <Badge variant="outline">{priorityMap[r.priority || "Medium"] || r.priority}</Badge>, className: "hidden md:table-cell" },
              { header: "到期日", accessor: (r: any) => r.dueDate || "-" },
              {
                header: "操作",
                accessor: (r: any) => (
                  <div className="flex gap-1" onClick={e => e.stopPropagation()}>
                    <Button variant="ghost" size="icon" onClick={() => openEdit(r)} aria-label="編輯任務"><Pencil size={14} /></Button>
                    <Button variant="ghost" size="icon" onClick={() => handleDelete(r)} aria-label="刪除任務"><Trash2 size={14} className="text-destructive" /></Button>
                  </div>
                ),
                className: "w-20",
              },
            ]}
          />
        </CardContent>
      </Card>

      <DocWindow
        open={open}
        onClose={() => setOpen(false)}
        name={editing ? "任務" : "新增任務"}
        status={editing ? <DocStatus label={statusMap[editing.status] || editing.status} tone={statusTone(editing.status)} /> : undefined}
        footer={<>
          <Button variant="outline" onClick={() => setOpen(false)}>取消</Button>
          <Button onClick={handleSave} disabled={createMut.isPending || updateMut.isPending}>
            {createMut.isPending || updateMut.isPending ? "處理中..." : editing ? "更新" : "建立"}
          </Button>
        </>}
      >
          <div className="grid gap-4">
            <div><Label>任務主題 *</Label><Input value={form.subject} onChange={F("subject")} /></div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div><Label>所屬專案</Label>
                <select className={selectClass} value={form.projectId} onChange={F("projectId")}>
                  <option value="">無</option>
                  {selectableProjects(projects, form.projectId).map((p: any) => <option key={p.id} value={p.id}>{projectPickerLabel(p)}</option>)}
                </select>
              </div>
              <div><Label>組別</Label>
                <Input value={form.taskGroup} onChange={F("taskGroup")} list="task-group-list" placeholder="例：開課前準備" />
                <datalist id="task-group-list">{groups.map(g => <option key={g} value={g} />)}</datalist>
              </div>
            </div>
            <div><Label>負責人</Label>
              <select className={selectClass} value={form.assignedTo} onChange={F("assignedTo")}>
                <option value="">不指定</option>
                {(employees || []).filter((e: any) => activeEmployees.includes(e) || String(e.id) === form.assignedTo).map((e: any) => <option key={e.id} value={e.id}>{e.fullName || e.name}</option>)}
              </select>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div><Label>狀態</Label>
                <select className={selectClass} value={form.status} onChange={F("status")}>
                  {statusOptions.map(s => <option key={s} value={s}>{statusMap[s]}</option>)}
                </select>
              </div>
              <div><Label>優先級</Label>
                <select className={selectClass} value={form.priority} onChange={F("priority")}>
                  {priorityOptions.map(s => <option key={s} value={s}>{priorityMap[s]}</option>)}
                </select>
              </div>
              <div><Label>到期日</Label><Input type="date" value={form.dueDate} onChange={F("dueDate")} /></div>
            </div>
            <div><Label>說明</Label><textarea className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm min-h-[60px]" value={form.description} onChange={F("description")} /></div>
          </div>
      </DocWindow>
    </div>
  );
}
