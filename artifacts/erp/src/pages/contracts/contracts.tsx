import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DocWindow, DocStatus, statusTone } from "@/components/shared/doc-window";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { Plus, Pencil, Trash2, AlertTriangle } from "lucide-react";
import { AttachmentsPanel } from "@/components/shared/attachments-panel";
import { useBatchSelection } from "@/hooks/use-batch-selection";
import { BatchActionBar, type BatchField } from "@/components/shared/batch-action-bar";
import { CheckboxCell, CheckboxHeader } from "@/components/shared/checkbox-column";

import { LookupSelect } from "@/components/shared/lookup-select";
const BASE = import.meta.env.BASE_URL.endsWith("/") ? import.meta.env.BASE_URL : import.meta.env.BASE_URL + "/";
const api = <T,>(path: string, opts?: RequestInit) =>
  fetch(`/erp-api${path}`, { headers: { "Content-Type": "application/json" }, ...opts })
    .then(r => { if (!r.ok) throw new Error("請求失敗"); return r.status === 204 ? (undefined as T) : r.json() as Promise<T>; });

interface Contract {
  id: number; contractNumber: string; title: string; partyType: string;
  customerId: number | null; supplierId: number | null; status: string;
  startDate: string | null; endDate: string | null; contractValue: string | null;
  terms: string | null; description: string | null; renewalDate: string | null;
  autoRenew: string | null; contactPerson: string | null; createdAt: string;
  customerName: string | null; supplierName: string | null;
}

const statuses = ["Draft", "Active", "Expired", "Renewed", "Cancelled"];
const statusLabel: Record<string, string> = { Draft: "草稿", Active: "有效", Expired: "已到期", Renewed: "已續約", Cancelled: "已取消" };
const statusColors: Record<string, string> = {
  Draft: "bg-gray-100 text-gray-800", Active: "bg-green-100 text-green-800",
  Expired: "bg-red-100 text-red-800", Renewed: "bg-blue-100 text-blue-800",
  Cancelled: "bg-yellow-100 text-yellow-800",
};

