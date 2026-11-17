import { useState, useEffect, useCallback, useMemo } from "react";
import { PageHeader } from "@/components/shared/page-header";
import { PageHint } from "@/components/page-hint";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { Plus, Trash2, Check, X, Eye, Search, FileText, Ban, Pencil } from "lucide-react";
import { useBatchSelection } from "@/hooks/use-batch-selection";
import { BatchActionBar, type BatchField } from "@/components/shared/batch-action-bar";
import { CheckboxCell, CheckboxHeader } from "@/components/shared/checkbox-column";
import { SearchableSelect } from "@/components/shared/searchable-select";
import { useAutoReloadKey } from "@/lib/auto-refresh";
import { DateRangePresets } from "@/components/shared/date-range-presets";
import { DocWindow, DocStatus, statusTone, DocFields, DocLines, DocSection } from "@/components/shared/doc-window";
import { RelatedDocs, useOpenFromUrl } from "@/components/shared/related-docs";

const BASE = import.meta.env.BASE_URL.endsWith("/") ? import.meta.env.BASE_URL : import.meta.env.BASE_URL + "/";

interface DNItem { itemId: number; itemName: string; quantity: number; rate: number; amount: number }
interface DeliveryNote {
  id: number; noteNumber: string; salesOrderId: number | null; customerId: number;
  customerName: string; deliveryDate: string; status: string; totalAmount: number;
  items: DNItem[]; remarks: string | null; createdAt: string;
  departmentId?: number | null; projectId?: number | null;
}
interface Customer { id: number; name: string }
interface Item { id: number; itemName: string; sellingPrice: string }

const statusMap: Record<string, string> = { Draft: "草稿", Submitted: "已確認", Completed: "已完成", Cancelled: "已取消" };
const statusColor = (s: string) => s === "Submitted" || s === "Completed" ? "default" : s === "Cancelled" ? "destructive" : "secondary";

interface Department { id: number; name: string }
interface Project { id: number; name: string }

function getMonthRange() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  return { from: `${y}-${m}-01`, to: `${y}-${m}-${new Date(y, now.getMonth() + 1, 0).getDate()}` };
}

