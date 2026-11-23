import { useState, useMemo, useEffect } from "react";
import { selectableDepartments, selectableProjects, departmentLabel, projectPickerLabel } from "@/lib/select-options";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useListDepartments, useListProjects } from "@workspace/erp-api-client-react";
import { PageHeader } from "@/components/shared/page-header";
import { PageHint } from "@/components/page-hint";
import { Card, CardContent } from "@/components/ui/card";
import { DocWindow } from "@/components/shared/doc-window";
import { RelatedDocs, useOpenFromUrl } from "@/components/shared/related-docs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Plus, Trash2, FileText, ArrowRight, X, Printer, Search, Copy, Mail } from "lucide-react";
import { SendEmailDialog } from "@/components/email/send-email-dialog";
import { PendingEmails } from "@/components/shared/pending-emails";
import { PrintButton } from "@/components/shared/print-button";
import { useBatchSelection } from "@/hooks/use-batch-selection";
import { BatchActionBar, type BatchField } from "@/components/shared/batch-action-bar";
import { CheckboxCell, CheckboxHeader } from "@/components/shared/checkbox-column";
import { ColumnSelector, useColumnVisibility, type ColumnDef } from "@/components/shared/column-selector";
import { SearchableSelect } from "@/components/shared/searchable-select";
import { QuotationPrintDialog, defaultBrand } from "@/components/sales/quotation-print-dialog";
import { missingTemplateFields, templateDefaults, extraFieldRows, withoutLegacyFields, templateAppliesTo, suggestTemplateForGroups } from "@/lib/template-fields";
import { useSearch } from "wouter";

import { LookupSelect } from "@/components/shared/lookup-select";
import { CustomerRemarkHint } from "@/components/shared/customer-remark-hint";
import { appendToDocumentRemarks } from "@/lib/customer-remarks";
import { DateRangePresets } from "@/components/shared/date-range-presets";
const BASE = import.meta.env.BASE_URL.endsWith("/") ? import.meta.env.BASE_URL : import.meta.env.BASE_URL + "/";
const apiFetch = (path: string, opts?: RequestInit) =>
  fetch(`/erp-api${path}`, { headers: { "Content-Type": "application/json" }, ...opts }).then(async (r) => {
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || "請求失敗");
    if (r.status === 204) return null;
    return r.json();
  });

interface QuotItem { code?: string; name: string; qty: number; unit: string; unitPrice: number; amount: number; summary?: string; }
interface FieldDef {
  name: string; label: string; type: "text" | "number" | "date" | "select" | "textarea";
  required: boolean; options?: string[];
}
interface OrderTemplate {
  id: number; name: string; projectId: number | null; fieldSchema: FieldDef[]; isActive: boolean;
}

const statusLabels: Record<string, string> = {
  Draft: "草稿", Sent: "已送出", Accepted: "已接受", Rejected: "已拒絕", Converted: "已轉單", Expired: "已過期",
};
const statusColors: Record<string, string> = {
  Draft: "bg-gray-100 text-gray-700", Sent: "bg-blue-100 text-blue-700", Accepted: "bg-green-100 text-green-700",
  Rejected: "bg-red-100 text-red-700", Converted: "bg-purple-100 text-purple-700", Expired: "bg-amber-100 text-amber-700",
};

function getMonthRange() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  return { from: `${y}-${m}-01`, to: `${y}-${m}-${new Date(y, now.getMonth() + 1, 0).getDate()}` };
}

