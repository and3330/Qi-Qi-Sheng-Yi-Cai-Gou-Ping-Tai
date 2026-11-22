import { useState, useEffect, useCallback } from "react";
import { useAutoReloadKey } from "@/lib/auto-refresh";
import { PageHeader } from "@/components/shared/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { DocWindow, DocStatus, DocFields, DocNote, statusTone } from "@/components/shared/doc-window";
import { useToast } from "@/hooks/use-toast";
import { Plus, Eye, Search } from "lucide-react";
import { useBatchSelection } from "@/hooks/use-batch-selection";
import { BatchActionBar, type BatchField } from "@/components/shared/batch-action-bar";
import { CheckboxCell, CheckboxHeader } from "@/components/shared/checkbox-column";
import { MasterLookup } from "@/components/shared/master-lookup";

const BASE = import.meta.env.BASE_URL.endsWith("/") ? import.meta.env.BASE_URL : import.meta.env.BASE_URL + "/";

interface Capa { id: number; capaNumber: string; title: string; type: string; nonConformanceId: number | null; ncrNumber: string; ncrTitle: string; description: string; assignedTo: string | null; dueDate: string | null; completedDate: string | null; verificationResult: string | null; status: string; priority: string; remarks: string | null; createdAt: string }

const typeMap: Record<string, string> = { Corrective: "矯正措施", Preventive: "預防措施" };
const statusMap: Record<string, string> = { Open: "開放", "In Progress": "進行中", "Pending Verification": "待驗證", Closed: "已結案", Cancelled: "已取消" };
const statusColor = (s: string) => s === "Closed" ? "secondary" : s === "Cancelled" ? "destructive" : s === "In Progress" ? "default" : "outline";
const priorityMap: Record<string, string> = { Low: "低", Medium: "中", High: "高", Urgent: "緊急" };

