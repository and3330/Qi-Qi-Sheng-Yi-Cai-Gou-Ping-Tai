import { useState, useEffect, useCallback } from "react";
import { useAutoReloadKey } from "@/lib/auto-refresh";
import { PageHeader } from "@/components/shared/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { Plus, Eye, Trash2, Play, CheckCircle } from "lucide-react";
import { useBatchSelection } from "@/hooks/use-batch-selection";
import { BatchActionBar, type BatchField } from "@/components/shared/batch-action-bar";
import { CheckboxCell, CheckboxHeader } from "@/components/shared/checkbox-column";

import { LookupSelect } from "@/components/shared/lookup-select";
const BASE = import.meta.env.BASE_URL.endsWith("/") ? import.meta.env.BASE_URL : import.meta.env.BASE_URL + "/";

interface JcItem { id: number; jobCardNumber: string; workOrderId: number; workOrderNumber: string; workstationName: string; operationName: string; sequenceNo: number; status: string; plannedQuantity: number; completedQuantity: number; totalHours: number; startTime: string | null; endTime: string | null }
interface Wo { id: number; workOrderNumber: string; status: string }
interface Ws { id: number; name: string }

const statusMap: Record<string, string> = { Open: "開放", "Work In Progress": "進行中", Completed: "已完成", Cancelled: "已取消" };
const statusColor = (s: string) => s === "Work In Progress" ? "default" : s === "Completed" ? "secondary" : s === "Cancelled" ? "destructive" : "outline";

