import { useState, useEffect, useCallback, useMemo } from "react";
import { selectableDepartments, selectableProjects, departmentLabel, projectPickerLabel } from "@/lib/select-options";
import { PageHeader } from "@/components/shared/page-header";
import { PageHint } from "@/components/page-hint";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { Plus, Trash2, Check, X, Eye, Search, FileText, Ban, Pencil, RotateCcw, Printer } from "lucide-react";
import { useBatchSelection } from "@/hooks/use-batch-selection";
import { BatchActionBar, type BatchField } from "@/components/shared/batch-action-bar";
import { CheckboxCell, CheckboxHeader } from "@/components/shared/checkbox-column";
import { SearchableSelect } from "@/components/shared/searchable-select";
import { useAutoReloadKey } from "@/lib/auto-refresh";
import { DateRangePresets } from "@/components/shared/date-range-presets";
import { DocWindow, DocStatus, statusTone, DocFields, DocLines, DocSection, DocFormRows, DocFormRow } from "@/components/shared/doc-window";
import { DocItemLines, blankLines, filledLines, linesPayload, linesFromSaved, type ItemLine } from "@/components/shared/doc-item-lines";
import { RelatedDocs, useOpenFromUrl } from "@/components/shared/related-docs";
import { CustomerRemarkHint } from "@/components/shared/customer-remark-hint";
import { appendToDocumentRemarks } from "@/lib/customer-remarks";
import { DocumentPrintDialog, companyOf, defaultBrand } from "@/components/sales/quotation-print-dialog";
import type { PrintData } from "@/lib/print-layout";
import { Textarea } from "@/components/ui/textarea";

const BASE = import.meta.env.BASE_URL.endsWith("/") ? import.meta.env.BASE_URL : import.meta.env.BASE_URL + "/";

