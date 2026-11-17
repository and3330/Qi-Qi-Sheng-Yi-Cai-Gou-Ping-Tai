import { useState, useEffect, useCallback } from "react";
import { useAutoReloadKey } from "@/lib/auto-refresh";
import { PageHeader } from "@/components/shared/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { Plus, Check, Trash2, AlertTriangle, Pencil } from "lucide-react";
import { useBatchSelection } from "@/hooks/use-batch-selection";
import { BatchActionBar, type BatchField } from "@/components/shared/batch-action-bar";
import { CheckboxCell, CheckboxHeader } from "@/components/shared/checkbox-column";

import { LookupSelect } from "@/components/shared/lookup-select";
import { MasterLookup } from "@/components/shared/master-lookup";
const BASE = import.meta.env.BASE_URL.endsWith("/") ? import.meta.env.BASE_URL : import.meta.env.BASE_URL + "/";

interface Maintenance {
  id: number; assetId: number; assetName: string; assetNumber: string;
  maintenanceType: string; description: string | null; scheduledDate: string;
  completedDate: string | null; cost: number; vendor: string | null;
  status: string; remarks: string | null;
}

interface Asset { id: number; assetNumber: string; name: string; status: string }

const statusMap: Record<string, string> = { Scheduled: "已排程", "In Progress": "進行中", Completed: "已完成", Cancelled: "已取消" };
const statusColor = (s: string) => s === "Completed" ? "default" : s === "Cancelled" ? "destructive" : s === "In Progress" ? "default" : "secondary";
const typeMap: Record<string, string> = { preventive: "預防性維護", corrective: "矯正性維護", inspection: "檢查", calibration: "校正", other: "其他" };

