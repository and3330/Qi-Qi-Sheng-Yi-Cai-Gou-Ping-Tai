import { useState, useEffect, useCallback, useRef } from "react";
import { RelatedDocs } from "@/components/shared/related-docs";
import { useRoute, useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowLeft, FileText, Calendar, Building2, FolderKanban, User, GraduationCap, Clock, Tag, Warehouse, Plus, Link2, Unlink, Receipt, Layers, Users, Trash2, Mail, Printer } from "lucide-react";
import { SendEmailDialog } from "@/components/email/send-email-dialog";
import { DocumentPrintDialog, COMPANY_INFO } from "@/components/sales/quotation-print-dialog";
import type { PrintData } from "@/lib/print-layout";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { useAutoReloadKey } from "@/lib/auto-refresh";

import { LookupSelect } from "@/components/shared/lookup-select";
import { SalesOrderFormDialog } from "@/components/sales/sales-order-edit-dialog";
import { Pencil } from "lucide-react";

/** 條列式的資料清單：左邊欄位名稱、右邊內容；沒填的不顯示 */
function DetailList({ rows, emptyText = "沒有資料" }: { rows: Array<[string, string | number | null | undefined]>; emptyText?: string }) {
  const filled = rows.filter(([, value]) => value !== null && value !== undefined && String(value).trim() !== "");
  if (filled.length === 0) return <p className="text-sm text-muted-foreground">{emptyText}</p>;
  return (
    <dl className="divide-y text-sm">
      {filled.map(([label, value]) => (
        <div key={label} className="flex gap-3 py-2">
          <dt className="w-28 shrink-0 text-muted-foreground">{label}</dt>
          <dd className="min-w-0 flex-1 font-medium whitespace-pre-wrap break-words">{value}</dd>
        </div>
      ))}
    </dl>
  );
}
const BASE_URL = import.meta.env.BASE_URL;
const BASE = BASE_URL.endsWith("/") ? BASE_URL : BASE_URL + "/";
const api = (path: string) => `/erp-api/${path}`;
const statusMap: Record<string, string> = { Draft: "草稿", Confirmed: "已確認", "To Deliver": "待出貨", Completed: "已完成", Cancelled: "已取消" };
const invStatusMap: Record<string, string> = { Draft: "草稿", Unpaid: "未付款", Submitted: "已提交", Paid: "已付款", Cancelled: "已取消", Overdue: "逾期" };
interface RelatedLegacyOrder {
  id: number; docNumber: string; docDate: string | null; total: number | null; lineCount: number; staffName: string | null;
  title: string | null; reason: string; info: Record<string, string | null>;
}

/**
 * 歷史銷貨單「可能相關」的舊訂貨單。舊系統沒有留下銷貨單是從哪張訂貨單轉的，
 * 這裡是用同客戶＋同標題（或同開課日期與上課時間）找出來的，所以只說「可能相關」。
 */
