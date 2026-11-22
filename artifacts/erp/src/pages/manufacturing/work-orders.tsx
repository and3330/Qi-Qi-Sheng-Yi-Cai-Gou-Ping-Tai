import { useState, useEffect, useCallback } from "react";
import { useAutoReloadKey } from "@/lib/auto-refresh";
import { PageHeader } from "@/components/shared/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { DocWindow, DocStatus, DocFields, DocLines, DocSection, DocFormRows, DocFormRow, statusTone } from "@/components/shared/doc-window";
import { RelatedDocs, useOpenFromUrl } from "@/components/shared/related-docs";
import { useToast } from "@/hooks/use-toast";
import { Plus, Eye, Trash2, Play, CheckCircle, Search, RotateCcw } from "lucide-react";
import { useBatchSelection } from "@/hooks/use-batch-selection";
import { BatchActionBar, type BatchField } from "@/components/shared/batch-action-bar";
import { CheckboxCell, CheckboxHeader } from "@/components/shared/checkbox-column";

import { LookupSelect } from "@/components/shared/lookup-select";
const BASE = import.meta.env.BASE_URL.endsWith("/") ? import.meta.env.BASE_URL : import.meta.env.BASE_URL + "/";

interface WoItem { id: number; workOrderNumber: string; bomNumber: string; itemName: string; plannedQuantity: number; completedQuantity: number; status: string; priority: string; plannedStartDate: string | null; plannedEndDate: string | null; customerId?: number | null; customerName?: string; handlerId?: number | null; handlerName?: string; salesOrderId?: number | null; salesOrderNumber?: string }
interface WoDetail extends WoItem { items: { id: number; itemId: number; itemName: string; itemCode: string; requiredQuantity: number; issuedQuantity: number; unit: string }[]; actualStartDate: string | null; actualEndDate: string | null; remarks: string | null; salesOrderId: number | null }
interface Bom { id: number; bomNumber: string; itemName: string; itemCode?: string; status: string }
/** 選了 BOM 之後抓的明細：一批做幾個、要用哪些原料 */
interface BomDetail { id: number; quantity: number; items: { id: number; itemId: number; itemCode: string; itemName: string; quantity: number; unit: string }[] }
interface OpenSalesOrder { id: number; orderNumber: string; customerId: number; customerName: string; deliveryDate: string | null; status: string; orderSource: string | null }
interface Lookups { customers: { id: number; name: string }[]; employees: any[]; salesOrders: OpenSalesOrder[] }

const statusMap: Record<string, string> = { Draft: "草稿", "In Progress": "進行中", Completed: "已完成", Cancelled: "已取消" };
const statusColor = (s: string) => s === "In Progress" ? "default" : s === "Completed" ? "secondary" : s === "Cancelled" ? "destructive" : "outline";
const priorityMap: Record<string, string> = { Low: "低", Medium: "中", High: "高", Urgent: "緊急" };
const emptyForm = { salesOrderId: "", customerId: "", handlerId: "", bomId: "", plannedQuantity: "", priority: "Medium", plannedStartDate: "", plannedEndDate: "", remarks: "" };
const selectClass = "h-10 w-full rounded-md border bg-background px-3 text-sm";
const empName = (e: any) => e ? (e.fullName || e.name || `${e.firstName || ""}${/^[A-Za-z]/.test(e.lastName || "") ? " " : ""}${e.lastName || ""}`.trim()) : "";
/** 需求數量最多留四位小數，不顯示多餘的 0 */
const qtyText = (n: number) => String(Math.round(n * 10000) / 10000);