interface DNItem { itemId: number; itemName: string; quantity: number; rate: number; amount: number; specification?: string; note?: string }
interface DeliveryNote {
  id: number; noteNumber: string; salesOrderId: number | null; customerId: number;
  customerName: string; deliveryDate: string; status: string; totalAmount: number;
  items: DNItem[]; remarks: string | null; createdAt: string;
  departmentId?: number | null; projectId?: number | null;
  warehouseId?: number | null; handlerId?: number | null; contactInfo?: string | null; shippingAddress?: string | null;
  handlerName?: string | null; warehouseName?: string | null; salesOrderNumber?: string | null;
}
interface Customer { id: number; name: string; remarks?: string | null; taxId?: string | null; phone?: string | null; address?: string | null }
interface Item { id: number; itemName: string; sellingPrice: string; itemCode?: string | null; specification?: string | null }
/** 「從銷貨單帶入」選單裡的一張銷貨單 */
interface OpenOrder { id: number; orderNumber: string; customerId: number; customerName: string; orderDate: string; label: string | null }
const empName = (e: any) => e ? (e.fullName || e.name || `${e.firstName || ""}${/^[A-Za-z]/.test(e.lastName || "") ? " " : ""}${e.lastName || ""}`.trim()) : "";
const today = () => new Date().toISOString().slice(0, 10);
const emptyForm = () => ({ salesOrderId: "", customerId: "", deliveryDate: today(), handlerId: "", warehouseId: "", contactInfo: "", shippingAddress: "", remarks: "", departmentId: "", projectId: "" });

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
  const [printData, setPrintData] = useState<PrintData | null>(null);
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

  const [form, setForm] = useState(emptyForm);
  const [lineItems, setLineItems] = useState<ItemLine[]>(() => blankLines());
  const [employees, setEmployees] = useState<any[]>([]);
  const [warehouses, setWarehouses] = useState<any[]>([]);
  const [openOrders, setOpenOrders] = useState<OpenOrder[]>([]);

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
    // 表單才用得到的選單：讀不到不影響列表
    const list = async (path: string) => { try { const r = await fetch(path); const d = r.ok ? await r.json() : []; return Array.isArray(d) ? d : []; } catch { return []; } };
    const [emps, whs, orders] = await Promise.all([list(`/erp-api/employees`), list(`/erp-api/warehouses`), list(`/erp-api/delivery-notes/open-orders`)]);
    setEmployees(emps); setWarehouses(whs); setOpenOrders(orders);
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll, reloadKey]);

  const resetForm = () => {
    setForm(emptyForm());
    setLineItems(blankLines());
    setEditing(null);
  };
  const formHasContent = () => !!(form.salesOrderId || form.customerId || form.remarks || form.contactInfo || form.shippingAddress || filledLines(lineItems).length > 0);
  /** 重新輸入：清空整張表單（跟 Ecount 的「重新輸入」一樣） */
  const clearForm = () => {
    if (formHasContent() && !window.confirm("要清空目前填的內容、重新輸入嗎？")) return;
    setForm(emptyForm()); setLineItems(blankLines());
  };

  /** 從銷貨單帶入：把這張銷貨單還沒出貨的品項與數量帶進來，數量可以再改少（分批出貨） */
  const pullFromOrder = async (orderId: string) => {
    if (!orderId) {
      setForm(p => ({ ...p, salesOrderId: "" }));
      setLineItems(prev => prev.map(l => ({ ...l, remaining: undefined })));
      return;
    }
    const res = await fetch(`/erp-api/delivery-notes/order-remaining/${orderId}`);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { toast({ title: data.error || "讀不到這張銷貨單", variant: "destructive" }); return; }
    if (!data.lines?.length) { toast({ title: "這張銷貨單的品項都已經排進出貨單了", variant: "destructive" }); return; }
    const o = data.order;
    setForm(p => ({
      ...p, salesOrderId: orderId, customerId: String(o.customerId),
      departmentId: o.departmentId ? String(o.departmentId) : p.departmentId,
      projectId: o.projectId ? String(o.projectId) : p.projectId,
      handlerId: o.handlerId ? String(o.handlerId) : p.handlerId,
      warehouseId: o.warehouseId ? String(o.warehouseId) : p.warehouseId,
      contactInfo: p.contactInfo || o.contactInfo || "",
      shippingAddress: p.shippingAddress || o.shippingAddress || "",
      // 出貨單還沒寫備註時，把銷貨單的備註帶過來
      remarks: p.remarks.trim() ? p.remarks : (o.remarks || ""),
    }));
    setLineItems(data.lines.map((l: any) => ({ itemId: String(l.itemId), quantity: String(l.quantity), rate: String(l.rate), specification: l.specification || "", note: l.note || "", remaining: Number(l.quantity) })));
    toast({ title: `已帶入 ${o.orderNumber} 還沒出貨的 ${data.lines.length} 個品項`, description: "只出一部分的話，把數量改少或刪掉那一行就可以。" });
  };

  const openEdit = (n: DeliveryNote) => {
    setEditing(n);
    setForm({
      salesOrderId: n.salesOrderId != null ? String(n.salesOrderId) : "",
      customerId: String(n.customerId),
      deliveryDate: n.deliveryDate,
      handlerId: n.handlerId != null ? String(n.handlerId) : "",
      warehouseId: n.warehouseId != null ? String(n.warehouseId) : "",
      contactInfo: n.contactInfo || "",
      shippingAddress: n.shippingAddress || "",
      remarks: n.remarks || "",
      departmentId: n.departmentId != null ? String(n.departmentId) : "",
      projectId: n.projectId != null ? String(n.projectId) : "",
    });
    setLineItems(linesFromSaved(n.items));
    setDetailNote(null);
    setOpen(true);
  };

  const handleCreate = async () => {
    if (!form.departmentId || !form.projectId) {
      toast({ title: "請選擇部門與專案", description: "部門與專案為必填欄位", variant: "destructive" }); return;
    }
    if (filledLines(lineItems).some(l => !(Number(l.quantity) > 0))) {
      toast({ title: "數量要大於 0", description: "不出貨的品項請把那一行刪掉。", variant: "destructive" }); return;
    }
    const payload = {
      customerId: Number(form.customerId), deliveryDate: form.deliveryDate,
      remarks: form.remarks || null,
      departmentId: Number(form.departmentId), projectId: Number(form.projectId),
      handlerId: form.handlerId ? Number(form.handlerId) : null,
      warehouseId: form.warehouseId ? Number(form.warehouseId) : null,
      contactInfo: form.contactInfo || null, shippingAddress: form.shippingAddress || null,
      items: linesPayload(lineItems),
      // 來源銷貨單只在新增時送；建好之後不能換
      ...(!editing && form.salesOrderId ? { salesOrderId: Number(form.salesOrderId) } : {}),
    };
    const res = editing
      ? await fetch(`/erp-api/delivery-notes/${editing.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) })
      : await fetch(`/erp-api/delivery-notes`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    if (res.ok) {
      toast({ title: editing ? "出貨單已更新" : "出貨單已建立" }); setOpen(false);
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
    if (!window.confirm("作廢此已出貨的出貨單將回沖庫存，確定嗎？")) return;
    const res = await fetch(`/erp-api/delivery-notes/${id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: "Cancelled" }),
    });
    if (res.ok) { toast({ title: "已作廢，庫存已回沖" }); fetchAll(); setDetailNote(null); }
    else { const err = await res.json(); toast({ title: err.error || "作廢失敗", variant: "destructive" }); }
  };

  useOpenFromUrl(notes, n => viewDetail(n.id));
  /** 列印出貨單：品項、送貨地址、備註都印出來；版面可在「系統管理 › 列印模板」調整 */
  const openPrint = async (n: DeliveryNote) => {
    const customer = customers.find(c => c.id === n.customerId);
    let company = companyOf(null);
    try { const r = await fetch(`/erp-api/brands`, { credentials: "include" }); if (r.ok) company = companyOf(defaultBrand(await r.json())); } catch { /* 讀不到公司資料就先不印公司欄 */ }
    const grand = Number(n.totalAmount) || 0;
    // 印的是視窗裡現在的備註（改了還沒按儲存也照印，免得印出舊的）
    const remarkText = (detailNote?.id === n.id ? editRemarks : n.remarks || "").trim();
    setPrintData({
      docNumber: n.noteNumber,
      customer: { name: n.customerName, taxId: customer?.taxId || undefined, phone: n.contactInfo || customer?.phone || undefined, address: n.shippingAddress || customer?.address || undefined },
      company: { ...company, contact: n.handlerName || company.contact },
      fields: { date: n.deliveryDate, salesOrder: n.salesOrderNumber, handler: n.handlerName, warehouse: n.warehouseName, project: projs.find(p => p.id === n.projectId)?.name },
      items: ((n.items as DNItem[]) || []).map(it => ({
        code: items.find(i => i.id === it.itemId)?.itemCode || undefined,
        name: it.specification ? `${it.itemName}[${it.specification}]` : it.itemName,
        qty: Number(it.quantity) || 0, unitPrice: Number(it.rate) || 0, amount: Number(it.amount) || 0, summary: it.note,
      })),
      totals: { subtotal: grand, tax: 0, grand, taxIncluded: true },
      terms: remarkText ? `備註：${remarkText}` : "",
    });
  };

  const viewDetail = async (id: number) => {
    const res = await fetch(`/erp-api/delivery-notes/${id}`);
    if (res.ok) {
      const d = await res.json();
      setDetailNote(d); setEditRemarks(d.remarks || "");
    }
  };

  // 「從銷貨單帶入」的選項：先選了客戶就只列那個客戶的單
  const orderOptions = openOrders
    .filter(o => !form.customerId || form.salesOrderId === String(o.id) || String(o.customerId) === form.customerId)
    .map(o => ({ value: String(o.id), label: `${o.orderNumber}｜${o.customerName}${o.label ? `｜${o.label}` : ""}` }));
  const linkedOrder = !!form.salesOrderId;

  return (
    <div className="space-y-6">
      <PageHeader title="出貨單" description="管理出貨流程，確認後自動扣除庫存" hint={<PageHint hintKey="delivery-notes">這裡記錄實際交付給客戶的品項。通常由已確認的銷售訂單轉入，核對出貨日期與數量後再確認。小提醒：確認會扣除庫存，若出貨有變更應先修正數量再送出。</PageHint>} />

      {batch.count > 0 && (
        <BatchActionBar
          count={batch.count}
          entityName="出貨單"
          entityEndpoint="delivery-notes"
          ids={batch.ids}
          batchFields={dnBatchFields}
          onClear={batch.clearSelection}
          onComplete={() => fetchAll()}
        />
      )}
      <div className="flex justify-end">
        <Button onClick={() => setOpen(true)}><Plus className="h-4 w-4 mr-1" />新增出貨單</Button>
        {/* 新增／編輯出貨單：外框用全系統共用的單據視窗 */}
        <DocWindow
          open={open}
          onClose={() => { setOpen(false); resetForm(); }}
          name={editing ? "編輯出貨單" : "新增出貨單"}
          number={editing?.noteNumber}
          status={editing ? <DocStatus label={statusMap[editing.status] || editing.status} tone={statusTone(editing.status)} /> : undefined}
          extraWide
          footer={<>
            <Button variant="outline" onClick={() => { setOpen(false); resetForm(); }}>取消</Button>
            {!editing && <Button variant="outline" onClick={clearForm}><RotateCcw className="mr-1 h-4 w-4" />重新輸入</Button>}
            <Button onClick={handleCreate} disabled={!form.customerId || filledLines(lineItems).length === 0}>儲存</Button>
          </>}
        >
          {/* 排法照 Ecount 的輸入畫面：上面一個欄位一列，下面一張一行一筆的品項表 */}
          <div className="space-y-4">
            <DocFormRows>
              <DocFormRow label="出貨單單號">
                <p className="py-1.5 text-sm text-muted-foreground">{editing ? editing.noteNumber : "儲存時產生"}</p>
              </DocFormRow>
              <DocFormRow label="銷貨單" hint={editing
                ? (linkedOrder ? "這張出貨單是從這張銷貨單帶入的，來源不能換。" : "這張出貨單沒有對應的銷貨單。")
                : "選一張銷貨單，會把還沒出貨的品項和數量帶進下面的表格；不選也可以直接自己填。"}>
                {editing
                  ? <p className="py-1.5 text-sm">{editing.salesOrderNumber || (linkedOrder ? `#${form.salesOrderId}` : "（無）")}</p>
                  : <SearchableSelect
                      value={form.salesOrderId}
                      onValueChange={pullFromOrder}
                      options={[{ value: "", label: "不從銷貨單帶入" }, ...orderOptions]}
                      placeholder="從銷貨單帶入（可不選）"
                      searchPlaceholder="輸入銷貨單號、客戶或標題搜尋..."
                      emptyText="找不到還沒出完的銷貨單"
                      data-testid="dn-pull-order"
                    />}
              </DocFormRow>
              <DocFormRow label="日期" htmlFor="dn-date" required>
                <Input id="dn-date" type="date" className="md:w-56" value={form.deliveryDate} onChange={e => setForm(p => ({ ...p, deliveryDate: e.target.value }))} />
              </DocFormRow>
              <DocFormRow label="客戶" required hint={linkedOrder ? "客戶跟著銷貨單走，不能改。" : undefined}>
                <SearchableSelect
                  value={form.customerId}
                  onValueChange={v => setForm(p => ({ ...p, customerId: v }))}
                  options={customers.map(c => ({ value: String(c.id), label: c.name }))}
                  placeholder="選擇客戶"
                  searchPlaceholder="輸入客戶名稱搜尋..."
                  emptyText="找不到符合的客戶"
                  disabled={linkedOrder}
                />
              </DocFormRow>
              {customers.find(c => String(c.id) === form.customerId)?.remarks?.trim() && (
                <DocFormRow label="客戶備註">
                  <CustomerRemarkHint
                    remarks={customers.find(c => String(c.id) === form.customerId)?.remarks}
                    onInsert={entry => setForm(p => ({ ...p, remarks: appendToDocumentRemarks(p.remarks, entry) }))}
                  />
                </DocFormRow>
              )}
              <DocFormRow label="承辦人">
                <SearchableSelect
                  value={form.handlerId}
                  onValueChange={v => setForm(p => ({ ...p, handlerId: v }))}
                  options={[{ value: "", label: "不指定" }, ...employees.filter(e => !e.status || e.status === "Active" || String(e.id) === form.handlerId).map(e => ({ value: String(e.id), label: empName(e) }))]}
                  placeholder="選擇承辦人"
                  searchPlaceholder="輸入姓名搜尋..."
                  emptyText="找不到符合的員工"
                />
              </DocFormRow>
              <DocFormRow label="發貨倉庫" hint="確認出貨時，庫存會從這個倉庫扣。">
                <SearchableSelect
                  value={form.warehouseId}
                  onValueChange={v => setForm(p => ({ ...p, warehouseId: v }))}
                  options={[{ value: "", label: "不指定" }, ...warehouses.filter(w => w.isActive !== false || String(w.id) === form.warehouseId).map(w => ({ value: String(w.id), label: w.name }))]}
                  placeholder="選擇倉庫"
                  searchPlaceholder="輸入倉庫名稱搜尋..."
                  emptyText="找不到符合的倉庫"
                />
              </DocFormRow>
              <DocFormRow label="聯繫方式" htmlFor="dn-contact">
                <Input id="dn-contact" value={form.contactInfo} onChange={e => setForm(p => ({ ...p, contactInfo: e.target.value }))} placeholder="收貨人、電話" />
              </DocFormRow>
              <DocFormRow label="地址" htmlFor="dn-address">
                <Input id="dn-address" value={form.shippingAddress} onChange={e => setForm(p => ({ ...p, shippingAddress: e.target.value }))} placeholder="送貨地址" />
              </DocFormRow>
              <DocFormRow label="部門" required>
                <SearchableSelect
                  value={form.departmentId}
                  onValueChange={v => setForm(p => ({ ...p, departmentId: v }))}
                  options={selectableDepartments(depts, form.departmentId).map(d => ({ value: String(d.id), label: departmentLabel(d) }))}
                  placeholder="請選擇部門"
                  searchPlaceholder="輸入部門名稱搜尋..."
                  emptyText="找不到符合的部門"
                  triggerClassName={!form.departmentId ? "border-red-300 bg-red-50" : undefined}
                />
              </DocFormRow>
              <DocFormRow label="專案" required>
                <SearchableSelect
                  value={form.projectId}
                  onValueChange={v => setForm(p => ({ ...p, projectId: v }))}
                  options={selectableProjects(projs, form.projectId).map(p => ({ value: String(p.id), label: projectPickerLabel(p) }))}
                  placeholder="請選擇專案"
                  searchPlaceholder="輸入專案名稱搜尋..."
                  emptyText="找不到符合的專案"
                  triggerClassName={!form.projectId ? "border-red-300 bg-red-50" : undefined}
                />
              </DocFormRow>
              <DocFormRow label="備註" htmlFor="dn-remarks">
                <Textarea id="dn-remarks" rows={2} value={form.remarks} onChange={e => setForm(p => ({ ...p, remarks: e.target.value }))} placeholder="備註說明（會印在出貨單上）" />
              </DocFormRow>
            </DocFormRows>

            <DocItemLines
              lines={lineItems}
              onChange={setLineItems}
              items={items}
              priceOf={id => items.find(it => it.id === id)?.sellingPrice}
              remainingLabel="銷貨單還剩"
            />
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
        <CardHeader className="py-3 border-b"><CardTitle>出貨單列表</CardTitle></CardHeader>
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
                  <tr key={n.id} className="border-b hover:bg-gray-50 cursor-pointer" title="點一下看這張出貨單的內容"
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

      {/* 出貨單明細：用全系統共用的單據視窗外框，排法跟其他單據一樣 */}
      {detailNote && (
        <DocWindow
          open
          onClose={() => setDetailNote(null)}
          name="出貨單"
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
              <Button variant="outline" onClick={() => openPrint(detailNote)} data-testid="button-print-delivery-note"><Printer className="h-4 w-4 mr-1" />列印</Button>
              <Button variant="outline" onClick={() => setDetailNote(null)}>關閉</Button>
            </>
          }
        >
          <DocFields items={[
            ["客戶", detailNote.customerName],
            ["出貨日期", detailNote.deliveryDate],
            ["金額", `$${detailNote.totalAmount.toLocaleString()}`],
            ["銷貨單", detailNote.salesOrderNumber],
            ["承辦人", detailNote.handlerName],
            ["發貨倉庫", detailNote.warehouseName],
            ["聯繫方式", detailNote.contactInfo],
            ["地址", detailNote.shippingAddress],
          ]} />

          <DocLines<DNItem>
            rows={(detailNote.items as DNItem[]) || []}
            columns={[
              { header: "品項", cell: item => item.itemName },
              { header: "規格", cell: item => item.specification || "" },
              { header: "數量", align: "right", cell: item => item.quantity },
              { header: "單價", align: "right", cell: item => `$${item.rate.toLocaleString()}` },
              { header: "摘要", cell: item => item.note || "" },
              { header: "金額", align: "right", cell: item => `$${item.amount.toLocaleString()}` },
            ]}
            total={{ value: `$${detailNote.totalAmount.toLocaleString()}` }}
          />

          <DocSection title="備註">
            <div className="flex gap-2">
              <Textarea rows={2} value={editRemarks} onChange={e => setEditRemarks(e.target.value)} placeholder="備註（會印在出貨單上）" />
              <Button size="sm" onClick={saveRemarks}>儲存</Button>
            </div>
            {detailNote.status !== "Draft" && <p className="text-xs text-muted-foreground">已出貨的出貨單可以補備註；品項與數量不能改。</p>}
          </DocSection>

          <RelatedDocs type="delivery_note" id={detailNote.id} onNavigate={() => setDetailNote(null)} />
        </DocWindow>
      )}
      <DocumentPrintDialog open={!!printData} onClose={() => setPrintData(null)} docType="DeliveryNote" data={printData} />
    </div>
  );
}
