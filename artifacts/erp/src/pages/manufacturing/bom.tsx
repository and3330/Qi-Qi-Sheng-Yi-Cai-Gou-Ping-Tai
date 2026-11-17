import { useState, useEffect, useCallback, useMemo } from "react";
import { useAutoReloadKey } from "@/lib/auto-refresh";
import { PageHeader } from "@/components/shared/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { Plus, Eye, Trash2, X, Pencil, Search } from "lucide-react";
import { useBatchSelection } from "@/hooks/use-batch-selection";
import { BatchActionBar, type BatchField } from "@/components/shared/batch-action-bar";
import { CheckboxCell, CheckboxHeader } from "@/components/shared/checkbox-column";
import { LookupSelect } from "@/components/shared/lookup-select";

/**
 * 物料清單（BOM）：做一批成品要用哪些原料、各多少。
 * 每一列可以點開看明細；可以編輯成品數量與原料；清單有「已停用」篩選。
 * 開工單時會把當下的原料抄一份到工單，所以之後改清單不會動到已經開出去的工單。
 */
interface BomListItem { id: number; bomNumber: string; itemId: number; itemName: string; itemCode: string; version: number; quantity: number; unit: string; status: string; remarks: string | null; componentCount: number; materialCost: number }
interface BomLine { id: number; itemId: number; itemName: string; itemCode: string; quantity: number; rate: number; amount: number; unit: string; currentUnitCost: number; currentCost: number }
interface BomDetail extends BomListItem { items: BomLine[]; estimatedMaterialCost: number; estimatedUnitCost: number }
interface Item { id: number; itemName: string; itemCode: string; buyingPrice: number; unit?: string; status?: string }
type FormLine = { itemId: string; quantity: string; rate: string; unit: string };

const statusMap: Record<string, string> = { Draft: "草稿", Active: "啟用", Inactive: "已停用" };
const money = (n: number) => `$${(Math.round((Number(n) || 0) * 100) / 100).toLocaleString()}`;
const emptyForm = { itemId: "", quantity: "1", remarks: "" };

