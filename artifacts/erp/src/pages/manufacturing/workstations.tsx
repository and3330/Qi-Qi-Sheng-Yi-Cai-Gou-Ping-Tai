import { useState, useEffect, useCallback } from "react";
import { useAutoReloadKey } from "@/lib/auto-refresh";
import { PageHeader } from "@/components/shared/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { Plus, Pencil, Trash2 } from "lucide-react";
import { useBatchSelection } from "@/hooks/use-batch-selection";
import { BatchActionBar, type BatchField } from "@/components/shared/batch-action-bar";
import { CheckboxCell, CheckboxHeader } from "@/components/shared/checkbox-column";

const BASE = import.meta.env.BASE_URL.endsWith("/") ? import.meta.env.BASE_URL : import.meta.env.BASE_URL + "/";

interface Workstation { id: number; name: string; description: string | null; productionCapacity: number; hourRate: number; status: string }

export default function WorkstationsPage() {
  const reloadKey = useAutoReloadKey();
  const [items, setItems] = useState<Workstation[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [form, setForm] = useState({ name: "", description: "", productionCapacity: "1", hourRate: "0", status: "Active" });
  const { toast } = useToast();
  const [filter, setFilter] = useState<"active" | "inactive" | "all">("active");
  const shown = items.filter(w => filter === "all" || (filter === "active" ? w.status === "Active" : w.status !== "Active"));
  const batch = useBatchSelection(shown);
  const inactiveCount = items.filter(w => w.status !== "Active").length;
  const chip = (active: boolean) => `rounded-full border px-3 py-1.5 text-sm transition-colors ${active ? "border-primary bg-primary text-primary-foreground" : "bg-background hover:bg-muted"}`;

  const fetchAll = useCallback(async () => {
    setLoading(true);
    const res = await fetch(`/erp-api/workstations`);
    setItems(await res.json());
    setLoading(false);
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll, reloadKey]);

  const resetForm = () => { setForm({ name: "", description: "", productionCapacity: "1", hourRate: "0", status: "Active" }); setEditId(null); };

  const openEdit = (w: Workstation) => {
    setEditId(w.id);
    setForm({ name: w.name, description: w.description || "", productionCapacity: String(w.productionCapacity), hourRate: String(w.hourRate), status: w.status });
    setOpen(true);
  };

  const handleSave = async () => {
    const payload = { name: form.name, description: form.description || null, productionCapacity: Number(form.productionCapacity), hourRate: Number(form.hourRate), status: form.status };
    const url = editId ? `/erp-api/workstations/${editId}` : `/erp-api/workstations`;
    const res = await fetch(url, { method: editId ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    if (res.ok) { toast({ title: editId ? "已更新" : "已建立" }); setOpen(false); resetForm(); fetchAll(); }
    else { const err = await res.json(); toast({ title: err.error || "操作失敗", variant: "destructive" }); }
  };

  const handleDelete = async (id: number) => {
    const res = await fetch(`/erp-api/workstations/${id}`, { method: "DELETE" });
    if (res.ok) { toast({ title: "已刪除" }); fetchAll(); }
    else { const err = await res.json(); toast({ title: err.error, variant: "destructive" }); }
  };

  return (
    <div className="space-y-6">
      <PageHeader title="工作站" description="管理生產工作站與產能" />
      {batch.count > 0 && (
        <BatchActionBar
          count={batch.count}
          entityName="工作站"
          entityEndpoint="workstations"
          ids={batch.ids}
          batchFields={[
            { key: "status", label: "狀態", type: "select", options: [{ value: "Active", label: "啟用" }, { value: "Inactive", label: "停用" }] },
            { key: "productionCapacity", label: "產能（件/天）", type: "number" },
            { key: "hourRate", label: "時薪費率", type: "number" },
            { key: "description", label: "描述", type: "text", clearable: true },
          ] as BatchField[]}
          onClear={batch.clearSelection}
          onComplete={() => fetchAll()}
        />
      )}
      <div className="flex items-center justify-between gap-2">
        <div className="flex gap-2" role="tablist" aria-label="狀態">
          <button type="button" className={chip(filter === "active")} onClick={() => setFilter("active")}>啟用中（{items.length - inactiveCount}）</button>
          <button type="button" className={chip(filter === "inactive")} onClick={() => setFilter("inactive")} data-testid="workstation-filter-inactive">已停用（{inactiveCount}）</button>
          <button type="button" className={chip(filter === "all")} onClick={() => setFilter("all")}>全部</button>
        </div>
        <Dialog open={open} onOpenChange={v => { if (!v) resetForm(); setOpen(v); }}>
          <DialogTrigger asChild><Button><Plus className="h-4 w-4 mr-1" />新增工作站</Button></DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>{editId ? "編輯工作站" : "新增工作站"}</DialogTitle></DialogHeader>
            <div className="space-y-4">
              <div><label className="text-sm font-medium">名稱 *</label><Input value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} /></div>
              <div><label className="text-sm font-medium">描述</label><Input value={form.description} onChange={e => setForm(p => ({ ...p, description: e.target.value }))} /></div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div><label className="text-sm font-medium">產能（件/天）</label><Input type="number" min="1" value={form.productionCapacity} onChange={e => setForm(p => ({ ...p, productionCapacity: e.target.value }))} /></div>
                <div><label className="text-sm font-medium">時薪費率</label><Input type="number" min="0" value={form.hourRate} onChange={e => setForm(p => ({ ...p, hourRate: e.target.value }))} /></div>
              </div>
              <div>
                <label className="text-sm font-medium">狀態</label>
                <select className="w-full border rounded-md px-3 py-2 text-sm" value={form.status} onChange={e => setForm(p => ({ ...p, status: e.target.value }))}>
                  <option value="Active">啟用</option>
                  <option value="Inactive">已停用</option>
                </select>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => { setOpen(false); resetForm(); }}>取消</Button>
              <Button onClick={handleSave} disabled={!form.name}>儲存</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
      <Card>
        <CardContent className="p-0 overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="border-b bg-gray-50/50">
              <th className="w-10 px-2"><CheckboxHeader checked={batch.allSelected} indeterminate={batch.someSelected} onChange={batch.toggleAll} /></th>
              <th className="text-left px-4 py-2.5 font-semibold">名稱</th>
              <th className="text-left px-4 py-2.5 font-semibold">描述</th>
              <th className="text-right px-4 py-2.5 font-semibold">產能</th>
              <th className="text-right px-4 py-2.5 font-semibold">時薪費率</th>
              <th className="text-center px-4 py-2.5 font-semibold">狀態</th>
              <th className="text-center px-4 py-2.5 font-semibold">操作</th>
            </tr></thead>
            <tbody>
              {loading ? <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-400">載入中...</td></tr>
              : shown.length === 0 ? <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-400">{filter === "inactive" ? "沒有已停用的工作站" : "尚無資料"}</td></tr>
              : shown.map(w => (
                <tr key={w.id} className="border-b hover:bg-gray-50 cursor-pointer" onClick={() => openEdit(w)}>
                  <td className="px-2" onClick={e => e.stopPropagation()}><CheckboxCell checked={batch.selectedIds.has(w.id)} onChange={() => batch.toggle(w.id)} /></td>
                  <td className="px-4 py-2 font-medium">{w.name}</td>
                  <td className="px-4 py-2 text-gray-500">{w.description || "-"}</td>
                  <td className="px-4 py-2 text-right">{w.productionCapacity}</td>
                  <td className="px-4 py-2 text-right font-mono">${w.hourRate}</td>
                  <td className="px-4 py-2 text-center"><Badge variant={w.status === "Active" ? "default" : "secondary"}>{w.status === "Active" ? "啟用" : "停用"}</Badge></td>
                  <td className="px-4 py-2 text-center" onClick={e => e.stopPropagation()}>
                    <div className="flex gap-1 justify-center">
                      <Button size="sm" variant="outline" onClick={() => openEdit(w)}><Pencil className="h-3 w-3" /></Button>
                      <Button size="sm" variant="ghost" onClick={() => handleDelete(w.id)}><Trash2 className="h-3 w-3" /></Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