export default function ContractsPage() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [tab, setTab] = useState("list");
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Contract | null>(null);
  const [filterStatus, setFilterStatus] = useState("");
  const [form, setForm] = useState({
    title: "", partyType: "Customer", customerId: "", supplierId: "", status: "Draft",
    startDate: "", endDate: "", contractValue: "", terms: "", description: "",
    renewalDate: "", autoRenew: "No", contactPerson: "",
  });

  const effectiveStatus = filterStatus === "all" ? "" : filterStatus;
  const { data: contracts = [] } = useQuery<Contract[]>({ queryKey: ["contracts", effectiveStatus], queryFn: () => api(`/contracts${effectiveStatus ? `?status=${effectiveStatus}` : ""}`) });
  const batch = useBatchSelection(contracts);
  const { data: renewalAlerts = [] } = useQuery<Contract[]>({ queryKey: ["contracts-renewal"], queryFn: () => api("/contracts/renewal-alerts") });
  const { data: customers = [] } = useQuery<any[]>({ queryKey: ["customers"], queryFn: () => api("/customers") });
  const { data: suppliers = [] } = useQuery<any[]>({ queryKey: ["suppliers"], queryFn: () => api("/suppliers") });

  const createMut = useMutation({
    mutationFn: (data: any) => api("/contracts", { method: "POST", body: JSON.stringify(data) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["contracts"] }); setOpen(false); toast({ title: "已建立合約" }); },
  });
  const updateMut = useMutation({
    mutationFn: ({ id, ...data }: any) => api(`/contracts/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["contracts"] }); qc.invalidateQueries({ queryKey: ["contracts-renewal"] }); setOpen(false); setEditing(null); toast({ title: "已更新" }); },
  });
  const deleteMut = useMutation({
    mutationFn: (id: number) => api(`/contracts/${id}`, { method: "DELETE" }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["contracts"] }); toast({ title: "已刪除" }); },
  });

  const openCreate = () => {
    setEditing(null);
    setForm({ title: "", partyType: "Customer", customerId: "", supplierId: "", status: "Draft", startDate: "", endDate: "", contractValue: "", terms: "", description: "", renewalDate: "", autoRenew: "No", contactPerson: "" });
    setOpen(true);
  };
  const openEdit = (c: Contract) => {
    setEditing(c);
    setForm({
      title: c.title, partyType: c.partyType, customerId: c.customerId ? String(c.customerId) : "",
      supplierId: c.supplierId ? String(c.supplierId) : "", status: c.status,
      startDate: c.startDate || "", endDate: c.endDate || "", contractValue: c.contractValue || "",
      terms: c.terms || "", description: c.description || "", renewalDate: c.renewalDate || "",
      autoRenew: c.autoRenew || "No", contactPerson: c.contactPerson || "",
    });
    setOpen(true);
  };
  const handleSave = () => {
    const payload: any = {
      title: form.title, partyType: form.partyType, status: form.status,
      startDate: form.startDate || null, endDate: form.endDate || null,
      contractValue: form.contractValue || null, terms: form.terms || null,
      description: form.description || null, renewalDate: form.renewalDate || null,
      autoRenew: form.autoRenew, contactPerson: form.contactPerson || null,
    };
    if (form.partyType === "Customer" && form.customerId) payload.customerId = Number(form.customerId);
    if (form.partyType === "Supplier" && form.supplierId) payload.supplierId = Number(form.supplierId);
    if (editing) updateMut.mutate({ id: editing.id, ...payload });
    else createMut.mutate(payload);
  };

  const daysUntil = (dateStr: string | null) => {
    if (!dateStr) return null;
    const diff = Math.ceil((new Date(dateStr).getTime() - Date.now()) / 86400000);
    return diff;
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">合約管理</h1>
        <Button onClick={openCreate}><Plus className="w-4 h-4 mr-1" />新增合約</Button>
      </div>
      {batch.count > 0 && (
        <BatchActionBar
          count={batch.count}
          entityName="合約"
          entityEndpoint="contracts"
          ids={batch.ids}
          batchFields={[{key:"status",label:"狀態",type:"select",options:[{value:"Draft",label:"草稿"},{value:"Active",label:"生效"},{value:"Expired",label:"已到期"},{value:"Terminated",label:"已終止"}]} as BatchField]}
          onClear={batch.clearSelection}
          onComplete={() => qc.invalidateQueries({ queryKey: ["contracts"] })}
        />
      )}
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList><TabsTrigger value="list">合約列表</TabsTrigger><TabsTrigger value="alerts">續約提醒 {renewalAlerts.length > 0 && <Badge variant="destructive" className="ml-1">{renewalAlerts.length}</Badge>}</TabsTrigger></TabsList>
        <TabsContent value="list" className="space-y-4">
          <div className="flex gap-2">
            <Select value={filterStatus} onValueChange={setFilterStatus}>
              <SelectTrigger className="w-[180px]"><SelectValue placeholder="全部狀態" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部狀態</SelectItem>
                {statuses.map(s => <SelectItem key={s} value={s}>{statusLabel[s]}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <Card><CardContent className="p-0 overflow-x-auto">
            <Table>
              <TableHeader><TableRow>
                <TableHead className="w-10"><CheckboxHeader checked={batch.allSelected} indeterminate={batch.someSelected} onChange={batch.toggleAll} /></TableHead>
                <TableHead>合約編號</TableHead><TableHead>名稱</TableHead><TableHead>對象類型</TableHead>
                <TableHead>對象名稱</TableHead><TableHead>狀態</TableHead><TableHead>起始日</TableHead>
                <TableHead>到期日</TableHead><TableHead>合約金額</TableHead><TableHead className="w-20">操作</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {contracts.length === 0 && <TableRow><TableCell colSpan={10} className="text-center text-muted-foreground py-8">尚無合約</TableCell></TableRow>}
                {contracts.map(c => (
                  <TableRow key={c.id} className="cursor-pointer" onClick={e => { if ((e.target as HTMLElement).closest("button,select,input,a,label")) return; openEdit(c); }}>
                    <TableCell><CheckboxCell checked={batch.selectedIds.has(c.id)} onChange={() => batch.toggle(c.id)} /></TableCell>
                    <TableCell className="font-mono text-sm">{c.contractNumber}</TableCell>
                    <TableCell className="font-medium">{c.title}</TableCell>
                    <TableCell>{c.partyType === "Customer" ? "客戶" : "供應商"}</TableCell>
                    <TableCell>{c.customerName || c.supplierName || "-"}</TableCell>
                    <TableCell><Badge variant="secondary" className={statusColors[c.status]}>{statusLabel[c.status] || c.status}</Badge></TableCell>
                    <TableCell className="text-sm">{c.startDate || "-"}</TableCell>
                    <TableCell className="text-sm">{c.endDate || "-"}</TableCell>
                    <TableCell className="text-right">{c.contractValue ? `$${Number(c.contractValue).toLocaleString()}` : "-"}</TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        <Button variant="ghost" size="icon" onClick={() => openEdit(c)}><Pencil className="w-4 h-4" /></Button>
                        <Button variant="ghost" size="icon" onClick={() => { if (confirm("確定刪除？")) deleteMut.mutate(c.id); }}><Trash2 className="w-4 h-4" /></Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent></Card>
        </TabsContent>
        <TabsContent value="alerts" className="space-y-4">
          {renewalAlerts.length === 0 ? (
            <Card><CardContent className="text-center text-muted-foreground py-8">無即將到期的合約</CardContent></Card>
          ) : (
            <div className="grid gap-4">
              {renewalAlerts.map(c => {
                const days = daysUntil(c.endDate);
                return (
                  <Card key={c.id} className={days !== null && days <= 30 ? "border-red-300" : days !== null && days <= 60 ? "border-orange-300" : "border-yellow-300"}>
                    <CardHeader className="pb-2">
                      <div className="flex items-center gap-2">
                        <AlertTriangle className={`w-5 h-5 ${days !== null && days <= 30 ? "text-red-500" : "text-orange-500"}`} />
                        <CardTitle className="text-base">{c.contractNumber} - {c.title}</CardTitle>
                      </div>
                      <CardDescription>
                        {c.customerName || c.supplierName} · 到期日: {c.endDate} · 剩餘 {days} 天
                        {c.contractValue && ` · 金額: $${Number(c.contractValue).toLocaleString()}`}
                      </CardDescription>
                    </CardHeader>
                  </Card>
                );
              })}
            </div>
          )}
        </TabsContent>
      </Tabs>

      <DocWindow
        open={open}
        onClose={() => setOpen(false)}
        name={editing ? "合約" : "新增合約"}
        number={editing?.contractNumber}
        status={editing ? <DocStatus label={statusLabel[editing.status] || editing.status} tone={statusTone(editing.status)} /> : undefined}
        footer={<>
          <Button variant="outline" onClick={() => setOpen(false)}>取消</Button>
          <Button onClick={handleSave} disabled={!form.title}>{editing ? "更新" : "建立"}</Button>
        </>}
      >
          <div className="grid gap-4">
            <div><label className="text-sm font-medium">合約名稱 *</label><Input value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} /></div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="text-sm font-medium">對象類型</label>
                <Select value={form.partyType} onValueChange={v => setForm({ ...form, partyType: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="Customer">客戶</SelectItem><SelectItem value="Supplier">供應商</SelectItem></SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-sm font-medium">{form.partyType === "Customer" ? "客戶" : "供應商"}</label>
                {form.partyType === "Customer" ? (
                  <LookupSelect value={form.customerId} onValueChange={v => setForm({ ...form, customerId: v })}>
                    <SelectTrigger><SelectValue placeholder="選擇客戶" /></SelectTrigger>
                    <SelectContent>{customers.map((c: any) => <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>)}</SelectContent>
                  </LookupSelect>
                ) : (
                  <LookupSelect value={form.supplierId} onValueChange={v => setForm({ ...form, supplierId: v })}>
                    <SelectTrigger><SelectValue placeholder="選擇供應商" /></SelectTrigger>
                    <SelectContent>{suppliers.map((s: any) => <SelectItem key={s.id} value={String(s.id)}>{s.name}</SelectItem>)}</SelectContent>
                  </LookupSelect>
                )}
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div><label className="text-sm font-medium">起始日期</label><Input type="date" value={form.startDate} onChange={e => setForm({ ...form, startDate: e.target.value })} /></div>
              <div><label className="text-sm font-medium">到期日期</label><Input type="date" value={form.endDate} onChange={e => setForm({ ...form, endDate: e.target.value })} /></div>
              <div><label className="text-sm font-medium">續約日期</label><Input type="date" value={form.renewalDate} onChange={e => setForm({ ...form, renewalDate: e.target.value })} /></div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div><label className="text-sm font-medium">合約金額</label><Input type="number" value={form.contractValue} onChange={e => setForm({ ...form, contractValue: e.target.value })} /></div>
              <div>
                <label className="text-sm font-medium">狀態</label>
                <Select value={form.status} onValueChange={v => setForm({ ...form, status: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{statuses.map(s => <SelectItem key={s} value={s}>{statusLabel[s]}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-sm font-medium">自動續約</label>
                <Select value={form.autoRenew} onValueChange={v => setForm({ ...form, autoRenew: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="Yes">是</SelectItem><SelectItem value="No">否</SelectItem></SelectContent>
                </Select>
              </div>
            </div>
            <div><label className="text-sm font-medium">聯絡人</label><Input value={form.contactPerson} onChange={e => setForm({ ...form, contactPerson: e.target.value })} /></div>
            <div><label className="text-sm font-medium">合約條款</label><Textarea value={form.terms} onChange={e => setForm({ ...form, terms: e.target.value })} rows={3} /></div>
            <div><label className="text-sm font-medium">說明</label><Textarea value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} rows={2} /></div>
          </div>
          {editing && (
            <div>
              <AttachmentsPanel module="contracts" documentType="contract" documentId={editing.id} />
            </div>
          )}
      </DocWindow>
    </div>
  );
}
