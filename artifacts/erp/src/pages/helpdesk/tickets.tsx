import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DocWindow, DocStatus, statusTone } from "@/components/shared/doc-window";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { Plus, Pencil, Trash2 } from "lucide-react";
import { useBatchSelection } from "@/hooks/use-batch-selection";
import { BatchActionBar, type BatchField } from "@/components/shared/batch-action-bar";
import { CheckboxCell, CheckboxHeader } from "@/components/shared/checkbox-column";

import { LookupSelect } from "@/components/shared/lookup-select";
const BASE = import.meta.env.BASE_URL.endsWith("/") ? import.meta.env.BASE_URL : import.meta.env.BASE_URL + "/";
const api = <T,>(path: string, opts?: RequestInit) =>
  fetch(`/erp-api${path}`, { headers: { "Content-Type": "application/json" }, ...opts })
    .then(r => { if (!r.ok) throw new Error("請求失敗"); return r.status === 204 ? (undefined as T) : r.json() as Promise<T>; });

interface Ticket {
  id: number; ticketNumber: string; subject: string; description: string | null;
  status: string; priority: string; categoryId: number | null; customerId: number | null;
  assignedTo: number | null; slaId: number | null;
  responseDeadline: string | null; resolutionDeadline: string | null;
  resolvedAt: string | null; closedAt: string | null; resolution: string | null;
  createdAt: string; categoryName: string | null; customerName: string | null; assigneeName: string | null;
}

interface Category { id: number; name: string; description: string | null; }
interface SlaDef { id: number; name: string; priority: string; responseTimeHours: number; resolutionTimeHours: number; }

const statuses = ["Open", "In Progress", "Waiting for Customer", "Resolved", "Closed"];
const priorities = ["Low", "Medium", "High", "Critical"];
const statusColors: Record<string, string> = {
  Open: "bg-blue-100 text-blue-800", "In Progress": "bg-yellow-100 text-yellow-800",
  "Waiting for Customer": "bg-purple-100 text-purple-800", Resolved: "bg-green-100 text-green-800",
  Closed: "bg-gray-100 text-gray-800",
};
const priorityColors: Record<string, string> = {
  Low: "bg-gray-100 text-gray-800", Medium: "bg-blue-100 text-blue-800",
  High: "bg-orange-100 text-orange-800", Critical: "bg-red-100 text-red-800",
};
const statusLabel: Record<string, string> = {
  Open: "開放", "In Progress": "處理中", "Waiting for Customer": "等待客戶",
  Resolved: "已解決", Closed: "已關閉",
};
const priorityLabel: Record<string, string> = { Low: "低", Medium: "中", High: "高", Critical: "緊急" };

