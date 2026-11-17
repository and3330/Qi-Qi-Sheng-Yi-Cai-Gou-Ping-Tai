import { useState, useEffect, useCallback } from "react";
import { useAutoReloadKey } from "@/lib/auto-refresh";
import { PageHeader } from "@/components/shared/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { Plus, Pencil, Trash2 } from "lucide-react";
import { useBatchSelection } from "@/hooks/use-batch-selection";
import { BatchActionBar, type BatchField } from "@/components/shared/batch-action-bar";
import { CheckboxCell, CheckboxHeader } from "@/components/shared/checkbox-column";

const BASE = import.meta.env.BASE_URL.endsWith("/") ? import.meta.env.BASE_URL : import.meta.env.BASE_URL + "/";

interface AssetCategory {
  id: number; name: string; description: string | null;
  depreciationMethod: string; defaultUsefulLifeYears: number;
}

const methodMap: Record<string, string> = { "straight-line": "直線法", "declining": "定率遞減法" };

export default function AssetCategoriesPage() {
  const reloadKey = useAutoReloadKey();
  const [categories, setCategories] = useState<AssetCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [editItem, setEditItem] = useState<AssetCategory | null>(null);
  const [form, setForm] = useState({ name: "", description: "", depreciationMethod: "straight-line", defaultUsefulLifeYears: "5" });
  const { toast } = useToast();
  const batch = useBatchSelection(categories);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    const res = await fetch(`/erp-api/asset-categories`);
    setCategories(await res.json());
    setLoading(false);
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll, reloadKey]);

  const openCreate = () => {
    setEditItem(null);
    setForm({ name: "", description: "", depreciationMethod: "straight-line", defaultUsefulLifeYears: "5" });
    setOpen(true);
  };

  const openEdit = (cat: AssetCategory) => {
    setEditItem(cat);
    setForm({ name: cat.name, description: cat.description || "", depreciationMethod: cat.depreciationMethod, defaultUsefulLifeYears: String(cat.defaultUsefulLifeYears) });
    setOpen(true);
  };

  const handleSave = async () => {
    const payload = { ...form, defaultUsefulLifeYears: Number(form.defaultUsefulLifeYears) };
    const url = editItem ? `/erp-api/asset-categories/${editItem.id}` : `/erp-api/asset-categories`;
    const method = editItem ? "PATCH" : "POST";
    const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    if (res.ok) {
      toast({ title: editItem ? "類別已更新" : "類別已建立" });
      setOpen(false); fetchAll();
    } else {
      const err = await res.json();
      toast({ title: err.error || "操作失敗", variant: "destructive" });
    }
  };

  const handleDelete = async (id: number) => {
    const res = await fetch(`/erp-api/asset-categories/${id}`, { method: "DELETE" });
    if (res.ok) { toast({ title: "已刪除" }); fetchAll(); }
    else { const err = await res.json(); toast({ title: err.error || "刪除失敗", variant: "destructive" }); }
  };

  return (
    <div className="space-y-6">
      <PageHeader title="資產類別" description="管理固定資產類別，設定預設折舊方式與使用年限" />
      {batch.count > 0 && (
        <BatchActionBar
          count={batch.count}
          entityName="資產類別"
          entityEndpoint="asset-categories"
          ids={batch.ids}
          batchFields={[
            { key: "depreciationMethod", label: "折舊方式", type: "select", options: [{ value: "straight-line", label: "直線法" }, { value: "declining", label: "定率遞減法" }] },
            { key: "defaultUsefulLifeYears", label: "預設使用年限（年）", type: "number" },
            { key: "description", label: "說明", type: "text", clearable: true },
          ] as BatchField[]}
          onClear={batch.clearSelection}
          onComplete={() => fetchAll()}
        />
      )}
      <div className="flex justify-end">
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild><Button onClick={openCreate}><Plus className="h-4 w-4 mr-1" />新增類別</Button></DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>{editItem ? "編輯類別" : "新增類別"}</DialogTitle></DialogHeader>
            <div className="space-y-4">
              <div><label className="text-sm font-medium">名稱 *</label><Input value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} placeholder="例：電腦設備" /></div>
              <div><label className="text-sm font-medium">說明</label><Input value={form.description} onChange={e => setForm(p => ({ ...p, description: e.target.value }))} placeholder="類別說明" /></div>
              <div>
                <label className="text-sm font-medium">折舊方式</label>
                <select className="w-full border rounded-md px-3 py-2 text-sm" value={form.depreciationMethod} onChange={e => setForm(p => ({ ...p, depreciationMethod: e.target.value }))}>
                  <option value="straight-line">直線法</option>
                  <option value="declining">定率遞減法</option>
                </select>
              </div>
              <div><label className="text-sm font-medium">預設使用年限</label><Input type="number" min="1" value={form.defaultUsefulLifeYears} onChange={e => setForm(p => ({ ...p, defaultUsefulLifeYears: e.target.value }))} /></div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setOpen(false)}>取消</Button>
              <Button onClick={handleSave} disabled={!form.name}>{editItem ? "更新" : "建立"}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
      <Card>
        <CardHeader className="py-3 border-b"><CardTitle>類別列表</CardTitle></CardHeader>
        <CardContent className="p-0 overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="border-b bg-gray-50/50">
              <th className="w-10 px-2"><CheckboxHeader checked={batch.allSelected} indeterminate={batch.someSelected} onChange={batch.toggleAll} /></th>
              <th className="text-left px-4 py-2.5 font-semibold">名稱</th>
              <th className="text-left px-4 py-2.5 font-semibold">說明</th>
              <th className="text-left px-4 py-2.5 font-semibold">折舊方式</th>
              <th className="text-center px-4 py-2.5 font-semibold">使用年限</th>
              <th className="text-center px-4 py-2.5 font-semibold">操作</th>
            </tr></thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-400">載入中...</td></tr>
              ) : categories.length === 0 ? (
                <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-400">尚無資料</td></tr>
              ) : categories.map(c => (
                <tr key={c.id} className="border-b hover:bg-gray-50 cursor-pointer" onClick={() => openEdit(c)}>
                  <td className="px-2" onClick={e => e.stopPropagation()}><CheckboxCell checked={batch.selectedIds.has(c.id)} onChange={() => batch.toggle(c.id)} /></td>
                  <td className="px-4 py-2 font-medium">{c.name}</td>
                  <td className="px-4 py-2 text-gray-500">{c.description || "-"}</td>
                  <td className="px-4 py-2">{methodMap[c.depreciationMethod] || c.depreciationMethod}</td>
                  <td className="px-4 py-2 text-center">{c.defaultUsefulLifeYears} 年</td>
                  <td className="px-4 py-2 text-center" onClick={e => e.stopPropagation()}>
                    <div className="flex gap-1 justify-center">
                      <Button size="sm" variant="outline" onClick={() => openEdit(c)}><Pencil className="h-3 w-3" /></Button>
                      <Button size="sm" variant="ghost" onClick={() => handleDelete(c.id)}><Trash2 className="h-3 w-3" /></Button>
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
