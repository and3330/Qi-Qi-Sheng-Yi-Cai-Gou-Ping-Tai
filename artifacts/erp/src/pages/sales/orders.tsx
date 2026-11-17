import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useLocation, useSearch } from "wouter";
import { DataTable } from "@/components/shared/data-table";
import { PageHeader } from "@/components/shared/page-header";
import { PageHint } from "@/components/page-hint";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { useToast } from "@/hooks/use-toast";
import { Plus, Pencil, Trash2, Search, FileText, Copy } from "lucide-react";
import { templateAppliesTo } from "@/lib/template-fields";
import { useBatchSelection } from "@/hooks/use-batch-selection";
import { BatchActionBar, type BatchField } from "@/components/shared/batch-action-bar";
import { CheckboxCell, CheckboxHeader } from "@/components/shared/checkbox-column";
import { ColumnSelector, useColumnVisibility, type ColumnDef } from "@/components/shared/column-selector";
import { ExportMenu } from "@/components/shared/export-menu";
import type { ExportOptions } from "@/lib/export-utils";
import { useAutoReloadKey } from "@/lib/auto-refresh";
import {
  getEcpayInvoiceFormErrors,
  type EcpayInvoiceForm,
} from "@/lib/ecpay-invoice-form";

import { SalesOrderFormDialog, salesOrderCopyValues, type SalesOrderForm } from "@/components/sales/sales-order-edit-dialog";
import { DateRangePresets } from "@/components/shared/date-range-presets";
const BASE_URL = import.meta.env.BASE_URL;
const BASE = BASE_URL.endsWith("/") ? BASE_URL : BASE_URL + "/";

function newInvoiceIssueKey(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, value => value.toString(16).padStart(2, "0")).join("");
}

const statusMap: Record<string, string> = { Draft: "草稿", Confirmed: "已確認", "To Deliver": "待出貨", Completed: "已完成", Cancelled: "已取消" };
const statusOptions = ["Draft", "Confirmed", "To Deliver", "Completed", "Cancelled"];
/** 員工顯示名稱：姓＋名（中文名字中間不加空白） */
const empName = (e: any) => e ? (e.fullName || e.name || `${e.firstName || ""}${/^[A-Za-z]/.test(e.lastName || "") ? " " : ""}${e.lastName || ""}`.trim()) : "";

const salesStatusActions: Record<string, string[]> = {
  Draft: ["Confirmed", "To Deliver", "Cancelled"],
  Confirmed: ["To Deliver", "Cancelled"],
  "To Deliver": ["Cancelled"],
  Completed: [],
  Cancelled: [],
};

function getMonthRange() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  return { from: `${y}-${m}-01`, to: `${y}-${m}-${new Date(y, now.getMonth() + 1, 0).getDate()}` };
}

const SOURCE_LABELS: Record<string, string> = {
  ecount: "Ecount 歷史單",
  manual: "手動建立", quick_entry: "快速錄單",
  api_ecommerce: "API匯入-商城", api_event: "API匯入-活動平台",
};

interface FieldDef {
  name: string; label: string; type: "text" | "number" | "date" | "select" | "textarea";
  required: boolean; options?: string[];
}

interface TemplateInfo {
  id: number; name: string; businessType: string; fieldSchema: FieldDef[];
  isActive: boolean; projectId: number | null;
}