export default function TicketsPage() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Ticket | null>(null);
  const [filterStatus, setFilterStatus] = useState("");
  const [form, setForm] = useState({ subject: "", description: "", priority: "Medium", categoryId: "", customerId: "", assignedTo: "", slaId: "", status: "Open", resolution: "" });

  const ticketBatchFields: BatchField[] = [{key:"status",label:"狀態",type:"select",options:[{value:"Open",label:"開啟"},{value:"In Progress",label:"處理中"},{value:"Resolved",label:"已解決"},{value:"Closed",label:"已關閉"}]},{key:"priority",label:"優先順序",type:"select",options:[{value:"Low",label:"低"},{value:"Medium",label:"中"},{value:"High",label:"高"},{value:"Critical",label:"緊急"}]}];

  const effectiveStatus = filterStatus === "all" ? "" : filterStatus;
  const { data: tickets = [] } = useQuery<Ticket[]>({ queryKey: ["support-tickets", effectiveStatus], queryFn: () => api(`/support-tickets${effectiveStatus ? `?status=${effectiveStatus}` : ""}`) });
  const { data: categories = [] } = useQuery<Category[]>({ queryKey: ["ticket-categories"], queryFn: () => api("/ticket-categories") });
  const { data: slas = [] } = useQuery<SlaDef[]>({ queryKey: ["sla-definitions"], queryFn: () => api("/sla-definitions") });
  const { data: customers = [] } = useQuery<any[]>({ queryKey: ["customers"], queryFn: () => api("/customers") });
  const { data: employees = [] } = useQuery<any[]>({ queryKey: ["employees"], queryFn: () => api("/employees") });

  const createMut = useMutation({
    mutationFn: (data: any) => api("/support-tickets", { method: "POST", body: JSON.stringify(data) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["support-tickets"] }); setOpen(false); toast({ title: "已建立工單" }); },
  });
  const updateMut = useMutation({
    mutationFn: ({ id, ...data }: any) => api(`/support-tickets/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["support-tickets"] }); setOpen(false); setEditing(null); toast({ title: "已更新" }); },
  });
  const deleteMut = useMutation({
    mutationFn: (id: number) => api(`/support-tickets/${id}`, { method: "DELETE" }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["support-tickets"] }); toast({ title: "已刪除" }); },
  });

  const openCreate = () => {
    setEditing(null);
    setForm({ subject: "", description: "", priority: "Medium", categoryId: "", customerId: "", assignedTo: "", slaId: "", status: "Open", resolution: "" });
    setOpen(true);
  };
  const openEdit = (t: Ticket) => {
    setEditing(t);
    setForm({ subject: t.subject, description: t.description || "", priority: t.priority, categoryId: t.categoryId ? String(t.categoryId) : "", customerId: t.customerId ? String(t.customerId) : "", assignedTo: t.assignedTo ? String(t.assignedTo) : "", slaId: t.slaId ? String(t.slaId) : "", status: t.status, resolution: t.resolution || "" });
    setOpen(true);
  };
  const batch = useBatchSelection(tickets);

  const handleSave = () => {
    const payload: any = { subject: form.subject, description: form.description || null, priority: form.priority, status: form.status, resolution: form.resolution || null };
    if (form.categoryId) payload.categoryId = Number(form.categoryId);
    if (form.customerId) payload.customerId = Number(form.customerId);
    if (form.assignedTo) payload.assignedTo = Number(form.assignedTo);
    if (form.slaId) payload.slaId = Number(form.slaId);
    if (editing) updateMut.mutate({ id: editing.id, ...payload });
    else createMut.mutate(payload);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">客訴工單</h1>
        <Button onClick={openCreate}><Plus className="w-4 h-4 mr-1" />新增工單</Button>
      </div>
      {batch.count > 0 && (
        <BatchActionBar
          count={batch.count}
          entityName="工單"
          entityEndpoint="support-tickets"
          ids={batch.ids}
          batchFields={ticketBatchFields}
          onClear={batch.clearSelection}
          onComplete={() => qc.invalidateQueries({ queryKey: ["support-tickets"] })}
        />
      )}
      <div className="flex gap-2">
        <Select value={filterStatus} onValueChange={setFilterStatus}>
          <SelectTrigger className="w-[180px]"><SelectValue placeholder="全部狀態" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部狀態</SelectItem>
            {statuses.map(s => <SelectItem key={s} value={s}>{statusLabel[s]}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      <Card>
        <CardContent className="p-0 overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10"><CheckboxHeader checked={batch.allSelected} indeterminate={batch.someSelected} onChange={batch.toggleAll} /></TableHead>
                <TableHead>工單編號</TableHead><TableHead>主題</TableHead><TableHead>客戶</TableHead>
                <TableHead>狀態</TableHead><TableHead>優先序</TableHead><TableHead>指派人員</TableHead>
                <TableHead>分類</TableHead><TableHead>建立時間</TableHead><TableHead className="w-20">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {tickets.length === 0 && <TableRow><TableCell colSpan={10} className="text-center text-muted-foreground py-8">尚無工單</TableCell></TableRow>}
              {tickets.map(t => (
                <TableRow key={t.id} className="cursor-pointer" onClick={e => { if ((e.target as HTMLElement).closest("button,select,input,a,label")) return; openEdit(t); }}>
                  <TableCell><CheckboxCell checked={batch.selectedIds.has(t.id)} onChange={() => batch.toggle(t.id)} /></TableCell>
                  <TableCell className="font-mono text-sm">{t.ticketNumber}</TableCell>
                  <TableCell>{t.subject}</TableCell>
                  <TableCell>{t.customerName || "-"}</TableCell>
                  <TableCell><Badge variant="secondary" className={statusColors[t.status]}>{statusLabel[t.status] || t.status}</Badge></TableCell>
                  <TableCell><Badge variant="secondary" className={priorityColors[t.priority]}>{priorityLabel[t.priority] || t.priority}</Badge></TableCell>
                  <TableCell>{t.assigneeName || "-"}</TableCell>
                  <TableCell>{t.categoryName || "-"}</TableCell>
                  <TableCell className="text-sm">{new Date(t.createdAt).toLocaleDateString("zh-TW")}</TableCell>
                  <TableCell>
                    <div className="flex gap-1">
                      <Button variant="ghost" size="icon" onClick={() => openEdit(t)}><Pencil className="w-4 h-4" /></Button>
                      <Button variant="ghost" size="icon" onClick={() => { if (confirm("確定刪除？")) deleteMut.mutate(t.id); }}><Trash2 className="w-4 h-4" /></Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      <DocWindow
        open={open}
        onClose={() => setOpen(false)}
        name={editing ? "客訴工單" : "新增工單"}
        number={editing?.ticketNumber}
        status={editing ? <DocStatus label={statusLabel[editing.status] || editing.status} tone={statusTone(editing.status)} /> : undefined}
        footer={<>
          <Button variant="outline" onClick={() => setOpen(false)}>取消</Button>
          <Button onClick={handleSave} disabled={!form.subject}>{editing ? "更新" : "建立"}</Button>
        </>}
      >
          <div className="grid gap-4">
            <div>
              <label className="text-sm font-medium">主題 *</label>
              <Input value={form.subject} onChange={e => setForm({ ...form, subject: e.target.value })} />
            </div>
            <div>
              <label className="text-sm font-medium">描述</label>
              <Textarea value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} rows={3} />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="text-sm font-medium">優先序</label>
                <Select value={form.priority} onValueChange={v => setForm({ ...form, priority: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{priorities.map(p => <SelectItem key={p} value={p}>{priorityLabel[p]}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              {editing && (
                <div>
                  <label className="text-sm font-medium">狀態</label>
                  <Select value={form.status} onValueChange={v => setForm({ ...form, status: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{statuses.map(s => <SelectItem key={s} value={s}>{statusLabel[s]}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
              )}
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="text-sm font-medium">客戶</label>
                <LookupSelect value={form.customerId} onValueChange={v => setForm({ ...form, customerId: v })}>
                  <SelectTrigger><SelectValue placeholder="選擇客戶" /></SelectTrigger>
                  <SelectContent>{customers.map((c: any) => <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>)}</SelectContent>
                </LookupSelect>
              </div>
              <div>
                <label className="text-sm font-medium">指派人員</label>
                <LookupSelect value={form.assignedTo} onValueChange={v => setForm({ ...form, assignedTo: v })}>
                  <SelectTrigger><SelectValue placeholder="選擇人員" /></SelectTrigger>
                  <SelectContent>{employees.map((e: any) => <SelectItem key={e.id} value={String(e.id)}>{e.firstName} {e.lastName}</SelectItem>)}</SelectContent>
                </LookupSelect>
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="text-sm font-medium">分類</label>
                <LookupSelect value={form.categoryId} onValueChange={v => setForm({ ...form, categoryId: v })}>
                  <SelectTrigger><SelectValue placeholder="選擇分類" /></SelectTrigger>
                  <SelectContent>{categories.map(c => <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>)}</SelectContent>
                </LookupSelect>
              </div>
              <div>
                <label className="text-sm font-medium">SLA 定義</label>
                <LookupSelect value={form.slaId} onValueChange={v => setForm({ ...form, slaId: v })}>
                  <SelectTrigger><SelectValue placeholder="選擇SLA" /></SelectTrigger>
                  <SelectContent>{slas.map(s => <SelectItem key={s.id} value={String(s.id)}>{s.name} ({s.responseTimeHours}h/{s.resolutionTimeHours}h)</SelectItem>)}</SelectContent>
                </LookupSelect>
              </div>
            </div>
            {editing && (
              <div>
                <label className="text-sm font-medium">解決方案</label>
                <Textarea value={form.resolution} onChange={e => setForm({ ...form, resolution: e.target.value })} rows={2} />
              </div>
            )}
          </div>
      </DocWindow>
    </div>
  );
}