export default function CapaPage() {
  const reloadKey = useAutoReloadKey();
  const [capas, setCapas] = useState<Capa[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [detail, setDetail] = useState<Capa | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [form, setForm] = useState({ title: "", type: "Corrective", nonConformanceId: "", priority: "Medium", description: "", assignedTo: "", dueDate: "", remarks: "" });
  const { toast } = useToast();
  const capaBatchFields: BatchField[] = [{key:"status",label:"狀態",type:"select",options:[{value:"Open",label:"開啟"},{value:"In Progress",label:"處理中"},{value:"Completed",label:"已完成"},{value:"Closed",label:"已關閉"}]}];

  const fetchAll = useCallback(async () => {
    setLoading(true);
    const res = await fetch(`/erp-api/capa-actions`);
    setCapas(await res.json());
    setLoading(false);
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll, reloadKey]);

  const handleCreate = async () => {
    const payload = {
      title: form.title,
      type: form.type,
      nonConformanceId: form.nonConformanceId ? Number(form.nonConformanceId) : null,
      priority: form.priority,
      description: form.description,
      assignedTo: form.assignedTo || null,
      dueDate: form.dueDate || null,
      remarks: form.remarks || null,
    };
    const res = await fetch(`/erp-api/capa-actions`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    if (res.ok) { toast({ title: "CAPA 已建立" }); setOpen(false); setForm({ title: "", type: "Corrective", nonConformanceId: "", priority: "Medium", description: "", assignedTo: "", dueDate: "", remarks: "" }); fetchAll(); }
    else { const err = await res.json(); toast({ title: err.error || "建立失敗", variant: "destructive" }); }
  };

  const viewDetail = async (id: number) => {
    const res = await fetch(`/erp-api/capa-actions/${id}`);
    if (res.ok) setDetail(await res.json());
  };

  const updateStatus = async (id: number, status: string, extra?: Record<string, unknown>) => {
    const res = await fetch(`/erp-api/capa-actions/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status, ...extra }) });
    if (res.ok) { toast({ title: "狀態已更新" }); fetchAll(); if (detail?.id === id) viewDetail(id); }
    else { const err = await res.json(); toast({ title: err.error, variant: "destructive" }); }
  };

  const filtered = capas.filter(c => {
    if (searchTerm && !c.capaNumber.includes(searchTerm) && !c.title.includes(searchTerm)) return false;
    return true;
  });

  const batch = useBatchSelection(filtered);

  return (
    <div className="space-y-6">
      <PageHeader title="CAPA（矯正與預防措施）" description="追蹤品質改善行動與成效驗證" />
      {batch.count > 0 && (
        <BatchActionBar
          count={batch.count}
          entityName="CAPA"
          entityEndpoint="capa"
          ids={batch.ids}
          batchFields={capaBatchFields}
          onClear={batch.clearSelection}
          onComplete={() => fetchAll()}
        />
      )}
      <div className="flex flex-wrap gap-3 items-center">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
          <Input className="pl-9" placeholder="搜尋..." value={searchTerm} onChange={e => setSearchTerm(e.target.value)} />
        </div>
        <Button onClick={() => setOpen(true)}><Plus className="h-4 w-4 mr-1" />新增 CAPA</Button>
        <DocWindow
          open={open} onClose={() => setOpen(false)} name="新增 CAPA"
          footer={<>
            <Button variant="outline" onClick={() => setOpen(false)}>取消</Button>
            <Button onClick={handleCreate} disabled={!form.title || !form.description}>建立</Button>
          </>}
        >
            <div className="space-y-4">
              <div><label className="text-sm font-medium">標題 *</label><Input value={form.title} onChange={e => setForm(p => ({ ...p, title: e.target.value }))} /></div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="text-sm font-medium">類型</label>
                  <select className="w-full border rounded-md px-3 py-2 text-sm" value={form.type} onChange={e => setForm(p => ({ ...p, type: e.target.value }))}>
                    {Object.entries(typeMap).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-sm font-medium">優先順序</label>
                  <select className="w-full border rounded-md px-3 py-2 text-sm" value={form.priority} onChange={e => setForm(p => ({ ...p, priority: e.target.value }))}>
                    {Object.entries(priorityMap).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div><label className="text-sm font-medium">關聯 NCR ID</label><Input type="number" value={form.nonConformanceId} onChange={e => setForm(p => ({ ...p, nonConformanceId: e.target.value }))} placeholder="選填" /></div>
                <div><label className="text-sm font-medium">到期日</label><Input type="date" value={form.dueDate} onChange={e => setForm(p => ({ ...p, dueDate: e.target.value }))} /></div>
              </div>
              <div><label className="text-sm font-medium">描述 *</label><textarea className="w-full border rounded-md px-3 py-2 text-sm min-h-[80px]" value={form.description} onChange={e => setForm(p => ({ ...p, description: e.target.value }))} /></div>
              <div><label className="text-sm font-medium">負責人</label><MasterLookup source="employees" valueKey="name" value={form.assignedTo} onValueChange={v => setForm(p => ({ ...p, assignedTo: v }))} placeholder="選擇員工" /></div>
            </div>
        </DocWindow>
      </div>

      <Card>
        <CardContent className="p-0 overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="border-b bg-gray-50/50">
              <th className="w-10 px-2"><CheckboxHeader checked={batch.allSelected} indeterminate={batch.someSelected} onChange={batch.toggleAll} /></th>
              <th className="text-left px-4 py-2.5 font-semibold">CAPA 編號</th>
              <th className="text-left px-4 py-2.5 font-semibold">標題</th>
              <th className="text-center px-4 py-2.5 font-semibold">類型</th>
              <th className="text-center px-4 py-2.5 font-semibold">優先</th>
              <th className="text-left px-4 py-2.5 font-semibold">負責人</th>
              <th className="text-left px-4 py-2.5 font-semibold">到期日</th>
              <th className="text-center px-4 py-2.5 font-semibold">狀態</th>
              <th className="text-center px-4 py-2.5 font-semibold">操作</th>
            </tr></thead>
            <tbody>
              {loading ? <tr><td colSpan={9} className="px-4 py-8 text-center text-gray-400">載入中...</td></tr>
              : filtered.length === 0 ? <tr><td colSpan={9} className="px-4 py-8 text-center text-gray-400">尚無資料</td></tr>
              : filtered.map(c => (
                <tr key={c.id} className="border-b hover:bg-gray-50 cursor-pointer" onClick={e => { if ((e.target as HTMLElement).closest("button,select,input,a,label")) return; viewDetail(c.id); }} data-testid={`capa-row-${c.id}`}>
                  <td className="px-2" onClick={e => e.stopPropagation()}><CheckboxCell checked={batch.selectedIds.has(c.id)} onChange={() => batch.toggle(c.id)} /></td>
                  <td className="px-4 py-2 font-mono">{c.capaNumber}</td>
                  <td className="px-4 py-2">{c.title}</td>
                  <td className="px-4 py-2 text-center"><Badge variant="outline">{typeMap[c.type]}</Badge></td>
                  <td className="px-4 py-2 text-center"><Badge variant="outline">{priorityMap[c.priority]}</Badge></td>
                  <td className="px-4 py-2 text-gray-500">{c.assignedTo || "-"}</td>
                  <td className="px-4 py-2">{c.dueDate || "-"}</td>
                  <td className="px-4 py-2 text-center"><Badge variant={statusColor(c.status)}>{statusMap[c.status] || c.status}</Badge></td>
                  <td className="px-4 py-2 text-center"><Button size="sm" variant="outline" onClick={() => viewDetail(c.id)}><Eye className="h-3 w-3" /></Button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <DocWindow
        open={!!detail} onClose={() => setDetail(null)}
        name="CAPA" number={detail?.capaNumber}
        status={detail ? <DocStatus label={statusMap[detail.status] || detail.status} tone={statusTone(detail.status)} /> : undefined}
        footer={detail && <>
          {(detail.status === "Open" || detail.status === "In Progress") && <Button variant="destructive" className="mr-auto" onClick={() => updateStatus(detail.id, "Cancelled")}>取消</Button>}
          <Button variant="outline" onClick={() => setDetail(null)}>關閉</Button>
          {detail.status === "Open" && <Button onClick={() => updateStatus(detail.id, "In Progress")}>開始執行</Button>}
          {detail.status === "In Progress" && <Button onClick={() => updateStatus(detail.id, "Pending Verification")}>提交驗證</Button>}
          {detail.status === "Pending Verification" && <Button onClick={() => updateStatus(detail.id, "Closed")}>驗證通過結案</Button>}
        </>}
      >
        {detail && (
          <>
            <DocFields items={[
              ["標題", detail.title],
              ["類型", <Badge variant="outline">{typeMap[detail.type]}</Badge>],
              ["優先順序", priorityMap[detail.priority]],
              ["負責人", detail.assignedTo || "-"],
              ["到期日", detail.dueDate || "-"],
              ["完成日期", detail.completedDate || "-"],
              ["NCR", detail.ncrNumber],
            ]} />
            <DocNote label="描述">{detail.description}</DocNote>
            <DocNote label="驗證結果">{detail.verificationResult}</DocNote>
          </>
        )}
      </DocWindow>
    </div>
  );
}
