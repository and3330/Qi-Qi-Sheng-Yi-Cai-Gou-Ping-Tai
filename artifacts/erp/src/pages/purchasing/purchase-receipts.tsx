import { useState, useEffect, useCallback, useMemo } from "react";
import { LandedCostButton } from "@/components/purchasing/landed-cost-dialog";
import { PageHeader } from "@/components/shared/page-header";
import { PageHint } from "@/components/page-hint";
import { BatchActionBar, type BatchField } from "@/components/shared/batch-action-bar";
import { CheckboxCell, CheckboxHeader } from "@/components/shared/checkbox-column";
import { useBatchSelection } from "@/hooks/use-batch-selection";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { Plus, Trash2, Check, X, Eye, Search, Receipt, Ban, Pencil } from "lucide-react";
import { SearchableSelect } from "@/components/shared/searchable-select";
import { useAutoReloadKey } from "@/lib/auto-refresh";
import { DateRangePresets } from "@/components/shared/date-range-presets";
import { DocWindow, DocStatus, statusTone, DocFields, DocLines, DocSection } from "@/components/shared/doc-window";
import { RelatedDocs, useOpenFromUrl } from "@/components/shared/related-docs";

const BASE = import.meta.env.BASE_URL.endsWith("/") ? import.meta.env.BASE_URL : import.meta.env.BASE_URL + "/";

interface PRItem { itemId: number; itemName: string; quantity: number; rate: number; amount: number }
interface PurchaseReceipt {
  id: number; receiptNumber: string; purchaseOrderId: number | null; supplierId: number;
  supplierName: string; receiptDate: string; status: string; totalAmount: number;
  items: PRItem[]; remarks: string | null; createdAt: string;
  departmentId?: number | null; projectId?: number | null;
  extraFields?: { legacy?: boolean; legacyUnpaid?: number; legacyDocNumber?: string; legacyStaff?: string } | null;
}
/** 從舊系統（Ecount）搬過來的歷史進貨單：只能查看 */
const isLegacy = (r: { extraFields?: { legacy?: boolean } | null }) => r.extraFields?.legacy === true;
const legacyUnpaid = (r: { extraFields?: { legacyUnpaid?: number } | null }) => Number(r.extraFields?.legacyUnpaid) || 0;
interface Supplier { id: number; name: string }
interface Item { id: number; itemName: string; buyingPrice: string }
interface Department { id: number; name: string }
interface Project { id: number; name: string }

const statusMap: Record<string, string> = { Draft: "草稿", Submitted: "已確認", Completed: "已完成", Cancelled: "已取消" };
const statusColor = (s: string) => s === "Submitted" || s === "Completed" ? "default" : s === "Cancelled" ? "destructive" : "secondary";

function getMonthRange() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  return { from: `${y}-${m}-01`, to: `${y}-${m}-${new Date(y, now.getMonth() + 1, 0).getDate()}` };
}