export default function BomPage() {
  const reloadKey = useAutoReloadKey();
  const [boms, setBoms] = useState<BomListItem[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<BomDetail | null>(null);
  const [detail, setDetail] = useState<BomDetail | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [formItems, setFormItems] = useState<FormLine[]>([]);
  const [saving, setSaving] = useState(false);
  const [filter, setFilter] = useState<"open" | "Draft" | "Active" | "Inactive" | "all">("open");
  const [search, setSearch] = useState("");
  const { toast } = useToast();

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return boms.filter(b => (filter === "all" || (filter === "open" ? b.status !== "Inactive" : b.status === filter))
      && (!q || `${b.bomNumber} ${b.itemCode} ${b.itemName}`.toLowerCase().includes(q)));
  }, [boms, filter, search]);
  const batch = useBatchSelection(filtered);
  const bomBatchFields: BatchField[] = [
    { key: "status", label: "狀態", type: "select", options: [{ value: "Active", label: "啟用" }, { value: "Inactive", label: "停用" }] },
  ];

  const fetchAll = useCallback(async () => {
    setLoading(true);
    const [bRes, iRes] = await Promise.all([fetch(`/erp-api/boms`), fetch(`/erp-api/items`)]);
    setBoms(bRes.ok ? await bRes.json() : []); setItems(iRes.ok ? await iRes.json() : []);
    setLoading(false);
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll, reloadKey]);

  const addItem = () => setFormItems(p => [...p, { itemId: "", quantity: "1", rate: "0", unit: "" }]);
  const removeItem = (i: number) => setFormItems(p => p.filter((_, idx) => idx !== i));
  const updateItem = (i: number, field: keyof FormLine, value: string) => {
    setFormItems(p => p.map((item, idx) => {
      if (idx !== i) return item;
      const updated = { ...item, [field]: value };
      if (field === "itemId") {
        const found = items.find(it => it.id === Number(value));
        if (found) { updated.rate = String(found.buyingPrice ?? 0); updated.unit = found.unit || ""; }
      }
      return updated;
    }));
  };

  const openCreate = () => { setEditing(null); setForm(emptyForm); setFormItems([{ itemId: "", quantity: "1", rate: "0", unit: "" }]); setOpen(true); };
  const fetchDetail = async (id: number): Promise<BomDetail | null> => { const res = await fetch(`/erp-api/boms/${id}`); return res.ok ? res.json() : null; };
  const viewDetail = async (id: number) => { const d = await fetchDetail(id); if (d) setDetail(d); };
  const openEdit = async (id: number) => {
    const d = await fetchDetail(id);
    if (!d) return;
    setDetail(null);
    setEditing(d);
    setForm({ itemId: String(d.itemId), quantity: String(d.quantity), remarks: d.remarks || "" });
    setFormItems(d.items.map(l => ({ itemId: String(l.itemId), quantity: String(l.quantity), rate: String(l.rate), unit: l.unit })));
    setOpen(true);
  };

  const handleSave = async () => {
    const lines = formItems.filter(fi => fi.itemId).map(fi => ({ itemId: Number(fi.itemId), quantity: Number(fi.quantity), rate: Number(fi.rate), unit: fi.unit }));
    setSaving(true);
    try {
      const res = editing
        ? await fetch(`/erp-api/boms/${editing.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ quantity: Number(form.quantity), remarks: form.remarks || null, items: lines }) })
        : await fetch(`/erp-api/boms`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ itemId: Number(form.itemId), quantity: Number(form.quantity), remarks: form.remarks || null, items: lines }) });
      if (res.ok) { toast({ title: editing ? "物料清單已更新" : "物料清單已建立" }); setOpen(false); fetchAll(); }
      else { const err = await res.json().catch(() => ({})); toast({ title: err.error || "儲存失敗", variant: "destructive" }); }
    } finally { setSaving(false); }
  };

  const updateStatus = async (id: number, status: string) => {
    const res = await fetch(`/erp-api/boms/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status }) });
    if (res.ok) { toast({ title: `已改為${statusMap[status]}` }); fetchAll(); if (detail?.id === id) viewDetail(id); }
    else { const err = await res.json().catch(() => ({})); toast({ title: err.error || "操作失敗", variant: "destructive" }); }
  };

  const handleDelete = async (id: number) => {
    if (!confirm("確定刪除這張草稿？")) return;
    const res = await fetch(`/erp-api/boms/${id}`, { method: "DELETE" });
    if (res.ok) { toast({ title: "已刪除" }); fetchAll(); setDetail(null); }
    else { const err = await res.json().catch(() => ({})); toast({ title: err.error || "刪除失敗", variant: "destructive" }); }
  };

  const totalCost = formItems.reduce((s, fi) => s + (Number(fi.quantity) || 0) * (Number(fi.rate) || 0), 0);
  const perUnit = Number(form.quantity) > 0 ? totalCost / Number(form.quantity) : 0;
  const usableItems = (currentId: string) => items.filter(i => (i.status !== "Inactive" && i.status !== "停用") || String(i.id) === currentId);
  const chip = (active: boolean) => `shrink-0 rounded-full border px-3 py-1.5 text-sm transition-colors ${active ? "border-primary bg-primary text-primary-foreground" : "bg-background hover:bg-muted"}`;
  const count = (s: string) => boms.filter(b => b.status === s).length;

  return (
    <div className="space-y-4">
      <PageHeader title="物料清單 (BOM)" description="做一批成品要用哪些原料、各多少；開工單時會照這張清單領料">
        <Button onClick={openCreate}><Plus className="h-4 w-4 mr-1" />新增物料清單</Button>
      </PageHeader>

      <div className="flex flex-col gap-2 md:flex-row md:items-center">
        <div className="flex gap-2 overflow-x-auto pb-1" role="tablist" aria-label="狀態">
          <button type="button" className={chip(filter === "open")} onClick={() => setFilter("open")}>使用中（{boms.length - count("Inactive")}）</button>
          <button type="button" className={chip(filter === "Draft")} onClick={() => setFilter("Draft")}>草稿（{count("Draft")}）</button>
          <button type="button" className={chip(filter === "Active")} onClick={() => setFilter("Active")}>啟用（{count("Active")}）</button>
          <button type="button" className={chip(filter === "Inactive")} onClick={() => setFilter("Inactive")} data-testid="bom-filter-inactive">已停用（{count("Inactive")}）</button>
          <button type="button" className={chip(filter === "all")} onClick={() => setFilter("all")}>全部</button>
        </div>
        <div className="relative md:ml-auto md:w-72">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input className="pl-9" placeholder="搜尋編號、成品" value={search} onChange={e => setSearch(e.target.value)} aria-label="搜尋物料清單" />
        </div>
      </div>

      {batch.count > 0 && (
        <BatchActionBar count={batch.count} entityName="物料清單" entityEndpoint="boms" ids={batch.ids} batchFields={bomBatchFields} allowDelete={false} onClear={batch.clearSelection} onComplete={() => fetchAll()} />
      )}

      <Card>
        <CardContent className="p-0 overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="border-b bg-gray-50/50">
              <th className="w-10 px-2"><CheckboxHeader checked={batch.allSelected} indeterminate={batch.someSelected} onChange={batch.toggleAll} /></th>
              <th className="text-left px-4 py-2.5 font-semibold">編號</th>
              <th className="text-left px-4 py-2.5 font-semibold">成品</th>
              <th className="text-center px-4 py-2.5 font-semibold">版本</th>
              <th className="text-right px-4 py-2.5 font-semibold">產出數量</th>
              <th className="text-right px-4 py-2.5 font-semibold">原料</th>
              <th className="text-right px-4 py-2.5 font-semibold">目前材料成本</th>
              <th className="text-center px-4 py-2.5 font-semibold">狀態</th>
              <th className="text-center px-4 py-2.5 font-semibold">操作</th>
            </tr></thead>
            <tbody>
              {loading ? <tr><td colSpan={9} className="px-4 py-8 text-center text-gray-400">載入中...</td></tr>
              : filtered.length === 0 ? <tr><td colSpan={9} className="px-4 py-8 text-center text-gray-400">{boms.length === 0 ? "還沒有物料清單，按右上角建立第一張" : "沒有符合條件的物料清單"}</td></tr>
              : filtered.map(b => (
                <tr key={b.id} className="border-b hover:bg-gray-50 cursor-pointer" onClick={() => viewDetail(b.id)} data-testid={`bom-row-${b.id}`}>
                  <td className="px-2" onClick={e => e.stopPropagation()}><CheckboxCell checked={batch.selectedIds.has(b.id)} onChange={() => batch.toggle(b.id)} /></td>
                  <td className="px-4 py-2 font-mono">{b.bomNumber}</td>
                  <td className="px-4 py-2">{b.itemCode} - {b.itemName}</td>
                  <td className="px-4 py-2 text-center">v{b.version}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{b.quantity} {b.unit !== "Nos" ? b.unit : ""}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{b.componentCount === 0 ? <span className="text-amber-600">尚未設定</span> : `${b.componentCount} 項`}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{money(b.materialCost)}</td>
                  <td className="px-4 py-2 text-center"><Badge variant={b.status === "Active" ? "default" : "secondary"}>{statusMap[b.status] || b.status}</Badge></td>
                  <td className="px-4 py-2 text-center" onClick={e => e.stopPropagation()}>
                    <div className="flex gap-1 justify-center">
                      <Button size="sm" variant="outline" onClick={() => viewDetail(b.id)} title="檢視" aria-label="檢視"><Eye className="h-3 w-3" /></Button>
                      <Button size="sm" variant="outline" onClick={() => openEdit(b.id)} title="編輯" aria-label="編輯物料清單"><Pencil className="h-3 w-3" /></Button>
                      {b.status === "Draft" && <Button size="sm" variant="ghost" onClick={() => handleDelete(b.id)} title="刪除" aria-label="刪除"><Trash2 className="h-3 w-3" /></Button>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      {/* 新增／編輯 */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="md:max-w-3xl max-h-[90dvh] overflow-y-auto">
          <DialogHeader><DialogTitle>{editing ? `編輯物料清單 ${editing.bomNumber}` : "新增物料清單"}</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="md:col-span-2">
                <label className="text-sm font-medium">成品 *</label>
                {editing ? <div className="rounded-md border bg-muted/40 px-3 py-2 text-sm">{editing.itemCode} - {editing.itemName}</div> : (
                  <LookupSelect className="w-full border rounded-md px-3 py-2 text-sm" value={form.itemId} onChange={e => setForm(p => ({ ...p, itemId: e.target.value }))}>
                    <option value="">選擇成品</option>
                    {usableItems(form.itemId).map(i => <option key={i.id} value={i.id}>{i.itemCode} - {i.itemName}</option>)}
                  </LookupSelect>
                )}
              </div>
              <div><label className="text-sm font-medium">一批做出幾個 *</label><Input type="number" min="1" value={form.quantity} onChange={e => setForm(p => ({ ...p, quantity: e.target.value }))} /></div>
            </div>
            <div><label className="text-sm font-medium">備註</label><Input value={form.remarks} onChange={e => setForm(p => ({ ...p, remarks: e.target.value }))} /></div>
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-sm font-semibold">原料（做這一批要用的）</label>
                <Button size="sm" variant="outline" onClick={addItem}><Plus className="h-3 w-3 mr-1" />新增原料</Button>
              </div>
              <div className="hidden md:grid grid-cols-[1fr_90px_70px_100px_100px_36px] gap-2 px-1 pb-1 text-xs text-muted-foreground"><span>品項</span><span className="text-right">數量</span><span>單位</span><span className="text-right">單價</span><span className="text-right">小計</span><span /></div>
              {formItems.map((fi, i) => (
                <div key={i} className="grid grid-cols-2 md:grid-cols-[1fr_90px_70px_100px_100px_36px] gap-2 mb-2 items-center rounded-md border p-2 md:border-0 md:p-0">
                  <div className="col-span-2 md:col-span-1">
                    <LookupSelect className="w-full border rounded-md px-2 py-1.5 text-sm" value={fi.itemId} onChange={e => updateItem(i, "itemId", e.target.value)}>
                      <option value="">選擇原料</option>
                      {usableItems(fi.itemId).filter(it => String(it.id) !== form.itemId).map(it => <option key={it.id} value={it.id}>{it.itemCode} - {it.itemName}</option>)}
                    </LookupSelect>
                  </div>
                  <Input type="number" min="0" step="any" className="text-right" value={fi.quantity} onChange={e => updateItem(i, "quantity", e.target.value)} placeholder="數量" aria-label="數量" />
                  <span className="text-sm text-muted-foreground">{fi.unit && fi.unit !== "Nos" ? fi.unit : "-"}</span>
                  <Input type="number" min="0" step="any" className="text-right" value={fi.rate} onChange={e => updateItem(i, "rate", e.target.value)} placeholder="單價" aria-label="單價" />
                  <span className="text-right text-sm tabular-nums">{money((Number(fi.quantity) || 0) * (Number(fi.rate) || 0))}</span>
                  <Button size="sm" variant="ghost" onClick={() => removeItem(i)} aria-label="移除這筆原料"><X className="h-3 w-3" /></Button>
                </div>
              ))}
              {formItems.length === 0 && <p className="rounded-md border border-dashed px-3 py-4 text-center text-sm text-muted-foreground">還沒有原料，按「新增原料」加入</p>}
              <div className="mt-2 flex flex-wrap justify-end gap-x-6 text-sm"><span>一批材料成本：<b className="tabular-nums">{money(totalCost)}</b></span><span>平均一個：<b className="tabular-nums">{money(perUnit)}</b></span></div>
            </div>
            {editing && <p className="text-xs text-muted-foreground">已經開出去的工單不會跟著變，改的內容從下一張工單開始生效。</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>取消</Button>
            <Button onClick={handleSave} disabled={saving || (!editing && !form.itemId)}>{saving ? "處理中..." : editing ? "更新" : "建立"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 明細 */}
      <Dialog open={!!detail} onOpenChange={v => { if (!v) setDetail(null); }}>
        <DialogContent className="md:max-w-2xl max-h-[90dvh] overflow-y-auto">
          <DialogHeader><DialogTitle>物料清單 {detail?.bomNumber}</DialogTitle></DialogHeader>
          {detail && (
            <div className="space-y-4">
              <dl className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                <div className="col-span-2"><dt className="text-xs text-muted-foreground">成品</dt><dd><a className="text-primary hover:underline" href={`/inventory/items?q=${encodeURIComponent(detail.itemCode)}`}>{detail.itemCode} - {detail.itemName}</a></dd></div>
                <div><dt className="text-xs text-muted-foreground">版本</dt><dd>v{detail.version}</dd></div>
                <div><dt className="text-xs text-muted-foreground">狀態</dt><dd><Badge variant={detail.status === "Active" ? "default" : "secondary"}>{statusMap[detail.status] || detail.status}</Badge></dd></div>
                <div><dt className="text-xs text-muted-foreground">一批做出</dt><dd>{detail.quantity} {detail.unit !== "Nos" ? detail.unit : ""}</dd></div>
                <div><dt className="text-xs text-muted-foreground">目前一批材料成本</dt><dd className="tabular-nums">{money(detail.estimatedMaterialCost)}</dd></div>
                <div><dt className="text-xs text-muted-foreground">平均一個</dt><dd className="tabular-nums">{money(detail.estimatedUnitCost)}</dd></div>
                {detail.remarks && <div className="col-span-2 md:col-span-4"><dt className="text-xs text-muted-foreground">備註</dt><dd>{detail.remarks}</dd></div>}
              </dl>
              <div>
                <h4 className="text-sm font-semibold mb-2">原料</h4>
                {detail.items.length === 0 ? <p className="rounded-md border border-dashed px-3 py-4 text-center text-sm text-muted-foreground">這張清單還沒有原料，按「編輯」加上後才能啟用</p> : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead><tr className="border-b bg-gray-50">
                        <th className="text-left px-2 py-1.5">品項</th>
                        <th className="text-right px-2 py-1.5">數量</th>
                        <th className="text-right px-2 py-1.5">設定單價</th>
                        <th className="text-right px-2 py-1.5">設定金額</th>
                        <th className="text-right px-2 py-1.5">目前成本</th>
                      </tr></thead>
                      <tbody>
                        {detail.items.map(i => (
                          <tr key={i.id} className="border-b">
                            <td className="px-2 py-1.5"><a className="text-primary hover:underline" href={`/inventory/items?q=${encodeURIComponent(i.itemCode)}`}>{i.itemCode} - {i.itemName}</a></td>
                            <td className="px-2 py-1.5 text-right tabular-nums">{i.quantity} {i.unit !== "Nos" ? i.unit : ""}</td>
                            <td className="px-2 py-1.5 text-right tabular-nums">{money(i.rate)}</td>
                            <td className="px-2 py-1.5 text-right tabular-nums">{money(i.amount)}</td>
                            <td className="px-2 py-1.5 text-right tabular-nums">{money(i.currentCost)}</td>
                          </tr>
                        ))}
                        <tr className="font-semibold">
                          <td className="px-2 py-1.5" colSpan={3}>合計</td>
                          <td className="px-2 py-1.5 text-right tabular-nums">{money(detail.items.reduce((s, i) => s + i.amount, 0))}</td>
                          <td className="px-2 py-1.5 text-right tabular-nums">{money(detail.estimatedMaterialCost)}</td>
                        </tr>
                      </tbody>
                    </table>
                    <p className="mt-1 text-xs text-muted-foreground">「目前成本」用各原料現在的平均進貨成本算，跟設定單價不同是正常的。</p>
                  </div>
                )}
              </div>
              <div className="flex gap-2 justify-end flex-wrap">
                <Button variant="outline" onClick={() => openEdit(detail.id)}><Pencil className="h-3 w-3 mr-1" />編輯</Button>
                {detail.status === "Draft" && <Button onClick={() => updateStatus(detail.id, "Active")}>啟用</Button>}
                {detail.status === "Active" && <Button variant="outline" onClick={() => updateStatus(detail.id, "Inactive")}>停用</Button>}
                {detail.status === "Inactive" && <Button onClick={() => updateStatus(detail.id, "Active")}>重新啟用</Button>}
                {detail.status === "Draft" && <Button variant="destructive" onClick={() => handleDelete(detail.id)}>刪除</Button>}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