export default function QuotationsPage() {
  const searchParams = useSearch();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [printQuot, setPrintQuot] = useState<any | null>(null);
  const [emailQuotId, setEmailQuotId] = useState<number | null>(null);

  const [form, setForm] = useState({
    customerId: "", customerName: "", quotationDate: new Date().toISOString().split("T")[0],
    validUntil: "", template: "", notes: "", terms: "報價有效期限：30天\n付款方式：月結30天\n交貨期限：下單後7個工作天",
    departmentId: "", projectId: "", brandId: "", title: "", quoterName: "", quoterPhone: "", taxIncluded: false,
    currency: "TWD", exchangeRate: "1", templateId: "", extraFields: {} as Record<string, any>,
  });
  const [items, setItems] = useState<QuotItem[]>([{ code: "", name: "", qty: 1, unit: "個", unitPrice: 0, amount: 0, summary: "" }]);

  useEffect(() => {
    const customerId = new URLSearchParams(searchParams).get("customerId");
    if (!customerId) return;
    setEditId(null);
    setForm(f => ({ ...f, customerId, quotationDate: new Date().toISOString().split("T")[0] }));
    setShowForm(true);
  }, [searchParams]);

  const { data: quotations = [], isLoading } = useQuery({
    queryKey: ["/erp-api/quotations"],
    queryFn: () => apiFetch("/quotations"),
  });

  const { data: customers = [] } = useQuery({
    queryKey: ["/erp-api/customers-list"],
    queryFn: () => apiFetch("/customers"),
  });

  const { data: departments = [] } = useListDepartments();
  const { data: projects = [] } = useListProjects();

  const { data: brands = [] } = useQuery({
    queryKey: ["/erp-api/brands"],
    queryFn: () => apiFetch("/brands"),
  });

  const { data: catalogItems = [] } = useQuery({
    queryKey: ["/erp-api/items-list"],
    queryFn: () => apiFetch("/items"),
  });

  const { data: quotTemplates = [] } = useQuery({
    queryKey: ["/erp-api/quotation-templates"],
    queryFn: () => apiFetch("/quotation-templates"),
  });
  const { data: orderTemplates = [] } = useQuery<OrderTemplate[]>({
    queryKey: ["/erp-api/order-templates"],
    queryFn: () => apiFetch("/order-templates"),
  });
  const availableOrderTemplates = useMemo(() => orderTemplates.filter(t =>
    t.isActive && templateAppliesTo(t as any, "sales") && (t.projectId == null || (form.projectId && String(t.projectId) === form.projectId))
  ), [orderTemplates, form.projectId]);

  // 新增報價單時，品項的分類對得上某個模板就自動帶出（編輯舊單不動）
  const lineGroupKey = useMemo(() => [...new Set(items.map(i => (catalogItems as any[]).find((c: any) => c.itemCode === i.code)?.itemGroup).filter(Boolean))].sort().join("|"), [items, catalogItems]);
  useEffect(() => {
    if (editId || form.templateId || !lineGroupKey) return;
    const tpl = suggestTemplateForGroups(availableOrderTemplates as any[], lineGroupKey.split("|"));
    if (!tpl) return;
    setForm(f => ({ ...f, templateId: String(tpl.id), extraFields: templateDefaults(tpl.fieldSchema as any) }));
    toast({ title: `已依品項帶入模板「${tpl.name}」` });
  }, [lineGroupKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const selectedOrderTemplate = useMemo(() =>
    orderTemplates.find(t => t.id === Number(form.templateId)) || null
  , [orderTemplates, form.templateId]);

  // 類別只列「報價模板」裡建好的；沒建就不出現
  const TEMPLATES = useMemo(() => [...new Set((quotTemplates as any[]).map((x: any) => x.category).filter(Boolean) as string[])], [quotTemplates]);

  const applyTemplate = (t: string) => {
    const tpl = (quotTemplates as any[]).find((x: any) => x.category === t);
    if (!tpl || editId) {
      setForm((f) => ({ ...f, template: t }));
      return;
    }
    setForm((f) => ({
      ...f,
      template: t,
      terms: tpl.terms ?? "",
      notes: tpl.notes ?? "",
    }));
    const tplItems = Array.isArray(tpl.items) ? tpl.items : [];
    setItems(tplItems.length > 0
      ? tplItems.map((i: any) => ({
          code: i.code || "",
          name: i.name || "",
          qty: Number(i.qty) || 1,
          unit: i.unit || "個",
          unitPrice: Number(i.unitPrice) || 0,
          amount: (Number(i.qty) || 1) * (Number(i.unitPrice) || 0),
          summary: i.summary || "",
        }))
      : [{ code: "", name: "", qty: 1, unit: "個", unitPrice: 0, amount: 0, summary: "" }]);
    toast({ title: `已套用「${t}」模板` });
  };

  const defaultRange = useMemo(() => getMonthRange(), []);
  const [dateFrom, setDateFrom] = useState(defaultRange.from);
  const [dateTo, setDateTo] = useState(defaultRange.to);
  const [searchQ, setSearchQ] = useState("");
  const [templateFilter, setTemplateFilter] = useState("");

  const quotColumnDefs: ColumnDef[] = useMemo(() => [
    { key: "quotationNumber", label: "報價單號", alwaysVisible: true },
    { key: "template", label: "模板", defaultVisible: false },
    { key: "customerName", label: "客戶", defaultVisible: true },
    { key: "quotationDate", label: "報價日期", defaultVisible: true },
    { key: "validUntil", label: "有效期限", defaultVisible: true },
    { key: "currency", label: "幣別", defaultVisible: true },
    { key: "totalAmount", label: "小計", defaultVisible: false },
    { key: "taxAmount", label: "稅額", defaultVisible: false },
    { key: "grandTotal", label: "合計金額", defaultVisible: true },
    { key: "status", label: "狀態", defaultVisible: true },
    { key: "notes", label: "備註", defaultVisible: false },
    { key: "terms", label: "報價條款", defaultVisible: false },
    { key: "departmentId", label: "部門", defaultVisible: false },
    { key: "projectId", label: "專案", defaultVisible: false },
    { key: "createdAt", label: "建立時間", defaultVisible: false },
  ], []);

  const { visibleKeys, setVisibleKeys } = useColumnVisibility("quotations-columns", quotColumnDefs);

  const filteredQuotations = useMemo(() => {
    return (quotations || []).filter((q: any) => {
      if (dateFrom && q.quotationDate < dateFrom) return false;
      if (dateTo && q.quotationDate > dateTo) return false;
      if (templateFilter && (q.template || "") !== templateFilter) return false;
      if (searchQ) {
        const s = searchQ.toLowerCase();
        if (!((q.quotationNumber || "").toLowerCase().includes(s) || (q.customerName || "").toLowerCase().includes(s))) return false;
      }
      return true;
    });
  }, [quotations, dateFrom, dateTo, searchQ, templateFilter]);

  const batch = useBatchSelection(filteredQuotations);
  const quotationBatchFields: BatchField[] = [
    {key:"status",label:"狀態",type:"select",options:[{value:"Draft",label:"草稿"},{value:"Submitted",label:"已提交"},{value:"Accepted",label:"已接受"},{value:"Rejected",label:"已拒絕"}]},
  ];

  const createMut = useMutation({
    mutationFn: (data: any) => editId
      ? apiFetch(`/quotations/${editId}`, { method: "PATCH", body: JSON.stringify(data) })
      : apiFetch("/quotations", { method: "POST", body: JSON.stringify(data) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/erp-api/quotations"] });
      toast({ title: editId ? "報價單已更新" : "報價單已建立" });
      resetForm();
    },
    onError: (e: Error) => toast({ title: "錯誤", description: e.message, variant: "destructive" }),
  });

  const deleteMut = useMutation({
    mutationFn: (id: number) => apiFetch(`/quotations/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/erp-api/quotations"] });
      toast({ title: "已刪除" });
    },
    onError: (e: Error) => toast({ title: "刪除失敗", description: e.message, variant: "destructive" }),
  });

  const updateStatusMut = useMutation({
    mutationFn: ({ id, status }: { id: number; status: string }) =>
      apiFetch(`/quotations/${id}`, { method: "PATCH", body: JSON.stringify({ status }) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/erp-api/quotations"] });
      toast({ title: "狀態已更新" });
    },
    onError: (e: Error) => toast({ title: "更新失敗", description: e.message, variant: "destructive" }),
  });

  const convertMut = useMutation({
    mutationFn: (id: number) => apiFetch(`/quotations/${id}/convert-to-sales-order`, { method: "POST" }),
    onSuccess: (data: any) => {
      qc.invalidateQueries({ queryKey: ["/erp-api/quotations"] });
      qc.invalidateQueries({ queryKey: ["/erp-api/sales-orders"] });
      toast({ title: "轉單成功", description: data?.message || "已建立銷售訂單" });
    },
    onError: (e: Error) => toast({ title: "轉單失敗", description: e.message, variant: "destructive" }),
  });

  const resetForm = () => {
    setShowForm(false);
    setEditId(null);
    setForm({ customerId: "", customerName: "", quotationDate: new Date().toISOString().split("T")[0], validUntil: "", template: "", notes: "", terms: "報價有效期限：30天\n付款方式：月結30天\n交貨期限：下單後7個工作天", departmentId: "", projectId: "", brandId: "", title: "", quoterName: "", quoterPhone: "", taxIncluded: false, currency: "TWD", exchangeRate: "1", templateId: "", extraFields: {} });
    setItems([{ code: "", name: "", qty: 1, unit: "個", unitPrice: 0, amount: 0, summary: "" }]);
  };

  const handleEdit = (q: any) => {
    setEditId(q.id);
    setForm({
      customerId: q.customerId ? String(q.customerId) : "",
      customerName: q.customerName || "",
      quotationDate: q.quotationDate,
      validUntil: q.validUntil || "",
      template: q.template || "",
      notes: q.notes || "",
      terms: q.terms || "",
      departmentId: q.departmentId ? String(q.departmentId) : "",
      projectId: q.projectId ? String(q.projectId) : "",
      brandId: q.brandId ? String(q.brandId) : "",
      title: q.title || "",
      quoterName: q.quoterName || "",
      quoterPhone: q.quoterPhone || "",
      taxIncluded: q.taxIncluded === true,
      currency: q.currency || "TWD",
      exchangeRate: String(q.exchangeRate || 1),
      templateId: q.templateId ? String(q.templateId) : "",
      extraFields: q.extraFields || {},
    });
    setItems(Array.isArray(q.items) && q.items.length > 0 ? q.items : [{ code: "", name: "", qty: 1, unit: "個", unitPrice: 0, amount: 0, summary: "" }]);
    setShowForm(true);
  };

  // 從關聯單據點過來（?open=編號）：跟點清單那一列一樣，打開那張報價單
  useOpenFromUrl(quotations as any[], q => setPrintQuot(q));

  const handleCopy = (q: any) => {
    setEditId(null);
    setForm({
      customerId: q.customerId ? String(q.customerId) : "",
      customerName: q.customerName || "",
      quotationDate: new Date().toISOString().split("T")[0],
      validUntil: "",
      template: q.template || "",
      notes: q.notes || "",
      terms: q.terms || "",
      departmentId: q.departmentId ? String(q.departmentId) : "",
      projectId: q.projectId ? String(q.projectId) : "",
      brandId: q.brandId ? String(q.brandId) : "",
      title: q.title || "",
      quoterName: q.quoterName || "",
      quoterPhone: q.quoterPhone || "",
      taxIncluded: q.taxIncluded === true,
      currency: q.currency || "TWD",
      exchangeRate: String(q.exchangeRate || 1),
      templateId: q.templateId ? String(q.templateId) : "",
      extraFields: withoutLegacyFields(q.extraFields),
    });
    setItems(Array.isArray(q.items) && q.items.length > 0
      ? q.items.map((item: any) => ({
          code: item.code || "",
          name: item.name || item.itemName || "",
          qty: Number(item.qty ?? item.quantity) || 1,
          unit: item.unit || "個",
          unitPrice: Number(item.unitPrice ?? item.rate) || 0,
          amount: Number(item.amount) || (Number(item.qty ?? item.quantity) || 1) * (Number(item.unitPrice ?? item.rate) || 0),
          summary: item.summary || "",
        }))
      : [{ code: "", name: "", qty: 1, unit: "個", unitPrice: 0, amount: 0, summary: "" }]);
    setShowForm(true);
  };

  const addItem = () => setItems([...items, { code: "", name: "", qty: 1, unit: "個", unitPrice: 0, amount: 0, summary: "" }]);
  const removeItem = (i: number) => setItems(items.filter((_, idx) => idx !== i));
  const updateItem = (i: number, field: string, val: any) => {
    const newItems = [...items];
    (newItems[i] as any)[field] = val;
    if (field === "qty" || field === "unitPrice") {
      newItems[i].amount = newItems[i].qty * newItems[i].unitPrice;
    }
    setItems(newItems);
  };

  const totalAmount = items.reduce((s, i) => s + (i.amount || 0), 0);
  const taxAmount = form.taxIncluded ? 0 : Math.round(totalAmount * 0.05);
  const grandTotal = totalAmount + taxAmount;

  const handleSubmit = () => {
    if (!form.departmentId || !form.projectId) {
      toast({ title: "請選擇部門與專案", description: "部門與專案為必填欄位", variant: "destructive" });
      return;
    }
    const missingFields = missingTemplateFields(selectedOrderTemplate?.fieldSchema, form.extraFields);
    if (missingFields.length > 0) {
      toast({ title: "模板必填欄位尚未填寫", description: missingFields.join("、"), variant: "destructive" });
      return;
    }
    const selectedCustomer = customers.find((c: any) => String(c.id) === form.customerId);
    createMut.mutate({
      customerId: form.customerId ? Number(form.customerId) : null,
      customerName: selectedCustomer ? selectedCustomer.name : form.customerName || null,
      quotationDate: form.quotationDate,
      validUntil: form.validUntil || null,
      template: form.template,
      notes: form.notes || null,
      terms: form.terms || null,
      totalAmount,
      taxAmount,
      grandTotal,
      items: items.filter((i) => i.name),
      departmentId: Number(form.departmentId),
      projectId: Number(form.projectId),
      brandId: form.brandId ? Number(form.brandId) : null,
      title: form.title || null,
      quoterName: form.quoterName || null,
      quoterPhone: form.quoterPhone || null,
      taxIncluded: form.taxIncluded,
      currency: form.currency,
      exchangeRate: Number(form.exchangeRate) || 1,
      templateId: form.templateId ? Number(form.templateId) : null,
      extraFields: form.extraFields || {},
    });
  };

  const fmtMoney = (v: any) => {
    const n = Number(v);
    return isNaN(n) ? "$0" : `$${n.toLocaleString()}`;
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <PageHeader title="報價單管理" description={`共 ${filteredQuotations.length} 筆報價單`} hint={<PageHint hintKey="sales-quotations">這裡用來準備並追蹤給客戶的報價。一般流程：建立草稿 → 核對價格與效期 → 送出 → 客戶接受後轉成訂單。小提醒：轉單前請確認報價版本，避免使用過期價格。</PageHint>} />
        <div className="flex gap-2">
          <PrintButton title="報價單清單" contentId="quotations-table" />
          <Button onClick={() => { resetForm(); setShowForm(true); }}>
            <Plus size={16} className="mr-2" />新增報價單
          </Button>
        </div>
      </div>

      {batch.count > 0 && (
        <BatchActionBar
          count={batch.count}
          entityName="報價單"
          entityEndpoint="quotations"
          ids={batch.ids}
          batchFields={quotationBatchFields}
          onClear={batch.clearSelection}
          onComplete={() => qc.invalidateQueries({ queryKey: ["/erp-api/quotations"] })}
        />
      )}

      {/* AI 助理提出要寄的報價單，業務在這裡就能確認寄出 */}
      <PendingEmails docType="quotation" />

      {/* 新增／編輯報價單：外框用全系統共用的單據視窗（共用外框不收 data-testid，所以標在內層） */}
      <DocWindow
        open={showForm}
        onClose={resetForm}
        name={editId ? "編輯報價單" : "新增報價單"}
        extraWide
        footer={<>
          <Button variant="outline" onClick={resetForm}>取消</Button>
          <Button onClick={handleSubmit} disabled={createMut.isPending}>{editId ? "更新" : "建立報價單"}</Button>
        </>}
      >
          <div className="space-y-5" data-testid="dialog-quotation-form">

            {TEMPLATES.length === 0 ? (
              <p className="text-sm text-muted-foreground">還沒有報價模板。要分類（例如校園、課程），請先到「報價管理 › 報價模板」新增。</p>
            ) : (
            <div className="flex flex-wrap gap-1 p-1 bg-muted rounded-lg w-fit max-w-full">
              {TEMPLATES.map(t => (
                <button
                  key={t}
                  type="button"
                  className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${form.template === t ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"}`}
                  onClick={() => applyTemplate(t)}
                >
                  {t}
                </button>
              ))}
            </div>
            )}

            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <div>
                <label className="text-sm text-muted-foreground">客戶</label>
                <SearchableSelect
                  value={form.customerId}
                  onValueChange={(v) => setForm({ ...form, customerId: v })}
                  options={(customers as any[]).map((c: any) => ({
                    value: String(c.id),
                    label: `${c.customerCode ? `[${c.customerCode}] ` : ""}${c.name}`,
                  }))}
                  placeholder="請選擇客戶"
                  searchPlaceholder="輸入客戶名稱或編號搜尋..."
                  emptyText="找不到符合的客戶"
                />
              </div>
              <div>
                <label className="text-sm text-muted-foreground">報價日期</label>
                <Input type="date" value={form.quotationDate} onChange={(e) => setForm({ ...form, quotationDate: e.target.value })} />
              </div>
              <div>
                <label className="text-sm text-muted-foreground">有效期限</label>
                <Input type="date" value={form.validUntil} onChange={(e) => setForm({ ...form, validUntil: e.target.value })} />
              </div>
              <div>
                <label className="text-sm text-muted-foreground">幣別</label>
                <select className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value })}>
                  <option value="TWD">TWD</option>
                  <option value="USD">USD</option>
                  <option value="JPY">JPY</option>
                  <option value="EUR">EUR</option>
                  <option value="CNY">CNY</option>
                </select>
              </div>
              {form.currency !== "TWD" && (
                <div>
                  <label className="text-sm text-muted-foreground">匯率（兌臺幣）</label>
                  <Input type="number" min="0.000001" step="0.000001" value={form.exchangeRate} onChange={(e) => setForm({ ...form, exchangeRate: e.target.value })} />
                </div>
              )}
            </div>
            <CustomerRemarkHint
              remarks={(customers as any[]).find((c: any) => String(c.id) === form.customerId)?.remarks}
              onInsert={(entry) => setForm(f => ({ ...f, notes: appendToDocumentRemarks(f.notes, entry) }))}
            />
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <div>
                <label className="text-sm text-muted-foreground">品牌（報價公司）</label>
                <SearchableSelect
                  value={form.brandId}
                  onValueChange={(v) => setForm({ ...form, brandId: v })}
                  options={(brands as any[]).filter((b: any) => b.isActive !== false || String(b.id) === form.brandId).map((b: any) => ({
                    value: String(b.id),
                    label: `${b.name}${b.isActive === false ? "（已停用）" : ""}`,
                  }))}
                  placeholder="請選擇品牌"
                  searchPlaceholder="輸入品牌名稱搜尋..."
                  emptyText="找不到品牌，請至「系統管理 > 品牌管理」新增"
                />
              </div>
              <div className="sm:col-span-1 lg:col-span-3">
                <label className="text-sm text-muted-foreground">報價單標題</label>
                <Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="如 114(下)仁愛_腦力開發桌遊_明細(0709)" />
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <div>
                <label className="text-sm text-muted-foreground">報價人</label>
                <Input value={form.quoterName} onChange={(e) => setForm({ ...form, quoterName: e.target.value })} placeholder="承辦人姓名" />
              </div>
              <div>
                <label className="text-sm text-muted-foreground">報價人電話</label>
                <Input value={form.quoterPhone} onChange={(e) => setForm({ ...form, quoterPhone: e.target.value })} placeholder="聯絡電話" />
              </div>
              <div>
                <label className="text-sm text-muted-foreground">部門 <span className="text-red-500">*</span></label>
                <SearchableSelect
                  value={form.departmentId}
                  onValueChange={(v) => setForm({ ...form, departmentId: v })}
                  options={selectableDepartments(departments as any[], form.departmentId).map((d: any) => ({
                    value: String(d.id),
                    label: departmentLabel(d),
                  }))}
                  placeholder="請選擇部門"
                  searchPlaceholder="輸入部門名稱搜尋..."
                  emptyText="找不到符合的部門"
                  triggerClassName={!form.departmentId ? "border-red-300 bg-red-50" : undefined}
                />
              </div>
              <div>
                <label className="text-sm text-muted-foreground">專案 <span className="text-red-500">*</span></label>
                <SearchableSelect
                  value={form.projectId}
                  onValueChange={(projectId) => {
                    const templateAvailable = !form.templateId || orderTemplates.some(t =>
                      t.id === Number(form.templateId) && t.isActive && (t.projectId == null || String(t.projectId) === projectId)
                    );
                    setForm({ ...form, projectId, templateId: templateAvailable ? form.templateId : "", extraFields: templateAvailable ? form.extraFields : {} });
                  }}
                  options={selectableProjects(projects as any[], form.projectId).map((p: any) => ({
                    value: String(p.id),
                    label: projectPickerLabel(p),
                  }))}
                  placeholder="請選擇專案"
                  searchPlaceholder="輸入專案名稱搜尋..."
                  emptyText="找不到符合的專案"
                  triggerClassName={!form.projectId ? "border-red-300 bg-red-50" : undefined}
                />
              </div>
            </div>

            <div>
              <label className="text-sm text-muted-foreground">訂單模板</label>
              <LookupSelect
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={form.templateId}
                onChange={(e) => {
                  const tpl = orderTemplates.find(t => t.id === Number(e.target.value));
                  setForm({ ...form, templateId: e.target.value, extraFields: templateDefaults(tpl?.fieldSchema) });
                }}
              >
                <option value="">不使用模板</option>
                {availableOrderTemplates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
              </LookupSelect>
            </div>

            {selectedOrderTemplate && selectedOrderTemplate.fieldSchema.length > 0 && (
              <div className="border-t pt-4">
                <h4 className="text-sm font-semibold text-blue-600 mb-3">模板欄位：{selectedOrderTemplate.name}</h4>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {selectedOrderTemplate.fieldSchema.map(f => (
                    <div key={f.name}>
                      <Label>{f.label}{f.required && <span className="text-red-500 ml-0.5">*</span>}</Label>
                      {f.type === "select" ? (
                        <select className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" value={form.extraFields[f.name] || ""} onChange={e => setForm(p => ({ ...p, extraFields: { ...p.extraFields, [f.name]: e.target.value } }))}>
                          <option value="">請選擇</option>
                          {(f.options || []).map(o => <option key={o} value={o}>{o}</option>)}
                        </select>
                      ) : f.type === "textarea" ? (
                        <textarea className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm min-h-[60px]" value={form.extraFields[f.name] || ""} onChange={e => setForm(p => ({ ...p, extraFields: { ...p.extraFields, [f.name]: e.target.value } }))} />
                      ) : (
                        <Input type={f.type === "number" ? "number" : f.type === "date" ? "date" : "text"} value={form.extraFields[f.name] || ""} onChange={e => setForm(p => ({ ...p, extraFields: { ...p.extraFields, [f.name]: e.target.value } }))} />
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div>
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-4">
                  <label className="text-sm font-medium">報價品項</label>
                  <label className="flex items-center gap-1.5 text-sm cursor-pointer select-none">
                    <input
                      type="checkbox"
                      className="h-4 w-4 accent-primary"
                      checked={form.taxIncluded}
                      onChange={(e) => setForm({ ...form, taxIncluded: e.target.checked })}
                    />
                    含稅（單價已含稅，不另加5%）
                  </label>
                </div>
                <Button variant="outline" size="sm" onClick={addItem}><Plus size={14} className="mr-1" />新增品項</Button>
              </div>
              {/* 手機版：卡片式品項編輯 */}
              <div className="md:hidden space-y-3">
                {items.map((item, i) => (
                  <div key={i} className="rounded-lg border p-3 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-medium text-muted-foreground">項目 {i + 1}</span>
                      {items.length > 1 && (
                        <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-red-500" onClick={() => removeItem(i)}>
                          <Trash2 size={14} />
                        </Button>
                      )}
                    </div>
                    <SearchableSelect
                      value={item.code || ""}
                      onValueChange={(code) => {
                        const ci = (catalogItems as any[]).find((c: any) => c.itemCode === code);
                        const newItems = [...items];
                        newItems[i] = {
                          ...newItems[i],
                          code,
                          ...(ci ? {
                            name: ci.itemName || newItems[i].name,
                            unit: ci.unit || newItems[i].unit,
                            unitPrice: ci.sellingPrice != null && !isNaN(Number(ci.sellingPrice)) ? Number(ci.sellingPrice) : newItems[i].unitPrice,
                          } : {}),
                        };
                        newItems[i].amount = newItems[i].qty * newItems[i].unitPrice;
                        setItems(newItems);
                      }}
                      options={(catalogItems as any[]).map((c: any) => ({ value: c.itemCode, label: `${c.itemCode} ${c.itemName}` }))}
                      placeholder="選擇品項編號"
                      searchPlaceholder="輸入編號或名稱搜尋..."
                      emptyText="找不到品項"
                    />
                    <Input placeholder="品項名稱" value={item.name} onChange={(e) => updateItem(i, "name", e.target.value)} />
                    <div className="grid grid-cols-3 gap-2">
                      <div><Label className="text-xs text-muted-foreground">數量</Label><Input type="number" min={1} value={item.qty} onChange={(e) => updateItem(i, "qty", Number(e.target.value))} /></div>
                      <div><Label className="text-xs text-muted-foreground">單位</Label><Input value={item.unit} onChange={(e) => updateItem(i, "unit", e.target.value)} /></div>
                      <div><Label className="text-xs text-muted-foreground">單價</Label><Input type="number" min={0} value={item.unitPrice} onChange={(e) => updateItem(i, "unitPrice", Number(e.target.value))} /></div>
                    </div>
                    <Input placeholder="摘要／備註" value={item.summary || ""} onChange={(e) => updateItem(i, "summary", e.target.value)} />
                    <div className="text-right text-sm font-medium">小計：{fmtMoney(item.amount)}</div>
                  </div>
                ))}
              </div>
              {/* 桌面版：表格式品項編輯 */}
              <div className="hidden md:block min-w-0 overflow-x-auto">
                <table className="w-full min-w-[1000px] table-fixed text-sm">
                  <thead>
                    <tr className="bg-muted/50 border-b">
                      <th className="text-left px-2 py-2 font-medium w-44">品項編號</th>
                      <th className="text-left px-2 py-2 font-medium min-w-[140px]">品項名稱</th>
                      <th className="text-left px-2 py-2 font-medium w-32">數量</th>
                      <th className="text-left px-2 py-2 font-medium w-24">單位</th>
                      <th className="text-left px-2 py-2 font-medium w-40">單價</th>
                      <th className="text-right px-2 py-2 font-medium w-32">小計</th>
                      <th className="text-left px-2 py-2 font-medium w-40">摘要（備註）</th>
                      <th className="w-10"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((item, i) => (
                      <tr key={i} className="border-b">
                        <td className="px-1.5 py-1.5">
                          <SearchableSelect
                            value={item.code || ""}
                            onValueChange={(code) => {
                              const ci = (catalogItems as any[]).find((c: any) => c.itemCode === code);
                              const newItems = [...items];
                              newItems[i] = {
                                ...newItems[i],
                                code,
                                ...(ci ? {
                                  name: ci.itemName || newItems[i].name,
                                  unit: ci.unit || newItems[i].unit,
                                  unitPrice: ci.sellingPrice != null && !isNaN(Number(ci.sellingPrice)) ? Number(ci.sellingPrice) : newItems[i].unitPrice,
                                } : {}),
                              };
                              newItems[i].amount = newItems[i].qty * newItems[i].unitPrice;
                              setItems(newItems);
                            }}
                            options={(catalogItems as any[]).map((c: any) => ({
                              value: c.itemCode,
                              label: `${c.itemCode} ${c.itemName}`,
                            }))}
                            placeholder="選擇編號"
                            searchPlaceholder="輸入編號或名稱搜尋..."
                            emptyText="找不到品項"
                          />
                        </td>
                        <td className="px-1.5 py-1.5">
                          <Input placeholder="品項名稱" value={item.name} onChange={(e) => updateItem(i, "name", e.target.value)} className="h-10 px-2 text-base" />
                        </td>
                        <td className="px-1.5 py-1.5">
                          <Input type="number" min={1} inputMode="decimal" step="any" value={item.qty === 0 ? "" : item.qty} placeholder="0" onChange={(e) => updateItem(i, "qty", Number(e.target.value))} className="h-10 px-2 text-right text-base tabular-nums [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none" />
                        </td>
                        <td className="px-1.5 py-1.5">
                          <Input value={item.unit} onChange={(e) => updateItem(i, "unit", e.target.value)} className="h-10 px-2 text-base" />
                        </td>
                        <td className="px-1.5 py-1.5">
                          <Input type="number" min={0} inputMode="decimal" step="any" value={item.unitPrice === 0 ? "" : item.unitPrice} placeholder="0" onChange={(e) => updateItem(i, "unitPrice", Number(e.target.value))} className="h-10 px-2 text-right text-base tabular-nums [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none" />
                        </td>
                        <td className="px-1.5 py-1.5 text-right font-medium">{fmtMoney(item.amount)}</td>
                        <td className="px-1.5 py-1.5">
                          <Input placeholder="摘要／備註" value={item.summary || ""} onChange={(e) => updateItem(i, "summary", e.target.value)} className="h-10 px-2 text-base" />
                        </td>
                        <td className="px-1 py-1.5">
                          {items.length > 1 && (
                            <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-red-500" onClick={() => removeItem(i)}>
                              <Trash2 size={14} />
                            </Button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="flex justify-end mt-3">
                <div className="text-sm space-y-1 w-60">
                  <div className="flex justify-between"><span>小計{form.taxIncluded ? "（含稅）" : ""}</span><span>{fmtMoney(totalAmount)}</span></div>
                  {form.taxIncluded ? (
                    <div className="flex justify-between text-muted-foreground"><span>稅額</span><span>已內含</span></div>
                  ) : (
                    <div className="flex justify-between"><span>稅額 (5%)</span><span>{fmtMoney(taxAmount)}</span></div>
                  )}
                  <div className="flex justify-between font-bold text-base border-t pt-1"><span>合計</span><span>{fmtMoney(grandTotal)}</span></div>
                  {form.currency !== "TWD" && (
                    <div className="text-right text-xs text-muted-foreground">折合 NT${(grandTotal * (Number(form.exchangeRate) || 0)).toLocaleString()}</div>
                  )}
                </div>
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="text-sm text-muted-foreground">備註</label>
                <textarea
                  className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm min-h-[80px]"
                  value={form.notes}
                  onChange={(e) => setForm({ ...form, notes: e.target.value })}
                />
              </div>
              <div>
                <label className="text-sm text-muted-foreground">報價條款</label>
                <textarea
                  className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm min-h-[80px]"
                  value={form.terms}
                  onChange={(e) => setForm({ ...form, terms: e.target.value })}
                />
              </div>
            </div>

            {editId && <RelatedDocs type="quotation" id={editId} onNavigate={() => setShowForm(false)} />}
          </div>
      </DocWindow>

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
              <Label className="text-xs text-muted-foreground">模板類別</Label>
              <select
                className="flex h-10 w-32 rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={templateFilter}
                onChange={(e) => setTemplateFilter(e.target.value)}
              >
                <option value="">全部</option>
                {[...new Set([...TEMPLATES, ...(quotations as any[]).map((q: any) => q.template).filter(Boolean)])].map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            </div>
            <div className="flex-1 min-w-[200px]">
              <Label className="text-xs text-muted-foreground">搜尋</Label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input className="pl-9" placeholder="報價單號、客戶名稱..." value={searchQ} onChange={e => setSearchQ(e.target.value)} />
              </div>
            </div>
            <div className="text-sm text-muted-foreground pb-2">共 {filteredQuotations.length} 筆</div>
            <ColumnSelector storageKey="quotations-columns" columns={quotColumnDefs} visibleKeys={visibleKeys} onChange={setVisibleKeys} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0 overflow-x-auto" id="quotations-table">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-muted/50 border-b">
                  <th className="w-10 px-2"><CheckboxHeader checked={batch.allSelected} indeterminate={batch.someSelected} onChange={batch.toggleAll} /></th>
                  {visibleKeys.has("quotationNumber") && <th className="text-left px-4 py-3 font-medium">報價單號</th>}
                  {visibleKeys.has("template") && <th className="text-left px-4 py-3 font-medium">模板</th>}
                  {visibleKeys.has("customerName") && <th className="text-left px-4 py-3 font-medium">客戶</th>}
                  {visibleKeys.has("quotationDate") && <th className="text-left px-4 py-3 font-medium">報價日期</th>}
                  {visibleKeys.has("validUntil") && <th className="text-left px-4 py-3 font-medium">有效期限</th>}
                  {visibleKeys.has("currency") && <th className="text-left px-4 py-3 font-medium">幣別</th>}
                  {visibleKeys.has("totalAmount") && <th className="text-right px-4 py-3 font-medium">小計</th>}
                  {visibleKeys.has("taxAmount") && <th className="text-right px-4 py-3 font-medium">稅額</th>}
                  {visibleKeys.has("grandTotal") && <th className="text-right px-4 py-3 font-medium">合計金額</th>}
                  {visibleKeys.has("status") && <th className="text-left px-4 py-3 font-medium">狀態</th>}
                  {visibleKeys.has("notes") && <th className="text-left px-4 py-3 font-medium">備註</th>}
                  {visibleKeys.has("terms") && <th className="text-left px-4 py-3 font-medium">報價條款</th>}
                  {visibleKeys.has("departmentId") && <th className="text-left px-4 py-3 font-medium">部門</th>}
                  {visibleKeys.has("projectId") && <th className="text-left px-4 py-3 font-medium">專案</th>}
                  {visibleKeys.has("createdAt") && <th className="text-left px-4 py-3 font-medium">建立時間</th>}
                  <th className="text-right px-4 py-3 font-medium">操作</th>
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  <tr><td colSpan={visibleKeys.size + 2} className="text-center py-8 text-muted-foreground">載入中...</td></tr>
                ) : filteredQuotations.length === 0 ? (
                  <tr><td colSpan={visibleKeys.size + 2} className="text-center py-8 text-muted-foreground">尚無報價單</td></tr>
                ) : (
                  filteredQuotations.map((q: any) => (
                    <tr key={q.id} className="border-b hover:bg-muted/30 cursor-pointer" title="點一下看這張報價單的內容"
                      onClick={(e) => { if ((e.target as HTMLElement).closest("button,select,input,a,label")) return; setPrintQuot(q); }}>
                      <td className="px-2"><CheckboxCell checked={batch.selectedIds.has(q.id)} onChange={() => batch.toggle(q.id)} /></td>
                      {visibleKeys.has("quotationNumber") && <td className="px-4 py-2.5 font-mono text-sm font-medium whitespace-nowrap">{q.quotationNumber}{q.extraFields?.legacy === true && <span className="ml-1.5 inline-block rounded border px-1 text-[10px] font-normal text-muted-foreground align-middle" title="從舊系統 Ecount 搬過來的歷史單，只能查看">歷史</span>}</td>}
                      {visibleKeys.has("template") && <td className="px-4 py-2.5">{q.template ? <span className="text-xs px-2 py-0.5 bg-muted rounded">{q.template}</span> : <span className="text-muted-foreground">-</span>}</td>}
                      {visibleKeys.has("customerName") && <td className="px-4 py-2.5">{q.customerName || "-"}</td>}
                      {visibleKeys.has("quotationDate") && <td className="px-4 py-2.5">{q.quotationDate}</td>}
                      {visibleKeys.has("validUntil") && <td className="px-4 py-2.5">{q.validUntil || "-"}</td>}
                      {visibleKeys.has("currency") && <td className="px-4 py-2.5">{q.currency || "TWD"}</td>}
                      {visibleKeys.has("totalAmount") && <td className="px-4 py-2.5 text-right">{fmtMoney(q.totalAmount)}</td>}
                      {visibleKeys.has("taxAmount") && <td className="px-4 py-2.5 text-right">{fmtMoney(q.taxAmount)}</td>}
                      {visibleKeys.has("grandTotal") && (
                        <td className="px-4 py-2.5 text-right font-medium">
                          <div>{q.currency === "TWD" || !q.currency ? "NT$" : q.currency} {Number(q.grandTotal).toLocaleString()}</div>
                          {q.currency && q.currency !== "TWD" && <div className="text-xs font-normal text-muted-foreground">折合 NT${Number(q.grandTotalTWD).toLocaleString()}</div>}
                        </td>
                      )}
                      {visibleKeys.has("status") && <td className="px-4 py-2.5">
                        <select
                          className={`px-2 py-0.5 rounded-full text-xs border-0 ${statusColors[q.status] || "bg-gray-100"}`}
                          value={q.status}
                          onChange={(e) => updateStatusMut.mutate({ id: q.id, status: e.target.value })}
                        >
                          {Object.entries(statusLabels).map(([k, v]) => (
                            <option key={k} value={k}>{v}</option>
                          ))}
                        </select>
                      </td>}
                      {visibleKeys.has("notes") && <td className="px-4 py-2.5"><span className="text-xs max-w-[150px] truncate block">{q.notes || "-"}</span></td>}
                      {visibleKeys.has("terms") && <td className="px-4 py-2.5"><span className="text-xs max-w-[150px] truncate block">{q.terms || "-"}</span></td>}
                      {visibleKeys.has("departmentId") && <td className="px-4 py-2.5">{(departments as any[]).find((d: any) => d.id === q.departmentId)?.name || "-"}</td>}
                      {visibleKeys.has("projectId") && <td className="px-4 py-2.5">{(projects as any[]).find((p: any) => p.id === q.projectId)?.name || "-"}</td>}
                      {visibleKeys.has("createdAt") && <td className="px-4 py-2.5 text-xs">{q.createdAt ? new Date(q.createdAt).toLocaleDateString("zh-TW") : "-"}</td>}
                      <td className="px-4 py-2.5">
                        <div className="flex justify-end gap-1">
                          {q.status !== "Converted" && q.extraFields?.legacy !== true && (
                            <Button
                              variant="ghost" size="sm" className="h-7 px-2 text-xs text-primary"
                              disabled={convertMut.isPending}
                              onClick={() => { if (confirm(`確定將報價單 ${q.quotationNumber} 轉為銷售訂單？`)) convertMut.mutate(q.id); }}
                            >
                              <ArrowRight size={14} className="mr-1" />轉訂單
                            </Button>
                          )}
                          <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => setPrintQuot(q)}>
                            <Printer size={14} className="mr-1" />{q.extraFields?.legacy === true ? "查看／列印" : "列印"}
                          </Button>
                          <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => setEmailQuotId(q.id)} data-testid={`button-email-quotation-${q.id}`}>
                            <Mail size={14} className="mr-1" />寄信
                          </Button>
                          <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => handleEdit(q)}>
                            <FileText size={14} className="mr-1" />編輯
                          </Button>
                          <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => handleCopy(q)}>
                            <Copy size={14} className="mr-1" />複製
                          </Button>
                          {q.extraFields?.legacy !== true && <Button
                            variant="ghost" size="sm" className="h-7 w-7 p-0 text-red-500"
                            onClick={() => { if (confirm("確定刪除？")) deleteMut.mutate(q.id); }}
                          >
                            <Trash2 size={14} />
                          </Button>}
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <QuotationPrintDialog
        open={!!printQuot}
        onClose={() => setPrintQuot(null)}
        quotation={printQuot ? {
          ...printQuot,
          extraFieldRows: extraFieldRows(orderTemplates.find(t => t.id === printQuot.templateId)?.fieldSchema, printQuot.extraFields),
        } : null}
        customer={printQuot ? (customers as any[]).find((c: any) => c.id === printQuot.customerId) || null : null}
        brand={printQuot ? (brands as any[]).find((b: any) => b.id === printQuot.brandId) || defaultBrand(brands as any[]) : null}
      />
      <SendEmailDialog docType="quotation" docId={emailQuotId} open={emailQuotId != null} onOpenChange={(v) => !v && setEmailQuotId(null)} />
    </div>
  );
}