export default function SalesOrdersPage() {
  const reloadKey = useAutoReloadKey();
  const [, navigate] = useLocation();
  const searchParams = useSearch();
  const { toast } = useToast();
  const [orders, setOrders] = useState<any[]>([]);
  const [employees, setEmployees] = useState<any[]>([]);
  const [templates, setTemplates] = useState<TemplateInfo[]>([]);
  const [loading, setLoading] = useState(true);
  // 銷貨單表單視窗：editing 有值＝編輯那一張；沒有＝新增（initial 是複製或從客戶頁帶進來的內容）
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [initial, setInitial] = useState<{ values?: Partial<SalesOrderForm>; priceSource?: string } | null>(null);

  // ===== 開立發票對話框 =====
  const [invoiceOpen, setInvoiceOpen] = useState(false);
  const [invoiceLoading, setInvoiceLoading] = useState(false);
  const [invoiceSubmitting, setInvoiceSubmitting] = useState(false);
  const [invoiceIssueKey, setInvoiceIssueKey] = useState("");
  const [invoicePreview, setInvoicePreview] = useState<any>(null);
  const invoicePreviewRequestRef = useRef(0);
  const [invoiceForm, setInvoiceForm] = useState<EcpayInvoiceForm>({
    invoiceType: "personal" as "personal" | "company" | "donation",
    customerName: "", customerEmail: "", customerPhone: "", customerAddr: "",
    taxId: "", companyTitle: "",
    carrierType: "" as "" | "phone_barcode" | "citizen_certificate" | "ecpay_carrier",
    carrierNum: "", loveCode: "",
  });
  const [invoiceItems, setInvoiceItems] = useState<{ name: string; count: number; unitPrice: number; amount: number }[]>([]);
  const invoiceItemsTotal = invoiceItems.reduce((s, it) => s + (it.amount || 0), 0);
  const invoiceFormErrors = useMemo(() => getEcpayInvoiceFormErrors(invoiceForm), [invoiceForm]);
  const updateInvoiceItem = (idx: number, field: "name" | "count" | "unitPrice", value: any) => {
    setInvoiceItems(prev => {
      const next = [...prev];
      next[idx] = { ...next[idx], [field]: field === "name" ? value : Number(value) };
      if (field !== "name") next[idx].amount = (next[idx].count || 0) * (next[idx].unitPrice || 0);
      return next;
    });
  };

  const { from: defaultFrom, to: defaultTo } = useMemo(() => getMonthRange(), []);
  const [dateFrom, setDateFrom] = useState(defaultFrom);
  const [dateTo, setDateTo] = useState(defaultTo);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [sourceFilter, setSourceFilter] = useState("");
  const [templateFilter, setTemplateFilter] = useState("");

  const orderColumnDefs: ColumnDef[] = useMemo(() => [
    { key: "orderNumber", label: "訂單編號", alwaysVisible: true },
    { key: "template", label: "分類（模板）", defaultVisible: true },
    { key: "customerName", label: "客戶", defaultVisible: true },
    { key: "handlerId", label: "承辦人", defaultVisible: true },
    { key: "label", label: "標籤", defaultVisible: true },
    { key: "orderDate", label: "訂單日期", defaultVisible: true },
    { key: "deliveryDate", label: "交貨日期", defaultVisible: false },
    { key: "status", label: "狀態", defaultVisible: true },
    { key: "invoiceNumbers", label: "發票號碼", defaultVisible: true },
    { key: "totalAmount", label: "總額", defaultVisible: true },
    { key: "classWeeks", label: "堂數", defaultVisible: false },
    { key: "courseStartDate", label: "課程開始日", defaultVisible: false },
    { key: "courseEndDate", label: "課程結束日", defaultVisible: false },
    { key: "caseTime", label: "案場時間", defaultVisible: false },
    { key: "teacherCode", label: "老師代碼", defaultVisible: false },
    { key: "teacherFeePerSession", label: "老師鐘點費", defaultVisible: false },
    { key: "teacherMaterialFeeMethod", label: "教材費方式", defaultVisible: false },
    { key: "coursePeriod", label: "課程期別", defaultVisible: false },
    { key: "warehouseCode", label: "倉庫代碼", defaultVisible: false },
    { key: "transactionType", label: "交易類型", defaultVisible: false },
    { key: "dateDetails", label: "日期明細", defaultVisible: false },
    { key: "remarks", label: "備註", defaultVisible: false },
  ], []);

  const { visibleKeys, setVisibleKeys } = useColumnVisibility("sales-orders-columns-v2", orderColumnDefs);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    const [ordRes, empRes, tplRes] = await Promise.all([
      fetch(`/erp-api/sales-orders`),
      fetch(`/erp-api/employees`),
      fetch(`/erp-api/order-templates`),
    ]);
    setOrders(await ordRes.json());
    setEmployees(await empRes.json());
    setTemplates(await tplRes.json());
    setLoading(false);
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll, reloadKey]);

  // 從客戶頁按「開訂單」過來（網址帶 ?customerId=）：直接打開新增視窗並帶入客戶
  useEffect(() => {
    const customerId = new URLSearchParams(searchParams).get("customerId");
    if (!customerId) return;
    setEditing(null);
    setInitial({ values: { customerId, orderNumber: "" } });
    setOpen(true);
  }, [searchParams]);

  // 網址帶 ?edit=訂單編號：資料載入後直接打開那張單的編輯視窗
  const editFromUrlHandled = useRef(false);
  useEffect(() => {
    const id = Number(new URLSearchParams(searchParams).get("edit"));
    if (!id || editFromUrlHandled.current || orders.length === 0) return;
    const target = orders.find(o => o.id === id);
    if (target) { editFromUrlHandled.current = true; openEdit(target); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, orders]);
  const filtered = useMemo(() => {
    return (orders || []).filter((o: any) => {
      if (dateFrom && o.orderDate < dateFrom) return false;
      if (dateTo && o.orderDate > dateTo) return false;
      if (statusFilter && o.status !== statusFilter) return false;
      if (sourceFilter && (o.orderSource || "") !== sourceFilter) return false;
      if (templateFilter === "none" ? o.templateId : templateFilter && String(o.templateId || "") !== templateFilter) return false;
      if (search) {
        const q = search.toLowerCase();
        const match = (o.orderNumber || "").toLowerCase().includes(q)
          || (o.customerName || "").toLowerCase().includes(q)
          || (o.label || "").toLowerCase().includes(q)
          || String(o.totalAmount || "").includes(q);
        if (!match) return false;
      }
      return true;
    });
  }, [orders, dateFrom, dateTo, search, statusFilter, sourceFilter, templateFilter]);

  // 分類頁籤的筆數：套用日期、狀態、來源、搜尋，但不套分類本身
  const categoryCounts = useMemo(() => {
    const counts = new Map<string, number>();
    let all = 0;
    for (const o of orders || []) {
      if (dateFrom && o.orderDate < dateFrom) continue;
      if (dateTo && o.orderDate > dateTo) continue;
      if (statusFilter && o.status !== statusFilter) continue;
      if (sourceFilter && (o.orderSource || "") !== sourceFilter) continue;
      if (search) {
        const q = search.toLowerCase();
        if (!((o.orderNumber || "").toLowerCase().includes(q) || (o.customerName || "").toLowerCase().includes(q) || (o.label || "").toLowerCase().includes(q) || String(o.totalAmount || "").includes(q))) continue;
      }
      all++;
      const key = o.templateId ? String(o.templateId) : "none";
      counts.set(key, (counts.get(key) || 0) + 1);
    }
    return { all, counts };
  }, [orders, dateFrom, dateTo, search, statusFilter, sourceFilter]);
  const salesTemplates = useMemo(() => templates.filter(t => templateAppliesTo(t as any, "sales") && (t.isActive || categoryCounts.counts.get(String(t.id)))), [templates, categoryCounts]);

  const buildExport = (): ExportOptions => ({
    title: "銷貨單",
    subtitle: `期間：${dateFrom || "不限"} 至 ${dateTo || "不限"}`,
    fileName: `銷貨單_${dateFrom || "不限"}_${dateTo || "不限"}`,
    headers: ["訂單編號", "客戶", "標籤", "訂單日期", "狀態", "發票號碼", "總額"],
    columnKeys: ["orderNumber", "customerName", "label", "orderDate", "status", "invoiceNumbers", "totalAmount"],
    rows: filtered.map((o: any) => ({
      orderNumber: o.orderNumber || "-",
      customerName: o.customerName || "-",
      label: o.label || "-",
      orderDate: o.orderDate || "-",
      status: statusMap[o.status] || o.status || "-",
      invoiceNumbers: (o.invoiceNumbers || []).length > 0 ? o.invoiceNumbers.join(", ") : "-",
      totalAmount: `$${Number(o.totalAmount).toLocaleString()}`,
    })),
  });

  const batch = useBatchSelection(filtered);
  const selectedOrders = filtered.filter((order: any) => batch.selectedIds.has(order.id));
  const commonStatusActions = selectedOrders.length === 0
    ? []
    : (salesStatusActions[selectedOrders[0].status] || []).filter(status =>
        selectedOrders.every((order: any) => (salesStatusActions[order.status] || []).includes(status)),
      );
  const orderBatchFields: BatchField[] = [
    {
      key: "templateId",
      label: "分類（套用模板）",
      type: "select",
      clearable: true,
      options: templates.filter(t => t.isActive && t.projectId == null && templateAppliesTo(t as any, "sales")).map(t => ({ value: String(t.id), label: t.name })),
    },
    {
      key: "handlerId",
      label: "承辦人",
      type: "select",
      clearable: true,
      options: (employees || []).filter((e: any) => e.status === "Active").map((e: any) => ({ value: String(e.id), label: empName(e) })),
    },
    ...(commonStatusActions.length > 0 ? [{
      key: "status",
      label: "推進狀態",
      type: "select" as const,
      options: commonStatusActions.map(value => ({
        value,
        label: value === "Cancelled" ? "取消（須先取消出貨單與發票）" : statusMap[value],
      })),
    }] : []),
  ];

  // 新增、複製、編輯開的都是同一個表單（components/sales/sales-order-edit-dialog）
  const openCreate = () => { setEditing(null); setInitial(null); setOpen(true); };
  const openEdit = (o: any) => { setEditing(o); setInitial(null); setOpen(true); };
  const openCopy = (o: any) => { setEditing(null); setInitial({ values: salesOrderCopyValues(o), priceSource: "複製" }); setOpen(true); };

  const openInvoice = async (o: any) => {
    const requestId = ++invoicePreviewRequestRef.current;
    const storageKey = `ecpay-invoice-issue:${o.id}`;
    const savedIssueKey = localStorage.getItem(storageKey);
    const nextIssueKey = savedIssueKey || newInvoiceIssueKey();
    if (!savedIssueKey) localStorage.setItem(storageKey, nextIssueKey);
    setInvoiceIssueKey(nextIssueKey);
    setInvoiceForm({
      invoiceType: "personal",
      customerName: "", customerEmail: "", customerPhone: "", customerAddr: "",
      taxId: "", companyTitle: "", carrierType: "", carrierNum: "", loveCode: "",
    });
    setInvoiceItems([]);
    setInvoicePreview({ orderId: o.id, orderNumber: o.orderNumber });
    setInvoiceOpen(true);
    setInvoiceLoading(true);
    try {
      const res = await fetch(`/erp-api/sales-orders/${o.id}/ecpay-invoice-preview`);
      if (!res.ok) throw new Error((await res.json()).error || "讀取失敗");
      const data = await res.json();
      if (requestId !== invoicePreviewRequestRef.current) return;
      setInvoicePreview(data);
      const c = data.customer || {};
      setInvoiceForm({
        invoiceType: data.suggestedInvoiceType || "personal",
        customerName: c.contactPerson || c.name || "",
        customerEmail: c.email || "",
        customerPhone: c.phone || "",
        customerAddr: c.address || "",
        taxId: c.taxId || "",
        companyTitle: c.name || "",
        carrierType: "",
        carrierNum: "",
        loveCode: "",
      });
      setInvoiceItems((data.order?.items || []).map((it: any) => {
        const count = Number(it.quantity || 1);
        const unitPrice = Number(it.rate || it.unitPrice || 0);
        return { name: it.itemName || it.name || "商品", count, unitPrice, amount: Number(it.amount ?? count * unitPrice) };
      }));
    } catch (err: any) {
      if (requestId !== invoicePreviewRequestRef.current) return;
      toast({ title: "讀取失敗", description: err.message, variant: "destructive" });
      setInvoicePreview(null);
      setInvoiceForm({
        invoiceType: "personal",
        customerName: "", customerEmail: "", customerPhone: "", customerAddr: "",
        taxId: "", companyTitle: "", carrierType: "", carrierNum: "", loveCode: "",
      });
      setInvoiceItems([]);
      setInvoiceOpen(false);
    } finally {
      if (requestId === invoicePreviewRequestRef.current) setInvoiceLoading(false);
    }
  };

  const handleIssueInvoice = async () => {
    if (!invoicePreview?.order?.id) return;
    if (invoiceFormErrors.length > 0) {
      toast({ title: "買方資料不完整", description: invoiceFormErrors.join("、"), variant: "destructive" }); return;
    }
    const validItems = invoiceItems.filter(it => (it.amount || 0) > 0);
    if (validItems.length === 0) {
      toast({ title: "請至少保留一個金額大於 0 的品項", variant: "destructive" }); return;
    }
    const remaining = Number(invoicePreview?.remainingAmount ?? invoicePreview?.order?.totalAmount ?? 0);
    if (invoiceItemsTotal > remaining + 0.001) {
      toast({ title: "開立金額超過剩餘可開金額", description: `本次 $${invoiceItemsTotal.toLocaleString()}，剩餘可開 $${remaining.toLocaleString()}`, variant: "destructive" }); return;
    }
    setInvoiceSubmitting(true);
    try {
      const res = await fetch(`/erp-api/sales-orders/${invoicePreview.order.id}/issue-ecpay-invoice`, {
        method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": invoiceIssueKey },
        body: JSON.stringify({ ...invoiceForm, idempotencyKey: invoiceIssueKey, items: validItems }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (data.retryable) {
          const nextIssueKey = newInvoiceIssueKey();
          localStorage.setItem(`ecpay-invoice-issue:${invoicePreview.order.id}`, nextIssueKey);
          setInvoiceIssueKey(nextIssueKey);
        }
        throw new Error(data.error || "開立失敗");
      }
      toast({
        title: data.isTest ? "[測試環境] 發票開立成功" : "發票開立成功",
        description: `發票號碼：${data.invoice.ecpayInvoiceNumber}`,
      });
      setInvoiceOpen(false);
      localStorage.removeItem(`ecpay-invoice-issue:${invoicePreview.order.id}`);
      setInvoiceIssueKey("");
      fetchAll();
    } catch (err: any) {
      toast({ title: "開立失敗", description: err.message, variant: "destructive" });
    } finally {
      setInvoiceSubmitting(false);
    }
  };

  const handleVoidInvoice = async (invId: number, invNumber: string) => {
    if (!confirm(`確定作廢發票「${invNumber}」？`)) return;
    try {
      const res = await fetch(`/erp-api/invoices/${invId}/void-ecpay`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: "訂單取消" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "作廢失敗");
      toast({ title: "發票已作廢" });
      // 重新讀取預覽
      if (invoicePreview?.order?.id) {
        const r = await fetch(`/erp-api/sales-orders/${invoicePreview.order.id}/ecpay-invoice-preview`);
        if (r.ok) setInvoicePreview(await r.json());
      }
      fetchAll();
    } catch (err: any) {
      toast({ title: "作廢失敗", description: err.message, variant: "destructive" });
    }
  };

  const handleDelete = async (o: any) => {
    if (!confirm(`確定刪除訂單「${o.orderNumber}」？`)) return;
    try {
      const res = await fetch(`/erp-api/sales-orders/${o.id}`, { method: "DELETE" });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error || "刪除失敗");
      }
      toast({ title: "訂單已刪除" });
      fetchAll();
    } catch (err: any) {
      toast({ title: "刪除失敗", description: err.message, variant: "destructive" });
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader title="銷貨單" description="校園專案銷貨管理" hint={<PageHint hintKey="sales-orders">這裡管理所有銷售訂單。一般流程：建立訂單 → 確認 → 轉出貨單 → 開發票。小提醒：請先確認客戶、品項與數量，訂單確認後才能進入後續出貨流程。</PageHint>}>
        <ExportMenu getExportOptions={buildExport} />
        <Button onClick={openCreate}><Plus size={16} className="mr-1" />新增銷貨單</Button>
      </PageHeader>

      {batch.count > 0 && (
        <BatchActionBar
          count={batch.count}
          entityName="銷貨單"
          entityEndpoint="sales-orders"
          ids={batch.ids}
          batchFields={orderBatchFields}
          allowDelete={false}
          onClear={batch.clearSelection}
          onComplete={() => fetchAll()}
        />
      )}

      <div className="flex flex-wrap gap-2" role="tablist" aria-label="銷貨單分類">
        {([["", "全部", categoryCounts.all], ...salesTemplates.map(t => [String(t.id), t.name, categoryCounts.counts.get(String(t.id)) || 0]), ["none", "未分類", categoryCounts.counts.get("none") || 0]] as [string, string, number][]).map(([key, label, n]) => (
          <button key={key || "all"} type="button" role="tab" aria-selected={templateFilter === key} data-testid={`order-category-${key || "all"}`}
            onClick={() => { setTemplateFilter(key); batch.clearSelection(); }}
            className={`rounded-full border px-3.5 py-1.5 text-sm transition-colors ${templateFilter === key ? "border-primary bg-primary text-primary-foreground" : "bg-background hover:bg-muted"}`}>
            {label}<span className={`ml-1.5 tabular-nums ${templateFilter === key ? "opacity-90" : "text-muted-foreground"}`}>{n.toLocaleString()}</span>
          </button>
        ))}
      </div>
      {templateFilter === "none" && categoryCounts.counts.get("none") ? <p className="-mt-3 text-sm text-muted-foreground">這些單還沒有分類。勾選後按「批次編輯 → 分類（套用模板）」就能一次歸類，歸類後打開單據就會照那個模板顯示欄位。</p> : null}

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
            <div>
              <Label className="text-xs text-muted-foreground">狀態</Label>
              <select className="flex h-10 w-32 rounded-md border border-input bg-background px-3 py-2 text-sm" value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
                <option value="">全部</option>
                {statusOptions.map(s => <option key={s} value={s}>{statusMap[s]}</option>)}
              </select>
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">來源</Label>
              <select className="flex h-10 w-32 rounded-md border border-input bg-background px-3 py-2 text-sm" value={sourceFilter} onChange={e => setSourceFilter(e.target.value)}>
                <option value="">全部</option>
                {Object.entries(SOURCE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </div>
            <div className="flex-1 min-w-[200px]">
              <Label className="text-xs text-muted-foreground">搜尋</Label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input className="pl-9" placeholder="訂單編號、客戶、標籤..." value={search} onChange={e => setSearch(e.target.value)} />
              </div>
            </div>
            <div className="text-sm text-muted-foreground pb-2">共 {filtered.length} 筆</div>
            <ColumnSelector storageKey="sales-orders-columns-v2" columns={orderColumnDefs} visibleKeys={visibleKeys} onChange={setVisibleKeys} />
          </div>
        </CardContent>
      </Card>

      <div className="md:hidden space-y-3">
        {loading && <Card><CardContent className="p-6 text-center text-muted-foreground">載入中...</CardContent></Card>}
        {!loading && filtered.length === 0 && <Card><CardContent className="p-6 text-center text-muted-foreground">尚無資料</CardContent></Card>}
        {!loading && filtered.map((r: any) => (
          <Card key={r.id} className="cursor-pointer active:bg-muted/50" onClick={() => navigate(`/sales/orders/${r.id}`)}>
            <CardContent className="p-4 space-y-2">
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  {(
                    <input
                      type="checkbox"
                      className="h-4 w-4 shrink-0 accent-primary"
                      checked={batch.selectedIds.has(r.id)}
                      onChange={() => batch.toggle(r.id)}
                      onClick={e => e.stopPropagation()}
                      aria-label={`選取 ${r.orderNumber} 以推進狀態`}
                    />
                  )}
                  <div className="min-w-0">
                    <div className="font-medium truncate">{r.orderNumber}{r.orderSource === "ecount" && <span className="ml-1.5 text-[10px] font-normal text-muted-foreground">歷史</span>}</div>
                    <div className="text-xs text-muted-foreground truncate">{r.customerName || "-"}</div>
                  </div>
                </div>
                <Badge variant={r.status === "Completed" ? "default" : r.status === "Cancelled" ? "destructive" : "secondary"} className="shrink-0">
                  {statusMap[r.status] || r.status}
                </Badge>
              </div>
              {r.label && <div className="text-xs text-blue-600 truncate">{r.label}</div>}
              <div className="flex flex-wrap gap-1.5 text-xs">
                <Badge variant="secondary" className="font-normal">{r.templateName || "未分類"}</Badge>
                {(empName(employees.find((e: any) => e.id === r.handlerId)) || r.extraFields?.legacyStaff) && <Badge variant="outline" className="font-normal">承辦 {empName(employees.find((e: any) => e.id === r.handlerId)) || r.extraFields?.legacyStaff}</Badge>}
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-x-4 gap-y-1 text-sm">
                <div className="text-muted-foreground">訂單日期</div><div className="text-right">{r.orderDate}</div>
                <div className="text-muted-foreground">總額</div><div className="text-right font-medium">${Number(r.totalAmount).toLocaleString()}</div>
                {(r.invoiceNumbers || []).length > 0 && <><div className="text-muted-foreground">發票號碼</div><div className="text-right text-xs text-blue-600 truncate">{r.invoiceNumbers.join(", ")}</div></>}
              </div>
              <div className="flex gap-1 pt-1 border-t" onClick={e => e.stopPropagation()}>
                <Button variant="ghost" size="sm" onClick={() => openEdit(r)}><Pencil size={14} className="mr-1" />編輯</Button>
                <Button variant="ghost" size="sm" onClick={() => openCopy(r)}><Copy size={14} className="mr-1" />複製</Button>
                {r.orderSource !== "ecount" && <Button variant="ghost" size="sm" onClick={() => openInvoice(r)}><FileText size={14} className="mr-1 text-blue-600" />發票</Button>}
                {r.orderSource !== "ecount" && <Button variant="ghost" size="sm" onClick={() => handleDelete(r)}><Trash2 size={14} className="text-destructive" /></Button>}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
      <Card className="hidden md:block">
        <CardContent className="p-0 overflow-x-auto">
          <DataTable
            isLoading={loading}
            data={filtered}
            onRowClick={(r: any) => navigate(`/sales/orders/${r.id}`)}
            columns={[
              {
                header: () => <CheckboxHeader checked={batch.allSelected} indeterminate={batch.someSelected} onChange={batch.toggleAll} />,
                accessor: (r: any) => <CheckboxCell checked={batch.selectedIds.has(r.id)} onChange={() => batch.toggle(r.id)} />,
                className: "w-10",
              },
              ...(visibleKeys.has("orderNumber") ? [{ header: "訂單編號", accessor: (r: any) => (
                <span className="inline-flex items-center gap-1.5 whitespace-nowrap">{r.orderNumber}{r.orderSource === "ecount" && <Badge variant="outline" className="text-[10px] font-normal text-muted-foreground" title="從舊系統 Ecount 搬過來的歷史單：可以補標題、專案、備註，金額與品項不能改">歷史</Badge>}</span>
              ), className: "whitespace-nowrap" }] : []),
              ...(visibleKeys.has("template") ? [{ header: "分類", accessor: (r: any) => r.templateName ? <Badge variant="secondary" className="whitespace-nowrap text-xs">{r.templateName}</Badge> : <span className="whitespace-nowrap text-xs text-muted-foreground">未分類</span>, className: "whitespace-nowrap" }] : []),
              ...(visibleKeys.has("customerName") ? [{ header: "客戶", accessor: (r: any) => <span className="block min-w-[8rem] max-w-[14rem] truncate" title={r.customerName}>{r.customerName}</span> }] : []),
              ...(visibleKeys.has("handlerId") ? [{ header: "承辦人", accessor: (r: any) => { const n = empName(employees.find((e: any) => e.id === r.handlerId)) || r.extraFields?.legacyStaff; return n ? <span className="whitespace-nowrap">{n}</span> : <span className="text-muted-foreground">-</span>; }, className: "whitespace-nowrap" }] : []),
              ...(visibleKeys.has("label") ? [{ header: "標籤", accessor: (r: any) => r.label ? <span className="text-xs text-blue-600 truncate max-w-[220px] block" title={r.label}>{r.label}</span> : "-" }] : []),
              ...(visibleKeys.has("orderSource") ? [{ header: "來源", accessor: (r: any) => <Badge variant="outline" className="text-xs">{SOURCE_LABELS[r.orderSource] || r.orderSource || "-"}</Badge> }] : []),
              ...(visibleKeys.has("orderDate") ? [{ header: "訂單日期", accessor: "orderDate" as const, className: "whitespace-nowrap" }] : []),
              ...(visibleKeys.has("deliveryDate") ? [{ header: "交貨日期", accessor: (r: any) => r.deliveryDate || "-" }] : []),
              ...(visibleKeys.has("status") ? [{
                header: "狀態",
                accessor: (r: any) => (
                  <Badge variant={r.status === "Completed" ? "default" : r.status === "Cancelled" ? "destructive" : "secondary"}>
                    {statusMap[r.status] || r.status}
                  </Badge>
                ),
                className: "whitespace-nowrap",
              }] : []),
              ...(visibleKeys.has("invoiceNumbers") ? [{ header: "發票號碼", accessor: (r: any) => {
                const nums = r.invoiceNumbers || [];
                if (nums.length === 0) return <span className="text-muted-foreground">-</span>;
                return <span className="text-xs text-blue-600 whitespace-nowrap">{nums.join(", ")}</span>;
              }, className: "whitespace-nowrap" }] : []),
              ...(visibleKeys.has("totalAmount") ? [{
                header: "總額",
                accessor: (r: any) => (
                  <div className="whitespace-nowrap tabular-nums">
                    <div>${Number(r.totalAmount).toLocaleString()}</div>
                    {r.status !== "Draft" && r.status !== "Cancelled" && (
                      <div className={`text-xs ${Number(r.outstandingAmount) > 0 ? "text-amber-600" : "text-emerald-600"}`}>
                        {Number(r.outstandingAmount) > 0 ? `未收 $${Number(r.outstandingAmount).toLocaleString()}` : "已收清"}
                      </div>
                    )}
                  </div>
                ),
                className: "text-right",
              }] : []),
              ...(visibleKeys.has("classWeeks") ? [{ header: "堂數", accessor: (r: any) => r.classWeeks ?? "-" }] : []),
              ...(visibleKeys.has("courseStartDate") ? [{ header: "課程開始日", accessor: (r: any) => r.courseStartDate || "-" }] : []),
              ...(visibleKeys.has("courseEndDate") ? [{ header: "課程結束日", accessor: (r: any) => r.courseEndDate || "-" }] : []),
              ...(visibleKeys.has("caseTime") ? [{ header: "案場時間", accessor: (r: any) => r.caseTime || "-" }] : []),
              ...(visibleKeys.has("teacherCode") ? [{ header: "老師代碼", accessor: (r: any) => r.teacherCode || "-" }] : []),
              ...(visibleKeys.has("teacherFeePerSession") ? [{ header: "老師鐘點費", accessor: (r: any) => r.teacherFeePerSession ? `$${Number(r.teacherFeePerSession).toLocaleString()}` : "-" }] : []),
              ...(visibleKeys.has("teacherMaterialFeeMethod") ? [{ header: "教材費方式", accessor: (r: any) => r.teacherMaterialFeeMethod || "-" }] : []),
              ...(visibleKeys.has("coursePeriod") ? [{ header: "課程期別", accessor: (r: any) => r.coursePeriod || "-" }] : []),
              ...(visibleKeys.has("warehouseCode") ? [{ header: "倉庫代碼", accessor: (r: any) => r.warehouseCode || "-" }] : []),
              ...(visibleKeys.has("transactionType") ? [{ header: "交易類型", accessor: (r: any) => r.transactionType || "-" }] : []),
              ...(visibleKeys.has("dateDetails") ? [{ header: "日期明細", accessor: (r: any) => r.dateDetails ? <span className="text-xs max-w-[200px] truncate block">{r.dateDetails}</span> : "-" }] : []),
              ...(visibleKeys.has("remarks") ? [{ header: "備註", accessor: (r: any) => r.remarks ? <span className="text-xs max-w-[200px] truncate block">{r.remarks}</span> : "-" }] : []),
              {
                header: "操作",
                accessor: (r: any) => (
                  <div className="flex gap-1" onClick={e => e.stopPropagation()}>
                    <Button variant="ghost" size="icon" onClick={() => openEdit(r)} title="編輯"><Pencil size={14} /></Button>
                    <Button variant="ghost" size="icon" onClick={() => openCopy(r)} title="複製"><Copy size={14} /></Button>
                    {r.orderSource !== "ecount" && <Button variant="ghost" size="icon" onClick={() => openInvoice(r)} title="開立發票"><FileText size={14} className="text-blue-600" /></Button>}
                    {r.orderSource !== "ecount" && <Button variant="ghost" size="icon" onClick={() => handleDelete(r)} title="刪除"><Trash2 size={14} className="text-destructive" /></Button>}
                  </div>
                ),
                className: "w-36",
              },
            ]}
          />
        </CardContent>
      </Card>

      {/* 新增、複製、編輯都是同一個視窗（跟銷貨單明細頁的「編輯」是同一個元件） */}
      <SalesOrderFormDialog
        open={open}
        onOpenChange={setOpen}
        order={editing}
        initial={initial}
        onSaved={() => fetchAll()}
      />

      {/* ===== 開立綠界電子發票對話框 ===== */}
      <Dialog open={invoiceOpen} onOpenChange={setInvoiceOpen}>
        <DialogContent className="md:max-w-3xl max-h-[90dvh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>開立電子發票 - {invoicePreview?.orderNumber || invoicePreview?.order?.orderNumber}</DialogTitle>
          </DialogHeader>

          {invoiceLoading ? (
            <div className="py-12 text-center text-muted-foreground">讀取訂單資料中...</div>
          ) : (
            <div className="space-y-4 py-2">
              {/* 已開立發票 */}
              {invoicePreview?.existingInvoices?.length > 0 && (
                <div className="border rounded-lg p-3 bg-blue-50">
                  <div className="text-sm font-semibold mb-2 text-blue-900">此訂單已開立發票</div>
                  <div className="space-y-1.5">
                    {invoicePreview.existingInvoices.map((e: any) => (
                      <div key={e.id} className="flex items-center gap-2 text-sm">
                        <Badge variant={e.ecpayVoidedAt ? "destructive" : "default"}>
                          {e.ecpayVoidedAt ? "已作廢" : "有效"}
                        </Badge>
                        <span className="font-mono">{e.ecpayInvoiceNumber || e.invoiceNumber}</span>
                        {e.ecpayInvoiceDate && <span className="text-muted-foreground">{String(e.ecpayInvoiceDate).slice(0, 10)}</span>}
                        <span className="text-muted-foreground">${Number(e.totalAmount).toLocaleString()}</span>
                        {!e.ecpayVoidedAt && e.ecpayInvoiceNumber && (
                          <Button variant="ghost" size="sm" className="ml-auto text-destructive" onClick={() => handleVoidInvoice(e.id, e.ecpayInvoiceNumber)}>
                            作廢
                          </Button>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* 訂單資訊 */}
              <div className="border rounded-lg p-3 bg-muted/30">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-sm">
                  <div><span className="text-muted-foreground">訂單編號：</span><span className="font-medium">{invoicePreview?.order?.orderNumber}</span></div>
                  <div><span className="text-muted-foreground">訂單日期：</span><span>{invoicePreview?.order?.orderDate}</span></div>
                  <div><span className="text-muted-foreground">總金額：</span><span className="font-bold text-blue-600">${Number(invoicePreview?.order?.totalAmount || 0).toLocaleString()}</span></div>
                </div>
                {Number(invoicePreview?.alreadyInvoiced || 0) > 0 && (
                  <div className="mt-2 pt-2 border-t text-sm flex flex-wrap gap-x-4 gap-y-1">
                    <span><span className="text-muted-foreground">已開金額：</span><span className="font-medium">${Number(invoicePreview.alreadyInvoiced).toLocaleString()}</span></span>
                    <span><span className="text-muted-foreground">剩餘可開：</span><span className="font-bold text-emerald-600">${Number(invoicePreview.remainingAmount || 0).toLocaleString()}</span></span>
                  </div>
                )}
              </div>

              {/* 發票類型 */}
              <div>
                <Label className="text-base font-semibold">發票類型</Label>
                <div className="flex gap-2 mt-2">
                  {([
                    { v: "personal", l: "個人發票" },
                    { v: "company", l: "公司發票（統編）" },
                    { v: "donation", l: "捐贈發票" },
                  ] as const).map(t => (
                    <button
                      key={t.v}
                      type="button"
                      className={`px-4 py-2 rounded-md text-sm font-medium border transition-colors ${invoiceForm.invoiceType === t.v ? "bg-blue-600 text-white border-blue-600" : "bg-background border-input hover:bg-muted"}`}
                      onClick={() => setInvoiceForm(p => ({ ...p, invoiceType: t.v }))}
                    >
                      {t.l}
                    </button>
                  ))}
                </div>
              </div>

              {/* 公司發票欄位 */}
              {invoiceForm.invoiceType === "company" && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 border-l-4 border-blue-500 pl-3 py-2">
                  <div>
                    <Label>統一編號 *</Label>
                    <Input maxLength={8} value={invoiceForm.taxId} onChange={e => setInvoiceForm(p => ({ ...p, taxId: e.target.value.replace(/\D/g, "").slice(0, 8) }))} placeholder="8 碼數字" />
                  </div>
                  <div>
                    <Label>公司抬頭 *</Label>
                    <Input value={invoiceForm.companyTitle} onChange={e => setInvoiceForm(p => ({ ...p, companyTitle: e.target.value }))} />
                  </div>
                </div>
              )}

              {/* 捐贈發票欄位 */}
              {invoiceForm.invoiceType === "donation" && (
                <div className="border-l-4 border-pink-500 pl-3 py-2">
                  <Label>愛心碼 *</Label>
                  <Input value={invoiceForm.loveCode} onChange={e => setInvoiceForm(p => ({ ...p, loveCode: e.target.value }))} placeholder="3-7 碼數字" />
                </div>
              )}

              {/* 個人發票載具 */}
              {invoiceForm.invoiceType === "personal" && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 border-l-4 border-green-500 pl-3 py-2">
                  <div>
                    <Label>載具類型</Label>
                    <select className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" value={invoiceForm.carrierType} onChange={e => setInvoiceForm(p => ({ ...p, carrierType: e.target.value as any }))}>
                      <option value="">紙本發票</option>
                      <option value="phone_barcode">手機條碼載具</option>
                      <option value="citizen_certificate">自然人憑證</option>
                      <option value="ecpay_carrier">綠界會員載具</option>
                    </select>
                  </div>
                  {(invoiceForm.carrierType === "phone_barcode" || invoiceForm.carrierType === "citizen_certificate") && (
                    <div>
                      <Label>載具號碼</Label>
                      <Input value={invoiceForm.carrierNum} onChange={e => setInvoiceForm(p => ({ ...p, carrierNum: e.target.value }))} placeholder={invoiceForm.carrierType === "phone_barcode" ? "/ABC+123" : "16 碼大寫英數"} />
                    </div>
                  )}
                </div>
              )}

              {/* 買方資訊 */}
              <div className="border-t pt-3">
                <div className="text-sm font-semibold mb-2">買方資訊（已自動帶入客戶資料）</div>
                <p className="text-xs text-muted-foreground mb-3">
                  以下資料由訂單客戶自動帶入；您可只為本張發票補充或修正，變更不會更新客戶主檔。
                </p>
                {invoiceFormErrors.length > 0 && (
                  <Alert variant="destructive" className="mb-3">
                    <AlertTitle>買方資料尚未完整，暫時無法開立</AlertTitle>
                    <AlertDescription>
                      <ul className="list-disc pl-5 mt-1">
                        {invoiceFormErrors.map(error => <li key={error}>{error}</li>)}
                      </ul>
                    </AlertDescription>
                  </Alert>
                )}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div>
                    <Label>買方姓名 {invoiceForm.invoiceType !== "company" && "*"}</Label>
                    <Input value={invoiceForm.customerName} onChange={e => setInvoiceForm(p => ({ ...p, customerName: e.target.value }))} placeholder="請輸入買方姓名" />
                  </div>
                  <div>
                    <Label>Email *</Label>
                    <Input type="email" value={invoiceForm.customerEmail} onChange={e => setInvoiceForm(p => ({ ...p, customerEmail: e.target.value }))} placeholder="例如 buyer@example.com" />
                  </div>
                  <div>
                    <Label>聯絡電話／手機 *</Label>
                    <Input value={invoiceForm.customerPhone} onChange={e => setInvoiceForm(p => ({ ...p, customerPhone: e.target.value }))} placeholder="例如 02-1234-5678 或 0912345678" />
                  </div>
                  <div>
                    <Label>買方地址 *</Label>
                    <Input value={invoiceForm.customerAddr} onChange={e => setInvoiceForm(p => ({ ...p, customerAddr: e.target.value }))} placeholder="請輸入完整地址" />
                  </div>
                </div>
              </div>

              {/* 發票品項（可調整金額，分次開票） */}
              <div className="border-t pt-3">
                <div className="flex items-center justify-between mb-2">
                  <div className="text-sm font-semibold">發票品項（可修改數量與單價，分次開立）</div>
                  <Button type="button" variant="outline" size="sm" className="h-7" onClick={() => setInvoiceItems(prev => [...prev, { name: "", count: 1, unitPrice: 0, amount: 0 }])}>
                    <Plus size={13} className="mr-1" />加一項
                  </Button>
                </div>
                <div className="space-y-2">
                  {invoiceItems.map((it, i) => (
                    <div key={i} className="grid grid-cols-2 md:grid-cols-12 gap-2 items-center rounded-md border p-2 md:border-0 md:p-0">
                      <Input className="col-span-2 md:col-span-5 h-9" placeholder="品項名稱" value={it.name} onChange={e => updateInvoiceItem(i, "name", e.target.value)} />
                      <div className="col-span-1 md:col-span-2"><Input className="h-9" type="number" min={1} placeholder="數量" value={it.count} onChange={e => updateInvoiceItem(i, "count", e.target.value)} /></div>
                      <div className="col-span-1 md:col-span-2"><Input className="h-9" type="number" min={0} placeholder="單價" value={it.unitPrice} onChange={e => updateInvoiceItem(i, "unitPrice", e.target.value)} /></div>
                      <div className="col-span-1 md:col-span-2 text-right text-sm font-medium">${(it.amount || 0).toLocaleString()}</div>
                      <div className="col-span-1 md:col-span-1 text-right">
                        {invoiceItems.length > 1 && (
                          <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-red-500" onClick={() => setInvoiceItems(prev => prev.filter((_, x) => x !== i))}>
                            <Trash2 size={14} />
                          </Button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
                <div className={`text-right mt-2 text-sm font-bold ${invoiceItemsTotal > Number(invoicePreview?.remainingAmount ?? invoicePreview?.order?.totalAmount ?? 0) + 0.001 ? "text-red-600" : ""}`}>
                  本次開立金額：${invoiceItemsTotal.toLocaleString()}
                  {invoiceItemsTotal > Number(invoicePreview?.remainingAmount ?? invoicePreview?.order?.totalAmount ?? 0) + 0.001 && "（超過剩餘可開金額）"}
                </div>
              </div>

              <div className="text-xs text-muted-foreground">
                綠界憑證未設定時系統會停止開票並明確提示；只有管理員明確設定測試環境時才會送到綠界測試站。
              </div>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setInvoiceOpen(false)}>取消</Button>
            <Button onClick={handleIssueInvoice} disabled={invoiceLoading || invoiceSubmitting || !invoicePreview?.order?.id || invoiceFormErrors.length > 0}>
              {invoiceSubmitting ? "開立中..." : "開立發票"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
