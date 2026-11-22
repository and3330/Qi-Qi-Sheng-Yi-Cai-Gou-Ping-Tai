import { useState, useEffect, useCallback, useMemo } from "react";
import { useAutoReloadKey } from "@/lib/auto-refresh";
import { PageHeader } from "@/components/shared/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { DocWindow, DocStatus, DocFields, DocSection, DocNote, DocFormRows, DocFormRow, statusTone } from "@/components/shared/doc-window";
import { useToast } from "@/hooks/use-toast";
import { Plus, Eye, Trash2, Pencil, Search, RotateCcw } from "lucide-react";
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
interface BomLine { id: number; itemId: number; itemName: string; itemCode: string; specification?: string; quantity: number; rate: number; amount: number; unit: string; remarks?: string | null; currentUnitCost: number; currentCost: number }
interface BomDetail extends BomListItem { items: BomLine[]; estimatedMaterialCost: number; estimatedUnitCost: number }
interface Item { id: number; itemName: string; itemCode: string; buyingPrice: number; unit?: string; status?: string; specification?: string | null }
type FormLine = { itemId: string; quantity: string; rate: string; unit: string; remarks: string };

const statusMap: Record<string, string> = { Draft: "草稿", Active: "啟用", Inactive: "已停用" };
const money = (n: number) => `$${(Math.round((Number(n) || 0) * 100) / 100).toLocaleString()}`;
const emptyForm = { itemId: "", quantity: "1", remarks: "" };
const blankLine = (): FormLine => ({ itemId: "", quantity: "", rate: "", unit: "", remarks: "" });
/** 新增時先給三行空白；沒選品項的行存檔時會略過 */
const blankLines = (): FormLine[] => [blankLine(), blankLine(), blankLine()];
const cellClass = "h-10 md:h-10";

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

  const addItem = () => setFormItems(p => [...p, blankLine()]);
  const removeItem = (i: number) => setFormItems(p => p.filter((_, idx) => idx !== i));
  const updateItem = (i: number, field: keyof FormLine, value: string) => {
    setFormItems(p => p.map((item, idx) => {
      if (idx !== i) return item;
      const updated = { ...item, [field]: value };
      if (field === "itemId") {
        const found = items.find(it => it.id === Number(value));
        if (found) { updated.rate = String(found.buyingPrice ?? 0); updated.unit = found.unit || ""; if (!updated.quantity) updated.quantity = "1"; }
        else if (!value) { updated.unit = ""; }
      }
      return updated;
    }));
  };

  const resetForm = () => { setForm(emptyForm); setFormItems(blankLines()); };
  const hasFormInput = !!form.itemId || !!form.remarks || form.quantity !== emptyForm.quantity || formItems.some(fi => fi.itemId || fi.remarks || fi.quantity || fi.rate);
  const openCreate = () => { setEditing(null); resetForm(); setOpen(true); };
  const fetchDetail = async (id: number): Promise<BomDetail | null> => { const res = await fetch(`/erp-api/boms/${id}`); return res.ok ? res.json() : null; };
  const viewDetail = async (id: number) => { const d = await fetchDetail(id); if (d) setDetail(d); };
  const openEdit = async (id: number) => {
    const d = await fetchDetail(id);
    if (!d) return;
    setDetail(null);
    setEditing(d);
    setForm({ itemId: String(d.itemId), quantity: String(d.quantity), remarks: d.remarks || "" });
    setFormItems(d.items.length > 0 ? d.items.map(l => ({ itemId: String(l.itemId), quantity: String(l.quantity), rate: String(l.rate), unit: l.unit, remarks: l.remarks || "" })) : blankLines());
    setOpen(true);
  };

  const handleSave = async () => {
    // 沒選品項的空白行不送出
    const lines = formItems.filter(fi => fi.itemId).map(fi => ({ itemId: Number(fi.itemId), quantity: Number(fi.quantity), rate: Number(fi.rate) || 0, unit: fi.unit, remarks: fi.remarks.trim() || null }));
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

  const totalCost = formItems.reduce((s, fi) => s + (fi.itemId ? (Number(fi.quantity) || 0) * (Number(fi.rate) || 0) : 0), 0);
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
      <DocWindow
        open={open} onClose={() => setOpen(false)} wide
        name={editing ? "編輯物料清單" : "新增物料清單"} number={editing?.bomNumber}
        status={editing ? <DocStatus label={statusMap[editing.status] || editing.status} tone={statusTone(editing.status)} /> : undefined}
        footer={<>
          <Button variant="outline" onClick={() => setOpen(false)}>取消</Button>
          {!editing && (
            <Button variant="outline" disabled={saving} onClick={() => { if (!hasFormInput || window.confirm("把這張單已經填的內容全部清掉，重新輸入？")) resetForm(); }} data-testid="button-reset-bom">
              <RotateCcw className="mr-1 h-4 w-4" />重新輸入
            </Button>
          )}
          <Button onClick={handleSave} disabled={saving || (!editing && !form.itemId)} data-testid="button-save-bom">{saving ? "儲存中..." : "儲存"}</Button>
        </>}
      >
          <div className="space-y-4">
            {/* 表頭：一個欄位一列（老闆 2026-11-18：照 Ecount「修改BOM」的輸入畫面） */}
            <DocFormRows data-testid="bom-header">
              <DocFormRow label="生產品項" required>
                {editing ? <div className="flex min-h-10 items-center rounded-md border bg-muted/40 px-3 py-2 text-sm">{editing.itemCode} - {editing.itemName}</div> : (
                  <LookupSelect className="w-full h-10" value={form.itemId} onChange={e => setForm(p => ({ ...p, itemId: e.target.value }))} data-testid="select-bom-item">
                    <option value="">選擇要生產的品項</option>
                    {usableItems(form.itemId).map(i => <option key={i.id} value={i.id}>{i.itemCode} - {i.itemName}</option>)}
                  </LookupSelect>
                )}
              </DocFormRow>
              <DocFormRow label="BOM版本" hint={editing ? undefined : "同一個品項的第幾版，存檔時自動編號。"}>
                <div className="flex h-10 items-center rounded-md border border-dashed bg-muted/40 px-3 text-sm text-muted-foreground md:w-48" data-testid="bom-version">{editing ? `v${editing.version}` : "儲存時產生"}</div>
              </DocFormRow>
              <DocFormRow label="生產數量" htmlFor="bom-quantity" required hint="一批做出幾個。下面表格的數量，就是做這一批要用掉的量。">
                <Input id="bom-quantity" type="number" inputMode="decimal" min="1" className="h-10 md:h-10 md:w-48" value={form.quantity} onChange={e => setForm(p => ({ ...p, quantity: e.target.value }))} />
              </DocFormRow>
              <DocFormRow label="備註" htmlFor="bom-remarks">
                <Input id="bom-remarks" className="h-10 md:h-10" value={form.remarks} onChange={e => setForm(p => ({ ...p, remarks: e.target.value }))} placeholder="整張清單的備註（選填）" />
              </DocFormRow>
            </DocFormRows>

            {/* 輸入表格：一行一個原料。欄位多，表格在自己的框裡左右捲，整個視窗不會跟著跑 */}
            <div className="max-w-full overflow-x-auto rounded-md border" data-testid="bom-lines">
              <table className="w-full min-w-[980px] text-sm">
                <thead className="bg-muted/60 text-xs text-muted-foreground">
                  <tr>
                    <th className="w-9 px-2 py-2 text-center font-medium">#</th>
                    <th className="w-[280px] px-1 py-2 text-left font-medium">品項編碼／名稱</th>
                    <th className="w-28 px-2 py-2 text-left font-medium">規格</th>
                    <th className="w-24 px-1 py-2 text-right font-medium">數量</th>
                    <th className="w-16 px-2 py-2 text-left font-medium">單位</th>
                    <th className="w-28 px-1 py-2 text-right font-medium">單價</th>
                    <th className="w-28 px-2 py-2 text-right font-medium">小計</th>
                    <th className="px-1 py-2 text-left font-medium">摘要（位置）</th>
                    <th className="w-12"><span className="sr-only">刪除這一行</span></th>
                  </tr>
                </thead>
                <tbody>
                  {formItems.map((fi, i) => {
                    // 規格跟著品項主檔走；編輯時原料已停用（選單裡沒有）就用這張清單原本帶的
                    const spec = items.find(it => String(it.id) === fi.itemId)?.specification || editing?.items.find(l => String(l.itemId) === fi.itemId)?.specification;
                    return (
                      <tr key={i} className="border-t">
                        <td className="px-2 text-center text-xs text-muted-foreground">{i + 1}</td>
                        <td className="px-1 py-1">
                          <LookupSelect className="w-full h-10" value={fi.itemId} onChange={e => updateItem(i, "itemId", e.target.value)} data-testid={`select-bom-line-item-${i}`}>
                            <option value="">選擇原料</option>
                            {usableItems(fi.itemId).filter(it => String(it.id) !== form.itemId).map(it => <option key={it.id} value={it.id}>{it.itemCode} - {it.itemName}</option>)}
                          </LookupSelect>
                        </td>
                        <td className="px-2 text-xs text-muted-foreground">{spec || "-"}</td>
                        <td className="px-1 py-1"><Input type="number" inputMode="decimal" min="0" step="any" className={`${cellClass} text-right`} value={fi.quantity} onChange={e => updateItem(i, "quantity", e.target.value)} placeholder="數量" aria-label={`第 ${i + 1} 行數量`} /></td>
                        <td className="px-2 text-muted-foreground">{fi.unit && fi.unit !== "Nos" ? fi.unit : "-"}</td>
                        <td className="px-1 py-1"><Input type="number" inputMode="decimal" min="0" step="any" className={`${cellClass} text-right`} value={fi.rate} onChange={e => updateItem(i, "rate", e.target.value)} placeholder="單價" aria-label={`第 ${i + 1} 行單價`} /></td>
                        <td className="px-2 text-right tabular-nums">{fi.itemId ? money((Number(fi.quantity) || 0) * (Number(fi.rate) || 0)) : ""}</td>
                        <td className="px-1 py-1"><Input className={cellClass} value={fi.remarks} onChange={e => updateItem(i, "remarks", e.target.value)} placeholder="用在哪裡、放哪個位置（選填）" aria-label={`第 ${i + 1} 行摘要（位置）`} data-testid={`input-bom-line-remarks-${i}`} /></td>
                        <td className="px-1 py-1"><Button type="button" variant="ghost" size="icon" className="h-10 w-10" disabled={formItems.length <= 1} onClick={() => removeItem(i)} aria-label={`刪除第 ${i + 1} 行`} title="刪除這一行"><Trash2 className="h-4 w-4 text-red-500" /></Button></td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 bg-muted/30 font-semibold">
                    <td className="px-2 py-2.5 text-right" colSpan={6}>一批材料成本</td>
                    <td className="px-2 py-2.5 text-right tabular-nums" data-testid="bom-total-cost">{money(totalCost)}</td>
                    <td className="px-2 py-2.5" colSpan={2}>平均一個 <span className="tabular-nums" data-testid="bom-unit-cost">{money(perUnit)}</span></td>
                  </tr>
                </tfoot>
              </table>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Button type="button" variant="outline" className="min-h-10" onClick={addItem} data-testid="button-add-bom-line"><Plus className="h-4 w-4 mr-1" />新增一行</Button>
              <p className="text-xs text-muted-foreground">沒選品項的空白行，存檔時會自動略過。</p>
            </div>
            {editing && <p className="text-xs text-muted-foreground">已經開出去的工單不會跟著變，改的內容從下一張工單開始生效。</p>}
          </div>
      </DocWindow>

      {/* 明細 */}
      <DocWindow
        open={!!detail} onClose={() => setDetail(null)}
        name="物料清單" number={detail?.bomNumber}
        status={detail ? <DocStatus label={statusMap[detail.status] || detail.status} tone={statusTone(detail.status)} /> : undefined}
        footer={detail && <>
          {detail.status === "Draft" && <Button variant="destructive" className="mr-auto" onClick={() => handleDelete(detail.id)}>刪除</Button>}
          <Button variant="outline" onClick={() => setDetail(null)}>關閉</Button>
          <Button variant="outline" onClick={() => openEdit(detail.id)}><Pencil className="h-3 w-3 mr-1" />編輯</Button>
          {detail.status === "Active" && <Button variant="outline" onClick={() => updateStatus(detail.id, "Inactive")}>停用</Button>}
          {detail.status === "Draft" && <Button onClick={() => updateStatus(detail.id, "Active")}>啟用</Button>}
          {detail.status === "Inactive" && <Button onClick={() => updateStatus(detail.id, "Active")}>重新啟用</Button>}
        </>}
      >
        {detail && (
          <>
            <DocFields items={[
              ["成品", <a className="text-primary hover:underline" href={`/inventory/items?q=${encodeURIComponent(detail.itemCode)}`}>{detail.itemCode} - {detail.itemName}</a>],
              ["版本", `v${detail.version}`],
              ["一批做出", `${detail.quantity} ${detail.unit !== "Nos" ? detail.unit : ""}`],
              ["目前一批材料成本", <span className="tabular-nums">{money(detail.estimatedMaterialCost)}</span>],
              ["平均一個", <span className="tabular-nums">{money(detail.estimatedUnitCost)}</span>],
            ]} />
            <DocNote>{detail.remarks}</DocNote>
            <DocSection title="原料">
              {detail.items.length === 0 ? <p className="rounded-md border border-dashed px-3 py-4 text-center text-sm text-muted-foreground">這張清單還沒有原料，按「編輯」加上後才能啟用</p> : (
                <>
                  <div className="overflow-x-auto rounded-md border">
                    <table className="w-full text-sm">
                      <thead className="bg-muted text-xs text-muted-foreground"><tr>
                        <th className="text-left px-3 py-1.5 font-medium">品項</th>
                        <th className="text-right px-3 py-1.5 font-medium">數量</th>
                        <th className="text-right px-3 py-1.5 font-medium">設定單價</th>
                        <th className="text-right px-3 py-1.5 font-medium">設定金額</th>
                        <th className="text-right px-3 py-1.5 font-medium">目前成本</th>
                        {detail.items.some(i => i.remarks) && <th className="text-left px-3 py-1.5 font-medium">摘要（位置）</th>}
                      </tr></thead>
                      <tbody>
                        {detail.items.map(i => (
                          <tr key={i.id} className="border-t">
                            <td className="px-3 py-1.5"><a className="text-primary hover:underline" href={`/inventory/items?q=${encodeURIComponent(i.itemCode)}`}>{i.itemCode} - {i.itemName}</a></td>
                            <td className="px-3 py-1.5 text-right tabular-nums">{i.quantity} {i.unit !== "Nos" ? i.unit : ""}</td>
                            <td className="px-3 py-1.5 text-right tabular-nums">{money(i.rate)}</td>
                            <td className="px-3 py-1.5 text-right tabular-nums">{money(i.amount)}</td>
                            <td className="px-3 py-1.5 text-right tabular-nums">{money(i.currentCost)}</td>
                            {detail.items.some(x => x.remarks) && <td className="px-3 py-1.5 text-muted-foreground">{i.remarks || ""}</td>}
                          </tr>
                        ))}
                        <tr className="border-t-2 font-semibold">
                          <td className="px-3 py-1.5" colSpan={3}>合計</td>
                          <td className="px-3 py-1.5 text-right tabular-nums">{money(detail.items.reduce((s, i) => s + i.amount, 0))}</td>
                          <td className="px-3 py-1.5 text-right tabular-nums">{money(detail.estimatedMaterialCost)}</td>
                          {detail.items.some(i => i.remarks) && <td />}
                        </tr>
                      </tbody>
                    </table>
                  </div>
                  <p className="text-xs text-muted-foreground">「目前成本」用各原料現在的平均進貨成本算，跟設定單價不同是正常的。</p>
                </>
              )}
            </DocSection>
          </>
        )}
      </DocWindow>
    </div>
  );
}