export default function AssetMaintenancePage() {
  const reloadKey = useAutoReloadKey();
  const [records, setRecords] = useState<Maintenance[]>([]);
  const [upcoming, setUpcoming] = useState<Maintenance[]>([]);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ assetId: "", maintenanceType: "preventive", description: "", scheduledDate: new Date().toISOString().slice(0, 10), cost: "0", vendor: "", remarks: "" });
  const { toast } = useToast();
  const batch = useBatchSelection(records);
  const [editItem, setEditItem] = useState<Maintenance | null>(null);
  const [editForm, setEditForm] = useState({ maintenanceType: "preventive", description: "", scheduledDate: "", completedDate: "", cost: "0", vendor: "", remarks: "" });
  const openEdit = (r: Maintenance) => {
    setEditItem(r);
    setEditForm({ maintenanceType: r.maintenanceType, description: r.description || "", scheduledDate: r.scheduledDate, completedDate: r.completedDate || "", cost: String(r.cost ?? 0), vendor: r.vendor || "", remarks: r.remarks || "" });
  };
  const handleEdit = async () => {
    if (!editItem) return;
    const body: Record<string, unknown> = {
      maintenanceType: editForm.maintenanceType, description: editForm.description || null, scheduledDate: editForm.scheduledDate,
      cost: Number(editForm.cost) || 0, vendor: editForm.vendor || null, remarks: editForm.remarks || null,
    };
    if (editItem.status === "Completed") body.completedDate = editForm.completedDate || editItem.completedDate;
    const res = await fetch(`/erp-api/asset-maintenance/${editItem.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (res.ok) { toast({ title: "維護紀錄已更新" }); setEditItem(null); fetchAll(); }
    else { const err = await res.json().catch(() => ({})); toast({ title: err.error || "更新失敗", variant: "destructive" }); }
  };

  const fetchAll = useCallback(async () => {
    setLoading(true);
    const [mRes, uRes, aRes] = await Promise.all([
      fetch(`/erp-api/asset-maintenance`),
      fetch(`/erp-api/asset-maintenance/upcoming`),
      fetch(`/erp-api/assets`),
    ]);
    setRecords(await mRes.json());
    setUpcoming(await uRes.json());
    const allAssets: Asset[] = await aRes.json();
    setAssets(allAssets.filter(a => a.status === "In Use" || a.status === "Submitted"));
    setLoading(false);
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll, reloadKey]);

  const handleCreate = async () => {
    const payload = { ...form, assetId: Number(form.assetId), cost: Number(form.cost) || 0 };
    const res = await fetch(`/erp-api/asset-maintenance`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    if (res.ok) {
      toast({ title: "維護排程已建立" }); setOpen(false); fetchAll();
      setForm({ assetId: "", maintenanceType: "preventive", description: "", scheduledDate: new Date().toISOString().slice(0, 10), cost: "0", vendor: "", remarks: "" });
    } else { const err = await res.json(); toast({ title: err.error || "建立失敗", variant: "destructive" }); }
  };

  const updateStatus = async (id: number, status: string) => {
    const body: Record<string, unknown> = { status };
    if (status === "Completed") body.completedDate = new Date().toISOString().slice(0, 10);
    const res = await fetch(`/erp-api/asset-maintenance/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (res.ok) { toast({ title: `狀態已更新` }); fetchAll(); }
    else { const err = await res.json(); toast({ title: err.error || "操作失敗", variant: "destructive" }); }
  };

  const handleDelete = async (id: number) => {
    const res = await fetch(`/erp-api/asset-maintenance/${id}`, { method: "DELETE" });
    if (res.ok) { toast({ title: "已刪除" }); fetchAll(); }
    else { const err = await res.json(); toast({ title: err.error || "刪除失敗", variant: "destructive" }); }
  };

  return (
    <div className="space-y-6">
      <PageHeader title="資產維護" description="排程與追蹤資產維護活動，查看即將到來的維護提醒" />

      {batch.count > 0 && (
        <BatchActionBar
          count={batch.count}
          entityName="維護紀錄"
          entityEndpoint="asset-maintenance"
          ids={batch.ids}
          batchFields={[
            { key: "status", label: "狀態", type: "select", options: Object.entries(statusMap).map(([value, label]) => ({ value, label })) },
            { key: "maintenanceType", label: "維護類型", type: "select", options: Object.entries(typeMap).map(([value, label]) => ({ value, label })) },
            { key: "scheduledDate", label: "排程日期", type: "date" },
            { key: "vendor", label: "維護廠商", type: "text", clearable: true },
            { key: "remarks", label: "備註", type: "text", clearable: true },
          ] as BatchField[]}
          onClear={batch.clearSelection}
          onComplete={() => fetchAll()}
        />
      )}

      {upcoming.length > 0 && (
        <Card className="border-orange-200 bg-orange-50">
          <CardHeader className="py-3 border-b border-orange-200">
            <CardTitle className="flex items-center gap-2 text-orange-700"><AlertTriangle className="h-4 w-4" />即將到來的維護 ({upcoming.length})</CardTitle>
          </CardHeader>
          <CardContent className="p-0 overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="border-b border-orange-200">
                <th className="text-left px-4 py-2 font-semibold">資產</th>
                <th className="text-left px-4 py-2 font-semibold">類型</th>
                <th className="text-left px-4 py-2 font-semibold">排程日期</th>
              </tr></thead>
              <tbody>
                {upcoming.map(u => (
                  <tr key={u.id} className="border-b border-orange-100">
                    <td className="px-4 py-2">{u.assetName} ({u.assetNumber})</td>
                    <td className="px-4 py-2">{typeMap[u.maintenanceType] || u.maintenanceType}</td>
                    <td className="px-4 py-2">{u.scheduledDate}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}

      <div className="flex justify-end">
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild><Button><Plus className="h-4 w-4 mr-1" />新增維護排程</Button></DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>新增維護排程</DialogTitle></DialogHeader>
            <div className="space-y-4">
              <div>
                <label className="text-sm font-medium">資產 *</label>
                <LookupSelect className="w-full border rounded-md px-3 py-2 text-sm" value={form.assetId} onChange={e => setForm(p => ({ ...p, assetId: e.target.value }))}>
                  <option value="">選擇資產</option>
                  {assets.map(a => <option key={a.id} value={a.id}>{a.assetNumber} - {a.name}</option>)}
                </LookupSelect>
              </div>
              <div>
                <label className="text-sm font-medium">維護類型 *</label>
                <select className="w-full border rounded-md px-3 py-2 text-sm" value={form.maintenanceType} onChange={e => setForm(p => ({ ...p, maintenanceType: e.target.value }))}>
                  <option value="preventive">預防性維護</option>
                  <option value="corrective">矯正性維護</option>
                  <option value="inspection">檢查</option>
                  <option value="calibration">校正</option>
                  <option value="other">其他</option>
                </select>
              </div>
              <div><label className="text-sm font-medium">說明</label><Input value={form.description} onChange={e => setForm(p => ({ ...p, description: e.target.value }))} placeholder="維護說明" /></div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div><label className="text-sm font-medium">排程日期 *</label><Input type="date" value={form.scheduledDate} onChange={e => setForm(p => ({ ...p, scheduledDate: e.target.value }))} /></div>
                <div><label className="text-sm font-medium">預估費用</label><Input type="number" min="0" value={form.cost} onChange={e => setForm(p => ({ ...p, cost: e.target.value }))} /></div>
              </div>
              <div><label className="text-sm font-medium">維護廠商</label><MasterLookup source="suppliers" valueKey="name" value={form.vendor} onValueChange={v => setForm(p => ({ ...p, vendor: v }))} placeholder="選擇供應商" /></div>
              <div><label className="text-sm font-medium">備註</label><Input value={form.remarks} onChange={e => setForm(p => ({ ...p, remarks: e.target.value }))} placeholder="備註" /></div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setOpen(false)}>取消</Button>
              <Button onClick={handleCreate} disabled={!form.assetId || !form.scheduledDate}>建立</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <Card>
        <CardHeader className="py-3 border-b"><CardTitle>維護紀錄</CardTitle></CardHeader>
        <CardContent className="p-0 overflow-x-auto">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="border-b bg-gray-50/50">
                <th className="w-10 px-2"><CheckboxHeader checked={batch.allSelected} indeterminate={batch.someSelected} onChange={batch.toggleAll} /></th>
                <th className="text-left px-4 py-2.5 font-semibold">資產</th>
                <th className="text-left px-4 py-2.5 font-semibold">維護類型</th>
                <th className="text-left px-4 py-2.5 font-semibold">排程日期</th>
                <th className="text-left px-4 py-2.5 font-semibold">完成日期</th>
                <th className="text-left px-4 py-2.5 font-semibold">廠商</th>
                <th className="text-left px-4 py-2.5 font-semibold">狀態</th>
                <th className="text-right px-4 py-2.5 font-semibold">費用</th>
                <th className="text-center px-4 py-2.5 font-semibold">操作</th>
              </tr></thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={9} className="px-4 py-8 text-center text-gray-400">載入中...</td></tr>
                ) : records.length === 0 ? (
                  <tr><td colSpan={9} className="px-4 py-8 text-center text-gray-400">尚無資料</td></tr>
                ) : records.map(r => (
                  <tr key={r.id} className="border-b hover:bg-gray-50 cursor-pointer" onClick={() => openEdit(r)} data-testid={`maintenance-row-${r.id}`}>
                    <td className="px-2" onClick={e => e.stopPropagation()}><CheckboxCell checked={batch.selectedIds.has(r.id)} onChange={() => batch.toggle(r.id)} /></td>
                    <td className="px-4 py-2">
                      <div className="font-medium">{r.assetName}</div>
                      <div className="text-xs text-gray-400">{r.assetNumber}</div>
                    </td>
                    <td className="px-4 py-2">{typeMap[r.maintenanceType] || r.maintenanceType}</td>
                    <td className="px-4 py-2">{r.scheduledDate}</td>
                    <td className="px-4 py-2">{r.completedDate || "-"}</td>
                    <td className="px-4 py-2 text-gray-500">{r.vendor || "-"}</td>
                    <td className="px-4 py-2"><Badge variant={statusColor(r.status)}>{statusMap[r.status] || r.status}</Badge></td>
                    <td className="px-4 py-2 text-right font-mono">${r.cost.toLocaleString()}</td>
                    <td className="px-4 py-2 text-center" onClick={e => e.stopPropagation()}>
                      <div className="flex gap-1 justify-center">
                        <Button size="sm" variant="outline" onClick={() => openEdit(r)} title="編輯" aria-label="編輯維護紀錄"><Pencil className="h-3 w-3" /></Button>
                        {r.status === "Scheduled" && (
                          <Button size="sm" variant="outline" onClick={() => updateStatus(r.id, "In Progress")} title="開始">開始</Button>
                        )}
                        {r.status === "In Progress" && (
                          <Button size="sm" variant="outline" onClick={() => updateStatus(r.id, "Completed")} title="完成"><Check className="h-3 w-3" /></Button>
                        )}
                        {(r.status === "Scheduled" || r.status === "In Progress") && (
                          <Button size="sm" variant="ghost" onClick={() => handleDelete(r.id)} title="刪除"><Trash2 className="h-3 w-3" /></Button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <Dialog open={!!editItem} onOpenChange={o => { if (!o) setEditItem(null); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>編輯維護紀錄</DialogTitle></DialogHeader>
          {editItem && (
            <div className="space-y-4">
              <div className="rounded-md bg-muted/50 px-3 py-2 text-sm">
                <div className="font-medium">{editItem.assetName}</div>
                <div className="text-xs text-muted-foreground">{editItem.assetNumber}・{statusMap[editItem.status] || editItem.status}</div>
              </div>
              <div>
                <label className="text-sm font-medium">維護類型</label>
                <select className="w-full border rounded-md px-3 py-2 text-sm" value={editForm.maintenanceType} onChange={e => setEditForm(p => ({ ...p, maintenanceType: e.target.value }))}>
                  {Object.entries(typeMap).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </div>
              <div><label className="text-sm font-medium">說明</label><Input value={editForm.description} onChange={e => setEditForm(p => ({ ...p, description: e.target.value }))} /></div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div><label className="text-sm font-medium">排程日期</label><Input type="date" value={editForm.scheduledDate} onChange={e => setEditForm(p => ({ ...p, scheduledDate: e.target.value }))} /></div>
                {editItem.status === "Completed"
                  ? <div><label className="text-sm font-medium">完成日期</label><Input type="date" value={editForm.completedDate} onChange={e => setEditForm(p => ({ ...p, completedDate: e.target.value }))} /></div>
                  : <div><label className="text-sm font-medium">費用</label><Input type="number" min="0" value={editForm.cost} onChange={e => setEditForm(p => ({ ...p, cost: e.target.value }))} /></div>}
              </div>
              {editItem.status === "Completed" && <div><label className="text-sm font-medium">費用</label><Input type="number" min="0" value={editForm.cost} onChange={e => setEditForm(p => ({ ...p, cost: e.target.value }))} /></div>}
              <div><label className="text-sm font-medium">維護廠商</label><MasterLookup source="suppliers" valueKey="name" value={editForm.vendor} onValueChange={v => setEditForm(p => ({ ...p, vendor: v }))} placeholder="選擇供應商" /></div>
              <div><label className="text-sm font-medium">備註</label><Input value={editForm.remarks} onChange={e => setEditForm(p => ({ ...p, remarks: e.target.value }))} /></div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditItem(null)}>取消</Button>
            <Button onClick={handleEdit} disabled={!editForm.scheduledDate}>更新</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