export default function DeliveryNotesPage() {
  const reloadKey = useAutoReloadKey();
  const [notes, setNotes] = useState<DeliveryNote[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [depts, setDepts] = useState<Department[]>([]);
  const [projs, setProjs] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<DeliveryNote | null>(null);
  const [detailNote, setDetailNote] = useState<DeliveryNote | null>(null);
  const [editRemarks, setEditRemarks] = useState("");
  const { toast } = useToast();

  const defaultRange = useMemo(() => getMonthRange(), []);
  const [dateFrom, setDateFrom] = useState(defaultRange.from);
  const [dateTo, setDateTo] = useState(defaultRange.to);
  const [search, setSearch] = useState("");

  const filteredNotes = useMemo(() => {
    return notes.filter(n => {
      if (dateFrom && n.deliveryDate < dateFrom) return false;
      if (dateTo && n.deliveryDate > dateTo) return false;
      if (search) {
        const q = search.toLowerCase();
        if (!(n.noteNumber.toLowerCase().includes(q) || n.customerName.toLowerCase().includes(q))) return false;
      }
      return true;
    });
  }, [notes, dateFrom, dateTo, search]);

  const batch = useBatchSelection(filteredNotes);
  const dnBatchFields: BatchField[] = [
    {key:"status",label:"狀態",type:"select",options:[{value:"Draft",label:"草稿"},{value:"Submitted",label:"已提交"},{value:"Completed",label:"已完成"}]},
  ];

  const [form, setForm] = useState({ customerId: "", deliveryDate: new Date().toISOString().slice(0, 10), remarks: "", departmentId: "", projectId: "" });
  const [lineItems, setLineItems] = useState<{ itemId: string; quantity: string; rate: string }[]>([{ itemId: "", quantity: "1", rate: "" }]);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    const [notesRes, custRes, itemsRes, deptRes, projRes] = await Promise.all([
      fetch(`/erp-api/delivery-notes`), fetch(`/erp-api/customers`), fetch(`/erp-api/items`),
      fetch(`/erp-api/departments`), fetch(`/erp-api/projects`),
    ]);
    setNotes(await notesRes.json());
    setCustomers(await custRes.json());
    setItems(await itemsRes.json());
    setDepts(await deptRes.json());
    setProjs(await projRes.json());
    setLoading(false);
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll, reloadKey]);

  const addLine = () => setLineItems(prev => [...prev, { itemId: "", quantity: "1", rate: "" }]);
  const removeLine = (i: number) => setLineItems(prev => prev.filter((_, idx) => idx !== i));
  const updateLine = (i: number, field: string, val: string) => {
    setLineItems(prev => {
      const copy = [...prev];
      copy[i] = { ...copy[i], [field]: val };
      if (field === "itemId") {
        const found = items.find(it => it.id === Number(val));
        if (found) copy[i].rate = String(found.sellingPrice);
      }
      return copy;
    });
  };

  const resetForm = () => {
    setForm({ customerId: "", deliveryDate: new Date().toISOString().slice(0, 10), remarks: "", departmentId: "", projectId: "" });
    setLineItems([{ itemId: "", quantity: "1", rate: "" }]);
    setEditing(null);
  };

  const openEdit = (n: DeliveryNote) => {
    setEditing(n);
    setForm({
      customerId: String(n.customerId),
      deliveryDate: n.deliveryDate,
      remarks: n.remarks || "",
      departmentId: n.departmentId != null ? String(n.departmentId) : "",
      projectId: n.projectId != null ? String(n.projectId) : "",
    });
    setLineItems((n.items || []).map(it => ({ itemId: String(it.itemId), quantity: String(it.quantity), rate: String(it.rate) })));
    setDetailNote(null);
    setOpen(true);
  };

  const handleCreate = async () => {
    if (!form.departmentId || !form.projectId) {
      toast({ title: "請選擇部門與專案", description: "部門與專案為必填欄位", variant: "destructive" }); return;
    }
    const payload = {
      customerId: Number(form.customerId), deliveryDate: form.deliveryDate,
      remarks: form.remarks || null,
      departmentId: Number(form.departmentId), projectId: Number(form.projectId),
      items: lineItems.filter(l => l.itemId).map(l => ({ itemId: Number(l.itemId), quantity: Number(l.quantity), rate: Number(l.rate) })),
    };
    const res = editing
      ? await fetch(`/erp-api/delivery-notes/${editing.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) })
      : await fetch(`/erp-api/delivery-notes`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    if (res.ok) {
      toast({ title: editing ? "送貨單已更新" : "送貨單已建立" }); setOpen(false);
      resetForm(); fetchAll();
    } else {
      const err = await res.json();
      toast({ title: err.error || (editing ? "更新失敗" : "建立失敗"), variant: "destructive" });
    }
  };

  const updateStatus = async (id: number, status: string) => {
    const res = await fetch(`/erp-api/delivery-notes/${id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status }),
    });
    if (res.ok) {
      toast({ title: status === "Submitted" ? "已確認出貨，庫存已扣除" : `狀態已更新為${statusMap[status] || status}` });
      fetchAll(); if (detailNote?.id === id) viewDetail(id);
    } else {
      const err = await res.json();
      toast({ title: err.error || "操作失敗", variant: "destructive" });
    }
  };

  const handleDelete = async (id: number) => {
    const res = await fetch(`/erp-api/delivery-notes/${id}`, { method: "DELETE" });
    if (res.ok) { toast({ title: "已刪除" }); fetchAll(); setDetailNote(null); }
    else { const err = await res.json(); toast({ title: err.error || "刪除失敗", variant: "destructive" }); }
  };

  const saveRemarks = async () => {
    if (!detailNote) return;
    await fetch(`/erp-api/delivery-notes/${detailNote.id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ remarks: editRemarks }),
    });
    toast({ title: "備註已更新" }); viewDetail(detailNote.id); fetchAll();
  };

  const createInvoice = async (id: number) => {
    const res = await fetch(`/erp-api/delivery-notes/${id}/invoices`, { method: "POST" });
    const data = await res.json();
    if (res.ok) {
      toast({ title: "發票已開立", description: `${data.invoiceNumber} - $${Number(data.totalAmount).toLocaleString()}` });
    } else {
      toast({ title: data.error || "開立發票失敗", variant: "destructive" });
    }
  };

  const cancelSubmitted = async (id: number) => {
    if (!window.confirm("作廢此已出貨的送貨單將回沖庫存，確定嗎？")) return;
    const res = await fetch(`/erp-api/delivery-notes/${id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: "Cancelled" }),
    });
    if (res.ok) { toast({ title: "已作廢，庫存已回沖" }); fetchAll(); setDetailNote(null); }
    else { const err = await res.json(); toast({ title: err.error || "作廢失敗", variant: "destructive" }); }
  };

  useOpenFromUrl(notes, n => viewDetail(n.id));
  const viewDetail = async (id: number) => {
    const res = await fetch(`/erp-api/delivery-notes/${id}`);
    if (res.ok) {
      const d = await res.json();
      setDetailNote(d); setEditRemarks(d.remarks || "");
    }
  };

  const total = lineItems.reduce((s, l) => s + Number(l.quantity) * Number(l.rate || 0), 0);

  return (
    <div className="space-y-6">
      <PageHeader title="送貨單" description="管理出貨流程，確認後自動扣除庫存" hint={<PageHint hintKey="delivery-notes">這裡記錄實際交付給客戶的品項。通常由已確認的銷售訂單轉入，核對出貨日期與數量後再確認。小提醒：確認會扣除庫存，若出貨有變更應先修正數量再送出。</PageHint>} />

      {batch.count > 0 && (
        <BatchActionBar
          count={batch.count}
          entityName="送貨單"
          entityEndpoint="delivery-notes"
          ids={batch.ids}
          batchFields={dnBatchFields}
          onClear={batch.clearSelection}
          onComplete={() => fetchAll()}
        />
      )}
      <div className="flex justify-end">
        <Button onClick={() => setOpen(true)}><Plus className="h-4 w-4 mr-1" />新增送貨單</Button>
        {/* 新增／編輯送貨單：外框用全系統共用的單據視窗 */}
        <DocWindow
          open={open}
          onClose={() => { setOpen(false); resetForm(); }}
          name={editing ? "編輯送貨單" : "新增送貨單"}
          number={editing?.noteNumber}
          status={editing ? <DocStatus label={statusMap[editing.status] || editing.status} tone={statusTone(editing.status)} /> : undefined}
          wide
          footer={<>
            <Button variant="outline" onClick={() => setOpen(false)}>取消</Button>
            <Button onClick={handleCreate} disabled={!form.customerId || lineItems.every(l => !l.itemId)}>{editing ? "儲存變更" : "建立"}</Button>
          </>}
        >
            <div className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="text-sm font-medium">客戶 *</label>
                  <SearchableSelect
                    value={form.customerId}
                    onValueChange={v => setForm(p => ({ ...p, customerId: v }))}
                    options={customers.map(c => ({ value: String(c.id), label: c.name }))}
                    placeholder="選擇客戶"
                    searchPlaceholder="輸入客戶名稱搜尋..."
                    emptyText="找不到符合的客戶"
                    disabled={!!editing?.salesOrderId}
                    title={editing?.salesOrderId ? "此送貨單由銷售訂單建立，客戶不可變更" : undefined}
                  />
                </div>
                <div>
                  <label className="text-sm font-medium">出貨日期 *</label>
                  <Input type="date" value={form.deliveryDate} onChange={e => setForm(p => ({ ...p, deliveryDate: e.target.value }))} />
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="text-sm font-medium">部門 <span className="text-red-500">*</span></label>
                  <SearchableSelect
                    value={form.departmentId}
                    onValueChange={v => setForm(p => ({ ...p, departmentId: v }))}
                    options={depts.filter(d => (d as any).isActive !== false || String(d.id) === String(form.departmentId)).map(d => ({ value: String(d.id), label: `${d.name}${(d as any).isActive === false ? "（已停用）" : ""}` }))}
                    placeholder="請選擇部門"
                    searchPlaceholder="輸入部門名稱搜尋..."
                    emptyText="找不到符合的部門"
                    triggerClassName={!form.departmentId ? "border-red-300 bg-red-50" : undefined}
                  />
                </div>
                <div>
                  <label className="text-sm font-medium">專案 <span className="text-red-500">*</span></label>
                  <SearchableSelect
                    value={form.projectId}
                    onValueChange={v => setForm(p => ({ ...p, projectId: v }))}
                    options={projs.filter(p => (p as any).isActive !== false || String(p.id) === String(form.projectId)).map(p => ({ value: String(p.id), label: `${p.name}${(p as any).isActive === false ? "（已停用）" : ""}` }))}
                    placeholder="請選擇專案"
                    searchPlaceholder="輸入專案名稱搜尋..."
                    emptyText="找不到符合的專案"
                    triggerClassName={!form.projectId ? "border-red-300 bg-red-50" : undefined}
                  />
                </div>
              </div>
              <div>
                <label className="text-sm font-medium">備註</label>
                <Input value={form.remarks} onChange={e => setForm(p => ({ ...p, remarks: e.target.value }))} placeholder="備註說明" />
              </div>
              <div>
                <div className="flex justify-between items-center mb-2">
                  <label className="text-sm font-medium">品項明細</label>
                  <Button size="sm" variant="outline" onClick={addLine}><Plus className="h-3 w-3 mr-1" />新增</Button>
                </div>
                {/* 手機版：卡片式品項編輯 */}
                <div className="md:hidden space-y-3">
                  {lineItems.map((line, i) => (
                    <div key={i} className="rounded-lg border p-3 space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-medium text-muted-foreground">項目 {i + 1}</span>
                        {lineItems.length > 1 && (
                          <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-red-500" onClick={() => removeLine(i)}><Trash2 size={14} /></Button>
                        )}
                      </div>
                      <SearchableSelect
                        value={String(line.itemId || "")}
                        onValueChange={v => updateLine(i, "itemId", v)}
                        options={items.map(it => ({ value: String(it.id), label: it.itemName }))}
                        placeholder="選擇品項"
                        searchPlaceholder="輸入品項名稱搜尋..."
                        emptyText="找不到符合的品項"
                      />
                      <div className="grid grid-cols-2 gap-2">
                        <div><Label className="text-xs text-muted-foreground">數量</Label><Input type="number" min="1" value={line.quantity} onChange={e => updateLine(i, "quantity", e.target.value)} placeholder="數量" /></div>
                        <div><Label className="text-xs text-muted-foreground">單價</Label><Input type="number" value={line.rate} onChange={e => updateLine(i, "rate", e.target.value)} placeholder="單價" /></div>
                      </div>
                      <div className="text-right text-sm font-medium">小計：${(Number(line.quantity) * Number(line.rate || 0)).toLocaleString()}</div>
                    </div>
                  ))}
                </div>
                {/* 桌面版：列式品項編輯 */}
                <div className="hidden md:block space-y-2">
                  {lineItems.map((line, i) => (
                    <div key={i} className="flex gap-2 items-end">
                      <div className="flex-1">
                        <SearchableSelect
                          value={String(line.itemId || "")}
                          onValueChange={v => updateLine(i, "itemId", v)}
                          options={items.map(it => ({ value: String(it.id), label: it.itemName }))}
                          placeholder="選擇品項"
                          searchPlaceholder="輸入品項名稱搜尋..."
                          emptyText="找不到符合的品項"
                        />
                      </div>
                      <Input className="w-20" type="number" min="1" value={line.quantity} onChange={e => updateLine(i, "quantity", e.target.value)} placeholder="數量" />
                      <Input className="w-24" type="number" value={line.rate} onChange={e => updateLine(i, "rate", e.target.value)} placeholder="單價" />
                      <span className="w-20 text-right text-sm font-mono">${(Number(line.quantity) * Number(line.rate || 0)).toLocaleString()}</span>
                      {lineItems.length > 1 && <Button size="sm" variant="ghost" onClick={() => removeLine(i)}><Trash2 className="h-3 w-3" /></Button>}
                    </div>
                  ))}
                </div>
                <div className="text-right mt-2 font-bold">合計：${total.toLocaleString()}</div>
              </div>
            </div>
        </DocWindow>
      </div>

      <Card>
        <CardContent className="py-4">
          <div className="flex flex-wrap gap-3 items-end">
            <div>
              <Label className="text-xs text-muted-foreground">起始日期</Label>
              <Input type="date" className="w-40" value={dateFrom} onChange={e => setDateFrom(e.target.value)} />
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">結束日期</Label>
              <Input type="date" className="w-40" value={dateTo} onChange={e => setDateTo(e.target.value)} />
            </div>
            <DateRangePresets from={dateFrom} to={dateTo} onChange={(r) => { setDateFrom(r.from); setDateTo(r.to); }} />
            <div className="flex-1 min-w-[200px]">
              <Label className="text-xs text-muted-foreground">搜尋</Label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input className="pl-9" placeholder="單號、客戶名稱..." value={search} onChange={e => setSearch(e.target.value)} />
              </div>
            </div>
            <div className="text-sm text-muted-foreground pb-2">共 {filteredNotes.length} 筆</div>
          </div>
        </CardContent>
      </Card>

      <div className="md:hidden space-y-3">
        {loading && <Card><CardContent className="p-6 text-center text-muted-foreground">載入中...</CardContent></Card>}
        {!loading && filteredNotes.length === 0 && <Card><CardContent className="p-6 text-center text-muted-foreground">尚無資料</CardContent></Card>}
        {!loading && filteredNotes.map(n => (
          <Card key={n.id}>
            <CardContent className="p-4 space-y-2">
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    className="h-4 w-4 accent-primary"
                    checked={batch.selectedIds.has(n.id)}
                    onChange={() => batch.toggle(n.id)}
                  />
                  <div>
                    <div className="font-medium">{n.noteNumber}</div>
                    <div className="text-xs text-muted-foreground">{n.customerName}</div>
                  </div>
                </div>
                <Badge variant={statusColor(n.status)}>{statusMap[n.status] || n.status}</Badge>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-x-4 gap-y-1 text-sm">
                <div className="text-muted-foreground">出貨日期</div><div className="text-right">{n.deliveryDate}</div>
                <div className="text-muted-foreground">金額</div><div className="text-right font-mono">${n.totalAmount.toLocaleString()}</div>
              </div>
              <div className="flex flex-wrap gap-1.5 pt-1">
                <Button size="sm" variant="outline" className="h-8" onClick={() => viewDetail(n.id)}><Eye className="h-3.5 w-3.5 mr-1" />檢視</Button>
                {n.status === "Draft" && (
                  <>
                    <Button size="sm" variant="outline" className="h-8" onClick={() => openEdit(n)}><Pencil className="h-3.5 w-3.5 mr-1" />編輯</Button>
                    <Button size="sm" variant="outline" className="h-8 text-green-700 border-green-300" onClick={() => updateStatus(n.id, "Submitted")}><Check className="h-3.5 w-3.5 mr-1" />確認出貨</Button>
                    <Button size="sm" variant="ghost" className="h-8 text-destructive" onClick={() => handleDelete(n.id)}><Trash2 className="h-3.5 w-3.5 mr-1" />刪除</Button>
                  </>
                )}
                {(n.status === "Submitted" || n.status === "Completed") && (
                  <Button size="sm" variant="outline" className="h-8" onClick={() => createInvoice(n.id)}><FileText className="h-3.5 w-3.5 mr-1" />開發票</Button>
                )}
                {n.status === "Submitted" && (
                  <Button size="sm" variant="ghost" className="h-8" onClick={() => cancelSubmitted(n.id)}><Ban className="h-3.5 w-3.5 mr-1" />作廢</Button>
                )}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card className="hidden md:block">
        <CardHeader className="py-3 border-b"><CardTitle>送貨單列表</CardTitle></CardHeader>
        <CardContent className="p-0 overflow-x-auto">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-gray-50/50">
                  <th className="w-10 px-2"><CheckboxHeader checked={batch.allSelected} indeterminate={batch.someSelected} onChange={batch.toggleAll} /></th>
                  <th className="text-left px-4 py-2.5 font-semibold">單號</th>
                  <th className="text-left px-4 py-2.5 font-semibold">客戶</th>
                  <th className="text-left px-4 py-2.5 font-semibold">出貨日期</th>
                  <th className="text-left px-4 py-2.5 font-semibold">狀態</th>
                  <th className="text-right px-4 py-2.5 font-semibold">金額</th>
                  <th className="text-center px-4 py-2.5 font-semibold">操作</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-400">載入中...</td></tr>
                ) : filteredNotes.length === 0 ? (
                  <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-400">尚無資料</td></tr>
                ) : filteredNotes.map(n => (
                  <tr key={n.id} className="border-b hover:bg-gray-50 cursor-pointer" title="點一下看這張送貨單的內容"
                    onClick={(e) => { if ((e.target as HTMLElement).closest("button,select,input,a,label")) return; viewDetail(n.id); }}>
                    <td className="px-2"><CheckboxCell checked={batch.selectedIds.has(n.id)} onChange={() => batch.toggle(n.id)} /></td>
                    <td className="px-4 py-2 font-medium">{n.noteNumber}</td>
                    <td className="px-4 py-2">{n.customerName}</td>
                    <td className="px-4 py-2">{n.deliveryDate}</td>
                    <td className="px-4 py-2"><Badge variant={statusColor(n.status)}>{statusMap[n.status] || n.status}</Badge></td>
                    <td className="px-4 py-2 text-right font-mono">${n.totalAmount.toLocaleString()}</td>
                    <td className="px-4 py-2 text-center">
                      <div className="flex gap-1 justify-center">
                        <Button size="sm" variant="outline" onClick={() => viewDetail(n.id)} title="檢視"><Eye className="h-3 w-3" /></Button>
                        {n.status !== "Draft" && <Button size="sm" variant="outline" onClick={() => viewDetail(n.id)} title="編輯備註"><Pencil className="h-3 w-3" /></Button>}
                        {n.status === "Draft" && (
                          <>
                            <Button size="sm" variant="outline" onClick={() => openEdit(n)} title="編輯（限草稿）"><Pencil className="h-3 w-3" /></Button>
                            <Button size="sm" variant="outline" onClick={() => updateStatus(n.id, "Submitted")} title="確認出貨"><Check className="h-3 w-3" /></Button>
                            <Button size="sm" variant="ghost" onClick={() => handleDelete(n.id)} title="刪除"><Trash2 className="h-3 w-3" /></Button>
                          </>
                        )}
                        {(n.status === "Submitted" || n.status === "Completed") && (
                          <Button size="sm" variant="outline" onClick={() => createInvoice(n.id)} title="依出貨開立發票"><FileText className="h-3 w-3" /></Button>
                        )}
                        {n.status === "Submitted" && (
                          <Button size="sm" variant="ghost" onClick={() => cancelSubmitted(n.id)} title="作廢並回沖庫存"><Ban className="h-3 w-3" /></Button>
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

      {/* 送貨單明細：用全系統共用的單據視窗外框，排法跟其他單據一樣 */}
      {detailNote && (
        <DocWindow
          open
          onClose={() => setDetailNote(null)}
          name="送貨單"
          number={detailNote.noteNumber}
          status={<DocStatus label={statusMap[detailNote.status] || detailNote.status} tone={statusTone(detailNote.status)} />}
          footer={
            <>
              {/* 左邊：刪除、取消、作廢；右邊：主要動作和關閉 */}
              <div className="mr-auto flex flex-wrap items-center gap-2">
                {detailNote.status === "Draft" && (
                  <>
                    <Button variant="destructive" onClick={() => handleDelete(detailNote.id)}>刪除</Button>
                    <Button variant="outline" onClick={() => updateStatus(detailNote.id, "Cancelled")}>取消</Button>
                  </>
                )}
                {detailNote.status === "Submitted" && (
                  <Button variant="destructive" onClick={() => cancelSubmitted(detailNote.id)}>作廢回沖</Button>
                )}
              </div>
              {detailNote.status === "Draft" && (
                <>
                  <Button variant="outline" onClick={() => openEdit(detailNote)}><Pencil className="h-4 w-4 mr-1" />編輯</Button>
                  <Button onClick={() => updateStatus(detailNote.id, "Submitted")}>確認出貨</Button>
                </>
              )}
              {(detailNote.status === "Submitted" || detailNote.status === "Completed") && (
                <Button variant="outline" onClick={() => createInvoice(detailNote.id)}><FileText className="h-4 w-4 mr-1" />開立發票</Button>
              )}
              {detailNote.status === "Submitted" && (
                <Button onClick={() => updateStatus(detailNote.id, "Completed")}>標記完成</Button>
              )}
              <Button variant="outline" onClick={() => setDetailNote(null)}>關閉</Button>
            </>
          }
        >
          <DocFields items={[
            ["客戶", detailNote.customerName],
            ["出貨日期", detailNote.deliveryDate],
            ["金額", `$${detailNote.totalAmount.toLocaleString()}`],
          ]} />

          <DocLines<DNItem>
            rows={(detailNote.items as DNItem[]) || []}
            columns={[
              { header: "品項", cell: item => item.itemName },
              { header: "數量", align: "right", cell: item => item.quantity },
              { header: "單價", align: "right", cell: item => `$${item.rate.toLocaleString()}` },
              { header: "金額", align: "right", cell: item => `$${item.amount.toLocaleString()}` },
            ]}
            total={{ value: `$${detailNote.totalAmount.toLocaleString()}` }}
          />

          <DocSection title="備註">
            <div className="flex gap-2">
              <Input value={editRemarks} onChange={e => setEditRemarks(e.target.value)} placeholder="備註" />
              <Button size="sm" onClick={saveRemarks}>儲存</Button>
            </div>
            {detailNote.status !== "Draft" && <p className="text-xs text-muted-foreground">已出貨的送貨單可以補備註；品項與數量不能改。</p>}
          </DocSection>

          <RelatedDocs type="delivery_note" id={detailNote.id} onNavigate={() => setDetailNote(null)} />
        </DocWindow>
      )}
    </div>
  );
}
