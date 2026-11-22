import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { DataTable } from "@/components/shared/data-table";
import { PageHeader } from "@/components/shared/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { DocWindow, DocStatus } from "@/components/shared/doc-window";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { call, post, selectClass } from "@/lib/call";
import { Pencil, Plus } from "lucide-react";

interface Warehouse { id: number; name: string; location: string | null; isActive: boolean }
const emptyForm = { name: "", location: "", isActive: true };

/**
 * 倉庫管理：可以新增、編輯、停用。
 * 停用的倉庫開單時不會出現在選單裡，但原本的庫存紀錄與單據都還在；這一頁可以用「狀態」篩出已停用的。
 */
export default function WarehousesPage() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { data: warehouses, isLoading } = useQuery({ queryKey: ["/warehouses", "all"], queryFn: () => call<Warehouse[]>("warehouses?includeInactive=1") });
  const [scope, setScope] = useState("active");
  const [keyword, setKeyword] = useState("");
  const [editing, setEditing] = useState<Warehouse | null>(null);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());

  const term = keyword.trim().toLowerCase();
  const rows = (warehouses ?? []).filter(w =>
    (scope === "all" || (scope === "active" ? w.isActive : !w.isActive))
    && (!term || w.name.toLowerCase().includes(term) || (w.location || "").toLowerCase().includes(term)));
  const inactiveCount = (warehouses ?? []).filter(w => !w.isActive).length;

  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["/warehouses"] }),
      queryClient.invalidateQueries({ queryKey: ["/erp-api/warehouses"] }),
      queryClient.invalidateQueries({ queryKey: ["master-lookup", "warehouses"] }),
    ]);
  };
  const openCreate = () => { setEditing(null); setForm(emptyForm); setOpen(true); };
  const openEdit = (w: Warehouse) => { setEditing(w); setForm({ name: w.name, location: w.location || "", isActive: w.isActive }); setOpen(true); };
  const save = async () => {
    setSaving(true);
    try {
      if (editing) await post(`warehouses/${editing.id}`, form, "PATCH");
      else await post("warehouses", form);
      toast({ title: editing ? "已更新倉庫" : "已新增倉庫" });
      setOpen(false);
      await refresh();
    } catch (e) {
      toast({ title: "沒有成功", description: e instanceof Error ? e.message : "請稍後再試", variant: "destructive" });
    } finally { setSaving(false); }
  };
  const setActive = async (ids: number[], isActive: boolean) => {
    try {
      for (const id of ids) await post(`warehouses/${id}`, { isActive }, "PATCH");
      toast({ title: isActive ? `已啟用 ${ids.length} 個倉庫` : `已停用 ${ids.length} 個倉庫` });
      setSelected(new Set());
      await refresh();
    } catch (e) {
      toast({ title: "沒有成功", description: e instanceof Error ? e.message : "請稍後再試", variant: "destructive" });
    }
  };
  const toggle = (id: number) => setSelected(prev => { const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next; });
  const allSelected = rows.length > 0 && rows.every(w => selected.has(w.id));

  return (
    <div className="space-y-4 md:space-y-6">
      <PageHeader title="倉庫管理" description="倉庫可以新增、編輯、停用。停用的倉庫開單時不會出現，原本的紀錄都還在。"
        action={<Button onClick={openCreate} data-testid="button-new-warehouse"><Plus className="h-4 w-4 mr-1" />新增倉庫</Button>} />

      <Card><CardContent className="flex flex-wrap items-end gap-3 p-4">
        <div className="min-w-[200px] flex-1 space-y-1">
          <Label htmlFor="wh-search">搜尋</Label>
          <Input id="wh-search" value={keyword} onChange={e => setKeyword(e.target.value)} placeholder="倉庫名稱、地點…" />
        </div>
        <div className="space-y-1">
          <Label htmlFor="wh-scope">狀態</Label>
          <select id="wh-scope" className={selectClass} value={scope} onChange={e => { setScope(e.target.value); setSelected(new Set()); }} data-testid="select-warehouse-scope">
            <option value="active">啟用中</option>
            <option value="inactive">已停用（{inactiveCount}）</option>
            <option value="all">全部</option>
          </select>
        </div>
        {selected.size > 0 && (
          <div className="flex basis-full flex-wrap items-center gap-2 rounded-md border bg-muted/40 px-3 py-2 text-sm">
            <span>已選 {selected.size} 個</span>
            <Button size="sm" variant="outline" onClick={() => setActive([...selected], false)}>批次停用</Button>
            <Button size="sm" variant="outline" onClick={() => setActive([...selected], true)}>批次啟用</Button>
            <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>取消選取</Button>
          </div>
        )}
      </CardContent></Card>

      <Card>
        <CardContent className="p-0 overflow-x-auto">
          <DataTable
            isLoading={isLoading}
            data={rows}
            onRowClick={(w: Warehouse) => openEdit(w)}
            emptyMessage={scope === "inactive" ? "沒有已停用的倉庫" : "沒有符合的倉庫"}
            columns={[
              {
                header: () => <input type="checkbox" aria-label="全選" checked={allSelected} onChange={() => setSelected(allSelected ? new Set() : new Set(rows.map(w => w.id)))} />,
                accessor: (w: Warehouse) => <span onClick={e => e.stopPropagation()}><input type="checkbox" aria-label={`選取 ${w.name}`} checked={selected.has(w.id)} onChange={() => toggle(w.id)} /></span>,
                className: "w-10 px-2",
              },
              { header: "倉庫名稱", accessor: (w: Warehouse) => <span className="font-medium">{w.name}</span> },
              { header: "地點／說明", accessor: (w: Warehouse) => w.location || "-" },
              { header: "狀態", accessor: (w: Warehouse) => <Badge variant={w.isActive ? "default" : "secondary"}>{w.isActive ? "啟用" : "已停用"}</Badge> },
              {
                header: "操作",
                accessor: (w: Warehouse) => (
                  <div className="flex gap-1" onClick={e => e.stopPropagation()}>
                    <Button size="sm" variant="outline" className="h-8" onClick={() => openEdit(w)}><Pencil className="h-3.5 w-3.5 mr-1" />編輯</Button>
                    <Button size="sm" variant="ghost" className="h-8" onClick={() => setActive([w.id], !w.isActive)}>{w.isActive ? "停用" : "啟用"}</Button>
                  </div>
                ),
                className: "w-40",
              },
            ]}
          />
        </CardContent>
      </Card>

      {/* 新增／編輯倉庫：外框用全系統共用的單據視窗 */}
      <DocWindow
        open={open}
        onClose={() => setOpen(false)}
        name={editing ? `編輯倉庫：${editing.name}` : "新增倉庫"} layoutKey="倉庫"
        status={editing && !editing.isActive ? <DocStatus label="已停用" tone="outline" /> : undefined}
        description="停用後，開單時的倉庫選單不會再出現這個倉庫；原本的庫存紀錄與單據不受影響。"
        footer={<>
            <Button variant="outline" onClick={() => setOpen(false)}>取消</Button>
            <Button onClick={save} disabled={saving || !form.name.trim()} data-testid="button-save-warehouse">{saving ? "儲存中…" : "儲存"}</Button>
        </>}
      >
          <div className="space-y-4">
            <div className="space-y-1.5"><Label htmlFor="wh-name">倉庫名稱</Label><Input id="wh-name" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} /></div>
            <div className="space-y-1.5"><Label htmlFor="wh-location">地點／說明</Label><Input id="wh-location" value={form.location} onChange={e => setForm(f => ({ ...f, location: e.target.value }))} /></div>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.isActive} onChange={e => setForm(f => ({ ...f, isActive: e.target.checked }))} />啟用（取消勾選就是停用）</label>
          </div>
      </DocWindow>
    </div>
  );
}