export default function WorkOrdersPage() {
  const reloadKey = useAutoReloadKey();
  const [orders, setOrders] = useState<WoItem[]>([]);
  const [boms, setBoms] = useState<Bom[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [detail, setDetail] = useState<WoDetail | null>(null);
  const [finishOpen, setFinishOpen] = useState(false);
  const [finishQty, setFinishQty] = useState("");
  const [issueOpen, setIssueOpen] = useState(false);
  const [issueItemId, setIssueItemId] = useState("");
  const [issueQty, setIssueQty] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [filterStatus, setFilterStatus] = useState("");
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [lookups, setLookups] = useState<Lookups>({ customers: [], employees: [], salesOrders: [] });
  const [bomDetail, setBomDetail] = useState<BomDetail | null>(null);
  const { toast } = useToast();
  const woBatchFields: BatchField[] = [{key:"status",label:"狀態",type:"select",options:[{value:"Draft",label:"草稿"},{value:"In Progress",label:"進行中"},{value:"Completed",label:"已完成"}]},{key:"priority",label:"優先順序",type:"select",options:[{value:"Low",label:"低"},{value:"Medium",label:"中"},{value:"High",label:"高"}]}];

  const fetchAll = useCallback(async () => {
    setLoading(true);
    const [wRes, bRes] = await Promise.all([fetch(`/erp-api/work-orders`), fetch(`/erp-api/boms`)]);
    setOrders(await wRes.json()); setBoms((await bRes.json()).filter((b: Bom) => b.status === "Active"));
    setLoading(false);
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll, reloadKey]);

  // 打開新增視窗時才抓客戶、員工、銷貨單（清單頁本身用不到）
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const get = (path: string) => fetch(`/erp-api/${path}`).then(r => (r.ok ? r.json() : null)).catch(() => null);
    Promise.all([get("customers"), get("employees"), get("sales-orders")]).then(([c, e, s]) => {
      if (cancelled) return;
      setLookups(prev => ({
        customers: Array.isArray(c) ? c : prev.customers,
        employees: Array.isArray(e) ? e : prev.employees,
        // 還沒結束的銷貨單才能帶入；從 Ecount 搬來的歷史單不列
        salesOrders: Array.isArray(s) ? s.filter((o: OpenSalesOrder) => o.status !== "Cancelled" && o.status !== "Completed" && o.orderSource !== "ecount") : prev.salesOrders,
      }));
    });
    return () => { cancelled = true; };
  }, [open]);

  // 選了 BOM 就抓它的原料，下面的「用料」表格用它乘上數量
  useEffect(() => {
    if (!open || !form.bomId) { setBomDetail(null); return; }
    let cancelled = false;
    setBomDetail(null);
    fetch(`/erp-api/boms/${form.bomId}`).then(r => (r.ok ? r.json() : null)).then(d => { if (!cancelled) setBomDetail(d); }).catch(() => {});
    return () => { cancelled = true; };
  }, [open, form.bomId]);

  const resetForm = () => setForm(emptyForm);
  const hasFormInput = (Object.keys(emptyForm) as (keyof typeof emptyForm)[]).some(k => form[k] !== emptyForm[k]);
  // 從銷貨單帶入：客戶跟著銷貨單，銷貨單有預計交貨日就帶進交付日期
  const pickSalesOrder = (value: string) => {
    const so = lookups.salesOrders.find(o => String(o.id) === value);
    setForm(p => ({ ...p, salesOrderId: value, ...(so ? { customerId: String(so.customerId), plannedEndDate: so.deliveryDate || p.plannedEndDate } : {}) }));
  };
  const pickedSalesOrder = lookups.salesOrders.find(o => String(o.id) === form.salesOrderId);
  const plannedQty = Number(form.plannedQuantity) || 0;

  const handleCreate = async () => {
    const payload = {
      bomId: Number(form.bomId), plannedQuantity: Number(form.plannedQuantity), priority: form.priority,
      salesOrderId: form.salesOrderId ? Number(form.salesOrderId) : null,
      customerId: form.customerId ? Number(form.customerId) : null,
      handlerId: form.handlerId ? Number(form.handlerId) : null,
      plannedStartDate: form.plannedStartDate || null, plannedEndDate: form.plannedEndDate || null, remarks: form.remarks || null,
    };
    setSaving(true);
    try {
      const res = await fetch(`/erp-api/work-orders`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      if (res.ok) { toast({ title: "工單已建立" }); setOpen(false); resetForm(); fetchAll(); }
      else { const err = await res.json().catch(() => ({})); toast({ title: err.error || "建立失敗", variant: "destructive" }); }
    } finally { setSaving(false); }
  };

  const viewDetail = async (id: number) => {
    const res = await fetch(`/erp-api/work-orders/${id}`);
    if (res.ok) setDetail(await res.json());
  };
  // 網址帶 ?open=<id> 時（從別張單的「關聯單據」點過來），直接打開那張工單
  useOpenFromUrl(orders, o => { viewDetail(o.id); });

  const updateStatus = async (id: number, status: string, extra?: Record<string, unknown>) => {
    const res = await fetch(`/erp-api/work-orders/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status, ...extra }) });
    if (res.ok) { toast({ title: `狀態已更新` }); fetchAll(); if (detail?.id === id) viewDetail(id); }
    else { const err = await res.json(); toast({ title: err.error, variant: "destructive" }); }
  };

  const handleIssueMaterial = async () => {
    if (!detail) return;
    const res = await fetch(`/erp-api/work-orders/${detail.id}/issue-material`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ itemId: Number(issueItemId), quantity: Number(issueQty) }) });
    if (res.ok) {
      const done = await res.json().catch(() => null);
      toast({ title: "材料已領用", description: done?.issuedCost > 0 ? `已入帳：在製品 $${Number(done.issuedCost).toLocaleString()}` : "這個材料沒有成本，未產生分錄" });
      setIssueOpen(false); setIssueItemId(""); setIssueQty(""); viewDetail(detail.id); fetchAll(); }
    else { const err = await res.json(); toast({ title: err.error, variant: "destructive" }); }
  };

  const handleFinish = async () => {
    if (!detail) return;
    const res = await fetch(`/erp-api/work-orders/${detail.id}/finish`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ quantity: Number(finishQty) }) });
    if (res.ok) {
      const done = await res.json().catch(() => null);
      toast({ title: "成品入庫完成", description: done?.finishedCost > 0 ? `已入帳：製成品 $${Number(done.finishedCost).toLocaleString()}` : "尚未發料，沒有成本可轉入製成品" });
      setFinishOpen(false); viewDetail(detail.id); fetchAll(); }
    else { const err = await res.json(); toast({ title: err.error, variant: "destructive" }); }
  };

  const handleDelete = async (id: number) => {
    const res = await fetch(`/erp-api/work-orders/${id}`, { method: "DELETE" });
    if (res.ok) { toast({ title: "已刪除" }); fetchAll(); setDetail(null); }
    else { const err = await res.json(); toast({ title: err.error, variant: "destructive" }); }
  };

  const filtered = orders.filter(o => {
    if (searchTerm && !o.workOrderNumber.includes(searchTerm) && !o.itemName.includes(searchTerm) && !(o.customerName || "").includes(searchTerm)) return false;
    if (filterStatus && o.status !== filterStatus) return false;
    return true;
  });

  const batch = useBatchSelection(filtered);

  return (
    <div className="space-y-6">
      <PageHeader title="工單" description="管理生產工單，追蹤生產進度" />
      {batch.count > 0 && (
        <BatchActionBar
          count={batch.count}
          entityName="工單"
          entityEndpoint="work-orders"
          ids={batch.ids}
          batchFields={woBatchFields}
          onClear={batch.clearSelection}
          onComplete={() => fetchAll()}
        />
      )}
      <div className="flex flex-wrap gap-3 items-center">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
          <Input className="pl-9" placeholder="搜尋工單..." value={searchTerm} onChange={e => setSearchTerm(e.target.value)} />
        </div>
        <select className="border rounded-md px-3 py-2 text-sm" value={filterStatus} onChange={e => setFilterStatus(e.target.value)}>
          <option value="">所有狀態</option>
          {Object.entries(statusMap).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <Button onClick={() => setOpen(true)}><Plus className="h-4 w-4 mr-1" />新增工單</Button>
        {/* 新增表單（老闆 2026-11-18：照 Ecount「輸入生產工單」的畫面）：上面一格一列的表頭，下面一張有編號的用料表格。
            我們一張工單只做一個成品，用料照 BOM 乘上數量算出來，所以表格只能看、不能改。 */}
        <DocWindow
          open={open} onClose={() => setOpen(false)} name="新增工單" wide
          footer={<>
            <Button variant="outline" onClick={() => setOpen(false)}>取消</Button>
            <Button variant="outline" disabled={saving} onClick={() => { if (!hasFormInput || window.confirm("把這張單已經填的內容全部清掉，重新輸入？")) resetForm(); }} data-testid="button-reset-work-order">
              <RotateCcw className="mr-1 h-4 w-4" />重新輸入
            </Button>
            <Button onClick={handleCreate} disabled={saving || !form.bomId || !(plannedQty > 0)} data-testid="button-save-work-order">{saving ? "儲存中..." : "儲存"}</Button>
          </>}
        >
            <div className="space-y-4">
              <DocFormRows data-testid="work-order-header">
                <DocFormRow label="生產工單單號">
                  <div className="flex h-10 items-center rounded-md border border-dashed bg-muted/40 px-3 text-sm text-muted-foreground md:w-48">儲存時產生</div>
                </DocFormRow>
                <DocFormRow label="銷貨單" hint={pickedSalesOrder ? `已帶入客戶${pickedSalesOrder.deliveryDate ? "和交付日期" : ""}，帶出來之後還是可以改。` : "選填。這張工單是為了哪一張銷貨單做的，選了會帶出客戶和交付日期。"}>
                  <LookupSelect className="w-full h-10" value={form.salesOrderId} onChange={e => pickSalesOrder(e.target.value)} data-testid="select-work-order-sales-order">
                    <option value="">從銷貨單帶入（不選也可以）</option>
                    {lookups.salesOrders.map(o => <option key={o.id} value={o.id}>{o.orderNumber}・{o.customerName}{o.deliveryDate ? `・交貨 ${o.deliveryDate}` : ""}</option>)}
                  </LookupSelect>
                </DocFormRow>
                <DocFormRow label="客戶">
                  <LookupSelect className="w-full h-10" value={form.customerId} onChange={e => setForm(p => ({ ...p, customerId: e.target.value }))} data-testid="select-work-order-customer">
                    <option value="">選擇客戶（選填）</option>
                    {/* 銷貨單的客戶已停用時選單裡沒有，補一個選項才顯示得出來 */}
                    {form.customerId && pickedSalesOrder && String(pickedSalesOrder.customerId) === form.customerId && !lookups.customers.some(c => String(c.id) === form.customerId) && <option value={form.customerId}>{pickedSalesOrder.customerName}</option>}
                    {lookups.customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </LookupSelect>
                </DocFormRow>
                <DocFormRow label="承辦人">
                  <LookupSelect className="w-full h-10" value={form.handlerId} onChange={e => setForm(p => ({ ...p, handlerId: e.target.value }))} data-testid="select-work-order-handler">
                    <option value="">選擇承辦人（選填）</option>
                    {lookups.employees.filter((e: any) => !e.status || e.status === "Active" || String(e.id) === form.handlerId).map((e: any) => <option key={e.id} value={e.id}>{empName(e)}</option>)}
                  </LookupSelect>
                </DocFormRow>
                <DocFormRow label="生產品項 (BOM)" required hint="只列得出已啟用的物料清單。">
                  <LookupSelect className="w-full h-10" value={form.bomId} onChange={e => setForm(p => ({ ...p, bomId: e.target.value }))} data-testid="select-work-order-bom">
                    <option value="">選擇要生產的品項</option>
                    {boms.map(b => <option key={b.id} value={b.id}>{b.itemCode ? `${b.itemCode} - ` : ""}{b.itemName}（{b.bomNumber}）</option>)}
                  </LookupSelect>
                </DocFormRow>
                <DocFormRow label="數量" htmlFor="wo-quantity" required>
                  <Input id="wo-quantity" type="number" inputMode="decimal" min="1" className="h-10 md:h-10 md:w-48" value={form.plannedQuantity} onChange={e => setForm(p => ({ ...p, plannedQuantity: e.target.value }))} placeholder="要做幾個" />
                </DocFormRow>
                <DocFormRow label="優先順序" htmlFor="wo-priority">
                  <select id="wo-priority" className={`${selectClass} md:w-48`} value={form.priority} onChange={e => setForm(p => ({ ...p, priority: e.target.value }))}>
                    <option value="Low">低</option><option value="Medium">中</option><option value="High">高</option><option value="Urgent">緊急</option>
                  </select>
                </DocFormRow>
                <DocFormRow label="計畫開始日" htmlFor="wo-start">
                  <Input id="wo-start" type="date" className="h-10 md:h-10 md:w-48" value={form.plannedStartDate} onChange={e => setForm(p => ({ ...p, plannedStartDate: e.target.value }))} />
                </DocFormRow>
                <DocFormRow label="交付日期" htmlFor="wo-delivery">
                  <Input id="wo-delivery" type="date" className="h-10 md:h-10 md:w-48" value={form.plannedEndDate} onChange={e => setForm(p => ({ ...p, plannedEndDate: e.target.value }))} />
                </DocFormRow>
                <DocFormRow label="備註" htmlFor="wo-remarks">
                  <Input id="wo-remarks" className="h-10 md:h-10" value={form.remarks} onChange={e => setForm(p => ({ ...p, remarks: e.target.value }))} />
                </DocFormRow>
              </DocFormRows>

              {/* 用料：BOM 的原料 ÷ 一批做幾個 × 這張工單的數量，跟存檔後工單上的「所需材料」算法一樣 */}
              <div className="space-y-1.5">
                <p className="text-sm font-semibold">用料（依 BOM 計算）</p>
                <div className="max-w-full overflow-x-auto rounded-md border" data-testid="work-order-materials">
                  <table className="w-full min-w-[420px] text-sm">
                    <thead className="bg-muted/60 text-xs text-muted-foreground">
                      <tr>
                        <th className="w-9 px-2 py-2 text-center font-medium">#</th>
                        <th className="px-2 py-2 text-left font-medium">品項編碼／名稱</th>
                        <th className="w-32 px-2 py-2 text-right font-medium">需求數量</th>
                        <th className="w-20 px-2 py-2 text-left font-medium">單位</th>
                      </tr>
                    </thead>
                    <tbody>
                      {!form.bomId ? <tr className="border-t"><td colSpan={4} className="px-3 py-6 text-center text-muted-foreground">選了生產品項 (BOM) 之後，這裡會列出要用的原料</td></tr>
                      : !bomDetail ? <tr className="border-t"><td colSpan={4} className="px-3 py-6 text-center text-muted-foreground">載入中...</td></tr>
                      : bomDetail.items.length === 0 ? <tr className="border-t"><td colSpan={4} className="px-3 py-6 text-center text-muted-foreground">這張 BOM 沒有原料</td></tr>
                      : bomDetail.items.map((m, i) => (
                        <tr key={m.id} className="border-t">
                          <td className="px-2 py-2 text-center text-xs text-muted-foreground">{i + 1}</td>
                          <td className="px-2 py-2">{m.itemCode} - {m.itemName}</td>
                          <td className="px-2 py-2 text-right tabular-nums">{plannedQty > 0 ? qtyText((m.quantity / (Number(bomDetail.quantity) || 1)) * plannedQty) : <span className="text-muted-foreground">-</span>}</td>
                          <td className="px-2 py-2 text-muted-foreground">{m.unit && m.unit !== "Nos" ? m.unit : "-"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {form.bomId && bomDetail && bomDetail.items.length > 0 && !(plannedQty > 0) && <p className="text-xs text-muted-foreground">填了數量就會算出每個原料要用多少。</p>}
              </div>
            </div>
        </DocWindow>
      </div>

      <Card>
        <CardContent className="p-0 overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="border-b bg-gray-50/50">
              <th className="w-10 px-2"><CheckboxHeader checked={batch.allSelected} indeterminate={batch.someSelected} onChange={batch.toggleAll} /></th>
              <th className="text-left px-4 py-2.5 font-semibold">工單號</th>
              <th className="text-left px-4 py-2.5 font-semibold">成品</th>
              <th className="text-left px-4 py-2.5 font-semibold">客戶</th>
              <th className="text-center px-4 py-2.5 font-semibold">優先</th>
              <th className="text-right px-4 py-2.5 font-semibold">計畫</th>
              <th className="text-right px-4 py-2.5 font-semibold">完成</th>
              <th className="text-left px-4 py-2.5 font-semibold">交付日期</th>
              <th className="text-center px-4 py-2.5 font-semibold">狀態</th>
              <th className="text-center px-4 py-2.5 font-semibold">操作</th>
            </tr></thead>
            <tbody>
              {loading ? <tr><td colSpan={10} className="px-4 py-8 text-center text-gray-400">載入中...</td></tr>
              : filtered.length === 0 ? <tr><td colSpan={10} className="px-4 py-8 text-center text-gray-400">尚無資料</td></tr>
              : filtered.map(o => (
                <tr key={o.id} className="border-b hover:bg-gray-50 cursor-pointer" onClick={e => { if ((e.target as HTMLElement).closest("button,select,input,a,label")) return; viewDetail(o.id); }} data-testid={`work-order-row-${o.id}`}>
                  <td className="px-2" onClick={e => e.stopPropagation()}><CheckboxCell checked={batch.selectedIds.has(o.id)} onChange={() => batch.toggle(o.id)} /></td>
                  <td className="px-4 py-2 font-mono">{o.workOrderNumber}</td>
                  <td className="px-4 py-2">{o.itemName}</td>
                  <td className="px-4 py-2">{o.customerName || <span className="text-muted-foreground">-</span>}</td>
                  <td className="px-4 py-2 text-center"><Badge variant="outline">{priorityMap[o.priority]}</Badge></td>
                  <td className="px-4 py-2 text-right">{o.plannedQuantity}</td>
                  <td className="px-4 py-2 text-right">{o.completedQuantity}</td>
                  <td className="px-4 py-2 whitespace-nowrap">{o.plannedEndDate || <span className="text-muted-foreground">-</span>}</td>
                  <td className="px-4 py-2 text-center"><Badge variant={statusColor(o.status)}>{statusMap[o.status]}</Badge></td>
                  <td className="px-4 py-2 text-center">
                    <div className="flex gap-1 justify-center">
                      <Button size="sm" variant="outline" onClick={() => viewDetail(o.id)}><Eye className="h-3 w-3" /></Button>
                      {o.status === "Draft" && <Button size="sm" variant="ghost" onClick={() => handleDelete(o.id)}><Trash2 className="h-3 w-3" /></Button>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      {/* 工單明細：標題列 → 表頭欄位 → 所需材料 → 關聯單據 → 底部按鈕列 */}
      <DocWindow
        open={!!detail} onClose={() => setDetail(null)}
        name="工單" number={detail?.workOrderNumber}
        status={detail ? <DocStatus label={statusMap[detail.status] || detail.status} tone={statusTone(detail.status)} /> : undefined}
        footer={detail && <>
          {detail.status === "Draft" && <Button variant="destructive" className="mr-auto" onClick={() => handleDelete(detail.id)}>刪除</Button>}
          {detail.status === "In Progress" && <Button variant="destructive" className="mr-auto" onClick={() => updateStatus(detail.id, "Cancelled")}>取消</Button>}
          <Button variant="outline" onClick={() => setDetail(null)}>關閉</Button>
          {detail.status === "Draft" && <Button onClick={() => updateStatus(detail.id, "In Progress")}><Play className="h-3 w-3 mr-1" />開始生產</Button>}
          {detail.status === "In Progress" && (
            <>
              <Button variant="outline" onClick={() => setIssueOpen(true)}>領料</Button>
              <Button variant="outline" onClick={() => { setFinishQty(String(detail.plannedQuantity)); setFinishOpen(true); }}><CheckCircle className="h-3 w-3 mr-1" />成品入庫</Button>
              <Button onClick={() => updateStatus(detail.id, "Completed", { completedQuantity: detail.completedQuantity })}>完工結案</Button>
            </>
          )}
        </>}
      >
        {detail && (
          <>
            <DocFields items={[
              ["成品", detail.itemName],
              ["BOM", detail.bomNumber],
              ["客戶", detail.customerName],
              ["承辦人", detail.handlerName],
              ["銷貨單", detail.salesOrderId && detail.salesOrderNumber ? <a className="text-primary hover:underline" href={`${BASE}sales/orders/${detail.salesOrderId}`}>{detail.salesOrderNumber}</a> : ""],
              ["計畫數量", detail.plannedQuantity],
              ["已完成", detail.completedQuantity],
              ["優先順序", priorityMap[detail.priority]],
              ["計畫開始", detail.plannedStartDate],
              ["交付日期", detail.plannedEndDate],
              ["實際開始", detail.actualStartDate],
              ["實際完成", detail.actualEndDate],
            ]} />
            {detail.items.length > 0 && (
              <DocSection title="所需材料">
                <DocLines
                  columns={[
                    { header: "品項", cell: (i: WoDetail["items"][number]) => `${i.itemCode} - ${i.itemName}` },
                    { header: "需求", align: "right", cell: (i: WoDetail["items"][number]) => i.requiredQuantity },
                    { header: "已領", align: "right", cell: (i: WoDetail["items"][number]) => i.issuedQuantity },
                    { header: "單位", cell: (i: WoDetail["items"][number]) => i.unit },
                  ]}
                  rows={detail.items}
                />
              </DocSection>
            )}
            <RelatedDocs type="work_order" id={detail.id} onNavigate={() => setDetail(null)} />
          </>
        )}
      </DocWindow>

      <DocWindow
        open={finishOpen} onClose={() => setFinishOpen(false)}
        name="成品入庫" number={detail?.workOrderNumber}
        footer={<>
          <Button variant="outline" onClick={() => setFinishOpen(false)}>取消</Button>
          <Button onClick={handleFinish}>確認入庫</Button>
        </>}
      >

          <div className="space-y-4">
            <div><label className="text-sm font-medium">入庫數量</label><Input type="number" min="1" value={finishQty} onChange={e => setFinishQty(e.target.value)} /></div>
          </div>
      </DocWindow>
      <DocWindow
        open={issueOpen} onClose={() => setIssueOpen(false)}
        name="領料" number={detail?.workOrderNumber}
        footer={<>
          <Button variant="outline" onClick={() => setIssueOpen(false)}>取消</Button>
          <Button onClick={handleIssueMaterial} disabled={!issueItemId || !issueQty}>確認領料</Button>
        </>}
      >
          {detail && (
            <div className="space-y-4">
              <div>
                <label className="text-sm font-medium">品項</label>
                <LookupSelect className="w-full border rounded-md px-3 py-2 text-sm" value={issueItemId} onChange={e => setIssueItemId(e.target.value)}>
                  <option value="">選擇材料</option>
                  {detail.items.map(i => (
                    <option key={i.id} value={i.itemId}>{i.itemCode} - {i.itemName}（需求: {i.requiredQuantity}, 已領: {i.issuedQuantity}）</option>
                  ))}
                </LookupSelect>
              </div>
              <div><label className="text-sm font-medium">領用數量</label><Input type="number" min="1" value={issueQty} onChange={e => setIssueQty(e.target.value)} /></div>
            </div>
          )}
      </DocWindow>
    </div>
  );
}
