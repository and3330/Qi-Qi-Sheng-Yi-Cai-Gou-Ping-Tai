import { useState, useMemo, useRef, useEffect } from "react";
import { ChangeRequestDialog } from "@/components/accounting/change-request-dialog";
import { useListVouchers, useCreateVoucher, useDeleteVoucher, useListProjects, useListDepartments, useListCustomers, useListEmployees } from "@workspace/erp-api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { PageHeader } from "@/components/shared/page-header";
import { PageHint } from "@/components/page-hint";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DocWindow, DocStatus, DocFields, DocLines, DocNote, DocSection, statusTone } from "@/components/shared/doc-window";
import { RelatedDocs } from "@/components/shared/related-docs";
import { useToast } from "@/hooks/use-toast";
import { Plus, Trash2, Search, Camera, Loader2, Sparkles, X, Ban, History, Pencil } from "lucide-react";
import { VoucherHistoryDialog } from "@/components/accounting/voucher-history-dialog";
import { useBatchSelection } from "@/hooks/use-batch-selection";
import { BatchActionBar } from "@/components/shared/batch-action-bar";
import { CheckboxCell, CheckboxHeader } from "@/components/shared/checkbox-column";
import { TablePagination } from "@/components/shared/table-pagination";
import { Link } from "wouter";

import { LookupSelect } from "@/components/shared/lookup-select";
import { CashAccountSelect, LedgerAccountSelect } from "@/components/shared/ledger-account-select";
import { DateRangePresets } from "@/components/shared/date-range-presets";
import { PaymentRequestForm } from "@/components/accounting/payment-request-doc";
const statusColor: Record<string, string> = {
  "Draft": "bg-gray-100 text-gray-700",
  "Submitted": "bg-blue-100 text-blue-700",
  "Approved": "bg-green-100 text-green-700",
  "Rejected": "bg-red-100 text-red-700",
  "Posted": "bg-emerald-100 text-emerald-700",
  "Cancelled": "bg-red-100 text-red-700",
  "已過帳": "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300",
};

const statusLabel: Record<string, string> = {
  "Draft": "草稿",
  "Submitted": "已送出",
  "Approved": "已核准",
  "Rejected": "已駁回",
  "Posted": "已過帳",
  "Cancelled": "已取消",
};

interface VoucherListProps {
  voucherType: string;
  title: string;
  description: string;
}

