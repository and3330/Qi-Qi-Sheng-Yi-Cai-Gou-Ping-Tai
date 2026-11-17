import { useState, useEffect, useCallback } from "react";
import { useAutoReloadKey } from "@/lib/auto-refresh";
import { PageHeader } from "@/components/shared/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { Plus, Pencil, Trash2, X } from "lucide-react";
import { useBatchSelection } from "@/hooks/use-batch-selection";
import { BatchActionBar } from "@/components/shared/batch-action-bar";
import { CheckboxCell, CheckboxHeader } from "@/components/shared/checkbox-column";

import { LookupSelect } from "@/components/shared/lookup-select";
const BASE = import.meta.env.BASE_URL.endsWith("/") ? import.meta.env.BASE_URL : import.meta.env.BASE_URL + "/";

interface Template { id: number; name: string; inspectionType: string; itemId: number | null; itemName: string; criteria: { name: string; specification: string; method: string }[]; remarks: string | null }
interface Item { id: number; itemName: string; itemCode: string }

const typeMap: Record<string, string> = { Incoming: "進料檢驗", "In Process": "製程檢驗", Outgoing: "出貨檢驗" };

export default function QualityTemplatesPage() {
  const reloadKey = useAutoReloadKey();
  const [templates, setTemplates] = useState<Template[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [form, setForm] = useState({ name: "", inspectionType: "Incoming", itemId: "", remarks: "" });
  const [criteria, setCriteria] = useState<{ name: string; specification: string; method: string }[]>([]);
  const { toast } = useToast();
  const batch = useBatchSelection(templates);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    const [tRes, iRes] = await Promise.all([fetch(`/erp-api/quality-inspection-templates`), fetch(`/erp-api/items`)]);
    setTemplates(await tRes.json()); setItems(await iRes.json());
    setLoading(false);
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll, reloadKey]);

  const resetForm = () => { setForm({ name: "", inspectionType: "Incoming", itemId: "", remarks: "" }); setCriteria([]); setEditId(null); };

  const openEdit = (t: Template) => {
    setEditId(t.id);
    setForm({ name: t.name, inspectionType: t.inspectionType, itemId: t.itemId ? String(t.itemId) : "", remarks: t.remarks || "" });
    setCriteria(t.criteria || []);
    setOpen(true);
  };

  const handleSave = async () => {
    const payload = { name: form.name, inspectionType: form.inspectionType, itemId: form.itemId ? Number(form.itemId) : null, criteria, remarks: form.remarks || null };
    const url = editId ? `/erp-api/quality-inspection-templates/${editId}` : `/erp-api/quality-inspection-templates`;
    const res = await fetch(url, { method: editId ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    if (res.ok) { toast({ title: editId ? "已更新" : "已建立" }); setOpen(false); resetForm(); fetchAll(); }
    else { const err = await res.json(); toast({ title: err.error, variant: "destructive" }); }
  };

  const handleDelete = async (id: number) => {
    const res = await fetch(`/erp-api/quality-inspection-templates/${id}`, { method: "DELETE" });
    if (res.ok) { toast({ title: "已刪除" }); fetchAll(); }
    else { const err = await res.json(); toast({ title: err.error, variant: "destructive" }); }
  };

  return (
    <div className="space-y-6">
      <PageHeader title="檢驗範本" description="定義品質檢驗標準與項目" />
      {batch.count > 0 && (
        <BatchActionBar
          count={batch.count}
          entityName="檢驗範本"
          entityEndpoint="quality-templates"
          ids={batch.ids}
          onClear={batch.clearSelection}
          onComplete={() => fetchAll()}
        />
      )}
      <div className="flex justify-end">
        <Dialog open={open} onOpenChange={v => { if (!v) resetForm(); setOpen(v); }}>
          <DialogTrigger asChild><Button><Plus className="h-4 w-4 mr-1" />新增範本</Button></DialogTrigger>
          <DialogContent className="md:max-w-2xl max-h-[85dvh] overflow-y-auto">
            <DialogHeader><DialogTitle>{editId ? "編輯範本" : "新增範本"}</DialogTitle></DialogHeader>
            <div className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div><label className="text-sm font-medium">範本名稱 *</label><Input value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} /></div>
                <div>
                  <label className="text-sm font-medium">檢驗類型</label>
                  <select className="w-full border rounded-md px-3 py-2 text-sm" value={form.inspectionType} onChange={e => setForm(p => ({ ...p, inspectionType: e.target.value }))}>
                    {Object.entries(typeMap).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label className="text-sm font-medium">對應品項</label>
                <LookupSelect className="w-full border rounded-md px-3 py-2 text-sm" value={form.itemId} onChange={e => setForm(p => ({ ...p, itemId: e.target.value }))}>
                  <option value="">不限品項</option>
                  {items.map(i => <option key={i.id} value={i.id}>{i.itemCode} - {i.itemName}</option>)}
                </LookupSelect>
              </div>
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-sm font-semibold">檢驗項目</label>
                  <Button size="sm" variant="outline" onClick={() => setCriteria(p => [...p, { name: "", specification: "", method: "" }])}><Plus className="h-3 w-3 mr-1" />新增項目</Button>
                </div>
                {criteria.map((c, i) => (
                  <div key={i} className="flex gap-2 mb-2 items-end">
                    <Input className="flex-1" value={c.name} onChange={e => setCriteria(p => p.map((x, j) => j === i ? { ...x, name: e.target.value } : x))} placeholder="項目名稱" />
                    <Input className="flex-1" value={c.specification} onChange={e => setCriteria(p => p.map((x, j) => j === i ? { ...x, specification: e.target.value } : x))} placeholder="規格" />
                    <Input className="w-24" value={c.method} onChange={e => setCriteria(p => p.map((x, j) => j === i ? { ...x, method: e.target.value } : x))} placeholder="方法" />
                    <Button size="sm" variant="ghost" onClick={() => setCriteria(p => p.filter((_, j) => j !== i))}><X className="h-3 w-3" /></Button>
                  </div>
                ))}
              </div>
              <div><label className="text-sm font-medium">備註</label><Input value={form.remarks} onChange={e => setForm(p => ({ ...p, remarks: e.target.value }))} /></div>
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
              <th className="text-left px-4 py-2.5 font-semibold">檢驗類型</th>
              <th className="text-left px-4 py-2.5 font-semibold">品項</th>
              <th className="text-center px-4 py-2.5 font-semibold">項目數</th>
              <th className="text-center px-4 py-2.5 font-semibold">操作</th>
            </tr></thead>
            <tbody>
              {loading ? <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-400">載入中...</td></tr>
              : templates.length === 0 ? <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-400">尚無資料</td></tr>
              : templates.map(t => (
                <tr key={t.id} className="border-b hover:bg-gray-50">
                  <td className="px-2"><CheckboxCell checked={batch.selectedIds.has(t.id)} onChange={() => batch.toggle(t.id)} /></td>
                  <td className="px-4 py-2 font-medium">{t.name}</td>
                  <td className="px-4 py-2"><Badge variant="secondary">{typeMap[t.inspectionType]}</Badge></td>
                  <td className="px-4 py-2 text-gray-500">{t.itemName || "不限"}</td>
                  <td className="px-4 py-2 text-center">{(t.criteria || []).length}</td>
                  <td className="px-4 py-2 text-center">
                    <div className="flex gap-1 justify-center">
                      <Button size="sm" variant="outline" onClick={() => openEdit(t)}><Pencil className="h-3 w-3" /></Button>
                      <Button size="sm" variant="ghost" onClick={() => handleDelete(t.id)}><Trash2 className="h-3 w-3" /></Button>
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
