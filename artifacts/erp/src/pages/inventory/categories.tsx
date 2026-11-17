import { useState, useEffect, useCallback } from "react";
import { PageHeader } from "@/components/shared/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { Plus, Pencil, Trash2, Search } from "lucide-react";
import { useBatchSelection } from "@/hooks/use-batch-selection";
import { BatchActionBar } from "@/components/shared/batch-action-bar";
import { CheckboxCell, CheckboxHeader } from "@/components/shared/checkbox-column";
import { useAutoReloadKey } from "@/lib/auto-refresh";

const BASE = import.meta.env.BASE_URL.endsWith("/") ? import.meta.env.BASE_URL : import.meta.env.BASE_URL + "/";

interface ItemCategory {
  id: number;
  name: string;
  description: string | null;
}

export default function ItemCategoriesPage() {
  const reloadKey = useAutoReloadKey();
  const [categories, setCategories] = useState<ItemCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [editItem, setEditItem] = useState<ItemCategory | null>(null);
  const [form, setForm] = useState({ name: "", description: "" });
  const [search, setSearch] = useState("");
  const { toast } = useToast();

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/erp-api/item-categories`, { credentials: "include" });
      setCategories(await res.json());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll, reloadKey]);

  const openCreate = () => {
    setEditItem(null);
    setForm({ name: "", description: "" });
    setOpen(true);
  };

  const openEdit = (cat: ItemCategory) => {
    setEditItem(cat);
    setForm({ name: cat.name, description: cat.description || "" });
    setOpen(true);
  };

  const handleSave = async () => {
    const url = editItem ? `/erp-api/item-categories/${editItem.id}` : `/erp-api/item-categories`;
    const method = editItem ? "PATCH" : "POST";
    const res = await fetch(url, {
      method,
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    if (res.ok) {
      toast({ title: editItem ? "分類已更新" : "分類已建立" });
      setOpen(false);
      fetchAll();
    } else {
      const err = await res.json().catch(() => ({ error: "操作失敗" }));
      toast({ title: err.error || "操作失敗", variant: "destructive" });
    }
  };

  const handleDelete = async (cat: ItemCategory) => {
    if (!confirm(`確定刪除分類「${cat.name}」？`)) return;
    const res = await fetch(`/erp-api/item-categories/${cat.id}`, { method: "DELETE", credentials: "include" });
    if (res.ok) {
      toast({ title: "已刪除" });
      fetchAll();
    } else {
      const err = await res.json().catch(() => ({ error: "刪除失敗" }));
      toast({ title: err.error || "刪除失敗", variant: "destructive" });
    }
  };

  const filtered = categories.filter((c) =>
    !search ||
    c.name.toLowerCase().includes(search.toLowerCase()) ||
    (c.description || "").toLowerCase().includes(search.toLowerCase()),
  );

  const batch = useBatchSelection(filtered);

  return (
    <div className="space-y-6" data-testid="page-item-categories">
      <PageHeader title="品項分類" description="管理庫存品項的分類，建立後在新增/編輯品項時可選用" />
      {batch.count > 0 && (
        <BatchActionBar
          count={batch.count}
          entityName="品項分類"
          entityEndpoint="item-categories"
          ids={batch.ids}
          batchFields={[{ key: "description", label: "說明", type: "text" }]}
          onClear={batch.clearSelection}
          onComplete={() => fetchAll()}
        />
      )}
      <div className="flex items-center justify-between gap-2">
        <div className="relative max-w-sm flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder="搜尋分類..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-10" data-testid="input-search" />
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button onClick={openCreate} data-testid="button-create"><Plus className="h-4 w-4 mr-1" />新增分類</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>{editItem ? "編輯分類" : "新增分類"}</DialogTitle></DialogHeader>
            <div className="space-y-4">
              <div>
                <label className="text-sm font-medium">名稱 *</label>
                <Input
                  value={form.name}
                  onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
                  placeholder="例：文具用品"
                  data-testid="input-name"
                />
              </div>
              <div>
                <label className="text-sm font-medium">說明</label>
                <Input
                  value={form.description}
                  onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))}
                  placeholder="分類說明（選填）"
                  data-testid="input-description"
                />
              </div>
              {editItem && (
                <div className="text-xs text-muted-foreground">
                  ⚠️ 修改名稱會同步更新所有使用此分類的品項
                </div>
              )}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setOpen(false)}>取消</Button>
              <Button onClick={handleSave} disabled={!form.name.trim()} data-testid="button-save">
                {editItem ? "更新" : "建立"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
      <Card>
        <CardHeader className="py-3 border-b">
          <CardTitle className="text-base">分類列表（共 {filtered.length} 個）</CardTitle>
        </CardHeader>
        <CardContent className="p-0 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/40">
                <th className="w-10 px-2"><CheckboxHeader checked={batch.allSelected} indeterminate={batch.someSelected} onChange={batch.toggleAll} /></th>
                <th className="text-left px-4 py-2.5 font-semibold">名稱</th>
                <th className="text-left px-4 py-2.5 font-semibold">說明</th>
                <th className="text-center px-4 py-2.5 font-semibold w-[140px]">操作</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={4} className="px-4 py-8 text-center text-muted-foreground">載入中...</td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan={4} className="px-4 py-8 text-center text-muted-foreground">{search ? "查無符合分類" : "尚無分類，點「新增分類」開始"}</td></tr>
              ) : filtered.map((c) => (
                <tr key={c.id} className="border-b hover:bg-muted/30" data-testid={`row-category-${c.id}`}>
                  <td className="px-2"><CheckboxCell checked={batch.selectedIds.has(c.id)} onChange={() => batch.toggle(c.id)} /></td>
                  <td className="px-4 py-2 font-medium">{c.name}</td>
                  <td className="px-4 py-2 text-muted-foreground">{c.description || "-"}</td>
                  <td className="px-4 py-2 text-center">
                    <div className="flex gap-1 justify-center">
                      <Button size="sm" variant="outline" onClick={() => openEdit(c)} data-testid={`button-edit-${c.id}`}><Pencil className="h-3 w-3" /></Button>
                      <Button size="sm" variant="ghost" onClick={() => handleDelete(c)} data-testid={`button-delete-${c.id}`}><Trash2 className="h-3 w-3" /></Button>
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