export default function VoucherList({ voucherType, title, description }: VoucherListProps) {
  const { data: vouchers, isLoading, refetch } = useListVouchers({ voucherType });
  const { data: projects } = useListProjects();
  const { data: departments } = useListDepartments();
  const { data: customers } = useListCustomers();
  const { data: employees } = useListEmployees();
  const queryClient = useQueryClient();
  const createVoucher = useCreateVoucher();
  const deleteVoucher = useDeleteVoucher();
  const { toast } = useToast();
  const [showCreate, setShowCreate] = useState(false);
  // 員工請款：手動填的請款跟「我的申請」是同一件事，用同一張付款申請表單（送審批 → 核准 → 付款才入帳）
  const [showRequest, setShowRequest] = useState(false);
  // 收款單、付款單：可以一行一行加的叫「摘要」（會變成日記帳的摘要），表頭那一格叫「備註」；「H」看這張單的操作紀錄
  const isCashSlip = voucherType === "收款單" || voucherType === "付款單";
  const [historyFor, setHistoryFor] = useState<{ id: number; number: string } | null>(null);
  const [deleteFor, setDeleteFor] = useState<any | null>(null);
  // 修改：備註、專案、部門；已入帳的送審（金額、日期、科目要改請刪除後重開）
  const [editFor, setEditFor] = useState<any | null>(null);
  const [editForm, setEditForm] = useState({ description: "", projectId: "", departmentId: "", reason: "" });
  const [editSaving, setEditSaving] = useState(false);
  const openVoucherEdit = (v: any) => { setEditFor(v); setEditForm({ description: v.description || "", projectId: v.projectId ? String(v.projectId) : "", departmentId: v.departmentId ? String(v.departmentId) : "", reason: "" }); };
  const submitVoucherEdit = async () => {
    if (!editFor) return;
    setEditSaving(true);
    try {
      const r = await fetch(`/erp-api/vouchers/${editFor.id}/edit-request`, { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify(editForm) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || "送出失敗");
      toast(j.applied ? { title: `已直接執行（${j.requestNumber}）`, description: "公司裡沒有其他可以審核的人，系統已直接執行並留下紀錄" } : { title: `修改申請 ${j.requestNumber} 已送出`, description: "財務或超級管理員核准後才會改，可以到審批中心看進度" });
      setEditFor(null);
    } catch (e: any) { toast({ title: "送出失敗", description: e.message, variant: "destructive" }); }
    finally { setEditSaving(false); }
  };
  // 從日記帳「開啟原單」連過來會帶 ?search=單號：直接找那張，日期不限
  const linkedSearch = useMemo(() => new URLSearchParams(window.location.search).get("search") ?? "", []);
  const [search, setSearch] = useState(linkedSearch);

  const defaultRange = useMemo(() => {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, "0");
    return { from: `${y}-${m}-01`, to: `${y}-${m}-${new Date(y, now.getMonth() + 1, 0).getDate()}` };
  }, []);
  const [dateFrom, setDateFrom] = useState(linkedSearch ? "" : defaultRange.from);
  const [dateTo, setDateTo] = useState(linkedSearch ? "" : defaultRange.to);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  // 錢進出哪個帳戶（收款單、付款單）；請款單記到哪個費用科目
  const [cashAccountId, setCashAccountId] = useState("");
  const [expenseAccountId, setExpenseAccountId] = useState("");
  const needsCashAccount = voucherType === "收款單" || voucherType === "付款單";
  // 外幣發票：收付當天的匯率（發票編號 → 匯率），和發票匯率的差額會記成兌換損益
  const [paymentRates, setPaymentRates] = useState<Record<number, string>>({});
  // 實際進出的台幣（外幣貨款換匯去付，和帳上金額不同）：差額記兌換損益
  const [actualCash, setActualCash] = useState("");
  const [form, setForm] = useState({
    voucherDate: new Date().toISOString().split("T")[0],
    description: "",
    projectId: "",
    departmentId: "",
    customerId: "",
    supplierId: "",
    employeeId: "",
    items: [{ description: "", amount: 0, invoiceId: 0 }] as Array<{ description: string; amount: number; invoiceId?: number; orderId?: number }>,
  });
  const [openInvoices, setOpenInvoices] = useState<any[]>([]);
  // 還沒收（付）完的訂單：可直接核對訂單，用於還沒開發票就先收、先付的訂金
  const [openOrders, setOpenOrders] = useState<any[]>([]);
  const [loadingInvoices, setLoadingInvoices] = useState(false);

  // 收款單：選了客戶後抓未結銷貨發票；付款單：選了供應商後抓未結採購發票
  const fetchOpenInvoices = async (partyId: string) => {
    if (!partyId || (voucherType !== "收款單" && voucherType !== "付款單")) { setOpenInvoices([]); setOpenOrders([]); return; }
    const orderUrl = voucherType === "收款單" ? `/erp-api/sales-orders?customerId=${partyId}` : `/erp-api/purchase-orders?supplierId=${partyId}`;
    fetch(orderUrl)
      .then(r => (r.ok ? r.json() : []))
      .then((rows: any[]) => setOpenOrders((Array.isArray(rows) ? rows : []).filter(o => o.status !== "Draft" && o.status !== "Cancelled" && Number(o.outstandingAmount) > 0)))
      .catch(() => setOpenOrders([]));
    setLoadingInvoices(true);
    try {
      const url = voucherType === "收款單" ? `/erp-api/customers/${partyId}/open-invoices` : `/erp-api/suppliers/${partyId}/open-invoices`;
      const r = await fetch(url);
      if (r.ok) setOpenInvoices(await r.json()); else setOpenInvoices([]);
    } catch { setOpenInvoices([]); }
    finally { setLoadingInvoices(false); }
  };

  const toggleInvoiceSettle = (inv: any, checked: boolean) => {
    setForm(f => {
      const others = f.items.filter(it => Number(it.invoiceId || 0) !== inv.id);
      if (checked) {
        const desc = `沖銷發票 ${inv.invoiceNumber}`;
        return { ...f, items: [...others.filter(it => it.description || it.amount), { description: desc, amount: inv.outstandingAmount, invoiceId: inv.id }] };
      }
      return { ...f, items: others.length > 0 ? others : [{ description: "", amount: 0, invoiceId: 0 }] };
    });
  };

  const toggleOrderSettle = (order: any, checked: boolean) => {
    setForm(f => {
      const others = f.items.filter(it => Number(it.orderId || 0) !== order.id);
      if (checked) {
        const desc = `${voucherType === "收款單" ? "銷貨單" : "採購單"} ${order.orderNumber} ${voucherType === "收款單" ? "收款" : "付款"}`;
        return { ...f, items: [...others.filter(it => it.description || it.amount), { description: desc, amount: Number(order.outstandingAmount), orderId: order.id }] };
      }
      return { ...f, items: others.length > 0 ? others : [{ description: "", amount: 0, invoiceId: 0 }] };
    });
  };
  const updateOrderAmount = (orderId: number, amount: number) => {
    setForm(f => ({ ...f, items: f.items.map(it => Number(it.orderId || 0) === orderId ? { ...it, amount } : it) }));
  };

  const updateSettleAmount = (invoiceId: number, amount: number) => {
    setForm(f => ({ ...f, items: f.items.map(it => Number(it.invoiceId || 0) === invoiceId ? { ...it, amount } : it) }));
  };
  const [aiCategory, setAiCategory] = useState<{ code: string; name: string; group: string; accountNumber: string; accountName: string } | null>(null);
  const [aiInfo, setAiInfo] = useState<{ merchant?: string; invoiceNumber?: string; taxId?: string; tax?: number; reason?: string; confidence?: number } | null>(null);
  const [pendingAttachmentIds, setPendingAttachmentIds] = useState<number[]>([]);
  const [aiCategories, setAiCategories] = useState<Array<{ code: string; name: string; group: string; accountNumber: string; accountName: string }>>([]);
  const [suppliers, setSuppliers] = useState<any[]>([]);
  const [supplierId, setSupplierId] = useState("");
  const [confirmingAi, setConfirmingAi] = useState(false);
  const [lastAiCreated, setLastAiCreated] = useState<{
    voucherId: number; voucherNumber: string; journalEntryId: number; entryNumber: string;
    invoiceId: number; invoiceNumber: string; paymentRequestId: number; requestNumber: string;
  } | null>(null);
  const [scanning, setScanning] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (voucherType !== "請款單" && voucherType !== "付款單") return;
    if (voucherType === "請款單") {
      fetch(`/erp-api/reimbursement/categories`)
        .then(r => r.ok ? r.json() : Promise.reject(new Error("分類載入失敗")))
        .then(setAiCategories)
        .catch(() => setAiCategories([]));
    }
    fetch(`/erp-api/suppliers`)
      .then(r => r.ok ? r.json() : Promise.reject(new Error("供應商載入失敗")))
      .then(setSuppliers)
      .catch(() => setSuppliers([]));
  }, [voucherType]);

  const resetForm = () => {
    setForm({ voucherDate: new Date().toISOString().split("T")[0], description: "", projectId: "", departmentId: "", customerId: "", supplierId: "", employeeId: "", items: [{ description: "", amount: 0, invoiceId: 0 }] });
    setAiCategory(null);
    setAiInfo(null);
    setPendingAttachmentIds([]);
    setSupplierId("");
    setOpenInvoices([]);
    setActualCash("");
  };

  const handleAiScan = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setScanning(true);
    try {
      const fd = new FormData();
      Array.from(files).forEach(f => fd.append("files", f));
      const resp = await fetch(`/erp-api/reimbursement/scan`, { method: "POST", body: fd });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        throw new Error(err.error || `HTTP ${resp.status}`);
      }
      const data = await resp.json();
      const p = data.parsed || {};
      const cat = data.category;

      const items = (p.items && p.items.length > 0)
        ? p.items.map((it: any) => ({ description: String(it.description || ""), amount: Number(it.amount || 0) }))
        : [{ description: p.merchant || "", amount: Number(p.total_amount || 0) }];

      const datePart = p.date && /^\d{4}-\d{2}-\d{2}$/.test(p.date) ? p.date : form.voucherDate;
      const desc = [p.merchant, p.invoice_number].filter(Boolean).join(" / ");

      setForm(f => ({
        ...f,
        voucherDate: datePart,
        description: desc || f.description,
        items,
      }));
      setAiCategory(cat);
      setAiInfo({
        merchant: p.merchant,
        invoiceNumber: p.invoice_number,
        taxId: p.tax_id,
        tax: p.tax_amount,
        reason: p.category_reason,
        confidence: p.confidence,
      });
      const normalize = (value: unknown) => String(value || "").replace(/[\s()（）股份有限公司企業社]/g, "").toLowerCase();
      const taxId = String(p.tax_id || "").trim();
      const merchant = normalize(p.merchant);
      const matchedSupplier = suppliers.find((s: any) =>
        (taxId && String(s.taxId || "").trim() === taxId) ||
        (merchant && (normalize(s.name).includes(merchant) || merchant.includes(normalize(s.name))))
      );
      setSupplierId(matchedSupplier ? String(matchedSupplier.id) : "");
      const attIds = (data.attachments || []).filter((a: any) => a && a.id).map((a: any) => a.id);
      setPendingAttachmentIds(prev => [...prev, ...attIds]);
      toast({ title: "AI 識別完成", description: `已分類為 ${cat.code} ${cat.name}（${cat.accountNumber} ${cat.accountName}）` });
    } catch (err: any) {
      toast({ title: "AI 識別失敗", description: err?.message || "請重試", variant: "destructive" });
    } finally {
      setScanning(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const addItem = () => setForm(f => ({ ...f, items: [...f.items, { description: "", amount: 0 }] }));
  const removeItem = (i: number) => setForm(f => ({ ...f, items: f.items.filter((_, idx) => idx !== i) }));
  const updateItem = (i: number, field: string, val: any) => {
    setForm(f => ({
      ...f,
      items: f.items.map((item, idx) => idx === i ? { ...item, [field]: val } : item),
    }));
  };

  const handleCreate = async () => {
    if (!form.projectId) {
      toast({ title: "請選擇專案", description: "每一筆收入與支出都必須歸屬到專案", variant: "destructive" });
      return;
    }
    if (needsCashAccount && !cashAccountId) {
      toast({ title: `請選擇${voucherType === "收款單" ? "收款" : "付款"}帳戶`, description: "要知道錢進出哪個帳戶，銀行存款的帳才會對", variant: "destructive" });
      return;
    }
    // 請款單不再手動直接入帳：沒有掃描憑證的請款，請用「新增請款（送審批）」，才會有人審、有人付
    if (voucherType === "請款單" && !aiCategory) {
      toast({ title: "請先掃描發票或收據", description: "沒有憑證要掃的請款，請關掉這個視窗，改按「新增請款（送審批）」", variant: "destructive" });
      return;
    }
    try {
      const items = form.items.filter(it => it.description && it.amount > 0).map(it => ({
        description: it.description,
        amount: it.amount,
        ...(it.invoiceId && Number(it.invoiceId) > 0 ? { invoiceId: Number(it.invoiceId) } : {}),
        ...(it.invoiceId && Number(paymentRates[Number(it.invoiceId)]) > 0 ? { exchangeRate: Number(paymentRates[Number(it.invoiceId)]) } : {}),
        ...(it.orderId && Number(it.orderId) > 0 ? (voucherType === "收款單" ? { salesOrderId: Number(it.orderId) } : { purchaseOrderId: Number(it.orderId) }) : {}),
        ...(aiCategory ? { categoryCode: aiCategory.code, accountNumber: aiCategory.accountNumber } : {}),
      }));
      if (voucherType === "請款單" && aiCategory) {
        setConfirmingAi(true);
        const response = await fetch(`/erp-api/reimbursement/confirm`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            date: form.voucherDate,
            description: form.description,
            merchant: aiInfo?.merchant,
            invoiceNumber: aiInfo?.invoiceNumber,
            taxId: aiInfo?.taxId,
            totalAmount: items.reduce((sum, it) => sum + it.amount, 0),
            taxAmount: aiInfo?.tax || 0,
            categoryCode: aiCategory.code,
            projectId: form.projectId ? Number(form.projectId) : null,
            departmentId: form.departmentId ? Number(form.departmentId) : null,
            employeeId: form.employeeId ? Number(form.employeeId) : null,
            supplierId: supplierId ? Number(supplierId) : null,
            attachmentIds: pendingAttachmentIds,
            items,
          }),
        });
        const json = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(json.error || `HTTP ${response.status}`);
        setLastAiCreated({
          voucherId: json.voucher.id,
          voucherNumber: json.voucher.voucherNumber,
          journalEntryId: json.journalEntry.id,
          entryNumber: json.journalEntry.entryNumber,
          invoiceId: json.invoice.id,
          invoiceNumber: json.invoice.invoiceNumber,
          paymentRequestId: json.paymentRequest.id,
          requestNumber: json.paymentRequest.requestNumber,
        });
        toast({ title: "憑證已確認入帳", description: `${json.voucher.voucherNumber} / ${json.journalEntry.entryNumber}` });
        setShowCreate(false);
        resetForm();
        refetch();
        return;
      }
      const created = await createVoucher.mutateAsync({
        data: {
          voucherType,
          voucherDate: form.voucherDate,
          description: form.description || undefined,
          projectId: form.projectId ? Number(form.projectId) : undefined,
          departmentId: form.departmentId ? Number(form.departmentId) : undefined,
          customerId: form.customerId ? Number(form.customerId) : undefined,
          supplierId: form.supplierId ? Number(form.supplierId) : undefined,
          employeeId: form.employeeId ? Number(form.employeeId) : undefined,
          items,
          ...(needsCashAccount && cashAccountId ? { cashAccountId: Number(cashAccountId) } : {}),
          ...(needsCashAccount && Number(actualCash) > 0 && items.some(it => "invoiceId" in it || "salesOrderId" in it || "purchaseOrderId" in it) ? { actualCashAmount: Number(actualCash) } : {}),
          ...(voucherType === "請款單" && expenseAccountId ? { expenseAccountId: Number(expenseAccountId) } : {}),
        } as any,
      });

      // 把先前 AI scan 上傳但 documentId=0 的附件，串到剛建立的請款單
      const createdId = (created as any)?.id as number | undefined;
      const createdNumber = (created as any)?.voucherNumber as string | undefined;
      if (pendingAttachmentIds.length > 0 && createdId) {
        await Promise.all(pendingAttachmentIds.map(aid =>
          fetch(`/erp-api/attachments/${aid}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              documentType: voucherType,
              documentId: createdId,
              description: `${aiInfo?.merchant ?? ""} / 請款單 ${createdNumber ?? createdId}`,
            }),
          }).catch(() => null)
        ));
      }

      toast({ title: `${title}已建立` });
      setShowCreate(false);
      resetForm();
      refetch();
    } catch (err: any) {
      toast({ title: "建立失敗", description: err?.message, variant: "destructive" });
    } finally { setConfirmingAi(false); }
  };

  // 已入帳的傳票不能刪除，只能作廢：系統會開一張沖銷分錄，並取消對發票、訂單的沖帳
  const handleVoid = async (v: any) => {
    const reason = window.prompt(`確定作廢 ${v.voucherNumber}？\n系統會自動開沖銷分錄，原紀錄會保留。\n\n作廢原因（選填）：`, "");
    if (reason === null) return;
    try {
      const response = await fetch(`/erp-api/vouchers/${v.id}/void`, {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason }),
      });
      if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error || "作廢失敗");
      toast({ title: "已作廢", description: `${v.voucherNumber} 已作廢並開立沖銷分錄` });
      refetch();
    } catch (err: any) {
      toast({ title: "作廢失敗", description: err.message, variant: "destructive" });
    }
  };

  const totalAmount = form.items.reduce((sum, it) => sum + (it.amount || 0), 0);

  // 申請修改視窗上半部顯示這張單現在的內容：明細只列看得懂的行（Ecount 搬來的歷史單沒有明細）
  const editLines: Array<{ description: string; amount: number }> = editFor && editFor.legacy !== true && Array.isArray(editFor.items)
    ? (editFor.items as any[]).filter(it => it && typeof it.description === "string" && Number(it.amount) > 0).map(it => ({ description: it.description, amount: Number(it.amount) }))
    : [];
  const partyLabel = voucherType === "請款單" ? "請款人" : voucherType === "付款單" ? "供應商" : "客戶";
  // 狀態徽章顏色照共用規則；這裡的狀態有中文的（已過帳、已作廢），另外對應
  const voucherTone = (s: string) => s === "已作廢" ? "destructive" as const : s === "已過帳" ? "default" as const : statusTone(s);

  const filtered = useMemo(() => {
    return (vouchers || []).filter((v: any) => {
      if (dateFrom && v.voucherDate < dateFrom) return false;
      if (dateTo && v.voucherDate > dateTo) return false;
      if (search) {
        const q = search.toLowerCase();
        if (!(v.voucherNumber.toLowerCase().includes(q) ||
          (v.description || "").toLowerCase().includes(q) ||
          (v.projectName || "").toLowerCase().includes(q) ||
          (v.departmentName || "").toLowerCase().includes(q))) return false;
      }
      return true;
    });
  }, [vouchers, dateFrom, dateTo, search]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  useEffect(() => { if (page > totalPages) setPage(totalPages); }, [page, totalPages]);
  const paged = useMemo(() => filtered.slice((page - 1) * pageSize, page * pageSize), [filtered, page, pageSize]);

  const batch = useBatchSelection(paged);

  return (
    <div className="space-y-6">
      <PageHeader
        title={title}
        description={description}
        hint={voucherType === "請款單" ? <PageHint hintKey="reimbursement-scan">這裡處理員工代墊費用。一般的請款按「新增請款（送審批）」，跟「我的申請」是同一張表單，核准、付款後才入帳。手上有發票或收據要直接入帳的，按「掃描憑證入帳」：上傳憑證 → 核對辨識結果與費用分類 → 補上專案或部門 → 確認入帳。小提醒：掃描結果可能有誤，發票號碼、金額與稅額一定要對照原始憑證。</PageHint> : undefined}
      >
        {voucherType === "請款單" ? (
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => setShowRequest(true)} size="sm" data-testid="button-new-reimbursement-request"><Plus className="h-4 w-4 mr-1" />新增請款（送審批）</Button>
            <Button onClick={() => setShowCreate(true)} size="sm" variant="outline">掃描憑證入帳</Button>
          </div>
        ) : (
          <Button onClick={() => setShowCreate(true)} size="sm"><Plus className="h-4 w-4 mr-1" />新增{title}</Button>
        )}
      </PageHeader>
      {voucherType === "請款單" && <PaymentRequestForm open={showRequest} onOpenChange={setShowRequest} />}
      {lastAiCreated && (
        <Card className="border-green-300 bg-green-50/40">
          <CardContent className="py-3 text-sm">
            憑證已入帳：<Link href="/accounting/reimbursement" className="text-primary font-medium hover:underline">{lastAiCreated.voucherNumber}</Link>
            <span className="mx-2">／</span>
            <Link href="/accounting/journal" className="text-primary font-medium hover:underline">{lastAiCreated.entryNumber}</Link>
            <span className="mx-2">／</span>
            <Link href="/accounting/invoices" className="text-primary font-medium hover:underline">{lastAiCreated.invoiceNumber}</Link>
            <span className="mx-2">／</span>
            <Link href="/accounting/payment-requests" className="text-primary font-medium hover:underline">{lastAiCreated.requestNumber}</Link>
          </CardContent>
        </Card>
      )}

      {batch.count > 0 && (
        <BatchActionBar
          count={batch.count}
          entityName={title}
          entityEndpoint="vouchers"
          ids={batch.ids}
          onClear={batch.clearSelection}
          onComplete={() => queryClient.invalidateQueries({ queryKey: ["/erp-api/vouchers"] })}
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
                <Input className="pl-9" placeholder="搜尋單號、說明、專案、部門..." value={search} onChange={e => setSearch(e.target.value)} />
              </div>
            </div>
            <div className="text-sm text-muted-foreground pb-2">共 {filtered.length} 筆</div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0 overflow-x-auto">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-gray-50/50">
                  <th className="w-10 px-2"><CheckboxHeader checked={batch.allSelected} indeterminate={batch.someSelected} onChange={batch.toggleAll} /></th>
                  <th className="text-left px-4 py-3 font-medium">單號</th>
                  <th className="text-left px-4 py-3 font-medium">日期</th>
                  <th className="text-left px-4 py-3 font-medium hidden sm:table-cell">{isCashSlip ? "備註" : "說明"}</th>
                  <th className="text-left px-4 py-3 font-medium hidden md:table-cell">專案</th>
                  <th className="text-left px-4 py-3 font-medium hidden md:table-cell">部門</th>
                  <th className="text-left px-4 py-3 font-medium hidden lg:table-cell">{voucherType === "請款單" ? "請款人" : voucherType === "付款單" ? "供應商" : "客戶"}</th>
                  {needsCashAccount && <th className="text-left px-4 py-3 font-medium hidden lg:table-cell">{voucherType === "收款單" ? "收款帳戶" : "付款帳戶"}</th>}
                  <th className="text-right px-4 py-3 font-medium">金額</th>
                  <th className="text-center px-4 py-3 font-medium">狀態</th>
                  <th className="text-center px-4 py-3 font-medium w-24">操作</th>
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  <tr><td colSpan={11} className="text-center py-8 text-gray-400">載入中...</td></tr>
                ) : !filtered?.length ? (
                  <tr><td colSpan={11} className="text-center py-8 text-gray-400">尚無資料</td></tr>
                ) : paged.map(v => (
                  <tr key={v.id} className="border-b hover:bg-gray-50 cursor-pointer" title="點一下看這張單的內容"
                    onClick={(e) => { if ((e.target as HTMLElement).closest("button,select,input,a,label")) return; openVoucherEdit(v); }}>
                    <td className="px-2"><CheckboxCell checked={batch.selectedIds.has(v.id)} onChange={() => batch.toggle(v.id)} /></td>
                    <td className="px-4 py-3 font-mono text-xs whitespace-nowrap">{v.voucherNumber}{(v as any).legacy === true && <span className="ml-1.5 inline-block rounded border px-1 font-sans text-[10px] font-normal text-muted-foreground align-middle" title="從舊系統 Ecount 搬過來的歷史紀錄，只能查看">歷史</span>}</td>
                    <td className="px-4 py-3">{v.voucherDate}</td>
                    <td className="px-4 py-3 hidden sm:table-cell max-w-[200px] truncate">{v.description || "-"}</td>
                    <td className="px-4 py-3 hidden md:table-cell">{v.projectName || "-"}</td>
                    <td className="px-4 py-3 hidden md:table-cell">{v.departmentName || "-"}</td>
                    <td className="px-4 py-3 hidden lg:table-cell">{v.employeeName || v.customerName || (v as any).supplierName || "-"}</td>
                    {needsCashAccount && <td className="px-4 py-3 hidden lg:table-cell">{(v as any).cashAccountName || "-"}</td>}
                    <td className="px-4 py-3 text-right font-mono">${Number(v.totalAmount).toLocaleString()}</td>
                    <td className="px-4 py-3 text-center">
                      <span className={`px-2 py-0.5 rounded-full text-xs ${v.status === "已作廢" ? "bg-gray-200 text-gray-600 line-through" : statusColor[v.status] || "bg-gray-100"}`}>{statusLabel[v.status] || v.status}</span>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <div className="flex gap-1 justify-center">
                        {isCashSlip && (
                          <Button variant="ghost" size="sm" onClick={() => setHistoryFor({ id: v.id, number: v.voucherNumber })} title="H：這張單的操作紀錄（誰、什麼時候新增、修改、作廢）" aria-label="操作紀錄" data-testid={`button-history-voucher-${v.id}`}>
                            <History className="h-4 w-4" />
                          </Button>
                        )}
                        {isCashSlip && (
                          <Button variant="ghost" size="sm" onClick={() => openVoucherEdit(v)} title="修改備註、專案、部門（已入帳的要送審）" aria-label="修改" data-testid={`button-edit-voucher-${v.id}`}>
                            <Pencil className="h-4 w-4" />
                          </Button>
                        )}
                        {isCashSlip && (
                          <Button variant="ghost" size="sm" onClick={() => setDeleteFor(v)} title="刪除：已入帳、已作廢或 Ecount 搬來的單要送審，核准後單據和分錄一起刪" aria-label="刪除" data-testid={`button-delete-voucher-${v.id}`}>
                            <Trash2 className="h-4 w-4 text-red-500" />
                          </Button>
                        )}
                        {v.status === "已作廢" || (v as any).legacy === true ? (
                          <span className="text-xs text-muted-foreground" title={(v as any).legacy === true ? "歷史紀錄只能查看" : undefined}>—</span>
                        ) : (
                          <Button variant="ghost" size="sm" onClick={() => handleVoid(v)} title="作廢" aria-label="作廢" data-testid={`button-void-voucher-${v.id}`}>
                            <Ban className="h-4 w-4 text-red-500" />
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <TablePagination
            total={filtered.length}
            page={page}
            pageSize={pageSize}
            onPageChange={setPage}
            onPageSizeChange={(n) => { setPageSize(n); setPage(1); }}
          />
        </CardContent>
      </Card>

      <VoucherHistoryDialog voucher={historyFor} onClose={() => setHistoryFor(null)} />

      <DocWindow
        open={!!editFor} onClose={() => setEditFor(null)}
        name={title} number={editFor?.voucherNumber}
        status={editFor ? <DocStatus label={statusLabel[editFor.status] || editFor.status} tone={voucherTone(editFor.status)} /> : undefined}
        footer={<>
          <Button variant="outline" onClick={() => setEditFor(null)}>關閉</Button>
          {isCashSlip && <Button disabled={editSaving || !editForm.reason.trim()} onClick={submitVoucherEdit} data-testid="button-submit-voucher-edit">送出修改申請</Button>}
        </>}
      >
        {editFor && (
          <>
            <DocFields items={[
              ["日期", editFor.voucherDate],
              ["金額", `$${Number(editFor.totalAmount).toLocaleString()}`],
              [partyLabel, editFor.employeeName || editFor.customerName || editFor.supplierName],
              needsCashAccount && [voucherType === "收款單" ? "收款帳戶" : "付款帳戶", editFor.cashAccountName],
              ["專案", editFor.projectName],
              ["部門", editFor.departmentName],
            ]} />
            {editLines.length > 0 && (
              <DocLines
                columns={[
                  { header: isCashSlip ? "摘要" : "項目", cell: (row: { description: string; amount: number }) => row.description },
                  { header: "金額", align: "right", cell: (row: { description: string; amount: number }) => `$${row.amount.toLocaleString()}` },
                ]}
                rows={editLines}
                total={{ value: `$${Number(editFor.totalAmount).toLocaleString()}` }}
              />
            )}
            <DocNote label={isCashSlip ? "備註" : "說明"}>{editFor.description}</DocNote>
            <RelatedDocs type="voucher" id={editFor.id} onNavigate={() => setEditFor(null)} />
          </>
        )}
        {/* 收款單、付款單可以申請修改；請款單只能看 */}
        {isCashSlip && (
        <DocSection title="申請修改">
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">可以改備註、專案、部門，要財務或超級管理員其一核准（財務提出的由超級管理員核准），審核人也可以直接調整。金額、日期、科目要改，請按刪除送審後重開一張。</p>
            <div><Label>備註</Label><Input value={editForm.description} onChange={e => setEditForm(p => ({ ...p, description: e.target.value }))} /></div>
            <div><Label>專案</Label>
              <select className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" value={editForm.projectId} onChange={e => setEditForm(p => ({ ...p, projectId: e.target.value }))}>
                <option value="">（不指定）</option>
                {projects?.filter((p: any) => p.isActive !== false || String(p.id) === editForm.projectId).map((p: any) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select></div>
            <div><Label>部門</Label>
              <select className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" value={editForm.departmentId} onChange={e => setEditForm(p => ({ ...p, departmentId: e.target.value }))}>
                <option value="">（不指定）</option>
                {departments?.filter((d: any) => d.isActive !== false || String(d.id) === editForm.departmentId).map((d: any) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select></div>
            <div><Label>原因 *</Label><Input value={editForm.reason} onChange={e => setEditForm(p => ({ ...p, reason: e.target.value }))} placeholder="例如：專案選錯" /></div>
          </div>
        </DocSection>
        )}
      </DocWindow>
      {deleteFor && (
        <ChangeRequestDialog open onClose={() => setDeleteFor(null)} title={`申請刪除 ${deleteFor.voucherNumber}`}
          endpoint={`/erp-api/vouchers/${deleteFor.id}/delete-request`}
          description={<>要刪除 <b>{deleteFor.voucherNumber}</b>（{deleteFor.voucherDate}，${Number(deleteFor.totalAmount).toLocaleString()}）。核准後這張單、它的分錄（含作廢沖回的那筆）和沖帳紀錄會一起刪除。{deleteFor.legacy === true && " 這張是從 Ecount 搬來的，刪除後會跟 Ecount 對不上，請確認。"}</>} />
      )}
      {/* 新增表單：外框和其他單據視窗一樣（標題列、內容、底部按鈕列），欄位照原樣 */}
      <DocWindow
        open={showCreate} onClose={() => { setShowCreate(false); resetForm(); }}
        name={`新增${title}`}
        footer={<>
          <Button variant="outline" onClick={() => setShowCreate(false)}>取消</Button>
          <Button onClick={handleCreate} disabled={createVoucher.isPending || confirmingAi || (!!aiCategory && voucherType === "請款單" && !supplierId)}>
            {createVoucher.isPending || confirmingAi ? "建立中..." : aiCategory && voucherType === "請款單" ? "確認入帳" : "建立"}
          </Button>
        </>}
      >
          <div className="grid gap-4">
            {voucherType === "請款單" && (
              <div className="rounded-lg border-2 border-dashed border-purple-200 bg-purple-50/50 p-4">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <Sparkles className="h-5 w-5 text-purple-600" />
                    <span className="font-medium text-purple-900">智慧報帳：拍照／上傳發票，AI 自動填單</span>
                  </div>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    multiple
                    capture="environment"
                    className="hidden"
                    onChange={e => handleAiScan(e.target.files)}
                  />
                  <Button type="button" size="sm" variant="default" disabled={scanning} onClick={() => fileInputRef.current?.click()}>
                    {scanning ? <><Loader2 className="h-4 w-4 mr-1 animate-spin" />識別中…</> : <><Camera className="h-4 w-4 mr-1" />拍照／上傳</>}
                  </Button>
                </div>
                {aiCategory && (
                  <div className="text-sm space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Badge className="bg-purple-100 text-purple-800 hover:bg-purple-100">分類 {aiCategory.code} {aiCategory.name}</Badge>
                      <Badge variant="outline">會計科目 {aiCategory.accountNumber} {aiCategory.accountName}</Badge>
                      {typeof aiInfo?.confidence === "number" && (
                        <Badge variant="outline">信心 {Math.round((aiInfo.confidence || 0) * 100)}%</Badge>
                      )}
                      {pendingAttachmentIds.length > 0 && (
                        <Badge variant="outline">已存 {pendingAttachmentIds.length} 張發票</Badge>
                      )}
                    </div>
                    {(aiInfo?.merchant || aiInfo?.invoiceNumber || aiInfo?.taxId) && (
                      <div className="text-xs text-muted-foreground">
                        {aiInfo?.merchant && <span className="mr-3">商家：{aiInfo.merchant}</span>}
                        {aiInfo?.invoiceNumber && <span className="mr-3">發票：{aiInfo.invoiceNumber}</span>}
                        {aiInfo?.taxId && <span className="mr-3">統編：{aiInfo.taxId}</span>}
                        {typeof aiInfo?.tax === "number" && aiInfo.tax > 0 && <span>稅額：${aiInfo.tax}</span>}
                      </div>
                    )}
                    {aiInfo?.reason && <div className="text-xs text-muted-foreground italic">AI 判斷：{aiInfo.reason}</div>}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-2">
                      <div>
                        <Label>費用類別</Label>
                        <LookupSelect className="w-full border rounded-md px-3 py-2 text-sm bg-background" value={aiCategory.code} onChange={e => {
                          const selected = aiCategories.find(c => c.code === e.target.value);
                          if (selected) setAiCategory(selected);
                        }}>
                          {aiCategories.map(c => <option key={c.code} value={c.code}>{c.code} {c.name}（{c.accountName}）</option>)}
                        </LookupSelect>
                      </div>
                      <div>
                        <Label>稅額</Label>
                        <Input type="number" min="0" value={aiInfo?.tax || ""} onChange={e => setAiInfo(info => ({ ...info, tax: Number(e.target.value) }))} />
                      </div>
                      <div className="col-span-2">
                        <Label>供應商（用於採購發票與付款申請）</Label>
                        <LookupSelect className="w-full border rounded-md px-3 py-2 text-sm bg-background" value={supplierId} onChange={e => setSupplierId(e.target.value)}>
                          <option value="">請選擇供應商</option>
                          {suppliers.map((s: any) => <option key={s.id} value={s.id}>{s.name}{s.taxId ? `（${s.taxId}）` : ""}</option>)}
                        </LookupSelect>
                      </div>
                    </div>
                    <div className="text-xs text-amber-700">以下欄位都可自由修改。AI 結果僅供參考。</div>
                  </div>
                )}
              </div>
            )}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <Label>日期</Label>
                <Input type="date" value={form.voucherDate} onChange={e => setForm(f => ({ ...f, voucherDate: e.target.value }))} />
              </div>
              <div>
                <Label>{isCashSlip ? "備註" : "說明"}</Label>
                <Input value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} placeholder={isCashSlip ? "整張單的備註（選填）" : "摘要說明"} />
              </div>
            </div>
            {needsCashAccount && (
              <div>
                <Label>{voucherType === "收款單" ? "收款帳戶" : "付款帳戶"} <span className="text-red-500">*</span></Label>
                <CashAccountSelect value={cashAccountId} onChange={setCashAccountId} />
                <p className="text-xs text-muted-foreground mt-1">錢實際{voucherType === "收款單" ? "進到" : "從"}哪個帳戶{voucherType === "收款單" ? "" : "出去"}（現金、零用金或哪一家銀行）</p>
              </div>
            )}
            {voucherType === "請款單" && !aiCategory && (
              <div>
                <Label>費用科目</Label>
                <LedgerAccountSelect value={expenseAccountId} onChange={setExpenseAccountId} types={["Expense"]} placeholder="未指定（記到其他管理費用）" />
              </div>
            )}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <Label>所屬專案 <span className="text-red-500">*</span></Label>
                <select className="w-full border rounded-md px-3 py-2 text-sm" value={form.projectId} onChange={e => setForm(f => ({ ...f, projectId: e.target.value }))}>
                  <option value="">請選擇專案</option>
                  {projects?.filter((p: any) => p.isActive !== false || String(p.id) === String(form.projectId)).map((p: any) => <option key={p.id} value={p.id}>{p.name}{p.isActive === false ? "（已停用）" : ""}</option>)}
                </select>
              </div>
              <div>
                <Label>所屬部門</Label>
                <select className="w-full border rounded-md px-3 py-2 text-sm" value={form.departmentId} onChange={e => setForm(f => ({ ...f, departmentId: e.target.value }))}>
                  <option value="">無</option>
                  {departments?.filter((d: any) => d.isActive !== false || String(d.id) === form.departmentId).map(d => <option key={d.id} value={d.id}>{d.name}{(d as any).isActive === false ? "（已停用）" : ""}</option>)}
                </select>
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {voucherType === "請款單" ? (
                <div>
                  <Label>請款人（員工）</Label>
                  <LookupSelect className="w-full border rounded-md px-3 py-2 text-sm" value={form.employeeId} onChange={e => setForm(f => ({ ...f, employeeId: e.target.value }))}>
                    <option value="">選擇員工</option>
                    {employees?.map(e => <option key={e.id} value={e.id}>{e.firstName} {e.lastName}</option>)}
                  </LookupSelect>
                </div>
              ) : voucherType === "付款單" ? (
                <div>
                  <Label>供應商</Label>
                  <LookupSelect className="w-full border rounded-md px-3 py-2 text-sm" value={form.supplierId} onChange={e => {
                    const v = e.target.value;
                    setForm(f => ({ ...f, supplierId: v, items: [{ description: "", amount: 0, invoiceId: 0 }] }));
                    fetchOpenInvoices(v);
                  }}>
                    <option value="">選擇供應商</option>
                    {suppliers.map((s: any) => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </LookupSelect>
                </div>
              ) : (
                <div>
                  <Label>客戶</Label>
                  <LookupSelect className="w-full border rounded-md px-3 py-2 text-sm" value={form.customerId} onChange={e => {
                    const v = e.target.value;
                    setForm(f => ({ ...f, customerId: v, items: [{ description: "", amount: 0, invoiceId: 0 }] }));
                    fetchOpenInvoices(v);
                  }}>
                    <option value="">選擇客戶</option>
                    {customers?.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </LookupSelect>
                </div>
              )}
            </div>

            {((voucherType === "收款單" && form.customerId) || (voucherType === "付款單" && form.supplierId)) && (
              <div className="rounded-lg border-2 border-blue-200 bg-blue-50/50 p-4">
                <div className="font-medium text-blue-900 mb-2">{voucherType === "收款單" ? "未結發票（勾選以沖銷）" : "未付採購發票（勾選以沖銷）"}</div>
                {loadingInvoices ? (
                  <div className="text-sm text-muted-foreground">載入中…</div>
                ) : openInvoices.length === 0 ? (
                  <div className="text-sm text-muted-foreground">此客戶目前沒有未結發票</div>
                ) : (
                  <div className="space-y-1">
                    {openInvoices.map((inv: any) => {
                      const settleItem = form.items.find(it => Number(it.invoiceId || 0) === inv.id);
                      const checked = !!settleItem;
                      return (
                        <div key={inv.id} className="flex items-center gap-2 text-sm py-1 border-b last:border-0">
                          <input type="checkbox" checked={checked} onChange={e => toggleInvoiceSettle(inv, e.target.checked)} />
                          <span className="font-mono text-xs w-32">{inv.invoiceNumber}</span>
                          <span className="text-xs text-muted-foreground w-24">{inv.invoiceDate}</span>
                          <span className="text-xs flex-1">{voucherType === "收款單" ? "未收" : "未付"} ${Number(inv.outstandingAmount).toLocaleString()} / 總額 ${Number(inv.totalAmount).toLocaleString()}</span>
                          {checked && (
                            <Input
                              type="number"
                              className="w-32 h-8"
                              value={settleItem!.amount || ""}
                              max={inv.outstandingAmount}
                              onChange={e => updateSettleAmount(inv.id, Number(e.target.value))}
                            />
                          )}
                          {checked && inv.currency && inv.currency !== "TWD" && (
                            <Input
                              type="number"
                              step="0.0001"
                              className="w-28 h-8"
                              title={`${inv.currency} 發票，入帳匯率 ${Number(inv.exchangeRate)}。填今天實際的匯率，差額會記成兌換損益`}
                              placeholder={`匯率 ${Number(inv.exchangeRate)}`}
                              value={paymentRates[inv.id] ?? ""}
                              onChange={e => setPaymentRates(prev => ({ ...prev, [inv.id]: e.target.value }))}
                            />
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
                <div className="text-xs text-amber-700 mt-2">勾選的發票會在{voucherType}建立時自動沖銷，更新發票的「{voucherType === "收款單" ? "已收 / 未收" : "已付 / 未付"}」金額與狀態。</div>
                {form.items.some(it => Number(it.invoiceId || 0) > 0) && (
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <Label htmlFor="voucher-actual-cash" className="text-sm">{voucherType === "收款單" ? "實際收到的台幣" : "實際付出的台幣"}</Label>
                    <Input id="voucher-actual-cash" type="number" inputMode="decimal" min="0" className="w-40 h-9" value={actualCash} onChange={e => setActualCash(e.target.value)} placeholder="和帳上一樣免填" data-testid="input-actual-cash" />
                    <span className="text-xs text-muted-foreground">外幣貨款換匯去付、金額和帳上不同時才填，差額自動記兌換損益。</span>
                  </div>
                )}
              </div>
            )}

            {((voucherType === "收款單" && form.customerId) || (voucherType === "付款單" && form.supplierId)) && openOrders.length > 0 && (
              <div className="rounded-lg border-2 border-emerald-200 bg-emerald-50/50 p-4" data-testid="voucher-open-orders">
                <div className="font-medium text-emerald-900 mb-2">{voucherType === "收款單" ? "未收完的銷貨單（勾選以核對）" : "未付完的採購單（勾選以核對）"}</div>
                <div className="space-y-1">
                  {openOrders.map((order: any) => {
                    const line = form.items.find(it => Number(it.orderId || 0) === order.id);
                    const total = Number(order.totalAmountTWD ?? order.totalAmount);
                    return (
                      <div key={order.id} className="flex items-center gap-2 text-sm py-1 border-b last:border-0">
                        <input type="checkbox" checked={!!line} onChange={e => toggleOrderSettle(order, e.target.checked)} />
                        <span className="font-mono text-xs w-32">{order.orderNumber}</span>
                        <span className="text-xs text-muted-foreground w-24">{order.orderDate}</span>
                        <span className="text-xs flex-1">{voucherType === "收款單" ? "未收" : "未付"} ${Number(order.outstandingAmount).toLocaleString()} / 總額 ${total.toLocaleString()}{voucherType === "收款單" && (order.status === "Draft" || order.status === "草稿") ? "（訂單未成立，記為預收訂金）" : ""}</span>
                        {line && (
                          <Input type="number" className="w-32 h-8" value={line.amount || ""} max={order.outstandingAmount} onChange={e => updateOrderAmount(order.id, Number(e.target.value))} />
                        )}
                      </div>
                    );
                  })}
                </div>
                <div className="text-xs text-amber-700 mt-2">用於還沒開發票就先{voucherType === "收款單" ? "收" : "付"}的訂金。之後開發票時，這筆錢會自動算進發票的{voucherType === "收款單" ? "已收" : "已付"}金額；已經開發票的部分請改勾上面的發票。</div>
              </div>
            )}

            {!((voucherType === "收款單" || voucherType === "付款單") && form.items.some(it => Number(it.invoiceId || 0) > 0 || Number(it.orderId || 0) > 0)) && (
              <div>
                <div className="flex justify-between items-center mb-2">
                  <Label>{isCashSlip ? "摘要" : "項目明細"}</Label>
                  <Button variant="outline" size="sm" onClick={addItem}><Plus className="h-3 w-3 mr-1" />{isCashSlip ? "新增一行" : "新增項目"}</Button>
                </div>
                {form.items.filter(it => !it.invoiceId && !it.orderId).map((item, i) => (
                  <div key={i} className="flex gap-2 mb-2 items-center">
                    <Input className="flex-1" placeholder={isCashSlip ? "摘要（會顯示在日記帳）" : "項目內容"} aria-label={isCashSlip ? `第 ${i + 1} 行摘要` : `第 ${i + 1} 行項目內容`} value={item.description} onChange={e => updateItem(i, "description", e.target.value)} />
                    <Input className="w-32" type="number" placeholder="金額" value={item.amount || ""} onChange={e => updateItem(i, "amount", Number(e.target.value))} />
                    {form.items.length > 1 && (
                      <Button variant="ghost" size="sm" onClick={() => removeItem(i)}><Trash2 className="h-4 w-4 text-red-500" /></Button>
                    )}
                  </div>
                ))}
              </div>
            )}
            {isCashSlip && <p className="text-xs text-muted-foreground">每一行的「摘要」會原樣變成日記帳、總分類帳那一行的摘要（前面帶客戶／供應商名稱）；「備註」只留在這張單上。</p>}
            <div className="text-right font-semibold mt-2">合計：${totalAmount.toLocaleString()}</div>
          </div>
      </DocWindow>
    </div>
  );
}