export default function JobCardsPage() {
  const reloadKey = useAutoReloadKey();
  const [cards, setCards] = useState<JcItem[]>([]);
  const [wos, setWos] = useState<Wo[]>([]);
  const [wss, setWss] = useState<Ws[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [detail, setDetail] = useState<JcItem | null>(null);
  const [form, setForm] = useState({ workOrderId: "", workstationId: "", operationName: "", sequenceNo: "1", plannedQuantity: "1", remarks: "" });
  const { toast } = useToast();
  const batch = useBatchSelection(cards);
  const jcBatchFields: BatchField[] = [{key:"status",label:"狀態",type:"select",options:[{value:"Draft",label:"草稿"},{value:"In Progress",label:"進行中"},{value:"Completed",label:"已完成"}]}];

  const fetchAll = useCallback(async () => {
    setLoading(true);
    const [jRes, wRes, wsRes] = await Promise.all([fetch(`/erp-api/job-cards`), fetch(`/erp-api/work-orders`), fetch(`/erp-api/workstations`)]);
    setCards(await jRes.json()); setWos(await wRes.json()); setWss(await wsRes.json());
    setLoading(false);
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll, reloadKey]);

  const handleCreate = async () => {
    const payload = { workOrderId: Number(form.workOrderId), workstationId: form.workstationId ? Number(form.workstationId) : null, operationName: form.operationName, sequenceNo: Number(form.sequenceNo), plannedQuantity: Number(form.plannedQuantity), remarks: form.remarks || null };
    const res = await fetch(`/erp-api/job-cards`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    if (res.ok) { toast({ title: "作業卡已建立" }); setOpen(false); setForm({ workOrderId: "", workstationId: "", operationName: "", sequenceNo: "1", plannedQuantity: "1", remarks: "" }); fetchAll(); }
    else { const err = await res.json(); toast({ title: err.error || "建立失敗", variant: "destructive" }); }
  };

  const viewDetail = async (id: number) => {
    const res = await fetch(`/erp-api/job-cards/${id}`);
    if (res.ok) setDetail(await res.json());
  };

  const updateStatus = async (id: number, status: string, extra?: Record<string, unknown>) => {
    const res = await fetch(`/erp-api/job-cards/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status, ...extra }) });
    if (res.ok) { toast({ title: "狀態已更新" }); fetchAll(); if (detail?.id === id) viewDetail(id); }
    else { const err = await res.json(); toast({ title: err.error, variant: "destructive" }); }
  };

  const handleDelete = async (id: number) => {
    const res = await fetch(`/erp-api/job-cards/${id}`, { method: "DELETE" });
    if (res.ok) { toast({ title: "已刪除" }); fetchAll(); setDetail(null); }
    else { const err = await res.json(); toast({ title: err.error, variant: "destructive" }); }
  };

  return (
    <div className="space-y-6">
      <PageHeader title="作業卡" description="追蹤工單內的個別作業" />
      {batch.count > 0 && (
        <BatchActionBar
          count={batch.count}
          entityName="作業卡"
          entityEndpoint="job-cards"
          ids={batch.ids}
          batchFields={jcBatchFields}
          onClear={batch.clearSelection}
          onComplete={() => fetchAll()}
        />
      )}
      <div className="flex justify-end">
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild><Button><Plus className="h-4 w-4 mr-1" />新增作業卡</Button></DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>新增作業卡</DialogTitle></DialogHeader>
            <div className="space-y-4">
              <div>
                <label className="text-sm font-medium">工單 *</label>
                <LookupSelect className="w-full border rounded-md px-3 py-2 text-sm" value={form.workOrderId} onChange={e => setForm(p => ({ ...p, workOrderId: e.target.value }))}>
                  <option value="">選擇工單</option>
                  {wos.filter(w => w.status === "In Progress" || w.status === "Draft").map(w => <option key={w.id} value={w.id}>{w.workOrderNumber}</option>)}
                </LookupSelect>
              </div>
              <div>
                <label className="text-sm font-medium">工作站</label>
                <LookupSelect className="w-full border rounded-md px-3 py-2 text-sm" value={form.workstationId} onChange={e => setForm(p => ({ ...p, workstationId: e.target.value }))}>
                  <option value="">選擇工作站</option>
                  {wss.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
                </LookupSelect>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div><label className="text-sm font-medium">作業名稱 *</label><Input value={form.operationName} onChange={e => setForm(p => ({ ...p, operationName: e.target.value }))} placeholder="作業名稱" /></div>
                <div><label className="text-sm font-medium">順序</label><Input type="number" min="1" value={form.sequenceNo} onChange={e => setForm(p => ({ ...p, sequenceNo: e.target.value }))} /></div>
              </div>
              <div><label className="text-sm font-medium">計畫數量</label><Input type="number" min="1" value={form.plannedQuantity} onChange={e => setForm(p => ({ ...p, plannedQuantity: e.target.value }))} /></div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setOpen(false)}>取消</Button>
              <Button onClick={handleCreate} disabled={!form.workOrderId || !form.operationName}>建立</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <Card>
        <CardContent className="p-0 overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="border-b bg-gray-50/50">
              <th className="w-10 px-2"><CheckboxHeader checked={batch.allSelected} indeterminate={batch.someSelected} onChange={batch.toggleAll} /></th>
              <th className="text-left px-4 py-2.5 font-semibold">作業卡號</th>
              <th className="text-left px-4 py-2.5 font-semibold">工單</th>
              <th className="text-left px-4 py-2.5 font-semibold">作業</th>
              <th className="text-left px-4 py-2.5 font-semibold">工作站</th>
              <th className="text-right px-4 py-2.5 font-semibold">完成/計畫</th>
              <th className="text-right px-4 py-2.5 font-semibold">工時</th>
              <th className="text-center px-4 py-2.5 font-semibold">狀態</th>
              <th className="text-center px-4 py-2.5 font-semibold">操作</th>
            </tr></thead>
            <tbody>
              {loading ? <tr><td colSpan={9} className="px-4 py-8 text-center text-gray-400">載入中...</td></tr>
              : cards.length === 0 ? <tr><td colSpan={9} className="px-4 py-8 text-center text-gray-400">尚無資料</td></tr>
              : cards.map(c => (
                <tr key={c.id} className="border-b hover:bg-gray-50">
                  <td className="px-2"><CheckboxCell checked={batch.selectedIds.has(c.id)} onChange={() => batch.toggle(c.id)} /></td>
                  <td className="px-4 py-2 font-mono">{c.jobCardNumber}</td>
                  <td className="px-4 py-2">{c.workOrderNumber}</td>
                  <td className="px-4 py-2">{c.operationName}</td>
                  <td className="px-4 py-2 text-gray-500">{c.workstationName || "-"}</td>
                  <td className="px-4 py-2 text-right">{c.completedQuantity}/{c.plannedQuantity}</td>
                  <td className="px-4 py-2 text-right">{c.totalHours}h</td>
                  <td className="px-4 py-2 text-center"><Badge variant={statusColor(c.status)}>{statusMap[c.status]}</Badge></td>
                  <td className="px-4 py-2 text-center">
                    <div className="flex gap-1 justify-center">
                      <Button size="sm" variant="outline" onClick={() => viewDetail(c.id)}><Eye className="h-3 w-3" /></Button>
                      {c.status === "Open" && <Button size="sm" variant="ghost" onClick={() => handleDelete(c.id)}><Trash2 className="h-3 w-3" /></Button>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <Dialog open={!!detail} onOpenChange={v => { if (!v) setDetail(null); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>作業卡 - {detail?.jobCardNumber}</DialogTitle></DialogHeader>
          {detail && (
            <div className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                <div><span className="text-gray-500">工單：</span>{detail.workOrderNumber}</div>
                <div><span className="text-gray-500">工作站：</span>{detail.workstationName || "-"}</div>
                <div><span className="text-gray-500">作業：</span>{detail.operationName}</div>
                <div><span className="text-gray-500">順序：</span>{detail.sequenceNo}</div>
                <div><span className="text-gray-500">計畫數量：</span>{detail.plannedQuantity}</div>
                <div><span className="text-gray-500">完成數量：</span>{detail.completedQuantity}</div>
                <div><span className="text-gray-500">狀態：</span><Badge variant={statusColor(detail.status)}>{statusMap[detail.status]}</Badge></div>
                <div><span className="text-gray-500">工時：</span>{detail.totalHours}h</div>
                {detail.startTime && <div><span className="text-gray-500">開始：</span>{new Date(detail.startTime).toLocaleString()}</div>}
                {detail.endTime && <div><span className="text-gray-500">結束：</span>{new Date(detail.endTime).toLocaleString()}</div>}
              </div>
              <div className="flex gap-2 justify-end">
                {detail.status === "Open" && (
                  <>
                    <Button onClick={() => updateStatus(detail.id, "Work In Progress")}><Play className="h-3 w-3 mr-1" />開始作業</Button>
                    <Button variant="destructive" onClick={() => handleDelete(detail.id)}>刪除</Button>
                  </>
                )}
                {detail.status === "Work In Progress" && (
                  <>
                    <Button onClick={() => updateStatus(detail.id, "Completed", { completedQuantity: detail.plannedQuantity })}><CheckCircle className="h-3 w-3 mr-1" />完成</Button>
                    <Button variant="destructive" onClick={() => updateStatus(detail.id, "Cancelled")}>取消</Button>
                  </>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