function RelatedLegacyOrders({ orderId }: { orderId: number }) {
  const [, navigate] = useLocation();
  const [rows, setRows] = useState<RelatedLegacyOrder[]>([]);
  useEffect(() => {
    let cancelled = false;
    fetch(api(`sales-orders/${orderId}/related-legacy-orders`))
      .then(r => (r.ok ? r.json() : []))
      .then(data => { if (!cancelled) setRows(Array.isArray(data) ? data : []); })
      .catch(() => { if (!cancelled) setRows([]); });
    return () => { cancelled = true; };
  }, [orderId]);
  if (rows.length === 0) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg flex items-center gap-2"><FileText className="h-5 w-5" />可能相關的訂貨單（{rows.length}）</CardTitle>
        <p className="text-sm text-muted-foreground">舊系統沒有記錄這張銷貨單是從哪張訂貨單轉來的。下面是同一個客戶、標題相同（或開課日期與上課時間相同）的訂貨單，僅供參考。</p>
      </CardHeader>
      <CardContent className="space-y-3">
        {rows.map(row => {
          const details = Object.entries(row.info).filter(([, value]) => value);
          return (
            <div key={row.id} className="rounded-lg border p-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="font-medium">{row.title || row.docNumber}</div>
                  <div className="text-xs text-muted-foreground">訂貨單 {row.docNumber}・{row.lineCount} 行明細{row.total !== null ? `・NT$ ${Number(row.total).toLocaleString()}` : ""}{row.staffName ? `・服務顧問 ${row.staffName}` : ""}・{row.reason}</div>
                </div>
                <Button size="sm" variant="outline" onClick={() => navigate(`/system/legacy-documents?type=${encodeURIComponent("訂貨單")}&q=${encodeURIComponent(row.docNumber)}`)}>看這張訂貨單</Button>
              </div>
              {details.length > 0 && (
                <dl className="mt-2 grid grid-cols-1 gap-x-4 gap-y-1 text-sm sm:grid-cols-2 lg:grid-cols-3">
                  {details.map(([label, value]) => (
                    <div key={label} className="flex gap-2 min-w-0"><dt className="shrink-0 text-muted-foreground">{label}</dt><dd className="min-w-0 break-words">{value}</dd></div>
                  ))}
                </dl>
              )}
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

/** 歷史銷貨單在舊系統開過的發票（只供查看） */
function LegacyInvoices({ orderId }: { orderId: number }) {
  const [rows, setRows] = useState<any[]>([]);
  useEffect(() => {
    let cancelled = false;
    fetch(api(`sales-orders/${orderId}/legacy-invoices`))
      .then(r => (r.ok ? r.json() : []))
      .then(data => { if (!cancelled) setRows(Array.isArray(data) ? data : []); })
      .catch(() => { if (!cancelled) setRows([]); });
    return () => { cancelled = true; };
  }, [orderId]);
  if (rows.length === 0) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg flex items-center gap-2"><Receipt className="h-5 w-5" />舊系統開過的發票（{rows.length}）</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {rows.map(row => (
          <div key={row.legacyDocumentId} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3 text-sm">
            <div className="min-w-0">
              <span className="font-mono font-medium">{row.invoiceNumber}</span>
              <span className="ml-2 text-muted-foreground">{row.invoiceDate}{row.einvoiceType ? `・${row.einvoiceType}` : ""}{String(row.linkMethod || "").startsWith("推定") ? "・推定是這張單的發票" : ""}</span>
              {row.detail && <div className="text-xs text-muted-foreground break-words">{row.detail}</div>}
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">未稅 {Number(row.netAmount).toLocaleString()}・稅 {Number(row.taxAmount).toLocaleString()}</span>
              <span className="font-semibold">NT$ {Number(row.totalAmount).toLocaleString()}</span>
              <Badge variant={row.status === "已開立" ? "secondary" : "destructive"}>{row.status}</Badge>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

const SOURCE_LABELS: Record<string, string> = { ecount: "Ecount 歷史單", manual: "手動建立", quick_entry: "快速錄單", api_ecommerce: "API匯入-商城", api_event: "API匯入-活動平台" };

function InfoCard({ icon: Icon, label, value }: { icon?: any; label: string; value: string | number | null | undefined }) {
  if (!value && value !== 0) return null;
  return (
    <Card>
      <CardContent className="pt-4">
        <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
          {Icon && <Icon className="h-4 w-4" />}{label}
        </div>
        <p className="font-semibold whitespace-pre-wrap">{value}</p>
      </CardContent>
    </Card>
  );
}

/** 這些模板欄位存在銷貨單本身的欄位（課程資訊），不放在 extraFields */
const COLUMN_FIELDS = new Set(["classWeeks", "courseStartDate", "courseEndDate", "caseTime", "coursePeriod", "teacherCode", "teacherFeePerSession", "teacherMaterialFeeMethod", "dateDetails", "deliveryDate", "label", "remarks"]);

export default function SalesOrderDetail() {
  const reloadKey = useAutoReloadKey();
  const { toast } = useToast();
  const [, params] = useRoute("/sales/orders/:id");
  const [, navigate] = useLocation();
  const [order, setOrder] = useState<any>(null);
  const [statusBusy, setStatusBusy] = useState(false);
  const [emailOpen, setEmailOpen] = useState(false);
  const [printData, setPrintData] = useState<PrintData | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const editOpenedFromUrl = useRef(false);
  const openEditRef = useRef<(() => void) | null>(null);
  const [editFocus, setEditFocus] = useState<"items" | null>(null);
  const [editReload, setEditReload] = useState(0);
  const [loading, setLoading] = useState(true);
  const [deptName, setDeptName] = useState("");
  const [projName, setProjName] = useState("");
  const [handlerName, setHandlerName] = useState("");
  const [teacherName, setTeacherName] = useState("");
  const [invoices, setInvoices] = useState<any[]>([]);
  const [linkDialogOpen, setLinkDialogOpen] = useState(false);
  const [unlinkedInvoices, setUnlinkedInvoices] = useState<any[]>([]);
  const [selectedInvoiceId, setSelectedInvoiceId] = useState<string>("");
  const [actionLoading, setActionLoading] = useState(false);

  const loadInvoices = useCallback(async () => {
    if (!params?.id) return;
    try {
      const res = await fetch(api(`sales-orders/${params.id}/invoices`));
      if (res.ok) setInvoices(await res.json());
    } catch {}
  }, [params?.id]);

  const [registrants, setRegistrants] = useState<any[]>([]);
  const [templateFields, setTemplateFields] = useState<any[]>([]);

  useEffect(() => {
    if (!params?.id) return;
    const load = async () => {
      setLoading(true);
      try {
        const res = await fetch(api(`sales-orders/${params.id}`));
        if (res.ok) {
          const data = await res.json();
          setOrder(data);

          const [dRes, pRes, eRes, tRes] = await Promise.all([
            fetch(api("departments")),
            fetch(api("projects")),
            fetch(api("employees")),
            fetch(api("teachers")),
          ]);
          const depts = await dRes.json();
          const projs = await pRes.json();
          const emps = await eRes.json();
          const teachers = await tRes.json();

          setDeptName(data.departmentId ? depts.find((x: any) => x.id === data.departmentId)?.name || "" : "");
          setProjName(data.projectId ? projs.find((x: any) => x.id === data.projectId)?.name || "" : "");
          if (data.handlerId) {
            const h = emps.find((x: any) => x.id === data.handlerId);
            if (h) setHandlerName(h.fullName || h.name || "");
          }
          if (data.teacherCode) {
            const t = teachers.find((x: any) => x.teacherCode === data.teacherCode);
            if (t) setTeacherName(`${data.teacherCode} ${t.name}`);
            else setTeacherName(data.teacherCode);
          }

          try {
            const regRes = await fetch(`/erp-api/sales-orders/${params.id}/registrants`);
            if (regRes.ok) setRegistrants(await regRes.json());
          } catch {}

          if (data.templateId) {
            try {
              const tplRes = await fetch(`/erp-api/order-templates/${data.templateId}`);
              if (tplRes.ok) {
                const tpl = await tplRes.json();
                setTemplateFields(tpl.fieldSchema || []);
              }
            } catch {}
          } else {
            setTemplateFields([]);
          }
        }
      } catch {}
      setLoading(false);
    };
    load();
    loadInvoices();
  }, [params?.id, loadInvoices, reloadKey, editReload]);

  const [invoiceDialogOpen, setInvoiceDialogOpen] = useState(false);
  const [invoiceItems, setInvoiceItems] = useState<{ itemName: string; quantity: string; rate: string }[]>([]);
  const [invoiceError, setInvoiceError] = useState("");

  const activeInvoices = invoices.filter((i: any) => i.status !== "Cancelled");
  const alreadyInvoiced = activeInvoices.reduce((s: number, i: any) => s + Number(i.totalAmount || 0), 0);
  const remainingInvoiceable = Math.max(0, Math.round((Number(order?.totalAmount || 0) - alreadyInvoiced) * 100) / 100);

  const handleOpenInvoiceDialog = () => {
    setInvoiceError("");
    if (alreadyInvoiced > 0) {
      setInvoiceItems([{ itemName: "部分開票", quantity: "1", rate: String(remainingInvoiceable) }]);
    } else {
      const orderItems = Array.isArray(order?.items) ? order.items : [];
      setInvoiceItems(orderItems.length > 0
        ? orderItems.map((it: any) => ({
            itemName: it.itemName || it.name || "品項",
            quantity: String(it.quantity || 1),
            rate: String(it.rate || it.unitPrice || 0),
          }))
        : [{ itemName: "", quantity: "1", rate: "" }]);
    }
    setInvoiceDialogOpen(true);
  };

  const invoiceTotal = invoiceItems.reduce((s, it) => {
    const amt = Number(it.quantity) * Number(it.rate);
    return s + (Number.isFinite(amt) ? amt : 0);
  }, 0);

  const handleCreateInvoice = async () => {
    if (!params?.id) return;
    setInvoiceError("");
    setActionLoading(true);
    try {
      const res = await fetch(api(`sales-orders/${params.id}/invoices`), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items: invoiceItems.map((it) => ({
            itemName: it.itemName.trim(),
            quantity: Number(it.quantity),
            rate: Number(it.rate),
          })),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setInvoiceDialogOpen(false);
        await loadInvoices();
      } else {
        setInvoiceError(data.error || "開立發票失敗");
      }
    } catch {
      setInvoiceError("開立發票失敗，請稍後再試");
    }
    setActionLoading(false);
  };

  const handleOpenLinkDialog = async () => {
    if (!order) return;
    try {
      const res = await fetch(api(`invoices/unlinked?customerId=${order.customerId}`));
      if (res.ok) setUnlinkedInvoices(await res.json());
    } catch {}
    setSelectedInvoiceId("");
    setLinkDialogOpen(true);
  };

  const handleLinkInvoice = async () => {
    if (!params?.id || !selectedInvoiceId) return;
    setActionLoading(true);
    try {
      const res = await fetch(api(`sales-orders/${params.id}/invoices`), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ invoiceId: parseInt(selectedInvoiceId) }),
      });
      if (res.ok) {
        setLinkDialogOpen(false);
        await loadInvoices();
      }
    } catch {}
    setActionLoading(false);
  };

  const handleUnlink = async (invoiceId: number) => {
    setActionLoading(true);
    try {
      const res = await fetch(api(`invoices/${invoiceId}/unlink-order`), { method: "DELETE" });
      if (res.ok) await loadInvoices();
    } catch {}
    setActionLoading(false);
  };

  if (loading) {
    return (
      <div className="space-y-4 p-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (!order) {
    return (
      <div className="p-8 text-center">
        <p className="text-muted-foreground">找不到此訂單</p>
        <Button variant="outline" className="mt-4" onClick={() => navigate("/sales/orders")}>
          <ArrowLeft className="h-4 w-4 mr-1" />返回列表
        </Button>
      </div>
    );
  }

  const items = Array.isArray(order.items) ? order.items : [];
  const statusActions: Array<{ next: string; label: string; danger?: boolean }> = (({
    Draft: [{ next: "Confirmed", label: "成立訂單" }, { next: "Cancelled", label: "取消訂單", danger: true }],
    Confirmed: [{ next: "To Deliver", label: "轉待出貨" }, { next: "Cancelled", label: "取消訂單", danger: true }],
    "To Deliver": [{ next: "Cancelled", label: "取消訂單", danger: true }],
  }) as Record<string, Array<{ next: string; label: string; danger?: boolean }>>)[order.status] || [];
  const changeStatus = async (next: string, override = false): Promise<void> => {
    if (next === "Cancelled" && !override && !window.confirm("確定取消這張銷貨單？已經入的帳會一起沖掉。")) return;
    setStatusBusy(true);
    try {
      const res = await fetch(api(`sales-orders/${order.id}`), {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: next, ...(override ? { overrideCreditLimit: true } : {}) }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        // 超過客戶信用額度：問一次要不要放行（後端只接受老闆或財務放行）
        if (body.code === "CREDIT_LIMIT" && !override && window.confirm(`${body.error}\n\n仍然要成立這張訂單嗎？（只有老闆或財務可以放行）`)) {
          return await changeStatus(next, true);
        }
        throw new Error(body.error || "更新失敗");
      }
      setOrder((prev: any) => ({ ...prev, status: body.status }));
      toast({ title: `已更新為「${statusMap[body.status] || body.status}」` });
    } catch (error: any) {
      toast({ title: "沒有成功", description: error?.message, variant: "destructive" });
    } finally { setStatusBusy(false); }
  };

  const isLegacy = order.orderSource === "ecount";
  // 明細有拆未稅與營業稅（從 Ecount 搬來的單）才多顯示那三欄
  const hasTaxSplit = Array.isArray(order.items) && order.items.some((i: any) => Number(i?.netAmount) || Number(i?.taxAmount));
  // 從清單按「編輯」過來（網址帶 ?edit=1）：直接打開編輯視窗
  if (!editOpenedFromUrl.current && new URLSearchParams(window.location.search).get("edit") === "1") {
    editOpenedFromUrl.current = true;
    setTimeout(() => openEditRef.current?.(), 0);
  }
  // 歷史單搬進來時還沒收的金額（之後在新系統收的錢，請看收款單與應收帳款）
  const legacyUnpaid = isLegacy && typeof order.extraFields?.legacyPaid === "number" ? Math.max(0, Math.round((Number(order.totalAmount) - Number(order.extraFields.legacyPaid)) * 100) / 100) : null;
  // 編輯用的是全系統共用的銷貨單表單；哪些欄位能改（草稿、已成立、歷史單）由表單自己照規則鎖
  const openEdit = (focus: "items" | null = null) => { setEditFocus(focus); setEditOpen(true); };
  openEditRef.current = () => openEdit();
  // 列印：版面用「系統管理 › 列印模板」裡銷貨單的預設版面
  const openPrint = async () => {
    let customer: any = null;
    try { const r = await fetch(`/erp-api/customers/${order.customerId}`); if (r.ok) customer = await r.json(); } catch {}
    const lines = (Array.isArray(order.items) ? order.items : []).map((it: any) => ({
      code: it.code || "", name: it.itemName || it.name || "", qty: Number(it.quantity) || 0, unit: it.unit || "",
      unitPrice: Number(it.rate ?? it.unitPrice) || 0, amount: Number(it.amount) || (Number(it.quantity) || 0) * (Number(it.rate ?? it.unitPrice) || 0), summary: it.summary || "",
    }));
    const grand = Number(order.totalAmount) || 0;
    const tax = lines.length ? (order.items as any[]).reduce((sum: number, it: any) => sum + (Number(it.taxAmount) || 0), 0) : 0;
    setPrintData({
      docNumber: order.orderNumber,
      title: order.label || "",
      customer: { name: order.customerName, taxId: order.invoiceTaxId || customer?.taxId, phone: customer?.phone || customer?.mobile, address: customer?.address || order.extraFields?.legacyAddress },
      company: { ...COMPANY_INFO, contact: handlerName || order.extraFields?.legacyStaff || COMPANY_INFO.contact },
      fields: {
        date: order.orderDate, handler: handlerName || order.extraFields?.legacyStaff, project: projName, deliveryDate: order.deliveryDate,
        courseStartDate: order.courseStartDate, courseEndDate: order.courseEndDate, caseTime: order.caseTime, coursePeriod: order.coursePeriod, teacher: teacherName || order.teacherCode,
      },
      items: lines,
      totals: { subtotal: Math.round((grand - tax) * 100) / 100, tax, grand, taxIncluded: true },
      terms: order.remarks || "",
      extraRows: templateFields
        .filter((fd: any) => !COLUMN_FIELDS.has(fd.name) && (order.extraFields?.[fd.name] || order.extraFields?.[fd.name] === 0))
        .map((fd: any) => ({ label: fd.label, value: String(order.extraFields[fd.name]) })),
    });
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => navigate("/sales/orders")}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div className="flex-1">
          <h1 className="text-2xl font-bold">銷貨單明細</h1>
          <p className="text-sm text-muted-foreground">{order.orderNumber}</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => openEdit()} data-testid="button-edit-order">
          <Pencil size={14} className="mr-1" />編輯
        </Button>
        {order.status === "Draft" && !isLegacy && (
          <Button variant="outline" size="sm" onClick={() => openEdit("items")} data-testid="button-edit-order-items">編輯品項</Button>
        )}
        <Button variant="outline" size="sm" onClick={openPrint} data-testid="button-print-order">
          <Printer size={14} className="mr-1" />列印
        </Button>
        <Button variant="outline" size="sm" onClick={() => setEmailOpen(true)} data-testid="button-email-order">
          <Mail size={14} className="mr-1" />寄送明細
        </Button>
        {statusActions.map(action => (
          <Button key={action.next} size="sm" variant={action.danger ? "ghost" : "default"} className={action.danger ? "text-red-600 dark:text-red-400" : undefined} disabled={statusBusy} onClick={() => changeStatus(action.next)} data-testid={`button-status-${action.next}`}>{action.label}</Button>
        ))}
        <Badge variant={order.status === "Completed" ? "default" : order.status === "Cancelled" ? "destructive" : "secondary"} className="text-sm px-3 py-1">
          {statusMap[order.status] || order.status}
        </Badge>
      </div>

      {isLegacy && (
        <div className="rounded-md border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
          這是從舊系統 Ecount 搬過來的歷史銷貨單{order.extraFields?.legacyDocNumber ? `（原單號 ${order.extraFields.legacyDocNumber}）` : ""}。可以補標題、專案、部門、備註與課程資訊；金額、品項、客戶不能改，因為帳已經入過了。
        </div>
      )}

      <Card>
        <CardContent className="grid grid-cols-2 gap-x-6 gap-y-4 pt-5 md:grid-cols-4">
          <div className="col-span-2 min-w-0">
            <p className="text-xs text-muted-foreground">標題</p>
            <p className="text-lg font-semibold break-words">{order.label || "（沒有標題）"}</p>
            <p className="mt-1 text-sm text-muted-foreground break-words">{order.customerName}・{order.orderDate}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">總額</p>
            <p className="text-lg font-semibold tabular-nums">NT$ {Number(order.totalAmount || 0).toLocaleString()}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">收款</p>
            {legacyUnpaid === null ? <p className="text-sm text-muted-foreground">到收款單查看</p> : legacyUnpaid > 0
              ? <p className="text-lg font-semibold tabular-nums text-amber-700">未收 NT$ {legacyUnpaid.toLocaleString()}</p>
              : <p className="text-lg font-semibold text-emerald-700">已收清</p>}
            {legacyUnpaid !== null && <p className="text-xs text-muted-foreground">搬進來時的狀況</p>}
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base flex items-center gap-2"><FileText className="h-4 w-4" />基本資料</CardTitle></CardHeader>
          <CardContent>
            <DetailList rows={[
              ["訂單編號", order.orderNumber],
              ["訂單日期", order.orderDate],
              ["客戶", order.customerName],
              ["客戶地址", order.extraFields?.legacyAddress && order.extraFields.legacyAddress !== order.caseTime ? order.extraFields.legacyAddress : null],
              ["承辦人", handlerName || order.extraFields?.legacyStaff],
              ["部門", deptName],
              ["專案", projName],
              ["發貨倉庫", order.warehouseCode],
              ["交易類型", order.transactionType],
              ["預計交貨日", order.deliveryDate],
              ["訂單模板", order.templateName],
              ["訂單來源", order.orderSource ? (SOURCE_LABELS[order.orderSource] || order.orderSource) : null],
            ]} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base flex items-center gap-2"><GraduationCap className="h-4 w-4" />課程資訊</CardTitle></CardHeader>
          <CardContent>
            <DetailList emptyText="這張單沒有填課程資訊" rows={[
              ["開課日期", order.courseStartDate],
              ["課程截止日", order.courseEndDate],
              ["上課週次", order.classWeeks ? `${order.classWeeks} 週` : null],
              ["上課時間", order.caseTime],
              ["課程期數", order.coursePeriod ? `${order.coursePeriod}${order.extraFields?.legacyCoursePeriodName ? `（${order.extraFields.legacyCoursePeriodName}）` : ""}` : null],
              ["老師", teacherName],
              ["講師費用／次", order.teacherFeePerSession ? `NT$ ${Number(order.teacherFeePerSession).toLocaleString()}` : null],
              ["老師酌收材料費", order.teacherMaterialFeeMethod],
              ["日期詳情", order.dateDetails],
            ]} />
          </CardContent>
        </Card>
      </div>

      {order.remarks && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base flex items-center gap-2"><Tag className="h-4 w-4" />備註</CardTitle></CardHeader>
          <CardContent><p className="whitespace-pre-wrap break-words text-sm">{order.remarks}</p></CardContent>
        </Card>
      )}
      {order.orderSource === "ecount" && <LegacyInvoices orderId={order.id} />}
      {order.orderSource === "ecount" && <RelatedLegacyOrders orderId={order.id} />}

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">訂單品項明細</CardTitle>
        </CardHeader>
        <CardContent className="p-0 overflow-x-auto">
          <div className="border rounded-lg overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/40">
                  <TableHead className="w-12">#</TableHead>
                  <TableHead>品項名稱</TableHead>
                  <TableHead className="text-right">數量</TableHead>
                  <TableHead className="text-right">單價{hasTaxSplit ? "（含稅）" : ""}</TableHead>
                  {hasTaxSplit && <TableHead className="text-right hidden md:table-cell">單價（未稅）</TableHead>}
                  {hasTaxSplit && <TableHead className="text-right hidden md:table-cell">稅前價格</TableHead>}
                  {hasTaxSplit && <TableHead className="text-right hidden md:table-cell">營業稅</TableHead>}
                  <TableHead className="text-right">{hasTaxSplit ? "合計" : "金額"}</TableHead>
                   <TableHead className="text-right">成本</TableHead>
                   <TableHead className="text-right">毛利</TableHead>
                   <TableHead className="text-right">毛利率</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.length > 0 ? items.map((item: any, idx: number) => (
                  <TableRow key={idx}>
                    <TableCell className="text-muted-foreground">{idx + 1}</TableCell>
                    <TableCell className="font-medium">
                      {item.itemName || item.name || "-"}
                      {(item.code || item.summary) && <div className="text-xs font-normal text-muted-foreground">{[item.code, item.summary].filter(Boolean).join("・")}</div>}
                    </TableCell>
                    <TableCell className="text-right">{Number(item.quantity || 0).toLocaleString()}</TableCell>
                    <TableCell className="text-right">${Number(item.rate || item.unitPrice || 0).toLocaleString()}</TableCell>
                    {hasTaxSplit && <TableCell className="text-right hidden md:table-cell">{item.untaxedRate ? `$${Number(item.untaxedRate).toLocaleString()}` : "—"}</TableCell>}
                    {hasTaxSplit && <TableCell className="text-right hidden md:table-cell">{item.netAmount ? `$${Number(item.netAmount).toLocaleString()}` : "—"}</TableCell>}
                    {hasTaxSplit && <TableCell className="text-right hidden md:table-cell">{item.taxAmount ? `$${Number(item.taxAmount).toLocaleString()}` : "—"}</TableCell>}
                    <TableCell className="text-right font-medium">${Number(item.amount || (item.quantity * (item.rate || item.unitPrice || 0)) || 0).toLocaleString()}</TableCell>
                     <TableCell className="text-right">${Number(item.cost || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}</TableCell>
                     <TableCell className={`text-right ${Number(item.grossProfit) < 0 ? "text-red-600" : "text-green-600"}`}>${Number(item.grossProfit || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}</TableCell>
                     <TableCell className="text-right">{Number(item.marginPct || 0).toFixed(1)}%</TableCell>
                  </TableRow>
                )) : (
                  <TableRow>
                    <TableCell colSpan={hasTaxSplit ? 11 : 8} className="text-center py-8 text-muted-foreground">無品項資料</TableCell>
                  </TableRow>
                )}
                {items.length > 0 && (
                  <TableRow className="bg-muted/20 font-bold">
                    <TableCell colSpan={4} className="text-right">合計</TableCell>
                    {hasTaxSplit && <TableCell className="hidden md:table-cell" />}
                    {hasTaxSplit && <TableCell className="text-right hidden md:table-cell">${items.reduce((s: number, i: any) => s + (Number(i.netAmount) || 0), 0).toLocaleString()}</TableCell>}
                    {hasTaxSplit && <TableCell className="text-right hidden md:table-cell">${items.reduce((s: number, i: any) => s + (Number(i.taxAmount) || 0), 0).toLocaleString()}</TableCell>}
                    <TableCell className="text-right">${Number(order.totalAmount || 0).toLocaleString()}</TableCell>
                    <TableCell className="text-right">${Number(order.marginTotals?.cost || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}</TableCell>
                    <TableCell className={Number(order.marginTotals?.grossProfit) < 0 ? "text-right text-red-600" : "text-right text-green-600"}>${Number(order.marginTotals?.grossProfit || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}</TableCell>
                    <TableCell className="text-right">{Number(order.marginTotals?.marginPct || 0).toFixed(1)}%</TableCell>
                  </TableRow>
                )}
                {items.length > 0 && (
                  <TableRow className="text-sm text-muted-foreground">
                    <TableCell colSpan={hasTaxSplit ? 11 : 8}>
                      成本 = 商品成本 ${Number(order.marginTotals?.itemCost || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })} + 講師與服務費 ${Number(order.marginTotals?.serviceCost || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}（{order.marginTotals?.serviceFeeCount || 0} 筆）
                      <a className="ml-3 text-primary underline" href={`/hr/service-fees?salesOrderId=${order.id}${order.projectId ? `&projectId=${order.projectId}` : ""}`}>登錄服務費</a>
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-6">
          <RelatedDocs type="sales_order" id={order.id} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4">
          <CardTitle className="text-lg flex items-center gap-2">
            <Receipt className="h-5 w-5" />
            關聯發票
          </CardTitle>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" disabled={actionLoading} onClick={async () => {
              setActionLoading(true);
              try {
                const res = await fetch(api(`delivery-notes/from-order/${order.id}`), { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
                const data = await res.json();
                if (res.ok) navigate("/sales/delivery-notes");
                else toast({ title: "建立出貨單失敗", description: data.error || undefined, variant: "destructive" });
              } finally { setActionLoading(false); }
            }}>
              <FileText className="h-4 w-4 mr-1" />建立出貨單
            </Button>
            <Button variant="outline" size="sm" onClick={handleOpenLinkDialog} disabled={actionLoading}>
              <Link2 className="h-4 w-4 mr-1" />綁定既有發票
            </Button>
            <Button size="sm" onClick={handleOpenInvoiceDialog} disabled={actionLoading || remainingInvoiceable <= 0}>
              <Plus className="h-4 w-4 mr-1" />開立新發票
            </Button>
          </div>
        </CardHeader>
        <CardContent className="px-4 pb-3">
          <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
            <span className="text-muted-foreground">已開 <span className="font-semibold text-foreground">{activeInvoices.length}</span> 張發票</span>
            <span className="text-muted-foreground">已開金額 <span className="font-semibold text-foreground">${alreadyInvoiced.toLocaleString()}</span></span>
            <span className="text-muted-foreground">剩餘可開 <span className={`font-semibold ${remainingInvoiceable > 0 ? "text-blue-600" : "text-green-600"}`}>${remainingInvoiceable.toLocaleString()}</span>{remainingInvoiceable <= 0 && invoices.length > 0 && "（已全額開立）"}</span>
          </div>
        </CardContent>
        <CardContent className="p-0 overflow-x-auto">
          <div className="border rounded-lg overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/40">
                  <TableHead>發票號碼</TableHead>
                  <TableHead>開票日期</TableHead>
                  <TableHead>狀態</TableHead>
                  <TableHead className="text-right">金額</TableHead>
                  <TableHead className="text-right">已付金額</TableHead>
                  <TableHead className="text-right">未付金額</TableHead>
                  <TableHead className="w-20">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {invoices.length > 0 ? invoices.map((inv: any) => (
                  <TableRow key={inv.id}>
                    <TableCell className="font-medium text-blue-600">{inv.invoiceNumber}</TableCell>
                    <TableCell>{inv.invoiceDate}</TableCell>
                    <TableCell>
                      <Badge variant={inv.status === "Paid" ? "default" : inv.status === "Cancelled" ? "destructive" : "secondary"}>
                        {invStatusMap[inv.status] || inv.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">${Number(inv.totalAmount).toLocaleString()}</TableCell>
                    <TableCell className="text-right">${Number(inv.paidAmount).toLocaleString()}</TableCell>
                    <TableCell className="text-right">${Number(inv.outstandingAmount).toLocaleString()}</TableCell>
                    <TableCell>
                      <Button variant="ghost" size="icon" title="解除綁定" onClick={() => handleUnlink(inv.id)} disabled={actionLoading}>
                        <Unlink className="h-4 w-4 text-red-500" />
                      </Button>
                    </TableCell>
                  </TableRow>
                )) : (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">尚未關聯任何發票</TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <Dialog open={invoiceDialogOpen} onOpenChange={setInvoiceDialogOpen}>
        <DialogContent className="md:max-w-2xl">
          <DialogHeader>
            <DialogTitle>本次開票內容</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm bg-muted/40 rounded-lg px-3 py-2">
              <span className="text-muted-foreground">訂單總額 <span className="font-semibold text-foreground">${Number(order.totalAmount || 0).toLocaleString()}</span></span>
              <span className="text-muted-foreground">已開金額 <span className="font-semibold text-foreground">${alreadyInvoiced.toLocaleString()}</span></span>
              <span className="text-muted-foreground">剩餘可開 <span className="font-semibold text-blue-600">${remainingInvoiceable.toLocaleString()}</span></span>
            </div>
            <div className="space-y-2">
              <div className="grid grid-cols-[1fr_80px_110px_100px_36px] gap-2 text-xs text-muted-foreground px-1">
                <span>品項名稱</span><span className="text-right">數量</span><span className="text-right">單價</span><span className="text-right">金額</span><span></span>
              </div>
              {invoiceItems.map((it, idx) => {
                const amt = Number(it.quantity) * Number(it.rate);
                return (
                  <div key={idx} className="grid grid-cols-[1fr_80px_110px_100px_36px] gap-2 items-center">
                    <Input value={it.itemName} placeholder="品項名稱" onChange={(e) => setInvoiceItems(rows => rows.map((r, i) => i === idx ? { ...r, itemName: e.target.value } : r))} />
                    <Input className="text-right" inputMode="decimal" value={it.quantity} onChange={(e) => setInvoiceItems(rows => rows.map((r, i) => i === idx ? { ...r, quantity: e.target.value } : r))} />
                    <Input className="text-right" inputMode="decimal" value={it.rate} onChange={(e) => setInvoiceItems(rows => rows.map((r, i) => i === idx ? { ...r, rate: e.target.value } : r))} />
                    <span className="text-right text-sm font-medium">${(Number.isFinite(amt) ? amt : 0).toLocaleString()}</span>
                    <Button variant="ghost" size="icon" className="h-8 w-8" disabled={invoiceItems.length <= 1} onClick={() => setInvoiceItems(rows => rows.filter((_, i) => i !== idx))}>
                      <Trash2 className="h-4 w-4 text-red-500" />
                    </Button>
                  </div>
                );
              })}
              <Button variant="outline" size="sm" onClick={() => setInvoiceItems(rows => [...rows, { itemName: "", quantity: "1", rate: "" }])}>
                <Plus className="h-4 w-4 mr-1" />新增品項
              </Button>
            </div>
            <div className="flex justify-end items-center gap-3 border-t pt-3">
              <span className="text-sm text-muted-foreground">本次開票金額</span>
              <span className={`text-lg font-bold ${invoiceTotal > remainingInvoiceable ? "text-red-600" : ""}`}>${invoiceTotal.toLocaleString()}</span>
            </div>
            {invoiceTotal > remainingInvoiceable && (
              <p className="text-sm text-red-600">超過剩餘可開金額 ${remainingInvoiceable.toLocaleString()}，請調整品項金額</p>
            )}
            {invoiceError && <p className="text-sm text-red-600">{invoiceError}</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setInvoiceDialogOpen(false)}>取消</Button>
            <Button onClick={handleCreateInvoice} disabled={actionLoading || invoiceTotal <= 0 || invoiceTotal > remainingInvoiceable || invoiceItems.some(it => !it.itemName.trim())}>
              確認開立
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={linkDialogOpen} onOpenChange={setLinkDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>綁定既有發票</DialogTitle>
          </DialogHeader>
          <div className="py-4">
            <p className="text-sm text-muted-foreground mb-3">
              選擇尚未綁定銷貨單的發票（僅顯示同一客戶的發票）
            </p>
            {unlinkedInvoices.length > 0 ? (
              <LookupSelect value={selectedInvoiceId} onValueChange={setSelectedInvoiceId}>
                <SelectTrigger>
                  <SelectValue placeholder="選擇發票..." />
                </SelectTrigger>
                <SelectContent>
                  {unlinkedInvoices.map((inv: any) => (
                    <SelectItem key={inv.id} value={String(inv.id)}>
                      {inv.invoiceNumber} — ${Number(inv.totalAmount).toLocaleString()} ({inv.invoiceDate})
                    </SelectItem>
                  ))}
                </SelectContent>
              </LookupSelect>
            ) : (
              <p className="text-sm text-muted-foreground text-center py-4">
                沒有可綁定的發票（該客戶的所有發票都已綁定銷貨單）
              </p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setLinkDialogOpen(false)}>取消</Button>
            <Button onClick={handleLinkInvoice} disabled={!selectedInvoiceId || actionLoading}>確認綁定</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {templateFields.some((fd: any) => !COLUMN_FIELDS.has(fd.name) && (order.extraFields?.[fd.name] || order.extraFields?.[fd.name] === 0)) && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <Layers className="h-5 w-5" />模板自訂欄位
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {templateFields.map((f: any) => {
                const val = order.extraFields[f.name];
                if (!val && val !== 0) return null;
                return (
                  <div key={f.name}>
                    <p className="text-sm text-muted-foreground">{f.label}</p>
                    <p className="font-semibold">{val}</p>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {registrants.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <Users className="h-5 w-5" />報名人員 ({registrants.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0 overflow-x-auto">
            <div className="border rounded-lg overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/40">
                    <TableHead className="w-12">#</TableHead>
                    <TableHead>姓名</TableHead>
                    <TableHead>聯絡方式</TableHead>
                    <TableHead>年齡</TableHead>
                    <TableHead>年級</TableHead>
                    <TableHead>備註</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {registrants.map((r: any, idx: number) => (
                    <TableRow key={r.id}>
                      <TableCell className="text-muted-foreground">{idx + 1}</TableCell>
                      <TableCell className="font-medium">{r.name}</TableCell>
                      <TableCell>{r.contactInfo || "-"}</TableCell>
                      <TableCell>{r.age || "-"}</TableCell>
                      <TableCell>{r.grade || "-"}</TableCell>
                      <TableCell>{r.notes || "-"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}
      {/* 編輯：跟銷貨單清單的新增、編輯是同一個視窗 */}
      <SalesOrderFormDialog open={editOpen} onOpenChange={setEditOpen} order={order} focus={editFocus} onSaved={() => setEditReload(k => k + 1)} />

      <DocumentPrintDialog open={!!printData} onClose={() => setPrintData(null)} docType="SalesOrder" data={printData} />
      <SendEmailDialog docType="sales_order" docId={order?.id ?? null} open={emailOpen} onOpenChange={setEmailOpen} />
    </div>
  );
}
