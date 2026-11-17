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

interface ItemType {
  id: number;
  name: string;
  label: string | null;
  colorClass: string | null;
  description: string | null;
}

const COLOR_PRESETS = [
  { label: "灰色（預設）", value: "bg-gray-100 text-gray-800" },
  { label: "藍色", value: "bg-blue-100 text-blue-800" },
  { label: "綠色", value: "bg-green-100 text-green-800" },
  { label: "黃色", value: "bg-yellow-100 text-yellow-800" },
  { label: "橘色", value: "bg-orange-100 text-orange-800" },
  { label: "紅色", value: "bg-red-100 text-red-800" },
  { label: "紫色", value: "bg-purple-100 text-purple-800" },
  { label: "粉色", value: "bg-pink-100 text-pink-800" },
  { label: "青色", value: "bg-teal-100 text-teal-800" },
];

export default function ItemTypesPage() {
  const reloadKey = useAutoReloadKey();
  const [rows, setRows] = useState<ItemType[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [editItem, setEditItem] = useState<ItemType | null>(null);
  const [form, setForm] = useState({ name: "", label: "", colorClass: "", description: "" });
  const [search, setSearch] = useState("");
  const { toast } = useToast();

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/erp-api/item-types`, { credentials: "include" });
      setRows(await res.json());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll, reloadKey]);

  const openCreate = () => {
    setEditItem(null);
    setForm({ name: "", label: "", colorClass: "", description: "" });
    setOpen(true);
  };

  const openEdit = (row: ItemType) => {
    setEditItem(row);
    setForm({ name: row.name, label: row.label || "", colorClass: row.colorClass || "", description: row.description || "" });
    setOpen(true);
  };

  const handleSave = async () => {
    const url = editItem ? `/erp-api/item-types/${editItem.id}` : `/erp-api/item-types`;
    const method = editItem ? "PATCH" : "POST";
    const res = await fetch(url, {
      method,
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    if (res.ok) {
      toast({ title: editItem ? "類型已更新" : "類型已建立" });
      setOpen(false);
      fetchAll();
    } else {
      const err = await res.json().catch(() => ({ error: "操作失敗" }));
      toast({ title: err.error || "操作失敗", variant: "destructive" });
    }
  };

  const handleDelete = async (row: ItemType) => {
    if (!confirm(`確定刪除類型「${row.label || row.name}」？`)) return;
    const res = await fetch(`/erp-api/item-types/${row.id}`, { method: "DELETE", credentials: "include" });
    if (res.ok) {
      toast({ title: "已刪除" });
      fetchAll();
    } else {
      const err = await res.json().catch(() => ({ error: "刪除失敗" }));
      toast({ title: err.error || "刪除失敗", variant: "destructive" });
    }
  };

  const filtered = rows.filter((r) =>
    !search ||
    r.name.toLowerCase().includes(search.toLowerCase()) ||
    (r.label || "").toLowerCase().includes(search.toLowerCase()),
  );

  const batch = useBatchSelection(filtered);

  return (
    <div className="space-y-6" data-testid="page-item-types">
      <PageHeader title="品項類型" description="管理品項類型（如商品、原料、半成品等），可自訂顯示文字與顏色標籤" />
      {batch.count > 0 && (
        <BatchActionBar
          count={batch.count}
          entityName="品項類型"
          entityEndpoint="item-types"
          ids={batch.ids}
          batchFields={[
            { key: "label", label: "顯示文字", type: "text" },
            { key: "colorClass", label: "顏色 CSS class", type: "select", options: COLOR_PRESETS.map(c => ({ value: c.value, label: c.label })) },
          ]}
          onClear={batch.clearSelection}
          onComplete={() => fetchAll()}
        />
      )}
      <div className="flex items-center justify-between gap-2">
        <div className="relative max-w-sm flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder="搜尋類型..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-10" data-testid="input-search" />
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button onClick={openCreate} data-testid="button-create"><Plus className="h-4 w-4 mr-1" />新增類型</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>{editItem ? "編輯類型" : "新增類型"}</DialogTitle></DialogHeader>
            <div className="space-y-4">
              <div>
                <label className="text-sm font-medium">內部名稱 *</label>
                <Input
                  value={form.name}
                  onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
                  placeholder="例：商品 / 原料 / Service"
                  data-testid="input-name"
                />
                <p className="text-xs text-muted-foreground mt-1">儲存於品項資料中的實際值</p>
              </div>
              <div>
                <label className="text-sm font-medium">顯示文字</label>
                <Input
                  value={form.label}
                  onChange={(e) => setForm((p) => ({ ...p, label: e.target.value }))}
                  placeholder="顯示在介面上的中文（選填，留空就用內部名稱）"
                  data-testid="input-label"
                />
              </div>
              <div>
                <label className="text-sm font-medium">顏色標籤</label>
                <select
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  value={form.colorClass}
                  onChange={(e) => setForm((p) => ({ ...p, colorClass: e.target.value }))}
                  data-testid="select-color"
                >
                  <option value="">不指定（預設灰色）</option>
                  {COLOR_PRESETS.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
                </select>
                {form.colorClass && (
                  <span className={`inline-block mt-2 px-2 py-0.5 rounded-full text-xs font-medium ${form.colorClass}`}>
                    {form.label || form.name || "預覽"}
                  </span>
                )}
              </div>
              <div>
                <label className="text-sm font-medium">說明</label>
                <Input
                  value={form.description}
                  onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))}
                  placeholder="類型說明（選填）"
                  data-testid="input-description"
                />
              </div>
              {editItem && (
                <div className="text-xs text-muted-foreground">
                  ⚠️ 修改內部名稱會同步更新所有使用此類型的品項
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
          <CardTitle className="text-base">類型列表（共 {filtered.length} 個）</CardTitle>
        </CardHeader>
        <CardContent className="p-0 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/40">
                <th className="w-10 px-2"><CheckboxHeader checked={batch.allSelected} indeterminate={batch.someSelected} onChange={batch.toggleAll} /></th>
                <th className="text-left px-4 py-2.5 font-semibold">內部名稱</th>
                <th className="text-left px-4 py-2.5 font-semibold">顯示</th>
                <th className="text-left px-4 py-2.5 font-semibold">說明</th>
                <th className="text-center px-4 py-2.5 font-semibold w-[140px]">操作</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">載入中...</td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">{search ? "查無符合類型" : "尚無類型，點「新增類型」開始"}</td></tr>
              ) : filtered.map((r) => (
                <tr key={r.id} className="border-b hover:bg-muted/30" data-testid={`row-type-${r.id}`}>
                  <td className="px-2"><CheckboxCell checked={batch.selectedIds.has(r.id)} onChange={() => batch.toggle(r.id)} /></td>
                  <td className="px-4 py-2 font-mono text-xs">{r.name}</td>
                  <td className="px-4 py-2">
                    <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${r.colorClass || "bg-gray-100 text-gray-800"}`}>
                      {r.label || r.name}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-muted-foreground">{r.description || "-"}</td>
                  <td className="px-4 py-2 text-center">
                    <div className="flex gap-1 justify-center">
                      <Button size="sm" variant="outline" onClick={() => openEdit(r)} data-testid={`button-edit-${r.id}`}><Pencil className="h-3 w-3" /></Button>
                      <Button size="sm" variant="ghost" onClick={() => handleDelete(r)} data-testid={`button-delete-${r.id}`}><Trash2 className="h-3 w-3" /></Button>
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