export default function PurchaseReceiptsPage() {
  const reloadKey = useAutoReloadKey();
  const [receipts, setReceipts] = useState<PurchaseReceipt[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [depts, setDepts] = useState<Department[]>([]);
  const [projs, setProjs] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<PurchaseReceipt | null>(null);
  const [detailItem, setDetailItem] = useState<PurchaseReceipt | null>(null);
  const [editRemarks, setEditRemarks] = useState("");
  const { toast } = useToast();

  const { from: defaultFrom, to: defaultTo } = useMemo(() => getMonthRange(), []);
  const [dateFrom, setDateFrom] = useState(defaultFrom);
  const [dateTo, setDateTo] = useState(defaultTo);
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    return (receipts || []).filter((r) => {
      if (dateFrom && r.receiptDate < dateFrom) return false;
      if (dateTo && r.receiptDate > dateTo) return false;
      if (search) {
        const q = search.toLowerCase();
        const match = (r.receiptNumber || "").toLowerCase().includes(q) || (r.supplierName || "").toLowerCase().includes(q);
        if (!match) return false;
      }
      return true;
    });
  }, [receipts, dateFrom, dateTo, search]);

  const batch = useBatchSelection(filtered);
  const batchFields: BatchField[] = [{key:"status",label:"狀態",type:"select",options:[{value:"Draft",label:"草稿"},{value:"Submitted",label:"已提交"},{value:"Completed",label:"已完成"}]}];

  const [form, setForm] = useState({ supplierId: "", receiptDate: new Date().toISOString().slice(0, 10), remarks: "", departmentId: "", projectId: "" });
  const [lineItems, setLineItems] = useState<{ itemId: string; quantity: string; rate: string }[]>([{ itemId: "", quantity: "1", rate: "" }]);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    const [rcpRes, supRes, itemsRes, deptRes, projRes] = await Promise.all([
      fetch(`/erp-api/purchase-receipts`), fetch(`/erp-api/suppliers`), fetch(`/erp-api/items`),
      fetch(`/erp-api/departments`), fetch(`/erp-api/projects`),
    ]);
    setReceipts(await rcpRes.json());
    setSuppliers(await supRes.json());
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
        if (found) copy[i].rate = String(found.buyingPrice);
      }
      return copy;
    });
  };

  const resetForm = () => {
    setForm({ supplierId: "", receiptDate: new Date().toISOString().slice(0, 10), remarks: "", departmentId: "", projectId: "" });
    setLineItems([{ itemId: "", quantity: "1", rate: "" }]);
    setEditing(null);
  };

  const openEdit = (r: PurchaseReceipt) => {
    setEditing(r);
    setForm({
      supplierId: String(r.supplierId),
      receiptDate: r.receiptDate,
      remarks: r.remarks || "",
      departmentId: r.departmentId != null ? String(r.departmentId) : "",
      projectId: r.projectId != null ? String(r.projectId) : "",
    });
    setLineItems((r.items || []).map(it => ({ itemId: String(it.itemId), quantity: String(it.quantity), rate: String(it.rate) })));
    setDetailItem(null);
    setOpen(true);
  };

  const handleCreate = async () => {
    if (!form.departmentId || !form.projectId) {
      toast({ title: "請選擇部門與專案", description: "部門與專案為必填欄位", variant: "destructive" }); return;
    }
    const payload = {
      supplierId: Number(form.supplierId), receiptDate: form.receiptDate, remarks: form.remarks || null,
      departmentId: Number(form.departmentId), projectId: Number(form.projectId),
      items: lineItems.filter(l => l.itemId).map(l => ({ itemId: Number(l.itemId), quantity: Number(l.quantity), rate: Number(l.rate) })),
    };
    const res = editing
      ? await fetch(`/erp-api/purchase-receipts/${editing.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) })
      : await fetch(`/erp-api/purchase-receipts`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    if (res.ok) {
      toast({ title: editing ? "進貨單已更新" : "進貨單已建立" }); setOpen(false);
      resetForm(); fetchAll();
    } else {
      const err = await res.json();
      toast({ title: err.error || (editing ? "更新失敗" : "建立失敗"), variant: "destructive" });
    }
  };

  const updateStatus = async (id: number, status: string) => {
    const res = await fetch(`/erp-api/purchase-receipts/${id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status }),
    });
    if (res.ok) {
      toast({ title: status === "Submitted" ? "已確認收貨，庫存已增加" : `狀態已更新為${statusMap[status] || status}` });
      fetchAll(); if (detailItem?.id === id) viewDetail(id);
    } else {
      const err = await res.json();
      toast({ title: err.error || "操作失敗", variant: "destructive" });
    }
  };

  const handleDelete = async (id: number) => {
    const res = await fetch(`/erp-api/purchase-receipts/${id}`, { method: "DELETE" });
    if (res.ok) { toast({ title: "已刪除" }); fetchAll(); setDetailItem(null); }
    else { const err = await res.json(); toast({ title: err.error || "刪除失敗", variant: "destructive" }); }
  };

  const saveRemarks = async () => {
    if (!detailItem) return;
    await fetch(`/erp-api/purchase-receipts/${detailItem.id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ remarks: editRemarks }),
    });
    toast({ title: "備註已更新" }); viewDetail(detailItem.id); fetchAll();
  };

  useOpenFromUrl(receipts, r => viewDetail(r.id));
  const viewDetail = async (id: number) => {
    const res = await fetch(`/erp-api/purchase-receipts/${id}`);
    if (res.ok) { const d = await res.json(); setDetailItem(d); setEditRemarks(d.remarks || ""); }
  };

  const createPaymentRequest = async (id: number) => {
    const res = await fetch(`/erp-api/purchase-receipts/${id}/payment-request`, { method: "POST" });
    const data = await res.json();
    if (res.ok) {
      toast({ title: "已產生採購發票與付款申請", description: `${data.paymentRequest.requestNumber} - $${Number(data.paymentRequest.amount).toLocaleString()}` });
    } else {
      toast({ title: data.error || "產生付款申請失敗", variant: "destructive" });
    }
  };

  const cancelSubmitted = async (id: number) => {
    if (!window.confirm("作廢此已收貨的進貨單將扣回庫存，確定嗎？")) return;
    const res = await fetch(`/erp-api/purchase-receipts/${id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: "Cancelled" }),
    });
    if (res.ok) { toast({ title: "已作廢，庫存已扣回" }); fetchAll(); setDetailItem(null); }
    else { const err = await res.json(); toast({ title: err.error || "作廢失敗", variant: "destructive" }); }
  };

  const total = lineItems.reduce((s, l) => s + Number(l.quantity) * Number(l.rate || 0), 0);

  return (
    <div className="space-y-6">
      <PageHeader title="進貨單" description="管理進貨流程，確認後自動增加庫存" hint={<PageHint hintKey="purchase-receipts">這裡登記供應商實際送到的貨。通常依採購訂單建立進貨單，核對品項與實收數量後再確認。小提醒：確認會增加庫存，短少或瑕疵品不要照原訂購數量直接入庫。</PageHint>} />
      <div className="flex justify-end gap-2">
        <Button onClick={() => setOpen(true)}><Plus className="h-4 w-4 mr-1" />新增進貨單</Button>
        {/* 新增／編輯進貨單：外框用全系統共用的單據視窗 */}
        <DocWindow
          open={open}
          onClose={() => { setOpen(false); resetForm(); }}
          name={editing ? "編輯進貨單" : "新增進貨單"}
          number={editing?.receiptNumber}
          status={editing ? <DocStatus label={statusMap[editing.status] || editing.status} tone={statusTone(editing.status === "Submitted" ? "Confirmed" : editing.status)} /> : undefined}
          wide
          footer={<>
            <Button variant="outline" onClick={() => setOpen(false)}>取消</Button>
            <Button onClick={handleCreate} disabled={!form.supplierId || lineItems.every(l => !l.itemId)}>{editing ? "儲存變更" : "建立"}</Button>
          </>}
        >
            <div className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="text-sm font-medium">供應商 *</label>
                  <SearchableSelect
                    value={form.supplierId}
                    onValueChange={v => setForm(p => ({ ...p, supplierId: v }))}
                    options={suppliers.map(s => ({ value: String(s.id), label: s.name }))}
                    placeholder="選擇供應商"
                    searchPlaceholder="輸入供應商名稱搜尋..."
                    emptyText="找不到符合的供應商"
                    disabled={!!editing?.purchaseOrderId}
                    title={editing?.purchaseOrderId ? "此進貨單由採購訂單建立，供應商不可變更" : undefined}
                  />
                </div>
                <div>
                  <label className="text-sm font-medium">收貨日期 *</label>
                  <Input type="date" value={form.receiptDate} onChange={e => setForm(p => ({ ...p, receiptDate: e.target.value }))} />
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
              <div><label className="text-sm font-medium">備註</label><Input value={form.remarks} onChange={e => setForm(p => ({ ...p, remarks: e.target.value }))} placeholder="備註說明" /></div>
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
                        <div><Label className="text-xs text-muted-foreground">數量</Label><Input type="number" min="1" value={line.quantity} onChange={e => updateLine(i, "quantity", e.target.value)} /></div>
                        <div><Label className="text-xs text-muted-foreground">單價</Label><Input type="number" value={line.rate} onChange={e => updateLine(i, "rate", e.target.value)} /></div>
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
                      <Input className="w-20" type="number" min="1" value={line.quantity} onChange={e => updateLine(i, "quantity", e.target.value)} />
                      <Input className="w-24" type="number" value={line.rate} onChange={e => updateLine(i, "rate", e.target.value)} />
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

      {batch.count > 0 && (
        <BatchActionBar
          count={batch.count}
          entityName="進貨單"
          entityEndpoint="purchase-receipts"
          ids={batch.ids}
          batchFields={batchFields}
          onClear={batch.clearSelection}
          onComplete={fetchAll}
        />
      )}

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
                <Input className="pl-9" placeholder="單號、供應商名稱..." value={search} onChange={e => setSearch(e.target.value)} />
              </div>
            </div>
            <div className="text-sm text-muted-foreground pb-2">共 {filtered.length} 筆</div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="py-3 border-b"><CardTitle>進貨單列表</CardTitle></CardHeader>
        <CardContent className="p-0 overflow-x-auto">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-gray-50/50">
                  <th className="w-10 px-2"><CheckboxHeader checked={batch.allSelected} indeterminate={batch.someSelected} onChange={batch.toggleAll} /></th>
                  <th className="text-left px-4 py-2.5 font-semibold">單號</th>
                  <th className="text-left px-4 py-2.5 font-semibold">供應商</th>
                  <th className="text-left px-4 py-2.5 font-semibold">收貨日期</th>
                  <th className="text-left px-4 py-2.5 font-semibold">狀態</th>
                  <th className="text-right px-4 py-2.5 font-semibold">金額</th>
                  <th className="text-center px-4 py-2.5 font-semibold">操作</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-400">載入中...</td></tr>
                ) : filtered.length === 0 ? (
                  <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-400">尚無資料</td></tr>
                ) : filtered.map(r => (
                  <tr key={r.id} className="border-b hover:bg-gray-50 cursor-pointer" title="點一下看這張進貨單的內容"
                    onClick={(e) => { if ((e.target as HTMLElement).closest("button,select,input,a,label")) return; viewDetail(r.id); }}>
                    <td className="px-2"><CheckboxCell checked={batch.selectedIds.has(r.id)} onChange={() => batch.toggle(r.id)} /></td>
                    <td className="px-4 py-2 font-medium whitespace-nowrap">{r.receiptNumber}{isLegacy(r) && <span className="ml-1.5 inline-block rounded border px-1 text-[10px] font-normal text-muted-foreground align-middle" title="從舊系統 Ecount 搬過來的歷史單，只能查看">歷史</span>}</td>
                    <td className="px-4 py-2">{r.supplierName}</td>
                    <td className="px-4 py-2">{r.receiptDate}</td>
                    <td className="px-4 py-2"><Badge variant={statusColor(r.status)}>{statusMap[r.status] || r.status}</Badge></td>
                    <td className="px-4 py-2 text-right font-mono">
                      ${r.totalAmount.toLocaleString()}
                      {legacyUnpaid(r) > 0 && <div className="text-xs font-sans text-amber-600">搬入時未付 ${legacyUnpaid(r).toLocaleString()}</div>}
                    </td>
                    <td className="px-4 py-2 text-center">
                      <div className="flex gap-1 justify-center">
                        <Button size="sm" variant="outline" onClick={() => viewDetail(r.id)} title="檢視"><Eye className="h-3 w-3" /></Button>
                        {r.status !== "Draft" && <Button size="sm" variant="outline" onClick={() => viewDetail(r.id)} title="編輯備註"><Pencil className="h-3 w-3" /></Button>}
                        {r.status === "Draft" && (
                          <>
                            <Button size="sm" variant="outline" onClick={() => openEdit(r)} title="編輯（限草稿）"><Pencil className="h-3 w-3" /></Button>
                            <Button size="sm" variant="outline" onClick={() => updateStatus(r.id, "Submitted")} title="確認收貨"><Check className="h-3 w-3" /></Button>
                            <Button size="sm" variant="ghost" onClick={() => handleDelete(r.id)} title="刪除"><Trash2 className="h-3 w-3" /></Button>
                          </>
                        )}
                        {(r.status === "Submitted" || r.status === "Completed") && !isLegacy(r) && (
                          <Button size="sm" variant="outline" onClick={() => createPaymentRequest(r.id)} title="產生發票與付款申請"><Receipt className="h-3 w-3" /></Button>
                        )}
                        {r.status === "Submitted" && (
                          <Button size="sm" variant="ghost" onClick={() => cancelSubmitted(r.id)} title="作廢並扣回庫存"><Ban className="h-3 w-3" /></Button>
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

      {/* 進貨單視窗：照全系統共用的單據版面（標題列 → 表頭欄位 → 明細 → 其他區塊 → 底部按鈕列） */}
      <DocWindow
        open={!!detailItem}
        onClose={() => setDetailItem(null)}
        name="進貨單"
        number={detailItem?.receiptNumber}
        // 「已確認」在共用顏色規則裡算完成（藍色），和列表上的徽章一致
        status={detailItem && <DocStatus label={statusMap[detailItem.status] || detailItem.status} tone={statusTone(detailItem.status === "Submitted" ? "Confirmed" : detailItem.status)} />}
        description={detailItem && isLegacy(detailItem) ? (
          <>
            這是從舊系統 Ecount 搬過來的歷史進貨單（原單號 {(detailItem as any).extraFields?.legacyDocNumber || "—"}{(detailItem as any).extraFields?.legacyStaff ? `・承辦人 ${(detailItem as any).extraFields.legacyStaff}` : ""}）。可以補備註；品項與金額不能改。
            {legacyUnpaid(detailItem) > 0 && <span className="text-amber-700"> 搬入時還沒付給廠商 ${legacyUnpaid(detailItem).toLocaleString()}。</span>}
          </>
        ) : undefined}
        footer={detailItem && (
          <>
            {/* 左邊：刪除、取消、作廢這類要小心的 */}
            <div className="mr-auto flex flex-wrap gap-2">
              {detailItem.status === "Draft" && (
                <>
                  <Button variant="destructive" onClick={() => handleDelete(detailItem.id)}>刪除</Button>
                  <Button variant="outline" onClick={() => updateStatus(detailItem.id, "Cancelled")}>取消</Button>
                </>
              )}
              {detailItem.status === "Submitted" && (
                <Button variant="destructive" onClick={() => cancelSubmitted(detailItem.id)}>作廢扣回</Button>
              )}
            </div>
            {/* 右邊：關閉和主要動作 */}
            <Button variant="outline" onClick={() => setDetailItem(null)}>關閉</Button>
            {detailItem.status === "Draft" && (
              <Button variant="outline" onClick={() => openEdit(detailItem)}><Pencil className="h-4 w-4 mr-1" />編輯</Button>
            )}
            {(detailItem.status === "Submitted" || detailItem.status === "Completed") && !isLegacy(detailItem) && (
              <Button variant="outline" onClick={() => createPaymentRequest(detailItem.id)}><Receipt className="h-4 w-4 mr-1" />產生付款申請</Button>
            )}
            {(detailItem.status === "Submitted" || detailItem.status === "Completed") && !isLegacy(detailItem) && (
              <LandedCostButton receiptId={detailItem.id} receiptNumber={detailItem.receiptNumber} />
            )}
            {detailItem.status === "Draft" && (
              <Button onClick={() => updateStatus(detailItem.id, "Submitted")}>確認收貨</Button>
            )}
            {detailItem.status === "Submitted" && (
              <Button onClick={() => updateStatus(detailItem.id, "Completed")}>標記完成</Button>
            )}
          </>
        )}
      >
        {detailItem && (
          <>
            <DocFields items={[
              ["供應商", detailItem.supplierName],
              ["收貨日期", detailItem.receiptDate],
              ["金額", <span className="font-mono">${detailItem.totalAmount.toLocaleString()}</span>],
              ["部門", depts.find(d => d.id === detailItem.departmentId)?.name],
              ["專案", projs.find(p => p.id === detailItem.projectId)?.name],
            ]} />
            <DocLines<PRItem>
              rows={(detailItem.items as PRItem[]) || []}
              columns={[
                { header: "品項", cell: (item) => (
                  <>
                    {item.itemName}
                    {((item as any).specification || (item as any).summary) && <div className="text-xs text-muted-foreground">{[(item as any).specification, (item as any).summary].filter(Boolean).join("・")}</div>}
                    {(item as any).originalCurrency && <div className="text-xs text-muted-foreground">原幣 {(item as any).originalCurrency} {Number((item as any).originalAmount).toLocaleString()}（匯率 {(item as any).originalRate}）</div>}
                  </>
                ) },
                { header: "數量", align: "right", cell: (item) => item.quantity },
                { header: "單價", align: "right", className: "font-mono", cell: (item) => `$${item.rate.toLocaleString()}` },
                { header: "金額", align: "right", className: "font-mono", cell: (item) => `$${item.amount.toLocaleString()}` },
              ]}
              total={{ value: <span className="font-mono">${detailItem.totalAmount.toLocaleString()}</span> }}
            />
            <DocSection title="備註">
              <div className="flex gap-2">
                <Input value={editRemarks} onChange={e => setEditRemarks(e.target.value)} placeholder="備註" />
                <Button size="sm" onClick={saveRemarks}>儲存</Button>
              </div>
              {detailItem.status !== "Draft" && <p className="text-xs text-muted-foreground">{isLegacy(detailItem) ? "歷史進貨單可以補備註；品項與金額不能改。" : "已收貨的進貨單可以補備註；品項與金額不能改。"}</p>}
            </DocSection>
            {/* 這張進貨單是從哪張採購訂單來的（頁面上只有訂單編號，沒有單號，所以用文字連結） */}
            <RelatedDocs type="purchase_receipt" id={detailItem.id} onNavigate={() => setDetailItem(null)} />
          </>
        )}
      </DocWindow>
    </div>
  );
}
